import { useId, useRef, type FormEvent, type ReactElement } from "react";
import { cx } from "../../lib/cx";
import { cleanCoupon, COUPON_LENGTH } from "../coupon";

/** How the line under the field reads: green = applied, orange = capped by the plan's lowest price, red = refused. */
export type CouponTone = "idle" | "ok" | "warn" | "bad";

export interface CouponNote {
  tone: CouponTone;
  text: string;
}


/**
 * "Have a coupon code?" under the checkout's Total (v1.3.5, F-21; board DashPayment): the link opens the field, Apply
 * checks the code with the server, Remove takes it off. The message under the field is a live status line; once a code
 * is applied, a grey note says what that is per PC and what next month costs.
 */
export function CouponBox({
  open,
  value,
  applied,
  busy,
  note,
  perPc,
  onOpen,
  onChange,
  onApply,
  onRemove,
}: {
  open: boolean;
  value: string;
  /** The code that is on the price now (null = none). */
  applied: string | null;
  busy: boolean;
  note: CouponNote | null;
  /** "That is ₹83 per PC a month for 10 PCs. From next month: ₹971 + GST." once applied. */
  perPc: { perPc: string; pcs: number; next: string } | null;
  onOpen: () => void;
  onChange: (value: string) => void;
  onApply: () => void;
  onRemove: () => void;
}): ReactElement {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const fieldId = `${id}-code`;
  const msgId = `${id}-msg`;

  if (!open) {
    return (
      <button
        type="button"
        className="zpf-cpn__open"
        onClick={() => {
          onOpen();
          // The field appears on the next render; put the cursor in it.
          requestAnimationFrame(() => input.current?.focus());
        }}
      >
        Have a coupon code?
      </button>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (applied) onRemove();
    else if (!busy) onApply();
  };

  return (
    <div className="zpf-cpn">
      <label htmlFor={fieldId}>Coupon code</label>
      {/* Not a <form>: the checkout's own controls sit around it. Enter applies. */}
      <div className="zpf-cpn__row">
        <input
          ref={input}
          id={fieldId}
          className={cx("zpf-cpn__input", note && `is-${note.tone}`)}
          value={applied ?? value}
          maxLength={COUPON_LENGTH}
          spellCheck={false}
          autoCapitalize="characters"
          autoComplete="off"
          inputMode="text"
          readOnly={Boolean(applied)}
          aria-describedby={msgId}
          aria-invalid={note?.tone === "bad" ? true : undefined}
          onChange={(event) => onChange(cleanCoupon(event.target.value))}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit(event);
          }}
        />
        {applied ? (
          <button type="button" className="zpf-cpn__btn" onClick={onRemove}>
            Remove
          </button>
        ) : (
          <button type="button" className="zpf-cpn__btn is-apply" onClick={onApply} disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Checking…" : "Apply"}
          </button>
        )}
      </div>
      <span id={msgId} role="status" className={cx("zpf-cpn__msg", note && `is-${note.tone}`)}>
        {note?.text ?? ""}
      </span>
      {applied && perPc ? (
        <span className="zpf-cpn__value">
          {perPc.pcs > 0 ? (
            <>
              That is <strong>{perPc.perPc} per PC a month</strong> for {perPc.pcs} PC{perPc.pcs === 1 ? "" : "s"}.{" "}
            </>
          ) : null}
          From next month: {perPc.next}.
        </span>
      ) : null}
    </div>
  );
}
