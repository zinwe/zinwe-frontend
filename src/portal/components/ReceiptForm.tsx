import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactElement } from "react";
import { TermsCheckbox } from "../../components/legal/TermsCheckbox";
import { PAYMENT_TERMS } from "../../content/legal";
import { DashIcon } from "../../dashboard/components/DashIcon";
import { submitPayment, type BillingCycle, type Payment, type PaymentField, type PaymentMethod } from "../../lib/api";
import { cx } from "../../lib/cx";
import { compactErrors, focusFirstInvalid, type FieldErrorMap } from "../../lib/validation";
import { apiFieldErrors, apiFormError } from "../failure";
import { FormAlert } from "./FormAlert";

const FIELDS: readonly PaymentField[] = ["method", "proof", "accept_terms"];
const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const PROOF_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const PROOF_EXT = /\.(jpe?g|png|pdf)$/i;

function proofError(file: File | null): string | undefined {
  if (!file) return "Upload your payment receipt or screenshot.";
  if (!PROOF_TYPES.includes(file.type) && !PROOF_EXT.test(file.name)) return "Upload a JPG, PNG or PDF file.";
  if (file.size > MAX_PROOF_BYTES) return "That file is over 5 MB. Upload a smaller screenshot or PDF.";
  return undefined;
}

function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

interface ReceiptFormProps {
  /** The way the owner had open (UPI, bank transfer, Skydo...): what the payment is recorded as. */
  method: PaymentMethod;
  onSubmitted: (payment: Payment) => void | Promise<void>;
  /** Dashboard upgrade: the plan code this payment is for. */
  upgradePlan?: string;
  /** Monthly or yearly, as chosen at checkout (default: the subscription's own). */
  billingCycle?: BillingCycle;
  /** v1.3.5: an applied coupon code, sent with the receipt (the server checks it again). */
  coupon?: string;
  /** Step number shown before the title ("2"), when the page numbers its steps. */
  step?: string;
  /** No heading of its own (the payment page titles it). */
  bare?: boolean;
}

/**
 * "I've paid": upload the receipt, tick the payment terms, send. Nothing to type: the server records
 * the amount due, today and the owner's name, and staff read the reference off the receipt.
 */
export function ReceiptForm({
  method,
  onSubmitted,
  upgradePlan,
  billingCycle,
  coupon,
  step,
  bare = false,
}: ReceiptFormProps): ReactElement {
  const [proof, setProof] = useState<File | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<FieldErrorMap<PaymentField>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const controls = useRef<Partial<Record<PaymentField, HTMLElement | null>>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (file: File | null) => {
    if (!file) return;
    const invalid = proofError(file);
    setErrors((e) => ({ ...e, proof: invalid }));
    setProof(invalid ? null : file);
    if (invalid && fileRef.current) fileRef.current.value = "";
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => pick(event.target.files?.[0] ?? null);

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!pending) pick(event.dataTransfer.files?.[0] ?? null);
  };

  const removeFile = () => {
    setProof(null);
    if (fileRef.current) fileRef.current.value = "";
    fileRef.current?.focus();
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const clientErrors = compactErrors<PaymentField>({
      // A file that was refused keeps its own reason ("Upload a JPG, PNG or PDF file.") until a good one is picked.
      proof: !proof && errors.proof ? errors.proof : proofError(proof),
      accept_terms: accepted ? undefined : "Please accept the payment terms to continue.",
    });
    setErrors(clientErrors);
    setFormError(null);
    if (Object.keys(clientErrors).length > 0) return focusFirstInvalid(FIELDS, clientErrors, controls.current);

    setPending(true);
    try {
      const payment = await submitPayment({
        method,
        proof,
        upgrade_plan: upgradePlan,
        billing_cycle: billingCycle,
        coupon,
        accept_terms: accepted,
      });
      await onSubmitted(payment);
    } catch (error) {
      const fieldErrors = apiFieldErrors(error, FIELDS);
      setErrors(fieldErrors);
      setFormError(apiFormError(error, FIELDS));
      focusFirstInvalid(FIELDS, fieldErrors, controls.current);
      setPending(false);
    }
  };

  return (
    <form
      className={bare ? "receipt receipt--bare" : "receipt"}
      onSubmit={onSubmit}
      noValidate
      aria-labelledby={bare ? undefined : "receipt-title"}
      aria-label={bare ? "Upload the receipt" : undefined}
    >
      {bare ? null : (
      <div className="pay-section__head">
        {step ? (
          <span className="pay-section__num" aria-hidden="true">
            {step}
          </span>
        ) : null}
        <div>
          <h2 className="pay-section__title" id="receipt-title">
            Upload the receipt
          </h2>
          <p className="pay-section__sub">
            Once you've paid, add the screenshot or PDF your UPI, bank or Skydo app shows. We read the reference
            from it.
          </p>
        </div>
      </div>
      )}

      <div className={cx("field", errors.proof && "is-invalid")}>
        {proof ? (
          <div className="receipt__file">
            <span className="receipt__file-icon" aria-hidden="true">
              <DashIcon name="file" />
            </span>
            <span className="receipt__file-name">{proof.name}</span>
            <small>{fileSize(proof.size)}</small>
            <button type="button" className="dash-link" onClick={removeFile} disabled={pending}>
              Remove
            </button>
          </div>
        ) : (
          <label
            htmlFor="receipt-file"
            className={cx("receipt__drop", dragging && "is-dragging")}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <span className="receipt__drop-icon" aria-hidden="true">
              <DashIcon name="upload" />
            </span>
            <span className="receipt__drop-text">
              <b>Drop the receipt here</b>
              <small>JPG, PNG or PDF, up to 5 MB</small>
            </span>
            <span className="btn btn--ghost dash-btn-sm receipt__browse" aria-hidden="true">
              Browse
            </span>
          </label>
        )}
        <input
          ref={(el) => {
            fileRef.current = el;
            controls.current.proof = el;
          }}
          id="receipt-file"
          className="dash-sr"
          type="file"
          accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
          onChange={onFile}
          disabled={pending}
          aria-invalid={errors.proof ? true : undefined}
          aria-describedby={errors.proof ? "receipt-file-error" : undefined}
        />
        {errors.proof ? (
          <p className="field__err" id="receipt-file-error" role="alert">
            {errors.proof}
          </p>
        ) : null}
      </div>

      <TermsCheckbox
        id="pay-terms"
        checked={accepted}
        onChange={(value) => {
          setAccepted(value);
          if (value && errors.accept_terms) setErrors((e) => ({ ...e, accept_terms: undefined }));
        }}
        docs={[PAYMENT_TERMS]}
        dialogTitle="Payment terms"
        lead="I've paid and agree to Zinwe's"
        error={errors.accept_terms}
        inputRef={(el) => {
          controls.current.accept_terms = el;
        }}
        disabled={pending}
      />

      <FormAlert message={formError} />

      <div className="receipt__foot">
        <button type="submit" className="btn btn--primary" disabled={pending}>
          {pending ? "Sending…" : "Submit receipt"}
        </button>
        <p className="receipt__after">We check it within one working day, switch your plan on and email the invoice.</p>
      </div>
    </form>
  );
}
