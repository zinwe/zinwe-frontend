import {
  useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type ReactElement,
} from "react";
import {
  ApiError, browserContext, errorMessage, getMyIssues, prepareScreenshot, sendIssue, type Issue, type IssueStatus,
} from "../../lib/api";
import { useResource } from "../useResource";
import { Spinner } from "../ui/States";
import "../../styles/dash13/help.css";

const MAX_MESSAGE = 2000;
const STATUS: Record<IssueStatus, string> = { new: "Received", looking: "Looking into it", fixed: "Fixed", closed: "Closed" };

function sentOn(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** "/app/team" → "Team"; anything else as typed. */
function pageName(path: string): string {
  const part = path.replace(/^modal:/, "").replace(/^\/app\/?/, "").split(/[/?#]/)[0];
  return part ? part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, " ") : "Overview";
}

interface IssueFormProps {
  /** Where the owner was when they opened it (a dashboard path); sent with the report. */
  page: string;
  /** Shows the owner's past reports, with their status and the team's reply. */
  showHistory?: boolean;
  /** Called from the thank-you state (the modal uses it to close). */
  onDone?: () => void;
  heading?: boolean;
}

/**
 * Report an issue: what went wrong, an optional screenshot (pick, drag in or paste with Ctrl+V; big images are
 * shrunk before upload) and the browser details, so the team can reproduce and fix it. Shared by the Help → Report
 * an issue tab and the feedback dialog's second tab.
 */
export function IssueForm({ page, showHistory = false, onDone, heading = false }: IssueFormProps): ReactElement {
  const load = useCallback(
    (signal: AbortSignal) => (showHistory ? getMyIssues(signal) : Promise.resolve<Issue[]>([])),
    [showHistory],
  );
  const history = useResource(load);

  const [description, setDescription] = useState("");
  // The screenshot and its preview URL, made together so the URL is freed when the image changes.
  const [shotState, setShotState] = useState<{ file: File; url: string } | null>(null);
  const shot = shotState?.file ?? null;
  const preview = shotState?.url ?? null;
  const [preparing, setPreparing] = useState(false);
  const [contactOk, setContactOk] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Issue | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const urlRef = useRef<string | null>(null);
  const setShot = (file: File | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = file ? URL.createObjectURL(file) : null;
    setShotState(file && urlRef.current ? { file, url: urlRef.current } : null);
  };
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const attach = async (file: File | undefined | null) => {
    if (!file) return;
    setPreparing(true);
    setError(null);
    const ready = await prepareScreenshot(file);
    setPreparing(false);
    if (typeof ready === "string") setError(ready);
    else setShot(ready);
  };

  const onPaste = (event: ClipboardEvent) => {
    const file = Array.from(event.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (file) {
      event.preventDefault();
      void attach(file);
    }
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void attach(event.dataTransfer.files[0]);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending || preparing) return;
    if (!description.trim()) {
      setError("Tell us what went wrong.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const saved = await sendIssue({
        description: description.trim(),
        page: page.replace(/^modal:/, "").slice(0, 120),
        contact_ok: contactOk,
        context: browserContext(),
        screenshot: shot,
      });
      if (showHistory) history.setData([saved, ...(history.data ?? [])].slice(0, 20));
      setSent(saved);
      setDescription("");
      setShot(null);
    } catch (err) {
      const field = err instanceof ApiError ? (err.fieldErrors.description ?? err.fieldErrors.screenshot)?.[0] : undefined;
      setError(field ?? errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="zf">
      {sent ? (
        <div className="zf-thanks" role="status">
          <b style={{ fontSize: 17 }}>Thanks. We've got it: report #{sent.id}.</b>
          <span className="zf-k">
            {sent.contact_ok
              ? "We'll look at it and email you as soon as it's fixed."
              : "We'll look at it. You asked us not to email you about it."}
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="z-btn sm" onClick={() => setSent(null)}>
              Report something else
            </button>
            {onDone ? (
              <button type="button" className="z-btn sm dark" onClick={onDone}>
                Done
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <form className="zf-form" noValidate onSubmit={onSubmit} onPaste={onPaste}>
          {heading ? <b className="zf-q big">Something not working?</b> : null}
          <label htmlFor="zi-msg" style={{ fontWeight: 600 }}>
            What went wrong?
          </label>
          <textarea
            id="zi-msg"
            className="zf-text"
            rows={4}
            maxLength={MAX_MESSAGE}
            placeholder="What you did, what you expected, and what happened instead."
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setError(null);
            }}
          />
          <span className="zf-k" style={{ marginTop: -8 }}>
            On the {pageName(page)} page · {description.length}/{MAX_MESSAGE}
          </span>

          <div
            className={`zi-shot${dragging ? " is-over" : ""}${preview ? " has-shot" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            {preview ? (
              <>
                <img src={preview} alt="Your screenshot" className="zi-shot__img" />
                <span className="zi-shot__meta">
                  <b>Screenshot attached</b>
                  <span className="zf-k">{Math.max(1, Math.round((shot?.size ?? 0) / 1024))} KB</span>
                  <button type="button" className="z-btn sm" onClick={() => setShot(null)}>
                    Remove
                  </button>
                </span>
              </>
            ) : (
              <span className="zi-shot__empty">
                <b>Add a screenshot</b> <span className="zf-k">(optional)</span>
                <span className="zf-k">Paste it with Ctrl+V, drag it here, or</span>
                <button type="button" className="z-btn sm" onClick={() => fileInput.current?.click()} disabled={preparing}>
                  {preparing ? <Spinner size={16} /> : null}
                  {preparing ? "Preparing…" : "Choose an image"}
                </button>
              </span>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                void attach(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          <label className="zi-check">
            <input type="checkbox" checked={contactOk} onChange={(e) => setContactOk(e.target.checked)} />
            <span>Email me updates about this report</span>
          </label>
          <span className="zf-k">
            We also send the page, your browser and screen size, so we can see what you saw. Nothing else.
          </span>

          {error ? (
            <p className="zf-err" role="alert">
              {error}
            </p>
          ) : null}

          <div className="zf-acts">
            <button type="submit" className={`z-btn pri${sending ? " is-busy" : ""}`} disabled={sending || preparing}>
              {sending ? <Spinner size={16} tone="on-orange" /> : null}
              {sending ? "Sending…" : "Send report"}
            </button>
          </div>
        </form>
      )}

      {showHistory && history.data && history.data.length > 0 ? (
        <div className="zf-hist" aria-label="Your reports">
          <b>Your reports</b>
          <ul>
            {history.data.map((r) => (
              <li key={r.id}>
                <span className={`zi-status zi-status--${r.status}`}>{STATUS[r.status]}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block" }}>{r.description}</span>
                  {r.reply ? <span style={{ display: "block", marginTop: 4 }}>Zinwe team: {r.reply}</span> : null}
                  <span className="zf-k">
                    #{r.id} · {sentOn(r.created_at)}
                    {r.has_screenshot ? " · screenshot attached" : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default IssueForm;
