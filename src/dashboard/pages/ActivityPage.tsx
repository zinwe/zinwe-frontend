import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/authContext";
import { upgradeBeingChecked } from "../../auth/steps";
import { usePageMeta } from "../../hooks/usePageMeta";
import { decideBreak, errorMessage, getWorkLog } from "../../lib/api";
import { AskBlock } from "../activity/AskBlock";
import {
  askItems,
  breaksCell,
  buildRows,
  dayInfo,
  dayOptions,
  endedCell,
  NOW_PILL,
  nowStatus,
  startedCell,
  type DayRow,
  type LocalDecision,
} from "../activity/model";
import { SheetBody } from "../activity/SheetBody";
import { Timeline } from "../activity/Timeline";
import { PagePlanGate } from "../components/PlanLock";
import { useEntitlements } from "../features/entitlements";
import { isoDay, shiftDay, summarizeDay } from "../features/workDay";
import { secondPcsNow } from "../fixtures/pcs";
import { Bell } from "../shell/Bell";
import { useShell } from "../shell/shellContext";
import { FilterSheet } from "../team/FilterSheet";
import { hmDuration } from "../team/format";
import { useNow } from "../time";
import { EmptyBlock, ErrorBlock, Sk, SkRows } from "../ui/States";
import { useTip } from "../ui/useTip";
import { useResource } from "../useResource";
import "../../styles/dash13/team.css";
import "../../styles/dash13/activity.css";

const UNDO_MS = 6000;

function parseDay(raw: string | null, today: string): string {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw <= today ? raw : today;
}

/** Plan enforcement: the whole page is work_time; without it, a lock card shows instead. */
export default function ActivityPage(): ReactElement {
  return (
    <PagePlanGate
      module="work_time"
      title="Today’s activity"
      lede="Start day, breaks and End day, exactly as each person pressed them in Zinwe."
      lock="See when each person started their day, every break and why, and when they ended it. Approve breaks or ask about them from one page."
    >
      <ActivityPageContent />
    </PagePlanGate>
  );
}

/**
 * Today's activity (DashActivity): one day at a time — tiles, everyone's row (started, breaks, ended, worked,
 * now) with requests waiting for the owner's OK inside the person's own row, and the selected person's day strip
 * and timeline. `?date=` picks the day; `#m=<first>` (or `?member=<id>`) selects and highlights a person.
 */
