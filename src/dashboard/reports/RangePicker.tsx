import { useEffect, useRef, useState, type ReactElement } from "react";
import { dDM, dMid, isoDay, MONTH_FULL, monthStart, shiftDay, toDate } from "./dates";

/**
 * The "Pick dates" pop-over on Reports (board DashReports `.pop`): quick chips, a month grid, a summary line,
 * Cancel / Apply. First click picks the start, the second the end (an earlier day restarts). Esc closes.
 * On a phone it sits above the tab bar as a fixed sheet (CSS).
 */
export function RangePicker({
  from,
  to,
  min,
  max,
  onApply,
  onClose,
}: {
  from: string;
  to: string;
  /** Earliest day that can be picked. */
  min: string;
  /** Latest (today). */
  max: string;
  onApply: (from: string, to: string) => void;
  onClose: () => void;
}): ReactElement {
  const [a, setA] = useState<string | null>(from);
  const [b, setB] = useState<string | null>(to);
  const [month, setMonth] = useState(() => monthStart(to));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const first = toDate(month);
  const lead = (first.getDay() + 6) % 7;
  const len = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const minMonth = monthStart(min);
  const maxMonth = monthStart(max);
  const atFirst = month <= minMonth;
  const atLast = month >= maxMonth;
  const shiftMonth = (n: number) => setMonth(isoDay(new Date(first.getFullYear(), first.getMonth() + n, 1)));

  const pick = (day: string) => {
    if (a === null || b !== null) {
      setA(day);
      setB(null);
    } else if (day < a) setA(day);
    else setB(day);
  };

  const lastMonthStart = isoDay(new Date(toDate(max).getFullYear(), toDate(max).getMonth() - 1, 1));
  const chips: Array<[string, string, string]> = [
    ["Last 7 days", shiftDay(max, -6), max],
    ["Last 30 days", shiftDay(max, -29), max],
    ["This month", monthStart(max), max],
    ["Last month", lastMonthStart, shiftDay(monthStart(max), -1)],
  ];

  const summary =
    a === null
      ? "Pick a start date"
      : b === null
        ? `${dDM(a)} · pick an end date`
        : `${dDM(a)} to ${dDM(b)} · ${Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000) + 1} days`;

  return (
    <div
      ref={ref}
      className="rp-pop"
      role="dialog"
      aria-label="Report dates"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {chips.map(([label, x, y]) => (
          <button
            key={label}
            type="button"
            className="rp-chip"
            onClick={() => {
              setA(x < min ? min : x);
              setB(y);
              setMonth(monthStart(y));
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button type="button" className="rp-nav" aria-label="Previous month" disabled={atFirst} onClick={() => shiftMonth(-1)}>
          ‹
        </button>
        <b style={{ fontSize: 14 }}>
          {MONTH_FULL[first.getMonth()]} {first.getFullYear()}
        </b>
        <button type="button" className="rp-nav" aria-label="Next month" disabled={atLast} onClick={() => shiftMonth(1)}>
          ›
        </button>
      </div>
      <div className="rp-cal">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((w) => (
          <span key={w} className="rp-wk">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`b${i}`} className="rp-cd blank" aria-hidden="true" />
        ))}
        {Array.from({ length: len }, (_, i) => {
          const day = isoDay(new Date(first.getFullYear(), first.getMonth(), i + 1));
          const edge = day === a || day === b;
          const inside = a !== null && b !== null && day > a && day < b;
          const off = day < min || day > max;
          return (
            <button
              key={day}
              type="button"
              className={`rp-cd${edge ? " edge" : inside ? " in" : ""}${day === max ? " today" : ""}`}
              disabled={off}
              aria-label={dMid(day)}
              aria-pressed={edge}
              onClick={() => pick(day)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, borderTop: "1px solid #F5F5F5", paddingTop: 10 }}>
        <span className="rp-num" style={{ fontSize: 12, color: "#404040" }}>
          {summary}
        </span>
        <span style={{ display: "flex", gap: 6 }}>
          <button type="button" className="z-btn sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="z-btn sm pri" disabled={a === null} onClick={() => a !== null && onApply(a, b ?? a)}>
            Apply
          </button>
        </span>
      </div>
    </div>
  );
}

/**
 * One day from the same calendar (F-09, Scheduled → "Pick dates"): the month grid and the Esc / focus behaviour of
 * RangePicker, a single pick, and Cancel / Use this date. Future days only (`min` = today).
 */
export function DatePicker({
  value,
  min,
  max,
  label,
  onPick,
  onClose,
}: {
  value: string;
  min: string;
  max: string;
  label: string;
  onPick: (day: string) => void;
  onClose: () => void;
}): ReactElement {
  const [day, setDay] = useState(value < min ? min : value);
  const [month, setMonth] = useState(() => monthStart(value < min ? min : value));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const first = toDate(month);
  const lead = (first.getDay() + 6) % 7;
  const len = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const shiftMonth = (n: number) => setMonth(isoDay(new Date(first.getFullYear(), first.getMonth() + n, 1)));

  return (
    <div
      ref={ref}
      className="rp-pop"
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button type="button" className="rp-nav" aria-label="Previous month" disabled={month <= monthStart(min)} onClick={() => shiftMonth(-1)}>
          ‹
        </button>
        <b style={{ fontSize: 14 }}>
          {MONTH_FULL[first.getMonth()]} {first.getFullYear()}
        </b>
        <button type="button" className="rp-nav" aria-label="Next month" disabled={month >= monthStart(max)} onClick={() => shiftMonth(1)}>
          ›
        </button>
      </div>
      <div className="rp-cal">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((w) => (
          <span key={w} className="rp-wk">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`b${i}`} className="rp-cd blank" aria-hidden="true" />
        ))}
        {Array.from({ length: len }, (_, i) => {
          const d = isoDay(new Date(first.getFullYear(), first.getMonth(), i + 1));
          return (
            <button
              key={d}
              type="button"
              className={`rp-cd${d === day ? " edge" : ""}${d === min ? " today" : ""}`}
              disabled={d < min || d > max}
              aria-label={dMid(d)}
              aria-pressed={d === day}
              onClick={() => setDay(d)}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, borderTop: "1px solid #F5F5F5", paddingTop: 10 }}>
        <span className="rp-num" style={{ fontSize: 12, color: "#404040" }}>
          {dMid(day)}
        </span>
        <span style={{ display: "flex", gap: 6 }}>
          <button type="button" className="z-btn sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="z-btn sm pri" onClick={() => onPick(day)}>
            Use this date
          </button>
        </span>
      </div>
    </div>
  );
}
