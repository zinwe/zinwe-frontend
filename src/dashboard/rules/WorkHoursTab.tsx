import { useState, type ReactElement } from "react";
import type { RulesScope, WorkHours } from "../../lib/api";
import { ErrorBlock, Sk } from "../ui/States";
import { errorMessage } from "../../lib/api";
import {
  clock12,
  DAY_NAMES,
  DAY_PRESETS,
  daysLine,
  daysOf,
  holidayDate,
  hoursLine,
  lateLine,
  longMinutes,
  maskOf,
  offDaysLine,
  parseHolidayDate,
  shortMinutes,
  timeOptions,
  withValue,
} from "./hoursModel";
import { Card, Toggle } from "./parts";
import { DEPT_LABEL, scopeKind, type ScopeOptions } from "./scope";
import type { Say, WorkHoursController } from "./useWorkHours";

function TimeSelect({ value, from, to, label, onChange, small }: { value: string; from: number; to: number; label?: string; onChange: (v: string) => void; small?: boolean }): ReactElement {
  return (
    <select className={`rh-sel${small ? " sm" : ""}`} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {timeOptions(from, to, value).map((t) => (
        <option key={t} value={t}>
          {clock12(t)}
        </option>
      ))}
    </select>
  );
}

/**
 * Rules › Work hours (board DashRulesHours, logic/rules_hours.*): working days, day start / end, late grace, the
 * departments' own hours (company view), Breaks (with the note people see) and How a day counts (full / half /
 * absent / leave / non-working days and holidays). Every change saves at once for the picked scope.
 */