function ActivityPageContent(): ReactElement {
  usePageMeta({
    title: "Today’s activity — Zinwe",
    description:
      "Start day, breaks and End day, exactly as each person pressed them in Zinwe.",
  });

  const now = useNow(60_000);
  const today = isoDay(new Date(now));
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  // The plan keeps `historyDays` of work log (0 = everything): the day picker stops there.
  const { historyDays } = useEntitlements();
  const upgradeInCheck = upgradeBeingChecked(useAuth().account?.subscription);
  const earliest = historyDays ? shiftDay(today, -historyDays) : undefined;
  const parsed = parseDay(params.get("date"), today);
  const day = earliest && parsed < earliest ? earliest : parsed;
  const isToday = day === today;
  // Phone filter sheet days (worked out before anything memoises on `day`).
  const dayOpts = dayOptions(today, earliest, day);
  const prevDay = shiftDay(day, -1);
  const nextDay = shiftDay(day, 1);
  const atEarliest = earliest !== undefined && day <= earliest;
  const info = dayInfo(day, today);

  const loadLog = useCallback(
    (signal: AbortSignal) => getWorkLog({ date: day }, signal),
    [day],
  );
  const log = useResource(loadLog, {
    resetKey: day,
    pollMs: isToday ? 60_000 : undefined,
  });
  const shell = useShell();
  const { decided: decidedAnywhere, markDecided } = shell;
  const members = useMemo(() => shell.members ?? [], [shell.members]);
  const tip = useTip();

  const people = useMemo(
    () => (log.data ? summarizeDay(log.data, isToday, now) : []),
    [log.data, isToday, now],
  );
  const rows = useMemo(() => buildRows(people, members), [people, members]);
  const activeCount = members.filter((m) => m.is_active).length;

  // FR-11 links: ?member=<id>; board links: #m=<first name>.
  const hashM = (
    new URLSearchParams(location.hash.replace(/^#/, "")).get("m") ?? ""
  ).toLowerCase();
  const memberParam = Number(params.get("member")) || null;
  const linkedKey = useMemo(() => {
    const hit = rows.find(
      (r) =>
        (memberParam !== null && r.memberId === memberParam) ||
        (hashM !== "" && r.first.toLowerCase() === hashM),
    );
    return hit?.key ?? null;
  }, [rows, memberParam, hashM]);

  // ---- Decisions: made here, Undo for 6 s, then sent (decideBreak). Leaving the page sends them at once.
  const [decisions, setDecisions] = useState<Record<number, LocalDecision>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [noting, setNoting] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [reopened, setReopened] = useState<ReadonlySet<number>>(new Set());
  const timers = useRef(
    new Map<
      number,
      { timer: number; val: "approved" | "denied"; note: string }
    >(),
  );
  const reload = log.reload;

  const commit = useCallback(
    (id: number) => {
      const job = timers.current.get(id);
      if (!job) return;
      timers.current.delete(id);
      setDecisions((d) =>
        d[id] ? { ...d, [id]: { ...d[id], phase: "sending" } } : d,
      );
      decideBreak(id, job.val, job.note.trim()).then(
        () => {
          setDecisions((d) =>
            d[id] ? { ...d, [id]: { ...d[id], phase: "done" } } : d,
          );
          setReopened((s) => {
            if (!s.has(id)) return s;
            const n = new Set(s);
            n.delete(id);
            return n;
          });
          reload();
        },
        (err: unknown) => {
          setDecisions((d) => {
            const n = { ...d };
            delete n[id];
            return n;
          });
          markDecided(id, null);
          setErrors((e) => ({ ...e, [id]: errorMessage(err) }));
        },
      );
    },
    [reload, markDecided],
  );
  useEffect(() => {
    const jobs = timers.current;
    return () => {
      for (const [id, job] of jobs) {
        window.clearTimeout(job.timer);
        void decideBreak(id, job.val, job.note.trim()).catch(() => undefined);
      }
      jobs.clear();
    };
  }, []);

  const decide = (id: number, val: "approved" | "denied", note: string) => {
    const old = timers.current.get(id);
    if (old) window.clearTimeout(old.timer);
    timers.current.set(id, {
      timer: window.setTimeout(() => commit(id), UNDO_MS),
      val,
      note,
    });
    setDecisions((d) => ({
      ...d,
      [id]: { val, note: note.trim(), phase: "undo" },
    }));
    // F-02: Overview and the bell hide it now, not after the 6 s Undo window.
    markDecided(id, val);
    setErrors((e) => ({ ...e, [id]: "" }));
    setNoting(null);
  };
  const undo = (id: number) => {
    const job = timers.current.get(id);
    if (job) window.clearTimeout(job.timer);
    timers.current.delete(id);
    setDecisions((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
    markDecided(id, null);
  };
  const change = (id: number) => {
    setDecisions((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
    setReopened((s) => new Set(s).add(id));
    markDecided(id, null);
  };

  const asksOf = (r: DayRow) =>
    askItems(r.person, isToday).filter(
      (a) =>
        decisions[a.id] ||
        (a.approval === "pending" && !decidedAnywhere[a.id]) ||
        reopened.has(a.id),
    );
  const pendingOf = (r: DayRow) =>
    asksOf(r).filter((a) => !decisions[a.id]).length;
  const freshOf = (r: DayRow) =>
    asksOf(r).some((a) => decisions[a.id]?.phase === "undo");
  const pendCount = rows.reduce((sum, r) => sum + pendingOf(r), 0);
  const pendPeople = rows.filter((r) => pendingOf(r) > 0).length;

  const [filter, setFilter] = useState<"all" | "ok">("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const top = (r: DayRow) => pendingOf(r) > 0 || freshOf(r);
  const ordered = [...rows.filter(top), ...rows.filter((r) => !top(r))];
  const shown = filter === "ok" ? ordered.filter(top) : ordered;

  // The picked person, for this day only (a new day starts from the default again).
  const [picked, setPicked] = useState<{ day: string; key: string } | null>(null);
  const sel = picked?.day === day ? picked.key : null;
  const setSel = (key: string) => setPicked({ day, key });
  const selected =
    rows.find((r) => r.key === sel) ??
    rows.find((r) => r.key === linkedKey) ??
    ordered.find((r) => pendingOf(r) > 0) ??
    rows.find((r) => r.person) ??
    rows[0];
  const second =
    selected?.memberId != null
      ? secondPcsNow(members).find((s) => s.memberId === selected.memberId)
      : undefined;

  // A #m= link scrolls that person's tile into view once.
  const scrolled = useRef<string | null>(null);
  useEffect(() => {
    if (!linkedKey || scrolled.current === linkedKey) return;
    scrolled.current = linkedKey;
    window.setTimeout(
      () =>
        document
          .getElementById(`tile-${linkedKey}`)
          ?.scrollIntoView({ block: "center" }),
      60,
    );
  }, [linkedKey]);

  const go = (next: string) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === today) p.delete("date");
        else p.set("date", next);
        return p;
      },
      { replace: true },
    );
    setFilter("all");
    tip.hide();
  };
  const dateInput = useRef<HTMLInputElement>(null);
  const openPicker = () => {
    const el = dateInput.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };

  const count = (k: string) =>
    rows.filter((r) => nowStatus(r.person, isToday) === k).length;
  const worked = rows.filter((r) => r.person).length;
  const tiles = [
    {
      label: "People who worked",
      value: activeCount ? `${worked} of ${activeCount}` : String(worked),
      color: "#141210",
    },
    {
      label: "Working now",
      value: isToday ? String(count("working")) : "—",
      color: "#141210",
    },
    {
      label: "On a break now",
      value: isToday ? String(count("break")) : "—",
      color: "#A84505",
    },
    {
      label: "Waiting for your OK",
      value: String(pendCount),
      color: pendCount ? "#A84505" : "#141210",
    },
    { label: "Ended day", value: String(count("out")), color: "#141210" },
  ];
  const filterCount = (isToday ? 0 : 1) + (filter !== "all" ? 1 : 0);
  const showPending = () => {
    setFilter("ok");
    document
      .getElementById("people")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const pick = (r: DayRow) => {
    setSel(r.key);
    tip.hide();
    if (window.innerWidth <= 760) {
      window.setTimeout(
        () =>
          document
            .getElementById("timeline")
            ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        30,
      );
    }
  };

  return (
    <div className="zp-act">
      {/* Header row: title (+ the "waiting for your OK" chip), day picker, then the bell (last item). */}
      <header className="zn-head">
        <div className="zn-head__text za-headtext">
          <div className="za-titlerow">
            <h1>{info.title}</h1>
            {pendCount > 0 ? (
              <button
                type="button"
                className="za-okchip"
                onClick={showPending}
                aria-label={`Show the ${pendPeople} people waiting for your OK`}
              >
                {pendCount} waiting for your OK
              </button>
            ) : null}
          </div>
          <p>
            Start day, breaks and End day, exactly as each person pressed them
            in Zinwe.
          </p>
        </div>
        <div className="za-daypick">
          <button
            type="button"
            className="z-btn sm"
            onClick={() => go(prevDay)}
            disabled={atEarliest}
            aria-label="Previous day"
          >
            ‹ Previous
          </button>
          <span className="za-daylabel">
            <button
              type="button"
              className="za-daybtn"
              onClick={openPicker}
              aria-label={`${info.label}, ${info.date}. Pick another date`}
            >
              <b>{info.label}</b>
              <br />
              <span>{info.date}</span>
            </button>
            <input
              ref={dateInput}
              type="date"
              className="za-dateinput"
              tabIndex={-1}
              aria-hidden="true"
              value={day}
              min={earliest}
              max={today}
              onChange={(e) => e.target.value && go(e.target.value)}
            />
          </span>
          <button
            type="button"
            className="z-btn sm"
            onClick={() => go(nextDay)}
            disabled={isToday}
            aria-label="Next day"
          >
            Next ›
          </button>
          {!isToday ? (
            <button
              type="button"
              className="za-linkbtn"
              onClick={() => go(today)}
            >
              Back to today
            </button>
          ) : null}
        </div>
        <Bell placement="page" />
      </header>

      {atEarliest ? (
        <p className="za-limit">
          Your plan keeps {historyDays} days of activity.{" "}
          {upgradeInCheck ? (
            "Your upgrade is being checked."
          ) : (
            <Link to="/onboarding/plan">Upgrade to keep more</Link>
          )}
        </p>
      ) : null}

      <section aria-label="Day in numbers" className="za-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="z-card za-tile">
            <span>{t.label}</span>
            {log.data ? (
              <b className="z-num" style={{ color: t.color }}>
                {t.value}
              </b>
            ) : (
              <Sk w={56} h={26} style={{ marginTop: 6 }} />
            )}
          </div>
        ))}
      </section>

      <div className="za-cols">
        <section id="people" className="z-card za-people" aria-label="Everyone">
          <div className="za-ph">
            <div className="za-ph__text">
              <h2>Everyone, {info.short}</h2>
              <span>Select a name to see their day</span>
            </div>
            <div className="z-segs za-fseg" role="group" aria-label="Filter">
              {(
                [
                  ["all", "Everyone", rows.length],
                  ["ok", "Waiting for your OK", pendCount],
                ] as const
              ).map(([k, label, n]) => (
                <button
                  key={k}
                  type="button"
                  className="z-seg"
                  aria-pressed={filter === k}
                  onClick={() => setFilter(k)}
                >
                  {label}{" "}
                  <span className="z-num" style={{ opacity: 0.6 }}>
                    {n}
                  </span>
                </button>
              ))}
            </div>
            {/* Phone: the day and the filter move into a bottom sheet behind this button. */}
            <button
              type="button"
              id="act-filters-btn"
              className="z-btn sm za-fbtn"
              aria-haspopup="dialog"
              aria-expanded={sheetOpen}
              onClick={() => setSheetOpen(true)}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M4 6h16M7 12h10M10 18h4" />
              </svg>
              {filterCount ? `Filters · ${filterCount}` : "Filters"}
            </button>
          </div>
          <FilterSheet
            id="act-filters"
            title="Filters"
            open={sheetOpen}
            onClose={closeSheet}
            returnTo="act-filters-btn"
          >
            <SheetBody
              days={dayOpts}
              day={day}
              earliest={earliest}
              today={today}
              onDay={go}
              filters={[
                { key: "all", label: "Everyone", n: rows.length, on: filter === "all" },
                { key: "ok", label: "Waiting for your OK", n: pendCount, on: filter === "ok" },
              ]}
              onFilter={(k) => {
                setFilter(k);
                closeSheet();
              }}
            />
          </FilterSheet>

          {log.data === undefined ? (
            log.error ? (
              <ErrorBlock
                title="We couldn't load this day"
                message={errorMessage(log.error)}
                onRetry={log.reload}
              />
            ) : (
              <SkRows label="Loading the day…" rows={5} />
            )
          ) : rows.length === 0 ? (
            <EmptyBlock
              icon="activity"
              title={
                isToday
                  ? "No one has started yet today"
                  : "No work recorded that day"
              }
              action={
                activeCount === 0 ? (
                  <Link className="z-btn sm pri" to="/app/team#add=1">
                    Add your team
                  </Link>
                ) : undefined
              }
            >
              When someone presses Start day in their Zinwe app, their day shows
              up here, with every break and when they end it.
            </EmptyBlock>
          ) : (
            <div className="za-scroll">
              {log.error ? (
                <p className="za-stale" role="status">
                  Showing what we had a moment ago. {errorMessage(log.error)}{" "}
                  <button
                    type="button"
                    className="za-linkbtn"
                    onClick={log.reload}
                  >
                    Try again
                  </button>
                </p>
              ) : null}
              <div className="za-plist" role="list">
                <div className="za-prow za-phead" aria-hidden="true">
                  <span>Person</span>
                  <span>Started day</span>
                  <span>Took a break</span>
                  <span>Ended day</span>
                  <span>Worked</span>
                  <span>Now</span>
                </div>
                {shown.map((r) => {
                  const asks = asksOf(r);
                  const pending = pendingOf(r) > 0;
                  const fresh = freshOf(r);
                  const freshVal = asks
                    .map((a) => decisions[a.id])
                    .find((d) => d?.phase === "undo")?.val;
                  const isSel = selected?.key === r.key;
                  const linked = linkedKey === r.key;
                  const st = NOW_PILL[nowStatus(r.person, isToday)];
                  const ended = endedCell(r.person, isToday);
                  const p = r.person;
                  const live =
                    p && !p.fromServer && isToday
                      ? (members.find((m) => m.id === r.memberId)?.device
                          ?.worked_seconds ?? 0)
                      : 0;
                  const workedS = p ? (live > 0 ? live : p.workedSeconds) : 0;
                  const border = pending
                    ? "#A84505"
                    : fresh
                      ? freshVal === "approved"
                        ? "#17663F"
                        : "#6B6B6B"
                      : linked
                        ? "#F26A0A"
                        : "transparent";
                  return (
                    <div
                      key={r.key}
                      id={`tile-${r.key}`}
                      className="za-ptile"
                      role="listitem"
                      style={{
                        borderLeftColor: border,
                        background: pending
                          ? "#FAFAFA"
                          : isSel
                            ? "#FFF6EF"
                            : "#FFFFFF",
                        boxShadow: linked
                          ? "inset 0 0 0 2px #F26A0A"
                          : isSel && pending
                            ? "inset 0 0 0 1px #F6C9A6"
                            : undefined,
                      }}
                    >
                      <div className="za-prow">
                        <span className="za-c-name">
                          <button
                            type="button"
                            className="za-rowbtn"
                            onClick={() => pick(r)}
                            aria-pressed={isSel}
                          >
                            {r.name}
                          </button>
                          <br />
                          <span className="z-mono za-pc">{r.pc}</span>
                        </span>
                        <span className="z-num">
                          <span className="za-mlab">Started day</span>
                          {startedCell(p)}
                        </span>
                        <span className="z-num">
                          <span className="za-mlab">Breaks</span>
                          {breaksCell(p, isToday)}
                        </span>
                        <span
                          className={`z-num za-c-out${ended.has ? " has" : ""}${ended.warn ? " za-warn" : ""}`}
                        >
                          <span className="za-mlab">Ended day</span>
                          {ended.text}
                        </span>
                        <span
                          className="z-num"
                          title={
                            p?.openEnded
                              ? "Time after the last change isn't counted: no log-out was recorded."
                              : undefined
                          }
                        >
                          <span className="za-mlab">Worked</span>
                          <b>
                            {p ? hmDuration(workedS, "0 min") : "—"}
                            {p?.openEnded ? (
                              <span aria-hidden="true">*</span>
                            ) : null}
                          </b>
                        </span>
                        <span className="za-c-now">
                          <span className={`z-pill ${st.cls}`}>{st.label}</span>
                        </span>
                      </div>
                      {asks.length ? (
                        <div
                          className={`za-asks${asks.length === 1 ? " one" : ""}`}
                        >
                          {asks.map((a) => (
                            <AskBlock
                              key={a.id}
                              item={a}
                              first={r.first}
                              pos="their"
                              decision={decisions[a.id]}
                              noting={noting === a.id}
                              note={notes[a.id] ?? ""}
                              error={errors[a.id] ?? ""}
                              onApprove={() => {
                                setSel(r.key);
                                decide(a.id, "approved", "");
                              }}
                              onDeny={() => {
                                setSel(r.key);
                                setNoting(a.id);
                              }}
                              onNote={(v) =>
                                setNotes((n) => ({ ...n, [a.id]: v }))
                              }
                              onSend={() =>
                                decide(a.id, "denied", notes[a.id] ?? "")
                              }
                              onCancel={() => setNoting(null)}
                              onUndo={() => undo(a.id)}
                              onChange={() => change(a.id)}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {shown.length === 0 ? (
                  <div className="za-empty">
                    Nothing waiting for your OK.{" "}
                    <button
                      type="button"
                      className="za-linkbtn"
                      onClick={() => setFilter("all")}
                    >
                      See everyone
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </section>

        {log.data === undefined && !log.error ? (
          <aside className="z-card za-tl" aria-busy="true">
            <Sk w="50%" h={16} />
            <Sk w="40%" h={10} />
            <Sk h={22} />
            <Sk w="70%" h={12} />
            <Sk w="60%" h={12} />
          </aside>
        ) : (
          <Timeline
            row={selected}
            day={day}
            info={info}
            isToday={isToday}
            now={now}
            decisions={decisions}
            second={second}
            tip={tip}
            onChange={(id) => {
              change(id);
              document
                .getElementById("people")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
        )}
      </div>
      {tip.node}
    </div>
  );
}
