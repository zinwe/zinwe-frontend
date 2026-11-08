import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { TeamReport } from "../../lib/api";
import { formatBytes } from "../features/metrics";
import { clockOf } from "../features/reportFormat";
import { TipBody, type TipRow } from "../ui/Tooltip";
import type { Tip } from "../ui/useTip";
import { statusText, type Attendance } from "./attendance";
import { axisLbl, daysBetween, fmt, fmtS } from "./dates";
import { buildColumns, COLORS, type ColorOf, type DayFacts, type Metric } from "./model";

/** Plot height, and the room kept above it for the value on top of the tallest bar. */
const PLOT = 220;
const HEAD = 22;

/** Tick steps in seconds: minutes, then whole hours. */
const STEPS = [5, 10, 15, 20, 30]
  .map((m) => m * 60)
  .concat([1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400, 500].map((h) => h * 3600));

/** Nice y ticks from the data max: the smallest clean step that needs at most 5 intervals. */
function niceTicks(maxSec: number): number[] {
  const step = STEPS.find((s) => Math.ceil(maxSec / s) <= 5) ?? STEPS[STEPS.length - 1];
  const n = Math.max(1, Math.ceil(maxSec / step));
  return Array.from({ length: n + 1 }, (_, i) => i * step);
}

/** The value on top of a bar, as far as the slot allows: "43 h 10 min", then "43.2 h", then nothing. */
function capLabel(sec: number, slot: number): string {
  if (sec <= 0 || slot < 34) return "";
  if (slot >= 76) return fmtS(sec);
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 6) / 10;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

/** Bar width from the slot: about half of it, never wider than 64 px, and still a solid bar on a phone. */
function barWidth(slot: number): number {
  return Math.round(Math.min(64, Math.max(slot * 0.5, Math.min(14, slot * 0.8))));
}

/** The chart keeps the top TOP of the period in their own colours (one palette slot each, so no colour shows twice)
 *  and groups everyone after them as "Others". */
const TOP = COLORS.length;
/** Grouped people named in the day tooltip before "+N more". */
const TIP_OTHERS = 5;
const OTHERS = "__others";
/** "Others": light grey with a quiet 45° hatch, so it never reads as one more person's colour. */
const OTHERS_FILL = "repeating-linear-gradient(45deg, #D4D4D4 0 3px, #E8E8E8 3px 6px)";

/** One drawn segment: a person, or everyone grouped under "Others" (with each grouped person's share). */
interface Part {
  key: string;
  name: string;
  value: number;
  fill: string;
  facts?: DayFacts;
  members?: Array<{ facts: DayFacts; value: number }>;
  /** Spoken name of the segment. */
  aria: string;
}

const factCache = new WeakMap<DayFacts, Array<{ label: string; value: string }>>();

function factRows(f: DayFacts): Array<{ label: string; value: string }> {
  const hit = factCache.get(f);
  if (hit) return hit;
  const rows = [
    { label: "Worked", value: fmtS(f.worked) },
    { label: "Active on PC", value: fmtS(f.active) },
    { label: "Breaks", value: fmtS(f.breakSec) + (f.breaks ? ` (${f.breaks})` : "") },
    { label: "Start – finish", value: `${clockOf(f.firstIn)} – ${clockOf(f.lastOut)}` },
    { label: "Internet data", value: f.dataBytes ? formatBytes(f.dataBytes) : "0 MB" },
    { label: "Alerts", value: String(f.alerts) },
  ];
  factCache.set(f, rows);
  return rows;
}

/**
 * "Who worked when" (board DashReports): one stacked column per day (per hour for a single day), one segment per
 * person, stacked in palette order so touching segments are palette neighbours. Hovering a person's piece shows their
 * card for that day (swatch, name, day and how it counted, Worked / Active on PC / Breaks / Start – finish / Internet
 * data / Alerts) and lights them up across every column; hovering the total on top of a column shows the whole day
 * (everyone's time). Hovering a legend row lights that person up too; a click pins them
 * (their By person row and Performance row light up too). Again = clear. One person's report: a click opens
 * that day on Activity. Phone: hidden behind "Show chart", with a one-line total in its place. A hidden table
 * carries every value for screen readers.
 */
