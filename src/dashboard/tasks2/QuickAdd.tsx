import { useEffect, useRef, useState, type ReactElement } from "react";
import { errorMessage } from "../../lib/api";
import { dayWords, dueIso, groupIn, keyOf, memberIdOf, namesOf, personIn, qaParse, qaStripDates, type TTask } from "./engine";
import { avStyle } from "./actions";
import { IcCal, IcEye, IcFlag, IcGroup, IcPerson, IcPlus, IcSend, IcSteps, IcClose, type Say, type TaskPrefill } from "./parts";
import type { TeamTasks } from "./useTeamTasks";

const DUE_OPTS: ReadonlyArray<[string, string]> = [
  ["Today 6 PM", "today 6pm"],
  ["Tomorrow 12 PM", "tomorrow 12pm"],
  ["Tomorrow 6 PM", "tomorrow 6pm"],
  ["Next Monday", "mon 6pm"],
  ["Next week", "next week"],
];

/**
 * Quick add (spec 3a): one line, "Add a task for your team…". The text is the single source of truth: "@" opens the
 * people + groups list (↑ ↓ Enter), date words (today, tomorrow, fri, 5pm, next week) set the due chip and are
 * highlighted, "!" sets High. A plain-words preview under it; Enter sends; the toast offers Undo for 5 seconds.
 * `fixed` pre-fills the person or group (Chat), so "Add a task for Karan…" needs no "@".
 */
