import { useEffect, useRef, useState, type ReactElement } from "react";
import { errorMessage, type TeamTaskRepeat } from "../../lib/api";
import { clock, dayAt, dayDiff, dayWords, dueIso, groupIn, keyOf, memberIdOf, namesOf, personIn, type Directory, type TTask } from "./engine";
import { avStyle } from "./actions";
import { Av, IcCal, IcChev, IcClock, IcClose, IcGroup, IcPerson, IcPlus, IcTick, type Say, type TaskPrefill } from "./parts";
import type { TeamTasks } from "./useTeamTasks";

interface FStep {
  id?: number;
  text: string;
  owner: string | null;
}
interface F {
  title: string;
  who: string[];
  groups: string[];
  mode: "all" | "any";
  d: number;
  time: string;
  dayOpen: boolean;
  repeat: TeamTaskRepeat;
  steps: FStep[];
  stepText: string;
  inOrder: boolean;
  high: boolean;
  details: string;
  post: boolean;
  /** Post the card in this group's chat without giving the task to the whole group (TaskPrefill.postIn). */
  postIn: number | null;
  pick: boolean;
  ownerPick: number;
  err: string;
}

const TIMES = ["Any time", "9:00 AM", "12:00 PM", "3:00 PM", "6:00 PM"];
const REPS: ReadonlyArray<[TeamTaskRepeat, string]> = [
  ["", "Never"],
  ["day", "Daily"],
  ["week", "Weekly"],
  ["month", "Monthly"],
];

function fromPrefill(p: TaskPrefill | undefined, dir: Directory): F {
  const g = p?.groupId != null ? groupIn(dir, p.groupId) : null;
  return {
    title: p?.title ?? "",
    who: (p?.memberIds ?? []).map(keyOf).filter((k) => !g || !g.people.includes(k)),
    groups: g ? [g.key] : [],
    mode: p?.mode ?? "all",
    d: p?.d ?? 0,
    time: p?.time ?? "6:00 PM",
    dayOpen: false,
    repeat: p?.repeat ?? "",
    steps: (p?.steps ?? []).map((s) => ({ text: s.title, owner: s.ownerId != null ? keyOf(s.ownerId) : null })),
    stepText: "",
    inOrder: !!p?.inOrder,
    high: !!p?.high,
    details: p?.details ?? "",
    post: true,
    postIn: !g && p?.postIn != null ? p.postIn : null,
    pick: false,
    ownerPick: -1,
    err: "",
  };
}

function fromTask(t: TTask, now: number): F {
  return {
    title: t.title,
    who: [...t.people],
    groups: [],
    mode: t.mode,
    d: t.dueAt != null ? dayDiff(t.dueAt, now) : 0,
    time: t.dueAt == null || t.anyTime ? "Any time" : clock(t.dueAt),
    dayOpen: false,
    repeat: t.repeat,
    steps: t.steps.map((s) => ({ id: s.id ?? undefined, text: s.text, owner: s.owner })),
    stepText: "",
    inOrder: t.inOrder,
    high: t.high,
    details: t.details,
    post: false,
    postIn: null,
    pick: false,
    ownerPick: -1,
    err: "",
  };
}

/**
 * The full task form = the task panel in create (or edit) mode (spec 3b): title, a "What's happening" preview, Who
 * (people + groups, Everyone / Any one of them), the When card (summary, Today · Tomorrow · Pick a date, time chips,
 * repeat chips), steps with owners and "Do the steps in order", priority, details, "Post it in the Design chat", and
 * "Send to …". `bare` renders only the panel's insides (TaskPanel uses it); otherwise it brings its own scrim + panel.
 */