export function WhoWorkedWhen({
  report,
  colorOf,
  pin,
  onPin,
  onDay,
  tip,
  att,
}: {
  report: TeamReport;
  /** v1.4 day status (how each person's day counted), for the person card. */
  att?: Attendance;
  colorOf: ColorOf;
  pin: string | null;
  onPin: (key: string | null) => void;
  /** One person's report: open that day on Activity. */
  onDay?: (date: string) => void;
  tip: Tip;
}): ReactElement {
  const [metric, setMetric] = useState<Metric>("worked");
  const [hover, setHover] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotW, setPlotW] = useState(0);
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setPlotW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const one = Boolean(report.member);
  const { columns, hourly } = useMemo(() => buildColumns(report, metric), [report, metric]);
  const ticks = niceTicks(Math.max(60, ...columns.map((c) => c.total)));
  const max = ticks[ticks.length - 1];
  const empty = columns.every((c) => c.total === 0);
  const measure = metric === "worked" ? "Worked" : "Active on PC";
  const hint = one ? (onDay ? "Click to open this day on Activity" : undefined) : "Click a person to highlight them";
  const { totals, people, legend, others, othersTotal, grouped, parts } = useMemo(() => {
    const totals = new Map<string, { facts: DayFacts; total: number }>();
    for (const c of columns)
      for (const s of c.segs) {
        const t = totals.get(s.facts.key) ?? { facts: s.facts, total: 0 };
        t.total += s.value;
        totals.set(s.facts.key, t);
      }
    const people = [...totals.values()].sort((a, b) => b.total - a.total);
    // Up to TOP people: everyone in their own colour. More: the top TOP of the period (colorMap's rank, by worked
    // time, so they wear the TOP distinct colours) keep them, and everyone after is one "Others" segment on top of
    // every column.
    const byRank = [...people].sort((a, b) => colorOf.rank(a.facts.key) - colorOf.rank(b.facts.key));
    const named = new Set(byRank.slice(0, TOP).map((p) => p.facts.key));
    const legend = people.filter((p) => named.has(p.facts.key));
    const others = people.filter((p) => !named.has(p.facts.key));
    const grouped = new Set(others.map((o) => o.facts.key));
    // Same stacking order in every column: palette (rank) order bottom up, Others on top.
    const slotOf = (key: string) => (key === OTHERS ? Number.MAX_SAFE_INTEGER : colorOf.rank(key));
    const lower = measure.toLowerCase();
    const parts = columns.map((c): Part[] => {
      const own: Part[] = c.segs
        .filter((x) => !grouped.has(x.facts.key))
        .map((x) => ({
          key: x.facts.key,
          name: x.facts.name,
          value: x.value,
          fill: colorOf(x.facts.key),
          facts: x.facts,
          aria: `${x.facts.name}, ${c.day}: ${lower} ${fmtS(x.value)}. ${factRows(x.facts)
            .map((r) => `${r.label} ${r.value}`)
            .join(", ")}.${hint ? ` ${hint}.` : ""}`,
        }));
      const rest = c.segs.filter((x) => grouped.has(x.facts.key)).sort((a, b) => b.value - a.value);
      if (rest.length) {
        const value = rest.reduce((t, x) => t + x.value, 0);
        own.push({
          key: OTHERS,
          name: "Others",
          value,
          fill: OTHERS_FILL,
          members: rest,
          aria: `Others, ${rest.length} people, ${c.day}: ${lower} ${fmtS(value)}. ${rest.map((m) => `${m.facts.name} ${fmtS(m.value)}`).join(", ")}.`,
        });
      }
      return own.sort((x, y) => slotOf(x.key) - slotOf(y.key));
    });
    const othersTotal = others.reduce((t, o) => t + o.total, 0);
    return { totals, people, legend, others, othersTotal, grouped, parts };
  }, [columns, colorOf, measure, hint]);
  const pinOk = pin !== null && totals.has(pin);
  const litRaw = hover ?? (pinOk ? pin : null);
  // A grouped person (pinned from By person, say) lights up the Others segment.
  const lit = litRaw !== null && grouped.has(litRaw) ? OTHERS : litRaw;
  const grand = columns.reduce((t, c) => t + c.total, 0);
  const nDays = daysBetween(report.from, report.to);
  const summary = empty ? "No work in this period." : `${measure} ${fmt(grand)} in total, ${hourly ? "by hour" : `over ${nDays} days`}.`;
  const table = useMemo(
    () =>
      empty ? null : (
        <table className="z-sr">
          <caption>
            Who worked when: {measure.toLowerCase()} by {hourly ? "hour" : "day"} and person
          </caption>
          <thead>
            <tr>
              <th scope="col">{hourly ? "Hour" : "Day"}</th>
              {people.map(({ facts }) => (
                <th key={facts.key} scope="col">
                  {facts.name}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c, k) => {
              const by = new Map(c.segs.map((s) => [s.facts.key, s.value]));
              return (
                <tr key={`${c.date}-${k}`}>
                  <th scope="row">{c.day}</th>
                  {people.map(({ facts }) => (
                    <td key={facts.key}>{fmtS(by.get(facts.key) ?? 0)}</td>
                  ))}
                  <td>{fmtS(c.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ),
    [empty, measure, hourly, people, columns],
  );
  const slot = columns.length ? plotW / columns.length : 0;
  const bw = barWidth(slot);

  const unhover = () => {
    setHover(null);
    tip.hide();
  };

  return (
    <section
      className="z-card"
      aria-labelledby="ww-h"
      style={{ padding: "18px 18px 14px", display: "flex", flexDirection: "column", gap: 14 }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        if (hover) unhover();
        else onPin(null);
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 id="ww-h" style={{ margin: 0, fontSize: 17 }}>
          Who worked when
        </h2>
        <div role="group" aria-label="Measure" className={`rp-segs${show ? "" : " rp-shut"}`}>
          {(
            [
              ["worked", "Worked"],
              ["active", "Active on PC"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`rp-seg${metric === k ? " on" : ""}`}
              aria-pressed={metric === k}
              onClick={() => {
                setMetric(k);
                unhover();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="rp-ph-only">
        <p className="rp-num" style={{ margin: "0 0 10px", fontSize: 13, color: "#404040" }}>
          {summary}
        </p>
        <button
          type="button"
          className="z-btn sm"
          aria-expanded={show}
          aria-controls="ww-body"
          onClick={() => {
            setShow(!show);
            unhover();
          }}
        >
          {show ? "Hide chart" : "Show chart"}
        </button>
      </div>
      <div id="ww-body" className={show ? "rp-ww-body" : "rp-ww-body rp-shut"} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="rp-ww-grid">
          <div style={{ position: "relative", height: PLOT + HEAD }} aria-hidden="true">
            {ticks.map((t) => (
              <span key={t} className="rp-axl" style={{ bottom: (t / max) * PLOT }}>
                {axisLbl(t)}
              </span>
            ))}
          </div>
          <div ref={plotRef} style={{ position: "relative", height: PLOT + HEAD }}>
            {ticks.map((t) => (
              <span key={t} className={`rp-ww-gl${t === 0 ? " base" : ""}`} style={{ bottom: (t / max) * PLOT }} aria-hidden="true" />
            ))}
            <div
              role="group"
              aria-label={`Who worked when, ${measure.toLowerCase()} by ${hourly ? "hour" : "day"}`}
              style={{ position: "absolute", inset: 0, display: "flex" }}
            >
              {plotW > 0 &&
                columns.map((c, k) => {
                let cum = 0;
                const segs = parts[k];
                const barH = (c.total / max) * PLOT;
                const cap = capLabel(c.total, slot);
                // The whole day: everyone's time, from the total on top of the column.
                const dayTip = (el: HTMLElement) => {
                  const r = el.getBoundingClientRect();
                  if (one) {
                    const f = segs[0]?.facts;
                    if (!f) return;
                    const st = statusText(att?.day(f.key, c.date));
                    tip.showAt(`ww-${k}`, <TipBody title={f.name} color={colorOf(f.key)} sub={st ? `${c.day} · ${st}` : c.day} rows={factRows(f)} hint={hint} />, r);
                    return;
                  }
                  const rows: TipRow[] = [];
                  for (const s of [...segs].reverse()) {
                    if (!s.members) {
                      rows.push({ label: s.name, value: fmtS(s.value), color: s.fill });
                      continue;
                    }
                    rows.push({ label: `Others (${s.members.length})`, value: fmtS(s.value), color: s.fill });
                    const sub = (label: string) => <span style={{ paddingLeft: 18, color: "#6B6B6B" }}>{label}</span>;
                    for (const m of s.members.slice(0, TIP_OTHERS)) rows.push({ label: sub(m.facts.name), value: fmtS(m.value) });
                    const more = s.members.slice(TIP_OTHERS);
                    if (more.length)
                      rows.push({ label: sub(`+${more.length} more`), value: fmtS(more.reduce((t, m) => t + m.value, 0)) });
                  }
                  rows.push({ label: "Total", value: fmtS(c.total), total: true });
                  tip.showAt(`ww-${k}`, <TipBody title={c.day} sub={measure} rows={rows} hint={hint} />, r);
                };
                // One piece: that person's card for the day (or who is in Others), pointing at the top of the piece.
                const segTip = (el: HTMLElement, s: Part) => {
                  const b = el.getBoundingClientRect();
                  const rect = new DOMRect(b.left, b.top, b.width, Math.min(b.height, 24));
                  if (s.facts) {
                    const st = statusText(att?.day(s.facts.key, c.date));
                    tip.showAt(
                      `ww-${k}-${s.key}`,
                      <TipBody title={s.facts.name} color={s.fill} sub={st ? `${c.day} · ${st}` : c.day} rows={factRows(s.facts)} hint={one ? hint : undefined} />,
                      rect,
                    );
                    return;
                  }
                  const members = s.members ?? [];
                  const rows: TipRow[] = members.slice(0, TIP_OTHERS).map((m) => ({ label: m.facts.name, value: fmtS(m.value) }));
                  const more = members.slice(TIP_OTHERS);
                  if (more.length) rows.push({ label: `+${more.length} more`, value: fmtS(more.reduce((t, m) => t + m.value, 0)) });
                  tip.showAt(`ww-${k}-${s.key}`, <TipBody title={`Others (${members.length})`} color={s.fill} sub={c.day} rows={rows} />, rect);
                };
                return (
                  <div key={`${c.date}-${k}`} className="rp-ww-col">
                    {c.total ? (
                      <button
                        type="button"
                        className={`rp-ww-top rp-num${cap ? "" : " bare"}`}
                        style={{ bottom: barH + 2 }}
                        aria-label={`${c.day}: ${measure.toLowerCase()} ${fmtS(c.total)} in total. Everyone's time.`}
                        onMouseEnter={(e) => dayTip(e.currentTarget)}
                        onMouseLeave={unhover}
                        onFocus={(e) => dayTip(e.currentTarget)}
                        onBlur={unhover}
                      >
                        {cap}
                      </button>
                    ) : null}
                    <div className="rp-ww-bar" style={{ width: bw, height: barH }}>
                      {segs.map((s, j) => {
                        const bottom = c.total ? (cum / c.total) * 100 : 0;
                        const h = c.total ? (s.value / c.total) * 100 : 0;
                        cum += s.value;
                        const f = s.facts;
                        const top = j === segs.length - 1;
                        return (
                          <button
                            key={s.key}
                            type="button"
                            className="rp-ww-seg"
                            style={{
                              bottom: `${bottom.toFixed(3)}%`,
                              height: top ? `${h.toFixed(3)}%` : `max(1px, calc(${h.toFixed(3)}% - 2px))`,
                              background: s.fill,
                              opacity: lit !== null && lit !== s.key ? 0.2 : 1,
                              // White inner + ink outer ring: shows on the pale tints and on the ink segments alike.
                              boxShadow: lit === s.key && segs.length > 1 ? "inset 0 0 0 2px #FFFFFF, 0 0 0 2px #141210" : undefined,
                              zIndex: lit === s.key ? 1 : undefined,
                              borderRadius: top ? "4px 4px 0 0" : 0,
                            }}
                            aria-label={s.aria}
                            aria-pressed={!one && f ? pinOk && pin === f.key : undefined}
                            onMouseEnter={(e) => {
                              setHover(s.key);
                              segTip(e.currentTarget, s);
                            }}
                            onMouseLeave={unhover}
                            onFocus={(e) => {
                              setHover(s.key);
                              segTip(e.currentTarget, s);
                            }}
                            onBlur={unhover}
                            onClick={() => {
                              if (one) {
                                if (onDay) onDay(c.date);
                                return;
                              }
                              if (!f) {
                                setOthersOpen(true);
                                return;
                              }
                              onPin(pinOk && pin === f.key ? null : f.key);
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {empty ? (
              <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#6B6B6B", fontSize: 13 }}>
                No work in this period.
              </span>
            ) : null}
          </div>
          <span />
          <div style={{ display: "flex", paddingTop: 8 }} aria-hidden="true">
            {columns.map((c, k) => (
              <span key={`${c.date}-${k}`} className="rp-xl">
                {c.label}
              </span>
            ))}
          </div>
        </div>
        {legend.length ? (
          <div className="rp-wwl" role="group" aria-label="People, most time first">
            {legend.map(({ facts, total }) => {
              const on = pinOk && pin === facts.key;
              return (
                <button
                  key={facts.key}
                  type="button"
                  className={`rp-lg${on ? " on" : ""}`}
                  style={{ opacity: lit !== null && lit !== facts.key ? 0.4 : 1 }}
                  aria-pressed={on}
                  aria-label={`${facts.name}, ${fmtS(total)}${on ? ", highlighted" : ""}`}
                  onMouseEnter={() => setHover(facts.key)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(facts.key)}
                  onBlur={() => setHover(null)}
                  onClick={() => onPin(on ? null : facts.key)}
                >
                  <span className="rp-lg-sw" style={{ background: colorOf(facts.key) }} />
                  <span className="rp-lg-n">{facts.name}</span>
                  <span className="rp-lg-t rp-num">{fmtS(total)}</span>
                </button>
              );
            })}
            {others.length ? (
              <button
                type="button"
                className={`rp-lg${othersOpen ? " on" : ""}`}
                style={{ opacity: lit !== null && lit !== OTHERS ? 0.4 : 1 }}
                aria-expanded={othersOpen}
                aria-controls="ww-others"
                aria-label={`Others, ${others.length} people, ${fmtS(othersTotal)}. ${othersOpen ? "Hide" : "Show"} who`}
                onMouseEnter={() => setHover(OTHERS)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(OTHERS)}
                onBlur={() => setHover(null)}
                onClick={() => setOthersOpen(!othersOpen)}
              >
                <span className="rp-lg-sw" style={{ background: OTHERS_FILL }} />
                <span className="rp-lg-n" title={`Others, ${others.length} people`}>
                  Others · {others.length}
                </span>
                <span className="rp-lg-t rp-num">{fmtS(othersTotal)}</span>
              </button>
            ) : null}
          </div>
        ) : null}
        {others.length && othersOpen ? (
          <ul id="ww-others" className="rp-wwo" aria-label="Grouped under Others">
            {others.map(({ facts, total }) => (
              <li key={facts.key}>
                <span className="rp-lg-n">{facts.name}</span>
                <span className="rp-lg-t rp-num">{fmtS(total)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <p className="rp-k" style={{ margin: 0 }}>
            Active on PC: time the PC was in use (keyboard or mouse), not what was done.
          </p>
          {pinOk ? (
            <button type="button" className="rp-lnk" style={{ fontSize: 12 }} onClick={() => onPin(null)}>
              Show all
            </button>
          ) : null}
        </div>
        {table}
      </div>
    </section>
  );
}
