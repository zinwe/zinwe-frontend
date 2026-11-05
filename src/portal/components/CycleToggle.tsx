import type { KeyboardEvent, ReactElement } from "react";
import type { BillingCycle } from "../../lib/api";
import { cx } from "../../lib/cx";

/**
 * Monthly or yearly: a two-way switch with the yearly saving on it ("Save 17%", or "Save up to 17%" across plans).
 * A radio group: arrow keys move between the two.
 */
export function CycleToggle({
  value,
  onChange,
  saving,
  upTo = false,
  short = false,
  className,
}: {
  value: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
  /** Whole percent a year saves; 0 hides the badge. */
  saving: number;
  /** "Save up to 17%" (several plans) instead of "Save 17%". */
  upTo?: boolean;
  /** The badge as "−17%" (narrow phone switch); screen readers still hear "save (up to) 17%". */
  short?: boolean;
  className?: string;
}): ReactElement {
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next: BillingCycle = value === "monthly" ? "yearly" : "monthly";
    onChange(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-cycle="${next}"]`)?.focus();
  };
  const option = (cycle: BillingCycle, label: string) => {
    const on = value === cycle;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={on}
        tabIndex={on ? 0 : -1}
        data-cycle={cycle}
        className={cx("cycle-toggle__opt", on && "is-on")}
        onClick={() => onChange(cycle)}
      >
        {label}
        {cycle === "yearly" && saving > 0 ? (
          short ? (
            <span className="cycle-toggle__save">
              <span aria-hidden="true">−{saving}%</span>
              <span className="cycle-toggle__sr">
                {upTo ? "save up to" : "save"} {saving}%
              </span>
            </span>
          ) : (
            <span className="cycle-toggle__save">
              {upTo ? "Save up to" : "Save"} {saving}%
            </span>
          )
        ) : null}
      </button>
    );
  };
  return (
    <div className={cx("cycle-toggle", className)} role="radiogroup" aria-label="Billing period" onKeyDown={onKey}>
      {option("monthly", "Monthly")}
      {option("yearly", "Yearly")}
    </div>
  );
}