export function TaskForm({
  team,
  prefill,
  editing,
  onClose,
  onSent,
  say,
  bare = false,
}: {
  team: TeamTasks;
  prefill?: TaskPrefill;
  /** Edit this task instead of making a new one. */
  editing?: TTask | null;
  onClose: () => void;
  /** After Send (or Save): the task as saved. */
  onSent?: (t: TTask) => void;
  say?: Say;
  bare?: boolean;
}): ReactElement {
  const { dir, now } = team;
  const [f, setF] = useState<F>(() => (editing ? fromTask(editing, now) : fromPrefill(prefill, dir)));
  const [busy, setBusy] = useState(false);
  const set = (o: Partial<F>) => setF((x) => ({ ...x, ...o }));
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) titleRef.current?.focus();
  }, [editing]);

  const keys = (() => {
    const out: string[] = [];
    f.groups.forEach((g) => groupIn(dir, g)?.people.forEach((k) => !out.includes(k) && out.push(k)));
    f.who.forEach((k) => !out.includes(k) && out.push(k));
    return out;
  })();
  const team2 = keys.length > 1;
  const gsel = f.groups;
  // The chat the card goes to: the picked group, or (Make a task from a group line) that group.
  const postGroup = gsel.length ? groupIn(dir, gsel[0]) : f.postIn != null ? groupIn(dir, f.postIn) : null;
  const sendLbl = editing ? "Save changes" : !keys.length ? "Send" : keys.length <= 3 ? `Send to ${namesOf(dir, keys)}` : `Send to ${keys.length} people`;
  const previewWho = !keys.length
    ? "Pick who gets it."
    : `${keys.length === 1 ? `${personIn(dir, keys[0]).first} gets it` : `${namesOf(dir, keys.slice(0, 3))}${keys.length > 3 ? ` and ${keys.length - 3} more` : ""} get it`} in the Zinwe app${
        team2 ? (f.mode === "any" ? ". The first to start takes it" : ". Each ticks their own steps, then you give the OK") : ". They mark it done, then you give the OK"
      }`;
  const draft = editing
    ? `Editing. ${namesOf(dir, keys)} see${keys.length === 1 ? "s" : ""} an “Edited” tag after you save.`
    : `Not sent yet. ${previewWho}${previewWho.endsWith(".") ? "" : "."}`;
  const dayRel = (d: number) => dayWords(d, now).rel;
  const whenLine = `Due ${f.d === 0 ? "today" : f.d === 1 ? "tomorrow" : dayWords(f.d, now).label}${f.time && f.time !== "Any time" ? `, ${f.time}` : ", any time"}${f.repeat ? ` · every ${f.repeat}` : ""}`;
  const preview =
    (keys.length ? `${keys.length}${keys.length === 1 ? " person" : " people"} · ` : "") +
    `due ${dayRel(f.d)}${f.time !== "Any time" ? ` ${f.time}` : ""}${f.high ? " · High" : ""}${f.repeat ? ` · repeats every ${f.repeat}` : ""}${f.inOrder && f.steps.length > 1 ? " · steps in order" : ""}`;
  const times = TIMES.includes(f.time) ? TIMES : [...TIMES, f.time];
  const picked = f.d > 1 || f.d < 0 || f.dayOpen;

  const addStep = () => {
    const x = f.stepText.trim();
    if (!x) return;
    set({ steps: [...f.steps, { text: x, owner: keys.length === 1 ? keys[0] : null }], stepText: "" });
  };

  const send = async () => {
    if (!f.title.trim()) return set({ err: "Write what needs doing." });
    if (!keys.length) return set({ err: "Pick who gets it." });
    if (busy) return;
    setBusy(true);
    const steps = f.steps.map((s) => ({ ...(s.id != null ? { id: s.id } : {}), title: s.text, owner_id: memberIdOf(s.owner, dir) }));
    const due_at = dueIso(f.d, f.time, now);
    try {
      if (editing) {
        const saved = await team.act.patch(editing.id, {
          title: f.title.trim(),
          note: f.details,
          due_at,
          priority: f.high ? "high" : "normal",
          repeat: f.repeat,
          in_order: f.inOrder && f.steps.length > 1,
          mode: f.mode,
          steps,
        });
        say?.(`${namesOf(dir, keys)} see${keys.length === 1 ? "s" : ""} an “Edited” tag. Ticked steps stay ticked.`);
        onSent?.(saved);
        return;
      }
      const g = postGroup;
      const saved = await team.act.create({
        title: f.title.trim(),
        note: f.details,
        due_at,
        priority: f.high ? "high" : "normal",
        member_ids: keys.map((k) => memberIdOf(k, dir)).filter((x): x is number => x != null),
        group_id: g?.id ?? null,
        post_in_group: !!g && f.post,
        mode: team2 ? f.mode : "all",
        in_order: f.inOrder && f.steps.length > 1,
        repeat: f.repeat,
        steps,
      });
      say?.(`Sent to ${namesOf(dir, keys)}.`);
      onSent?.(saved);
    } catch (err) {
      set({ err: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const ownerOpts = (i: number) => [null, ...keys].map((k) => ({ k, on: (f.steps[i]?.owner ?? null) === k }));

  const body = (
    <>
      <div className="tv-ph">
        <span className="tv-pill">{editing ? "Edit task" : "New task"}</span>
        <span className="tv-ph__grow" />
        <button type="button" className="tv-ic" aria-label="Close" onClick={onClose}>
          <IcClose />
        </button>
      </div>
      <div className="tv-pb">
        <div className="tv-f">
          <label className="tv-sr" htmlFor="tv-ft">
            What needs doing
          </label>
          <input ref={titleRef} id="tv-ft" className="tv-ftitle" placeholder="What needs doing?" maxLength={120} value={f.title} onChange={(e) => set({ title: e.target.value, err: "" })} />
          <section className="tv-hap" data-tone="neutral">
            <span className="tv-hap__k">What’s happening</span>
            <span className="tv-hap__t" style={{ fontSize: 14.5 }}>
              {draft}
            </span>
          </section>

          <div className="tv-fld">
            <span className="tv-lab">Who</span>
            <div className="tv-who">
              {gsel.map((gk) => {
                const G = groupIn(dir, gk);
                if (!G) return null;
                return (
                  <span key={gk} className="tv-pchip grp" title={namesOf(dir, G.people)}>
                    <IcGroup />
                    {`${G.name} · ${G.people.length}`}
                    {editing ? null : (
                      <button type="button" aria-label={`Remove ${G.name}`} onClick={() => set({ groups: gsel.filter((x) => x !== gk) })}>
                        <IcClose size={12} sw={2.4} />
                      </button>
                    )}
                  </span>
                );
              })}
              {f.who.map((k) => (
                <span key={k} className="tv-pchip">
                  <Av dir={dir} k={k} />
                  {personIn(dir, k).first}
                  {editing ? null : (
                    <button type="button" aria-label={`Remove ${personIn(dir, k).first}`} onClick={() => set({ who: f.who.filter((x) => x !== k) })}>
                      <IcClose size={12} sw={2.4} />
                    </button>
                  )}
                </span>
              ))}
              {editing ? null : (
                <button type="button" className="tv-who__add" aria-expanded={f.pick} onClick={() => set({ pick: !f.pick })}>
                  <IcPlus />
                  Add people or a group
                </button>
              )}
              {f.pick ? (
                <div className="tv-menu" role="listbox" aria-multiselectable="true" aria-label="People and groups">
                  {dir.groups.length ? <span className="tv-menu__h">Groups</span> : null}
                  {dir.groups.map((G) => {
                    const on = gsel.includes(G.key);
                    return (
                      <button key={G.key} type="button" role="option" aria-selected={on} onClick={() => set({ groups: on ? gsel.filter((x) => x !== G.key) : [...gsel, G.key] })}>
                        <span className="tv-gico">
                          <IcGroup />
                        </span>
                        <span>
                          <b>{G.name}</b>
                          <small>{`${G.people.length} people · ${namesOf(dir, G.people.slice(0, 3))}${G.people.length > 3 ? "…" : ""}`}</small>
                        </span>
                        {on ? (
                          <span className="chk">
                            <IcTick size={16} sw={2.6} />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                  <span className="tv-menu__h">People</span>
                  {dir.list.map((p) => {
                    const on = keys.includes(p.key);
                    const mine = f.who.includes(p.key);
                    return (
                      <button key={p.key} type="button" role="option" aria-selected={on} onClick={() => set({ who: mine ? f.who.filter((x) => x !== p.key) : [...f.who, p.key] })}>
                        <span className="tv-av" style={avStyle(p)}>
                          {p.ini}
                        </span>
                        <span>
                          <b>{p.name}</b>
                          <small>{p.role || "Team member"}</small>
                        </span>
                        {on ? (
                          <span className="chk">
                            <IcTick size={16} sw={2.6} />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                  <div style={{ padding: 6, display: "flex", justifyContent: "flex-end" }}>
                    <button type="button" className="tv-btn sm" style={{ width: "auto", minHeight: 32 }} onClick={() => set({ pick: false })}>
                      Done
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            {team2 ? (
              <div className="tv-radio" role="radiogroup" aria-label="Who has to finish?">
                <span className="tv-lab">Who has to finish?</span>
                <button type="button" role="radio" aria-checked={f.mode !== "any"} onClick={() => set({ mode: "all" })}>
                  <i />
                  <span>
                    Everyone <small>· each does their steps</small>
                  </span>
                </button>
                <button type="button" role="radio" aria-checked={f.mode === "any"} onClick={() => set({ mode: "any" })}>
                  <i />
                  <span>
                    Any one of them <small>· the first to start takes it</small>
                  </span>
                </button>
              </div>
            ) : null}
          </div>

          <div className="tv-fld">
            <span className="tv-lab">When</span>
            <div className="tv-when">
              <div className="tv-when__sum">
                <IcClock size={15} />
                <b>{whenLine}</b>
              </div>
              <div className="tv-seg" role="group" aria-label="Day">
                <button type="button" className={f.d === 0 && !f.dayOpen ? "on" : ""} aria-pressed={f.d === 0 && !f.dayOpen} onClick={() => set({ d: 0, dayOpen: false })}>
                  Today
                </button>
                <button type="button" className={f.d === 1 && !f.dayOpen ? "on" : ""} aria-pressed={f.d === 1 && !f.dayOpen} onClick={() => set({ d: 1, dayOpen: false })}>
                  Tomorrow
                </button>
                <button type="button" className={picked ? "on" : ""} aria-pressed={picked} aria-expanded={f.dayOpen} onClick={() => set({ dayOpen: !f.dayOpen })}>
                  <IcCal />
                  {f.d > 1 || f.d < 0 ? dayWords(f.d, now).label : "Pick a date"}
                </button>
              </div>
              {f.dayOpen ? (
                <div className="tv-scroll" role="group" aria-label="Pick a day">
                  {[2, 3, 4, 5, 6, 7, 9].map((d) => (
                    <button key={d} type="button" className={f.d === d ? "tv-zk on" : "tv-zk"} onClick={() => set({ d, dayOpen: false })}>
                      {dayWords(d, now).label}
                    </button>
                  ))}
                  <label className="tv-zk tv-zk--date">
                    <span className="tv-sr">Another date</span>
                    <input
                      type="date"
                      min={new Date(dayAt(0, now)).toISOString().slice(0, 10)}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        const [y, m, dd] = v.split("-").map(Number);
                        set({ d: dayDiff(new Date(y, m - 1, dd).getTime(), now), dayOpen: false });
                      }}
                    />
                  </label>
                </div>
              ) : null}
              <div className="tv-when__row">
                <span className="tv-when__k">Time</span>
                <div className="tv-scroll" role="group" aria-label="Time">
                  {times.map((x) => (
                    <button key={x} type="button" className={f.time === x ? "tv-zk on" : "tv-zk"} aria-pressed={f.time === x} onClick={() => set({ time: x })}>
                      {x === "Any time" ? x : x.replace(":00", "")}
                    </button>
                  ))}
                </div>
              </div>
              <div className="tv-when__row">
                <span className="tv-when__k">Repeat</span>
                <div className="tv-scroll" role="group" aria-label="Repeat">
                  {REPS.map(([v, label]) => (
                    <button key={label} type="button" className={f.repeat === v ? "tv-zk on" : "tv-zk"} aria-pressed={f.repeat === v} onClick={() => set({ repeat: v })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="tv-fld">
            <span className="tv-lab">
              Steps <span style={{ fontWeight: 400, color: "#6B6B6B" }}>(optional)</span>
            </span>
            {f.steps.length ? (
              <div className="tv-fsteps" data-order={f.inOrder ? "true" : "false"}>
                {f.steps.map((s, i) => {
                  const owner = s.owner ? personIn(dir, s.owner) : null;
                  return (
                    <div key={`${s.id ?? "n"}-${i}`} className="tv-fstep">
                      <span className="n">{i + 1}</span>
                      <span className="tx">
                        <span>{s.text}</span>
                        {f.inOrder && i > 0 ? <small>{`After step ${i}`}</small> : null}
                      </span>
                      <span className="tv-own">
                        <button type="button" aria-label={`Who does step ${i + 1}: ${owner?.first ?? "Anyone"}`} aria-expanded={f.ownerPick === i} onClick={() => set({ ownerPick: f.ownerPick === i ? -1 : i })}>
                          {owner ? (
                            <span className="tv-av" style={avStyle(owner)}>
                              {owner.ini}
                            </span>
                          ) : (
                            <span className="tv-any">
                              <IcPerson />
                            </span>
                          )}
                          {owner?.first ?? "Anyone"}
                          <IcChev />
                        </button>
                        {f.ownerPick === i ? (
                          <div className="tv-menu" role="listbox" aria-label="Who does this step">
                            <span className="tv-menu__h">Who does this step</span>
                            {ownerOpts(i).map((o) => (
                              <button
                                key={o.k ?? "any"}
                                type="button"
                                role="option"
                                aria-selected={o.on}
                                onClick={() => {
                                  const st = f.steps.slice();
                                  st[i] = { ...st[i], owner: o.k };
                                  set({ steps: st, ownerPick: -1 });
                                }}
                              >
                                {o.k ? (
                                  <span className="tv-av" style={avStyle(personIn(dir, o.k))}>
                                    {personIn(dir, o.k).ini}
                                  </span>
                                ) : (
                                  <span className="tv-any">
                                    <IcPerson />
                                  </span>
                                )}
                                <span>
                                  <b>{o.k ? personIn(dir, o.k).name : "Anyone"}</b>
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </span>
                      <button type="button" className="x" aria-label={`Remove step ${i + 1}`} onClick={() => set({ steps: f.steps.filter((_, j) => j !== i), ownerPick: -1 })}>
                        <IcClose size={13} sw={2.4} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
            <div className="tv-addstep">
              <span className="tv-addstep__i" aria-hidden="true">
                +
              </span>
              <input
                aria-label="New step"
                placeholder={f.steps.length ? "Add another step" : "Add a step, like “Send the draft”"}
                value={f.stepText}
                maxLength={200}
                onChange={(e) => set({ stepText: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addStep();
                  }
                }}
              />
              {f.stepText.trim() ? (
                <button type="button" className="tv-addstep__b" onClick={addStep}>
                  Add
                </button>
              ) : null}
            </div>
            {f.steps.length > 1 ? (
              <button type="button" className="tv-sw" role="switch" aria-checked={f.inOrder} onClick={() => set({ inOrder: !f.inOrder })}>
                <i />
                <span>
                  Do the steps in order
                  <small>Each step waits for the one above, like a relay. Zinwe tells the next person when it’s their turn.</small>
                </span>
              </button>
            ) : null}
          </div>

          <div className="tv-fld">
            <span className="tv-lab">Priority</span>
            <div className="tv-row2">
              <button type="button" className={f.high ? "tv-zk" : "tv-zk on"} aria-pressed={!f.high} onClick={() => set({ high: false })}>
                Normal
              </button>
              <button type="button" className={f.high ? "tv-zk on" : "tv-zk"} aria-pressed={f.high} onClick={() => set({ high: true })}>
                High
              </button>
            </div>
          </div>
          <div className="tv-fld">
            <label className="tv-lab" htmlFor="tv-fd">
              Details <span style={{ fontWeight: 400, color: "#6B6B6B" }}>(optional)</span>
            </label>
            <textarea id="tv-fd" className="tv-ta" placeholder="Links, files, anything that helps" maxLength={1000} value={f.details} onChange={(e) => set({ details: e.target.value })} />
          </div>
          {postGroup && !editing ? (
            <button type="button" className="tv-sw" role="switch" aria-checked={f.post} onClick={() => set({ post: !f.post })}>
              <i />
              <span>
                {`Post it in the ${postGroup.name} chat`}
                <small>Everyone in the group sees the task card and can talk about it there.</small>
              </span>
            </button>
          ) : null}
          {f.err ? (
            <span className="tv-err" role="alert">
              {f.err}
            </span>
          ) : null}
        </div>
      </div>
      <div className="tv-ffoot">
        <p>{preview}</p>
        <button type="button" className="tv-btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="tv-btn pri" disabled={busy} onClick={() => void send()}>
          {busy ? "Sending…" : sendLbl}
        </button>
      </div>
    </>
  );
  if (bare) return body;
  return (
    <div className="tv">
      <button type="button" className="tv-scrim" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <aside className="tv-panel" role="dialog" aria-modal="true" aria-label={editing ? "Edit task" : "New task"} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        {body}
      </aside>
    </div>
  );
}
