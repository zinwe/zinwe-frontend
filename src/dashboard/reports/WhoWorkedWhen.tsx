import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { TeamReport } from "../../lib/api";
import { formatBytes } from "../features/metrics";
import { clockOf } from "../features/reportFormat";
import { TipBody, type TipRow } from "../ui/Tooltip";
import type { Tip } from "../ui/useTip";
import { axisLbl, daysBetween, fmt, fmtS } from "./dates";
import { buildColumns, COLORS, type DayFacts, type Metric } from "./model";

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

/** The value on top of a bar, as far as the slot allows: "43 h 10 min", then "43 h", then nothing. */
function capLabel(sec: number, slot: number): string {
  if (sec <= 0 || slot < 30) return "";
  if (slot >= 76) return fmtS(sec);
  const m = Math.round(sec / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)} h`;
}

/** Bar width from the slot: about half of it, never wider than 64 px, and still a solid bar on a phone. */
function barWidth(slot: number): number {
  return Math.round(Math.min(64, Math.max(slot * 0.5, Math.min(14, slot * 0.8))));
}

function factRows(f: DayFacts): Array<{ label: string; value: string }> {
  return [
    { label: "Worked", value: fmtS(f.worked) },
    { label: "Active on PC", value: fmtS(f.active) },
    { label: "On breaks", value: fmtS(f.breakSec) + (f.breaks ? ` (${f.breaks})` : "") },
    { label: "Started – finished", value: `${clockOf(f.firstIn)} – ${clockOf(f.lastOut)}` },
    { label: "Internet data", value: f.dataBytes ? formatBytes(f.dataBytes) : "0 MB" },
    { label: "Alerts", value: String(f.alerts) },
  ];
}

/**
 * "Who worked when" (board DashReports): one stacked column per day (per hour for a single day), one segment per
 * person, stacked in palette order so touching segments are palette neighbours. Hovering a column shows everyone's
 * time for it; hovering a segment or a legend row lights that person up across every column; a click pins them
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
}: {
  report: TeamReport;
  colorOf: (key: string) => string;
  pin: string | null;
  onPin: (key: string | null) => void;
  /** One person's report: open that day on Activity. */
  onDay?: (date: string) => void;
  tip: Tip;
}): ReactElement {
  const [metric, setMetric] = useState<Metric>("worked");
  const [hover, setHover] = useState<string | null>(null);
  const [show, setShow] = useState(false);
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
  const totals = new Map<string, { facts: DayFacts; total: number }>();
  for (const c of columns)
    for (const s of c.segs) {
      const t = totals.get(s.facts.key) ?? { facts: s.facts, total: 0 };
      t.total += s.value;
      totals.set(s.facts.key, t);
    }
  const legend = [...totals.values()].sort((a, b) => b.total - a.total);
  const rank = new Map(legend.map((l, i) => [l.facts.key, i]));
  // Same stacking order in every column: palette order, bottom up (ties, past the last colour, by total).
  const slotOf = (key: string) => (COLORS as readonly string[]).indexOf(colorOf(key)) * 1000 + (rank.get(key) ?? 0);
  const pinOk = pin !== null && totals.has(pin);
  const lit = hover ?? (pinOk ? pin : null);
  const grand = columns.reduce((t, c) => t + c.total, 0);
  const nDays = daysBetween(report.from, report.to);
  const measure = metric === "worked" ? "Worked" : "Active on PC";
  const summary = empty ? "No work in this period." : `${measure} ${fmt(grand)} in total, ${hourly ? "by hour" : `over ${nDays} days`}.`;
  const hint = one ? (onDay ? "Click to open this day on Activity" : undefined) : "Click a person to highlight them";
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
              {columns.map((c, k) => {
                let cum = 0;
                const segs = [...c.segs].sort((x, y) => slotOf(x.facts.key) - slotOf(y.facts.key));
                const barH = (c.total / max) * PLOT;
                const cap = capLabel(c.total, slot);
                const tipFor = (el: HTMLElement) => {
                  const bar = el.closest(".rp-ww-col")?.querySelector(".rp-ww-bar") ?? el;
                  const rect = bar.getBoundingClientRect();
                  if (one) {
                    const f = segs[0]?.facts;
                    if (!f) return;
                    tip.showAt(`ww-${k}`, <TipBody title={f.name} color={colorOf(f.key)} sub={c.day} rows={factRows(f)} hint={hint} />, rect);
                    return;
                  }
                  const rows: TipRow[] = [...segs]
                    .reverse()
                    .map((s): TipRow => ({ label: s.facts.name, value: fmtS(s.value), color: colorOf(s.facts.key) }));
                  rows.push({ label: "Total", value: fmtS(c.total), total: true });
                  tip.showAt(`ww-${k}`, <TipBody title={c.day} sub={measure} rows={rows} hint={hint} />, rect);
                };
                return (
                  <div
                    key={`${c.date}-${k}`}
                    className="rp-ww-col"
                    onMouseEnter={(e) => {
                      if (c.total) tipFor(e.currentTarget);
                    }}
                    onMouseLeave={unhover}
                  >
                    {cap ? (
                      <span className="rp-ww-cap rp-num" style={{ bottom: barH + 6 }} aria-hidden="true">
                        {cap}
                      </span>
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
                            key={f.key}
                            type="button"
                            className="rp-ww-seg"
                            style={{
                              bottom: `${bottom.toFixed(3)}%`,
                              height: top ? `${h.toFixed(3)}%` : `max(1px, calc(${h.toFixed(3)}% - 2px))`,
                              backgroundColor: colorOf(f.key),
                              opacity: lit !== null && lit !== f.key ? 0.2 : 1,
                              boxShadow: lit === f.key && segs.length > 1 ? "inset 0 0 0 2px #141210" : undefined,
                              borderRadius: top ? "4px 4px 0 0" : 0,
                            }}
                            aria-label={`${f.name}, ${c.day}: ${measure.toLowerCase()} ${fmtS(s.value)}. ${factRows(f)
                              .map((r) => `${r.label} ${r.value}`)
                              .join(", ")}.${hint ? ` ${hint}.` : ""}`}
                            aria-pressed={!one ? pinOk && pin === f.key : undefined}
                            onMouseEnter={() => setHover(f.key)}
                            onMouseLeave={() => setHover(null)}
                            onFocus={(e) => {
                              setHover(f.key);
                              tipFor(e.currentTarget);
                            }}
                            onBlur={unhover}
                            onClick={() => {
                              if (one) {
                                if (onDay) onDay(c.date);
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
          </div>
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
        {!empty ? (
          <table className="z-sr">
            <caption>
              Who worked when: {measure.toLowerCase()} by {hourly ? "hour" : "day"} and person
            </caption>
            <thead>
              <tr>
                <th scope="col">{hourly ? "Hour" : "Day"}</th>
                {legend.map(({ facts }) => (
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
                    {legend.map(({ facts }) => (
                      <td key={facts.key}>{fmtS(by.get(facts.key) ?? 0)}</td>
                    ))}
                    <td>{fmtS(c.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}