export function QuickAdd({
  team,
  fixed,
  initialText = "",
  autoFocus = false,
  onSent,
  onOpenFull,
  onCancel,
  say,
}: {
  team: TeamTasks;
  /** Chat: the person / group this quick add is for. */
  fixed?: { memberIds?: number[]; groupId?: number | null };
  initialText?: string;
  autoFocus?: boolean;
  onSent?: (t: TTask) => void;
  /** "Open full form" and "Steps": the form with what was typed. */
  onOpenFull?: (prefill: TaskPrefill) => void;
  /** Escape on an empty line (Chat closes the quick add). */
  onCancel?: () => void;
  say?: Say;
}): ReactElement {
  const { dir, now } = team;
  const [text, setText] = useState(initialText);
  const [focus, setFocus] = useState(autoFocus || !!initialText);
  const [menu, setMenu] = useState<"" | "who" | "due">("");
  const [sel, setSel] = useState(0);
  const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  // Clicking outside folds the bar (when nothing is typed) and closes the menus.
  useEffect(() => {
    const out = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenu("");
        if (!inputRef.current?.value) setFocus(false);
      }
    };
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, []);

  const fixedGroup = fixed?.groupId != null ? groupIn(dir, fixed.groupId) : null;
  const fixedKeys = fixedGroup ? fixedGroup.people : (fixed?.memberIds ?? []).map(keyOf);
  const p = qaParse(text, dir, now);
  const keys = p.keys.length ? p.keys : fixedKeys;
  const on = focus || !!text;
  const frag = p.atFrag;
  const whoMenu = (menu === "who" || frag !== null) && on;
  const list = [
    ...dir.groups.map((g) => ({ key: g.name, group: true, name: g.name, sub: `${g.people.length} people`, pk: g.key })),
    ...dir.list.map((x) => ({ key: x.first, group: false, name: x.name, sub: x.role || "Team member", pk: x.key })),
  ]
    .filter((o) => !frag || o.name.toLowerCase().startsWith(frag) || o.key.toLowerCase().startsWith(frag))
    .slice(0, 7);
  const cur = Math.min(sel, Math.max(0, list.length - 1));
  const dayTxt = dayWords(p.due.d, now).word;
  const dueLbl = `Due ${p.due.d <= 1 ? dayTxt.toLowerCase() : dayTxt} ${p.due.time.replace(":00 ", " ")}`;
  const names = keys.length > 3 ? `${keys.length} people` : namesOf(dir, keys);
  const groupOnly = (p.groups.length && !p.who.length) || (!p.keys.length && fixedGroup);
  const gName = p.groups.length ? groupIn(dir, p.groups[0])?.name : fixedGroup?.name;
  const preview = !keys.length
    ? "Type @ and a name, or a group, to choose who gets it."
    : `${groupOnly ? `Everyone in ${gName} (${keys.length}) gets it` : `${names}${keys.length === 1 ? " gets it" : " get it"}`} in the Zinwe app now · due ${dayWords(p.due.d, now).rel} ${p.due.time}${p.high ? " · High" : ""}`;
  const ready = !!(p.title && keys.length);
  const ph = fixedKeys.length ? `Add a task for ${fixedGroup ? fixedGroup.name : namesOf(dir, fixedKeys)}…` : "Add a task for your team…";

  const syncScroll = () => {
    if (mirrorRef.current && inputRef.current) mirrorRef.current.scrollLeft = inputRef.current.scrollLeft;
  };
  const focusEnd = () =>
    window.setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      syncScroll();
    }, 0);
  const pickWho = (name: string) => {
    setText((x) => (/@[A-Za-z]*$/.test(x) ? x.replace(/@[A-Za-z]*$/, `@${name} `) : `${x.replace(/\s*$/, "")} @${name} `));
    setMenu("");
    setSel(0);
    setFocus(true);
    focusEnd();
  };
  const pickDue = (word: string) => {
    setText((x) => `${qaStripDates(x)} ${word} `.replace(/^\s+/, ""));
    setMenu("");
    focusEnd();
  };
  const toggleHigh = () => {
    setText((x) => (p.high ? x.replace(/(^|\s)!(?:high)?(?=\s|$)/gi, "").replace(/\s{2,}/g, " ") : `${x.replace(/\s*$/, "")} ! `));
    focusEnd();
  };
  const prefill = (): TaskPrefill => {
    const g = p.groups[0] ? groupIn(dir, p.groups[0]) : fixedGroup;
    const ids = (p.keys.length ? p.who : fixedGroup ? [] : fixedKeys).map((k) => memberIdOf(k, dir)).filter((x): x is number => x != null);
    return { title: p.title, memberIds: ids, groupId: g?.id ?? null, d: p.due.d, time: p.due.time, high: p.high };
  };
  const openFull = () => {
    onOpenFull?.(prefill());
    setText("");
    setFocus(false);
  };

  const send = async () => {
    if (!ready) {
      setShake(true);
      window.setTimeout(() => setShake(false), 320);
      return;
    }
    if (busy) return;
    setBusy(true);
    setErr("");
    const g = p.groups[0] ? groupIn(dir, p.groups[0]) : !p.keys.length ? fixedGroup : null;
    try {
      const t = await team.act.create({
        title: p.title,
        note: "",
        due_at: dueIso(p.due.d, p.due.time, now),
        priority: p.high ? "high" : "normal",
        member_ids: keys.map((k) => memberIdOf(k, dir)).filter((x): x is number => x != null),
        group_id: g?.id ?? null,
        post_in_group: !!g,
        mode: "all",
        in_order: false,
        repeat: "",
        steps: [],
      });
      setText("");
      setMenu("");
      say?.(`Sent to ${namesOf(dir, keys)} · due ${dayWords(p.due.d, now).rel} ${p.due.time}.`, () => {
        void team.act.action(t.id, { action: "cancel" }).catch(() => undefined);
      });
      onSent?.(t);
      focusEnd();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section ref={rootRef} className="tv-qa" aria-label="Add a task" data-on={on ? "true" : "false"} data-shake={shake ? "true" : "false"}>
      <div className="tv-qa__line">
        <span className="tv-qa__ic" aria-hidden="true">
          <IcPlus size={16} sw={2.4} />
        </span>
        <div className="tv-qa__field">
          <div className="tv-qa__mirror" aria-hidden="true" ref={mirrorRef}>
            {p.segs.map((s, i) => (
              <span key={i} className={s.cls ? `tv-tok ${s.cls}` : undefined}>
                {s.t}
              </span>
            ))}
          </div>
          <label htmlFor="tv-qa-in" className="tv-sr">
            Add a task
          </label>
          <input
            ref={inputRef}
            id="tv-qa-in"
            className="tv-qa__input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={200}
            placeholder={ph}
            value={text}
            role="combobox"
            aria-expanded={whoMenu}
            aria-controls="tv-qa-list"
            aria-autocomplete="list"
            onChange={(e) => {
              setText(e.target.value);
              setFocus(true);
              setSel(0);
              setShake(false);
              setErr("");
              if (menu === "who") setMenu("");
            }}
            onScroll={syncScroll}
            onSelect={syncScroll}
            onFocus={() => setFocus(true)}
            onKeyDown={(e) => {
              const k = e.key;
              if (whoMenu && list.length && (k === "ArrowDown" || k === "ArrowUp")) {
                e.preventDefault();
                setSel((cur + (k === "ArrowDown" ? 1 : list.length - 1)) % list.length);
                return;
              }
              if (k === "Enter") {
                e.preventDefault();
                if (whoMenu && list.length && (frag !== null || menu === "who")) return pickWho(list[cur].key);
                void send();
              }
              if (k === "Escape") {
                if (menu || frag !== null) setMenu("");
                else if (!text) {
                  setFocus(false);
                  onCancel?.();
                }
              }
            }}
          />
        </div>
        {!text ? (
          <span className="tv-qa__kbd">
            Type <b>@</b> to assign · <b>Enter</b> to send
          </span>
        ) : (
          <button type="button" className="tv-qa__x" aria-label="Clear" onClick={() => (setText(""), setMenu(""), focusEnd())}>
            <IcClose size={15} />
          </button>
        )}
      </div>
      {whoMenu && list.length ? (
        <div className="tv-menu tv-qa__menu" id="tv-qa-list" role="listbox" aria-label="Give it to">
          <span className="tv-menu__h">{frag ? `People and groups matching “${frag}”` : "Give it to"}</span>
          {list.map((o, i) => (
            <button key={o.pk} type="button" role="option" aria-selected={i === cur} onMouseDown={(e) => e.preventDefault()} onClick={() => pickWho(o.key)}>
              {o.group ? (
                <span className="tv-gico">
                  <IcGroup size={15} />
                </span>
              ) : (
                <span className="tv-av" style={avStyle(personIn(dir, o.pk))}>
                  {personIn(dir, o.pk).ini}
                </span>
              )}
              <span>
                <b>{o.name}</b>
                <small>{o.sub}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {on ? (
        <div className="tv-qa__bar">
          <p className="tv-qa__prev">
            <IcEye />
            <span>{preview}</span>
            {err ? <em role="alert">{err}</em> : !p.title && keys.length ? <em>Write what needs doing.</em> : null}
          </p>
          <button type="button" className={p.keys.length || fixedKeys.length ? "tv-qchip set" : "tv-qchip"} aria-expanded={menu === "who"} onClick={() => (setMenu(menu === "who" ? "" : "who"), setSel(0), focusEnd())}>
            <IcPerson size={14} sw={2} />
            {keys.length ? names : "Assign"}
          </button>
          <span style={{ position: "relative" }}>
            <button type="button" className={p.dueSet ? "tv-qchip set" : "tv-qchip"} aria-expanded={menu === "due"} onClick={() => setMenu(menu === "due" ? "" : "due")}>
              <IcCal />
              {dueLbl}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {menu === "due" ? (
              <div className="tv-menu" role="listbox" aria-label="Due" style={{ left: 0, top: "calc(100% + 6px)", minWidth: 200 }}>
                {DUE_OPTS.map(([label, word]) => (
                  <button key={label} type="button" role="option" onClick={() => pickDue(word)}>
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </span>
          <button type="button" className={p.high ? "tv-qchip set hi" : "tv-qchip"} aria-pressed={p.high} onClick={toggleHigh}>
            <IcFlag size={14} />
            {p.high ? "High" : "Normal"}
          </button>
          {onOpenFull ? (
            <button type="button" className="tv-qchip" onClick={openFull}>
              <IcSteps />
              Steps
            </button>
          ) : null}
          <span className="tv-qa__grow" />
          {onOpenFull ? (
            <button type="button" className="tv-link" onClick={openFull}>
              Open full form
            </button>
          ) : null}
          <button type="button" className="tv-btn pri" aria-disabled={!ready} disabled={busy} onClick={() => void send()}>
            Send
            <IcSend size={15} />
          </button>
        </div>
      ) : null}
    </section>
  );
}
