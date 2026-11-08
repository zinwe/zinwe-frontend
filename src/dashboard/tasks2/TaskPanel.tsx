import { useEffect, useRef, useState, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { errorMessage, type TeamTaskRepeat } from "../../lib/api";
import {
  clock,
  dayWords,
  dueIso,
  dueOf,
  happen,
  isClosed,
  journey,
  listWords,
  memberIdOf,
  namesOf,
  personIn,
  personState,
  pillOf,
  stepInfo,
  when,
  whenLong,
  type TTask,
} from "./engine";
import { avStyle, chatHrefOf, prefillOf, runDirect } from "./actions";
import { useToast } from "./toast";
import {
  Av,
  IcChat,
  IcClock,
  IcClose,
  IcFlag,
  IcLock,
  IcMore,
  IcPerson,
  IcPlus,
  IcRepeat,
  IcSend,
  IcTick,
  type PanelCard,
  type PanelTab,
  type Say,
  type TaskPrefill,
} from "./parts";
import { TaskForm } from "./TaskForm";
import { useTaskChat, type TeamTasks } from "./useTeamTasks";

const MOVE_DUE: ReadonlyArray<[number, string]> = [
  [0, "6:00 PM"],
  [1, "12:00 PM"],
  [1, "6:00 PM"],
  [2, "6:00 PM"],
  [3, "6:00 PM"],
];
const REPEATS: ReadonlyArray<[string, TeamTaskRepeat]> = [
  ["Doesn’t repeat", ""],
  ["Every day", "day"],
  ["Every week", "week"],
  ["Every month", "month"],
];

type Mode = { kind: "view" } | { kind: "edit" } | { kind: "create"; prefill?: TaskPrefill };

/**
 * The task panel (spec 2): right panel 560 px on a desktop, a full-height bottom sheet on a phone. Header (pill, due,
 * High, chat icon + badge, ⋯ menu, ×), tabs Overview · Chat · Activity, title (click to rename) + meta, the
 * "What's happening" card with its buttons and inline cards (reply, reopen note, reassign, move due, cancel), the
 * journey bar, people (or one compact person line), the steps relay (owners, Now / After step N, + Add a step),
 * details and the task chat preview. Chat tab = the one shared task chat with its composer; Activity = the timeline.
 * `taskId` null with `create` = the form (TaskForm) in the same panel; after Send it turns into that task's panel.
 */
export function TaskPanel({
  team,
  taskId,
  create,
  tab: tab0 = "overview",
  card: card0 = null,
  onClose,
  onOpen,
  say: sayProp,
  chatHref,
}: {
  team: TeamTasks;
  /** The task to show; null with `create` = a new task. */
  taskId: number | null;
  /** Open as the new-task form, with these values filled in. */
  create?: TaskPrefill | null;
  /** First tab shown. */
  tab?: PanelTab;
  /** Open an inline card in "What's happening" (e.g. Overview's Reply → "reply"). */
  card?: PanelCard | null;
  onClose: () => void;
  /** The panel now shows another task (after Send / Duplicate): keep the URL in step. */
  onOpen?: (id: number) => void;
  /** Toasts go here (the page's toast); the panel has its own when left out. */
  say?: Say;
  /** Where "Open chat" goes for this task (default: its group or the one person's chat). */
  chatHref?: (t: TTask) => string | null;
}): ReactElement | null {
  const own = useToast();
  const say = sayProp ?? own.say;
  const [mode, setMode] = useState<Mode>(create !== undefined && create !== null && taskId == null ? { kind: "create", prefill: create } : { kind: "view" });
  const [shown, setShown] = useState<number | null>(taskId);
  const [tab, setTab] = useState<PanelTab>(tab0);
  const [card, setCard] = useState<PanelCard | null>(card0);
  const [cardText, setCardText] = useState("");
  const [menu, setMenu] = useState<"" | "menu" | "repeat">("");
  const [ownerPick, setOwnerPick] = useState(-1);
  const [adding, setAdding] = useState(false);
  const [stepText, setStepText] = useState("");
  const [title, setTitle] = useState<string | null>(null);
  const [chatText, setChatText] = useState("");
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLElement>(null);

  // A new taskId from outside (another row clicked) resets the panel to it.
  const [seenProps, setSeenProps] = useState({ taskId, tab0, card0 });
  if (seenProps.taskId !== taskId || seenProps.tab0 !== tab0 || seenProps.card0 !== card0) {
    setSeenProps({ taskId, tab0, card0 });
    setShown(taskId);
    setTab(tab0);
    setCard(card0);
    setCardText("");
    setMenu("");
    setTitle(null);
    if (taskId != null) setMode({ kind: "view" });
  }

  const t = shown != null ? team.byId(shown) : undefined;
  const chat = useTaskChat(team, t?.id ?? null, tab === "chat" && mode.kind === "view");
  const msgsRef = useRef<HTMLDivElement>(null);
  const nLines = chat.lines?.length ?? 0;
  useEffect(() => {
    if (tab === "chat") msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight });
  }, [tab, nLines]);
  useEffect(() => {
    panelRef.current?.focus();
  }, [shown, mode.kind]);

  const { dir, now } = team;

  if (mode.kind !== "view" || !t) {
    if (mode.kind === "view") return null; // the task is gone (or not loaded yet)
    return (
      <div className="tv">
        <button type="button" className="tv-scrim" aria-label="Close" tabIndex={-1} onClick={onClose} />
        <aside ref={panelRef} tabIndex={-1} className="tv-panel" role="dialog" aria-modal="true" aria-label={mode.kind === "edit" ? "Edit task" : "New task"} onKeyDown={(e) => e.key === "Escape" && onClose()}>
          <TaskForm
            bare
            team={team}
            prefill={mode.kind === "create" ? mode.prefill : undefined}
            editing={mode.kind === "edit" ? t : null}
            say={say}
            onClose={() => (mode.kind === "edit" ? setMode({ kind: "view" }) : onClose())}
            onSent={(saved) => {
              setMode({ kind: "view" });
              setShown(saved.id);
              setTab("overview");
              setCard(null);
              onOpen?.(saved.id);
            }}
          />
        </aside>
        {sayProp ? null : own.node}
      </div>
    );
  }

  const owner = true;
  const id = t.id;
  const h = happen(t, dir, now);
  const pill = pillOf(t);
  const due = dueOf(t, now);
  const info = stepInfo(t);
  const team2 = t.people.length > 1;
  const closed = isClosed(t);
  const others = dir.list.filter((p) => !t.people.includes(p.key));
  const solo = personIn(dir, t.people[0]);

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      after?.();
    } catch (err) {
      say(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const act = async (a: string) => {
    if (busy) return;
    setBusy(true);
    const done = await runDirect(team, t, a, say);
    setBusy(false);
    if (done) return;
    if (a === "reply" || a === "reopen" || a === "reassign" || a === "due") {
      setCard(a);
      setCardText("");
    }
  };
  const cardGo = () => {
    const txt = cardText.trim();
    if (card === "reply") {
      if (!txt) return;
      void run(() => team.act.action(id, { action: "reply", note: txt }), () => setCard(null));
    } else if (card === "reopen") {
      void run(() => team.act.action(id, { action: "reopen", note: txt || "Please take another look." }), () => setCard(null));
    }
  };
  const patchSteps = (steps: Array<{ id?: number; title: string; owner_id: number | null }>) => team.act.patch(id, { steps });
  const stepsNow = () => t.steps.map((s) => ({ ...(s.id != null ? { id: s.id } : {}), title: s.text, owner_id: memberIdOf(s.owner, dir) }));

  const menuItems: Array<[string, string, boolean?]> = (
    [
      ["Edit", "edit"],
      ["Change due date", "due"],
      ["Duplicate", "dup"],
      ["Repeat…", "repeat"],
      ["Copy to chat", "chat"],
      ["Cancel task", "cancel", true],
    ] as Array<[string, string, boolean?]>
  ).filter(([, k]) => !(closed && (k === "cancel" || k === "due")));
  const menuAct = (k: string) => {
    setMenu("");
    if (k === "edit") return setMode({ kind: "edit" });
    if (k === "dup") return setMode({ kind: "create", prefill: prefillOf(t, dir, now) });
    if (k === "due") return (setCard("due"), setTab("overview"));
    if (k === "repeat") return setMenu("repeat");
    if (k === "cancel") return (setCard("cancel"), setTab("overview"));
    if (k === "chat")
      return void run(
        () => team.act.copyToChat(t),
        () => say(t.group ? `Posted in the ${t.group.name} chat.` : `Posted in your chat with ${namesOf(dir, t.people)}.`),
      );
  };

  const cardPh =
    card === "reply"
      ? `Reply to ${t.help ? personIn(dir, t.help.who).first : t.cantdo ? personIn(dir, t.cantdo.who).first : namesOf(dir, t.people)}…`
      : card === "reopen"
        ? "What needs fixing?"
        : "";
  const chatHrefNow = (chatHref ?? ((x: TTask) => chatHrefOf(x, dir)))(t);
  const thrWho = listWords([...t.people.map((k) => personIn(dir, k).first), "you"]);
  const meta = `From you · Sent ${whenLong(t.sentAt, now).replace(/^today, /, "Today, ")}${t.group ? ` · in the ${t.group.name} chat` : ""}`;
  const unread = t.chat.unread;
  const chatN = Math.max(t.chat.count, chat.lines?.length ?? 0);

  const sendChat = () => {
    const x = chatText.trim();
    if (!x) return;
    void run(() => chat.send(x), () => setChatText(""));
  };

  const jr = journey(t, dir, now);
  const events = [...t.events].reverse();

  return (
    <div className="tv">
      <button type="button" className="tv-scrim" aria-label="Close task" tabIndex={-1} onClick={onClose} />
      <aside
        ref={panelRef}
        tabIndex={-1}
        className="tv-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Task: ${t.title}`}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          if (menu || ownerPick >= 0) {
            setMenu("");
            setOwnerPick(-1);
          } else onClose();
        }}
      >
        <div className="tv-ph">
          <span className="tv-pill" data-tone={pill.tone}>
            {pill.label}
          </span>
          <span className="tv-due" data-kind={due.kind}>
            <IcClock />
            {due.chip}
          </span>
          {t.high ? (
            <span className="tv-high">
              <IcFlag />
              High
            </span>
          ) : null}
          {t.repeat ? (
            <span className="tv-rep" title={`Repeats every ${t.repeat}`}>
              <IcRepeat />
              <span className="tv-sr">{`Repeats every ${t.repeat}`}</span>
            </span>
          ) : null}
          <span className="tv-ph__grow" />
          <button
            type="button"
            className="tv-ic tv-ic--chat"
            aria-label={`Task chat, ${chatN} messages${unread ? `, ${unread} new` : ""}`}
            title="Task chat"
            aria-pressed={tab === "chat"}
            onClick={() => setTab("chat")}
          >
            <IcChat />
            {unread ? <b className="tv-badge">{unread}</b> : null}
          </button>
          <button type="button" className="tv-ic" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu === "menu"} onClick={() => setMenu(menu === "menu" ? "" : "menu")}>
            <IcMore />
          </button>
          <button type="button" className="tv-ic" aria-label="Close" onClick={onClose}>
            <IcClose />
          </button>
          {menu === "menu" ? (
            <div className="tv-menu end" role="menu" style={{ minWidth: 220 }}>
              {menuItems.map(([label, k, danger]) => (
                <button key={k} type="button" role="menuitem" className={danger ? "danger" : ""} onClick={() => menuAct(k)}>
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          {menu === "repeat" ? (
            <div className="tv-menu end" role="menu" style={{ minWidth: 220 }}>
              <span className="tv-menu__h">Repeat this task</span>
              {REPEATS.map(([label, r]) => (
                <button
                  key={label}
                  type="button"
                  role="menuitemradio"
                  aria-checked={(t.repeat || "") === r}
                  onClick={() => {
                    setMenu("");
                    void run(
                      () => team.act.patch(id, { repeat: r }),
                      () => say(r ? `Repeats every ${r}. Zinwe sends a fresh copy each time.` : "Repeat is off."),
                    );
                  }}
                >
                  {label}
                  {(t.repeat || "") === r ? (
                    <span className="chk">
                      <IcTick size={16} sw={2.6} />
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="tv-vt" role="tablist" aria-label="Task">
          <button type="button" role="tab" aria-selected={tab === "overview"} onClick={() => setTab("overview")}>
            Overview
          </button>
          <button type="button" role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}>
            <IcChat size={15} />
            Chat<span className="n">{chatN}</span>
            {unread ? <b className="tv-badge in">{unread} new</b> : null}
          </button>
          <button type="button" role="tab" aria-selected={tab === "activity"} onClick={() => setTab("activity")}>
            Activity
          </button>
        </div>

        {tab === "overview" ? (
          <div className="tv-pb">
            <div className="tv-h">
              <h2>
                {title !== null ? (
                  <input
                    aria-label="Title"
                    autoFocus
                    value={title}
                    maxLength={120}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={() => setTitle(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setTitle(null);
                      }
                      if (e.key === "Enter") {
                        const v = title.trim();
                        if (v && v !== t.title) void run(() => team.act.patch(id, { title: v }), () => setTitle(null));
                        else setTitle(null);
                      }
                    }}
                  />
                ) : owner && !closed ? (
                  <button type="button" onClick={() => setTitle(t.title)} title="Click to rename">
                    {t.title}
                  </button>
                ) : (
                  t.title
                )}
              </h2>
              <span className="tv-meta">{meta}</span>
              {t.editedAt ? <span className="tv-edited">{`Edited ${when(t.editedAt, now)}. ${namesOf(dir, t.people)} see${t.people.length === 1 ? "s" : ""} an “Edited” tag.`}</span> : null}
            </div>

            <section className="tv-hap" data-tone={h.tone} aria-label="What’s happening">
              <span className="tv-hap__k">What’s happening</span>
              <span className="tv-hap__t">{h.text}</span>
              {h.sub.length ? <span className="tv-hap__s">{h.sub.join(" · ")}</span> : null}
              {card === "reply" || card === "reopen" ? (
                <div className="tv-hap__in">
                  <textarea aria-label={cardPh} placeholder={cardPh} autoFocus value={cardText} maxLength={1000} onChange={(e) => setCardText(e.target.value)} />
                  <div className="tv-hap__b">
                    <button type="button" className="tv-btn pri" disabled={busy || (card === "reply" && !cardText.trim())} onClick={cardGo}>
                      {card === "reply" ? "Send reply" : "Reopen"}
                    </button>
                    <button type="button" className="tv-btn" onClick={() => setCard(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              {card === "reassign" ? (
                <div className="tv-hap__in">
                  <span className="tv-lab">Give it to someone else. Ticked steps stay ticked.</span>
                  <div className="tv-pick">
                    {others.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const was = namesOf(dir, t.people);
                          if (p.memberId == null) return;
                          void run(
                            () => team.act.action(id, { action: "reassign", member_id: p.memberId as number }),
                            () => {
                              setCard(null);
                              say(`Sent to ${p.first}. ${was} is told it moved.`);
                            },
                          );
                        }}
                      >
                        <span className="tv-av" style={avStyle(p)}>
                          {p.ini}
                        </span>
                        <span>
                          <b>{p.name}</b>
                          <small>{`${p.role || "Team member"}${p.pc ? ` · PC ${p.pc}` : ""}`}</small>
                        </span>
                      </button>
                    ))}
                    {others.length === 0 ? <span className="tv-meta" style={{ padding: 8 }}>Nobody else on your team yet.</span> : null}
                  </div>
                  <div className="tv-hap__b">
                    <button type="button" className="tv-btn" onClick={() => setCard(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              {card === "due" ? (
                <div className="tv-hap__in">
                  <span className="tv-lab">New due date</span>
                  <div className="tv-chips">
                    {MOVE_DUE.map(([d, time]) => {
                      const w = d < 2 ? dayWords(d, now).word : dayWords(d, now).label;
                      return (
                        <button
                          key={`${d}-${time}`}
                          type="button"
                          className="tv-zk"
                          disabled={busy}
                          onClick={() => void run(() => team.act.action(id, { action: "move_due", due_at: dueIso(d, time, now) }), () => setCard(null))}
                        >
                          {`${w}, ${time}`}
                        </button>
                      );
                    })}
                  </div>
                  <div className="tv-hap__b">
                    <button type="button" className="tv-btn" onClick={() => setCard(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              {card === "cancel" ? (
                <div className="tv-hap__in">
                  <span className="tv-lab">Cancel this task? It leaves their Zinwe app. You can restore it later.</span>
                  <div className="tv-hap__b">
                    <button type="button" className="tv-btn pri" disabled={busy} onClick={() => void run(() => team.act.action(id, { action: "cancel" }), () => setCard(null))}>
                      Cancel task
                    </button>
                    <button type="button" className="tv-btn" onClick={() => setCard(null)}>
                      Keep it
                    </button>
                  </div>
                </div>
              ) : null}
              {h.btns.length && !card ? (
                <div className="tv-hap__b">
                  {h.btns.map((b) => (
                    <button
                      key={b.label}
                      type="button"
                      className={b.off ? "tv-btn" : b.pri ? "tv-btn pri" : "tv-btn"}
                      aria-disabled={b.off || undefined}
                      disabled={busy && !b.off}
                      onClick={() => !b.off && void act(b.act)}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>

            <div className="tv-jr" aria-label="Where it is">
              {jr.map((j) => (
                <span key={j.label} className="tv-jr__s" data-st={j.st}>
                  <i />
                  <b>{j.label}</b>
                  <small>{j.time}</small>
                </span>
              ))}
            </div>

            {team2 ? (
              <section className="tv-sec" aria-label="People">
                <span className="tv-sec__h">{`People · ${t.people.length}${t.mode === "any" ? " · the first to start takes it" : ""}`}</span>
                <div>
                  {t.people.map((k) => {
                    const ps = personState(t, k, dir);
                    const P = personIn(dir, k);
                    const pct = ps.n ? ps.d / ps.n : ps.word === "Done" || ps.word === "Approved" ? 1 : 0;
                    const col = ps.tone === "ok" || ps.word === "Approved" ? "#17663F" : "#F26A0A";
                    const canNudge = !["Done", "Approved", "Cancelled", "Needs help", "Can’t do it"].includes(ps.word) && !t.nudgedAt && !ps.word.startsWith("Waits");
                    return (
                      <div key={k} className="tv-prow">
                        <span className="tv-ring" style={{ background: `conic-gradient(${col} ${Math.round(pct * 360)}deg, #EEEEEE 0deg)` }}>
                          <Av dir={dir} k={k} />
                        </span>
                        <span className="tv-prow__n">
                          <b>{P.name}</b>
                          <small>{ps.n ? `${ps.d} of ${ps.n}${ps.n === 1 ? " step" : " steps"}` : P.role || "Team member"}</small>
                        </span>
                        <span className="tv-word" data-tone={ps.tone}>
                          {ps.word}
                        </span>
                        {canNudge ? (
                          <button
                            type="button"
                            className="tv-btn sm"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => team.act.action(id, P.memberId != null ? { action: "nudge", member_id: P.memberId } : { action: "nudge" }),
                                () => say(`Nudged ${P.first}. Zinwe reminds them on their PC.`),
                              )
                            }
                          >
                            Nudge
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : (
              <div className="tv-solo">
                <Av dir={dir} k={t.people[0]}>
                  {solo.pc ? <i data-on={solo.pc === "online" ? "true" : "false"} /> : null}
                </Av>
                <span className="tv-prow__n">
                  <b>{solo.name}</b>
                  <small>{[solo.role, solo.pc ? `PC ${solo.pc}${solo.pc === "offline" && solo.pcSince ? ` since ${solo.pcSince}` : ""}` : ""].filter(Boolean).join(" · ") || "Team member"}</small>
                </span>
                {chatHrefNow ? (
                  <Link className="tv-btn sm" to={chatHrefNow}>
                    <IcChat size={14} />
                    Open chat
                  </Link>
                ) : null}
              </div>
            )}

            <section className="tv-sec" aria-label="Steps">
              <span className="tv-sec__h">{t.steps.length ? `Steps · ${info.done} of ${info.n} done${t.inOrder ? " · in order" : ""}` : "Steps"}</span>
              {t.steps.length ? (
                <ol className="tv-steps" data-order={t.inOrder ? "true" : "false"}>
                  {t.steps.map((s, i) => {
                    const isNow = !s.done && i === info.cur && (t.status === "progress" || t.status === "help") && !closed && (t.inOrder || !team2);
                    const blocked = t.inOrder && !s.done && info.cur >= 0 && i > info.cur;
                    const st = s.done ? "done" : isNow ? "now" : blocked ? "blocked" : "todo";
                    const ow = s.owner ? personIn(dir, s.owner) : null;
                    const canPick = owner && !s.done && !closed;
                    const by = s.done ? `${personIn(dir, s.by ?? s.owner).first} · ${when(s.at, now)}` : "";
                    return (
                      <li key={`${s.id ?? i}`} className="tv-step" data-st={st}>
                        <span className="tv-tick" data-can="false" role="img" aria-label={`Step ${i + 1}: ${s.text}${s.done ? ", done" : ""}`}>
                          {s.done ? <IcTick /> : null}
                          {blocked ? <IcLock /> : null}
                        </span>
                        <span className="tv-step__t">
                          <span>{s.text}</span>
                          {s.done ? <small>{by.replace(/ · $/, "")}</small> : null}
                          {isNow ? (
                            <small>
                              <span className="tv-now">Now</span>
                            </small>
                          ) : null}
                          {blocked ? <small className="tv-after">{`After step ${i}`}</small> : null}
                        </span>
                        <span className="tv-own">
                          <button
                            type="button"
                            disabled={!canPick}
                            aria-label={`Who does step ${i + 1}: ${ow?.name ?? "Anyone"}`}
                            title={ow?.name ?? "Anyone"}
                            aria-expanded={ownerPick === i}
                            onClick={() => canPick && setOwnerPick(ownerPick === i ? -1 : i)}
                          >
                            {ow ? (
                              <span className="tv-av" style={avStyle(ow)}>
                                {ow.ini}
                              </span>
                            ) : (
                              <>
                                <span className="tv-any">
                                  <IcPerson />
                                </span>
                                <span>Anyone</span>
                              </>
                            )}
                          </button>
                          {ownerPick === i ? (
                            <div className="tv-menu" role="listbox" aria-label="Who does this step">
                              <span className="tv-menu__h">Who does this step</span>
                              {[null, ...t.people].map((k) => (
                                <button
                                  key={k ?? "any"}
                                  type="button"
                                  role="option"
                                  aria-selected={s.owner === k}
                                  onClick={() => {
                                    setOwnerPick(-1);
                                    const next = stepsNow();
                                    next[i] = { ...next[i], owner_id: memberIdOf(k, dir) };
                                    void run(() => patchSteps(next));
                                  }}
                                >
                                  {k ? (
                                    <span className="tv-av" style={avStyle(personIn(dir, k))}>
                                      {personIn(dir, k).ini}
                                    </span>
                                  ) : (
                                    <span className="tv-any">
                                      <IcPerson />
                                    </span>
                                  )}
                                  <span>
                                    <b>{k ? personIn(dir, k).name : "Anyone on the task"}</b>
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <span className="tv-meta">No steps. They mark the whole task done.</span>
              )}
              {owner && !closed ? (
                adding ? (
                  <input
                    className="tv-inp"
                    aria-label="New step"
                    placeholder="Write the step, then Enter"
                    autoFocus
                    maxLength={200}
                    value={stepText}
                    onChange={(e) => setStepText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setAdding(false);
                      }
                      if (e.key === "Enter") {
                        const x = stepText.trim();
                        if (!x) return;
                        const ownerId = t.people.length === 1 ? memberIdOf(t.people[0], dir) : null;
                        void run(
                          () => patchSteps([...stepsNow(), { title: x, owner_id: ownerId }]),
                          () => {
                            setStepText("");
                            setAdding(false);
                          },
                        );
                      }
                    }}
                  />
                ) : (
                  <button type="button" className="tv-add" onClick={() => (setAdding(true), setStepText(""))}>
                    <span className="tv-any">
                      <IcPlus size={12} />
                    </span>
                    Add a step
                  </button>
                )
              ) : null}
            </section>

            {t.details ? (
              <section className="tv-sec" aria-label="Details">
                <span className="tv-sec__h">Details</span>
                <div className="tv-det">{t.details}</div>
              </section>
            ) : null}

            <section className="tv-sec" aria-label="Task chat">
              <span className="tv-sec__h">Task chat</span>
              <button type="button" className="tv-cprev" onClick={() => setTab("chat")}>
                <span className="tv-cprev__i">
                  <IcChat size={17} />
                  {unread ? <b className="tv-badge">{unread}</b> : null}
                </span>
                <span className="tv-cprev__t">
                  {t.chat.last ? (
                    <>
                      <small>{`${t.chat.last.key === "me" ? "You" : t.chat.last.key ? personIn(dir, t.chat.last.key).first : t.chat.last.name} · ${when(t.chat.last.at, now)}`}</small>
                      <span>{t.chat.last.text}</span>
                    </>
                  ) : (
                    <>
                      <small>No messages yet</small>
                      <span>Ask a question or share a file. Everyone on the task sees it.</span>
                    </>
                  )}
                </span>
                <span className="tv-cprev__go">{chatN ? `Open the task chat · ${chatN}${unread ? ` · ${unread} new` : ""}` : "Start the task chat"}</span>
              </button>
            </section>
          </div>
        ) : null}

        {tab === "chat" ? (
          <>
            <div className="tv-cb" aria-label="Task chat" ref={msgsRef}>
              <div className="tv-parent" data-tone={h.tone}>
                <div className="tv-parent__top">
                  <span className="tv-pill" data-tone={pill.tone}>
                    {pill.label}
                  </span>
                  <span className="tv-due" data-kind={due.kind}>
                    {due.chip}
                  </span>
                </div>
                <b>{t.title}</b>
                <span className="tv-parent__s">{h.text}</span>
                <div className="tv-parent__f">
                  <span className="tv-avs">
                    {t.people.slice(0, 4).map((k) => (
                      <Av key={k} dir={dir} k={k} />
                    ))}
                  </span>
                  <span>{`${thrWho} see this chat`}</span>
                  <button type="button" className="tv-link" onClick={() => setTab("overview")}>
                    Task details
                  </button>
                </div>
              </div>
              {t.group ? (
                <span className="tv-also">
                  <IcChat size={13} />
                  {`This task is also posted in the ${t.group.name} chat. Replies on the card land here.`}
                </span>
              ) : null}
              <div className="tv-msgs">
                {(chat.lines ?? []).map((m) => {
                  const mine = m.by.kind === "owner";
                  const k = mine ? "me" : m.by.member_id != null ? `m${m.by.member_id}` : null;
                  const P = k ? personIn(dir, k) : null;
                  return (
                    <div key={m.id} className={`tv-msg${mine ? " mine" : ""}`}>
                      <Av dir={dir} k={k} />
                      <span className="tv-bub">
                        <small>{`${mine ? "You" : (P?.memberId != null ? P.first : m.by.name.split(" ")[0]) || "Someone"} · ${when(Date.parse(m.at), now)}`}</small>
                        {m.body}
                      </span>
                    </div>
                  );
                })}
                {chat.lines && chat.lines.length === 0 ? <span className="tv-meta tv-cb__none">No messages yet. Everyone on the task sees what you write here.</span> : null}
                {!chat.lines && chat.pending ? <span className="tv-meta tv-cb__none">Loading the task chat…</span> : null}
                {chat.error && !chat.lines ? (
                  <span className="tv-meta tv-cb__none">
                    Couldn’t load the chat.{" "}
                    <button type="button" className="tv-link" onClick={chat.reload}>
                      Try again
                    </button>
                  </span>
                ) : null}
              </div>
            </div>
            <div className="tv-cf">
              <div className="tv-cbox">
                <textarea
                  rows={2}
                  aria-label="Message everyone on this task…"
                  placeholder="Message everyone on this task…"
                  value={chatText}
                  maxLength={2000}
                  onChange={(e) => setChatText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendChat();
                    }
                  }}
                />
                <div className="tv-cbox__row">
                  <span>Enter sends · Shift + Enter for a new line</span>
                  <button type="button" className="tv-send" aria-label="Send" disabled={busy || !chatText.trim()} onClick={sendChat}>
                    <IcSend />
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {tab === "activity" ? (
          <div className="tv-pb">
            <section className="tv-sec" aria-label="Activity">
              <span className="tv-sec__h">Everything that happened</span>
              <ol className="tv-ev">
                {events.map((e, i) => (
                  <li key={`${e.at}-${i}`} data-first={i === 0 ? "true" : "false"}>
                    <span>{e.text}</span>
                    <small>{when(e.at, now)}</small>
                  </li>
                ))}
              </ol>
              {t.nudgedAt ? <span className="tv-meta">{`Nudged at ${clock(t.nudgedAt)}. You can nudge again an hour later.`}</span> : null}
            </section>
          </div>
        ) : null}
      </aside>
      {sayProp ? null : own.node}
    </div>
  );
}