export function WorkHoursTab({ scope, opts, wh, say }: { scope: RulesScope; opts: ScopeOptions; wh: WorkHoursController; say: Say }): ReactElement {
  const [holName, setHolName] = useState("");
  const [holDate, setHolDate] = useState("");
  const data = wh.at.data;

  if (!data) {
    return wh.at.error && !wh.at.pending ? (
      <ErrorBlock title="We couldn't load the work hours" message={errorMessage(wh.at.error)} onRetry={wh.at.reload} />
    ) : (
      <div role="status" aria-busy="true" className="z-card rl-card">
        <span className="z-sr">Loading the work hours…</span>
        <Sk w={140} h={18} />
        <Sk w="55%" h={12} />
        <Sk h={120} style={{ borderRadius: 12 }} />
      </div>
    );
  }

  const e = data.effective;
  const kind = scopeKind(scope);
  const isAll = kind === "company";
  const custom = !isAll && data.own;
  const pc = kind === "device" ? opts.pcs.find((p) => p.scope === scope) : undefined;
  const dept = kind === "department" ? opts.depts.find((d) => d.scope === scope) : undefined;
  const deptName = dept?.name ?? (kind === "department" ? DEPT_LABEL[scope.slice(11) as keyof typeof DEPT_LABEL] : "");
  const forWho = isAll ? "" : pc ? ` For ${pc.person || pc.host}’s PC.` : ` For everyone in ${deptName}.`;
  const put = (patch: Partial<WorkHours>) => void wh.put(patch);
  const days = daysOf(e.days);
  const halfMin = Math.round(e.full_day_hours / 2);

  const addHol = async () => {
    const name = holName.trim().replace(/\s+/g, " ");
    const raw = holDate.trim();
    if (!name || !raw) return say("Give the holiday a name and a date.", "warn");
    const iso = parseHolidayDate(raw);
    if (!iso) return say("Use a date like 4 Mar.", "warn");
    if (await wh.addHoliday(name, iso)) {
      setHolName("");
      setHolDate("");
    }
  };

  const company = isAll ? e : undefined;
  const deptRows = isAll
    ? opts.depts.map((d) => {
        const h = wh.depts.data?.find((x) => x.scope === d.scope)?.at;
        return { d, own: Boolean(h?.own), eff: h?.effective ?? e, loaded: Boolean(h) };
      })
    : [];

  return (
    <>
      <Card
        title="Work hours"
        sub={`From the Start day and End day buttons in each person’s Zinwe window.${forWho}`}
        side={custom ? <span className="rh-badge">Own hours</span> : undefined}
      >
        <div className="rh-row">
          <span className="rh-lab" id="rh-days-l">
            Working days
          </span>
          <div className="rh-days" role="group" aria-labelledby="rh-days-l">
            {DAY_NAMES.map((n, i) => (
              <button
                key={n}
                type="button"
                className="rh-day"
                aria-pressed={days[i]}
                onClick={() => {
                  const next = [...days];
                  next[i] = !next[i];
                  put({ days: maskOf(next) });
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="rh-row rh-row--wrap">
          <label className="rh-field">
            <span className="rh-lab">Day starts</span>
            <TimeSelect value={e.start} from={7} to={12} onChange={(v) => put({ start: v })} />
          </label>
          <label className="rh-field">
            <span className="rh-lab">Day ends</span>
            <TimeSelect value={e.end} from={16} to={22} onChange={(v) => put({ end: v })} />
          </label>
          <label className="rh-field">
            <span className="rh-lab">Late after</span>
            <select className="rh-sel" value={e.late_grace_min} onChange={(ev) => put({ late_grace_min: Number(ev.target.value) })}>
              {withValue([0, 10, 15, 30], e.late_grace_min).map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? "No grace" : `${m} minutes`}
                </option>
              ))}
            </select>
          </label>
          <span className="rh-hint">{lateLine(e)}</span>
        </div>

        {isAll && company ? (
          <div className="rh-dept">
            <div className="rh-dept__h">
              <b>By department</b>
              <span className="rl-k">A department can keep its own hours. People get their department’s hours from their tag on the Team page.</span>
            </div>
            {deptRows.length === 0 ? (
              <span className="rl-k">Tag people with what they do on the Team page to give a department its own hours.</span>
            ) : (
              deptRows.map(({ d, own, eff, loaded }) => {
                const write = (patch: Partial<WorkHours>) => void wh.putDept(d.scope, patch, `Saved. Reaches the ${d.name} PCs within a minute.`);
                const preset = DAY_PRESETS.some(([m]) => m === eff.days) ? eff.days : "custom";
                return (
                  <div key={d.scope} className="rh-dept__row">
                    <span className="rh-dept__n">
                      <b>{d.name}</b>
                      <small title={d.who}>{d.who}</small>
                    </span>
                    {own ? (
                      <>
                        <TimeSelect small label={`${d.name} starts`} value={eff.start} from={7} to={12} onChange={(v) => write({ start: v })} />
                        <span className="rh-to">to</span>
                        <TimeSelect small label={`${d.name} ends`} value={eff.end} from={16} to={22} onChange={(v) => write({ end: v })} />
                        <select className="rh-sel sm" aria-label={`${d.name} days`} value={preset} onChange={(ev) => ev.target.value !== "custom" && write({ days: ev.target.value })}>
                          {DAY_PRESETS.map(([m, label]) => (
                            <option key={m} value={m}>
                              {label}
                            </option>
                          ))}
                          {preset === "custom" ? <option value="custom">{daysLine(eff.days)}</option> : null}
                        </select>
                      </>
                    ) : (
                      <span className="rh-same">Same as company · {hoursLine(company)}</span>
                    )}
                    <span className="rh-dept__sw">
                      <Toggle
                        on={own}
                        label={`Own hours for ${d.name}`}
                        disabled={!loaded}
                        onChange={() =>
                          own
                            ? void wh.reset(d.scope, `${d.name} now follows the company hours.`)
                            : void wh.putDept(
                                d.scope,
                                { start: company.start, end: company.end, days: company.days },
                                `${d.name} has its own hours. Reaches their PCs within a minute.`,
                              )
                        }
                      />
                      <span className="rh-swl" aria-hidden="true">
                        Own hours
                      </span>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        ) : null}
      </Card>

      <Card title="Breaks" sub="Lunch and short breaks together, from the Take a break button.">
        <div className="rh-row rh-row--wrap">
          <label className="rh-field">
            <span className="rh-lab">Break time allowed per day</span>
            <select className="rh-sel" value={e.break_allowed_min} onChange={(ev) => put({ break_allowed_min: Number(ev.target.value) })}>
              {withValue([45, 60, 75, 90, 120], e.break_allowed_min).map((m) => (
                <option key={m} value={m}>
                  {longMinutes(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="rh-field">
            <span className="rh-lab">Ask for my OK on one break longer than</span>
            <select className="rh-sel" value={e.break_ok_over_min} onChange={(ev) => put({ break_ok_over_min: Number(ev.target.value) })}>
              {withValue([0, 30, 45, 60], e.break_ok_over_min).map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? "Never ask" : longMinutes(m)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ToggleRow
          title="Tell them in their Zinwe app when they go over"
          sub="A quiet note on their Home screen, before and when the limit is reached."
          on={e.tell_member_over}
          label="Tell them when they go over"
          onChange={() => put({ tell_member_over: !e.tell_member_over })}
        />
        {e.tell_member_over ? (
          <div className="rh-preview">
            <span className="rh-preview__k">They see</span>
            <span className="rh-preview__t">“You’ve used 1 h 10 min of your {shortMinutes(e.break_allowed_min)} break time today.”</span>
          </div>
        ) : null}
        <ToggleRow
          title="Tell me too"
          sub="Shows in Needs you on your Overview, like a break OK."
          on={e.tell_owner_over}
          label="Tell me when someone goes over"
          onChange={() => put({ tell_owner_over: !e.tell_owner_over })}
        />
        <ToggleRow
          title="Ask for my OK when someone ends their day early"
          sub={`Pressing End day before ${clock12(e.end)} on a working day.`}
          on={e.ok_early_end}
          label="Ask for my OK on an early End day"
          onChange={() => put({ ok_early_end: !e.ok_early_end })}
        />
      </Card>

      <Card title="How a day counts" sub="Reports use these to count attendance, late days, half days and leave from each person’s Start day and End day.">
        <div className="rh-count">
          <div className="rh-count__row">
            <span className="rh-pill ok">Full day</span>
            <span className="rh-count__t">
              <select className="rh-sel sm" aria-label="Hours for a full day" value={e.full_day_hours} onChange={(ev) => put({ full_day_hours: Number(ev.target.value) })}>
                {withValue([7, 8, 9], e.full_day_hours).map((h) => (
                  <option key={h} value={h}>
                    {h} hours
                  </option>
                ))}
              </select>
              <span>or more between Start day and End day, breaks taken out.</span>
            </span>
          </div>
          <div className="rh-count__row">
            <span className="rh-pill warn">Half day</span>
            <span className="rh-count__t">
              <span>Less than that but at least {halfMin} hours, or Start day after</span>
              <select className="rh-sel sm" aria-label="Start day after" value={e.half_start_after} onChange={(ev) => put({ half_start_after: ev.target.value })}>
                {withTime(["12:00", "12:30", "13:00", "14:00"], e.half_start_after).map((t) => (
                  <option key={t} value={t}>
                    {clock12(t)}
                  </option>
                ))}
              </select>
              <span>, or End day before</span>
              <select className="rh-sel sm" aria-label="End day before" value={e.half_end_before} onChange={(ev) => put({ half_end_before: ev.target.value })}>
                {withTime(["13:00", "14:00", "15:00", "16:00"], e.half_end_before).map((t) => (
                  <option key={t} value={t}>
                    {clock12(t)}
                  </option>
                ))}
              </select>
              <span>.</span>
            </span>
          </div>
          <div className="rh-count__row">
            <span className="rh-pill red">Absent</span>
            <span className="rh-count__t">Under {halfMin} hours, or no Start day at all, on a working day.</span>
          </div>
          <div className="rh-count__row">
            <span className="rh-pill grey">Leave</span>
            <span className="rh-count__t">A person marks leave in their Zinwe app, a full or a half day. You approve it in Needs you. Reports show Leave, never Absent.</span>
          </div>
          <div className="rh-count__row">
            <span className="rh-pill grey">Non-working</span>
            <span className="rh-count__t">
              <span>{offDaysLine(e.days)} and these holidays:</span>
              <span className="rh-hol">
                {(wh.holidays.data ?? []).map((h) => (
                  <span key={h.id} className="rh-chip">
                    {h.name} · {holidayDate(h.date)}
                    <button type="button" aria-label={`Remove ${h.name}`} onClick={() => void wh.removeHoliday(h)}>
                      ×
                    </button>
                  </span>
                ))}
                <span className="rh-add">
                  <input
                    aria-label="Holiday name"
                    placeholder="Holiday, e.g. Holi"
                    maxLength={60}
                    value={holName}
                    onChange={(ev) => setHolName(ev.target.value)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") void addHol();
                    }}
                  />
                  <input
                    aria-label="Holiday date"
                    placeholder="Date, e.g. 4 Mar"
                    value={holDate}
                    onChange={(ev) => setHolDate(ev.target.value)}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") void addHol();
                    }}
                  />
                  <button type="button" className="rh-btn" onClick={() => void addHol()}>
                    Add
                  </button>
                </span>
              </span>
            </span>
          </div>
        </div>
      </Card>
    </>
  );
}

function withTime(values: readonly string[], keep: string): string[] {
  return values.includes(keep) ? [...values] : [...values, keep].sort();
}

/** A setting row as on the board: bold title, grey line under it, switch on the right. */
function ToggleRow({ title, sub, on, label, onChange }: { title: string; sub: string; on: boolean; label: string; onChange: () => void }): ReactElement {
  return (
    <div className="rh-tog">
      <span>
        <b>{title}</b>
        <br />
        <span className="rl-k">{sub}</span>
      </span>
      <Toggle on={on} label={label} onChange={onChange} />
    </div>
  );
}
