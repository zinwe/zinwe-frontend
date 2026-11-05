import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import {
  createMember,
  MEMBER_ROLES,
  pictureErrorMessage,
  rememberPicture,
  setMemberAvatar,
  setMemberRole,
  uploadMemberPhoto,
  type Member,
  type MemberField,
  type MemberPicture,
  type MemberRole,
} from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { apiFieldErrors, apiFormError } from "../../portal/failure";
import { CopyDetails } from "../components/CopyDetails";
import { downloadPage } from "../features/invite";
import { MemberAvatar } from "./Avatar";
import { shrinkPhoto } from "./photo";
import { PicturePicker } from "./PicturePicker";
import { firstName } from "./format";

const FIELDS: readonly MemberField[] = ["name", "email"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Draft {
  name: string;
  email: string;
  role: MemberRole;
  /** A library avatar, or a photo already shrunk in the browser (sent once the person exists). */
  picture: { kind: "avatar"; key: string; label: string } | { kind: "photo"; blob: Blob; kb: number; preview: string } | null;
}

const EMPTY: Draft = { name: "", email: "", role: "developer", picture: null };

function previewOf(picture: Draft["picture"]): MemberPicture | null {
  if (!picture) return null;
  return picture.kind === "avatar" ? { kind: "avatar", key: picture.key } : { kind: "photo", url: picture.preview, updated_at: null };
}

/**
 * DashTeam "Add a person": inline under the header on desktop, a full-screen sheet (ends above the tab bar) with
 * the Add button sticky at its bottom on a phone. Picture, name, work email and role sit in one row (owner, 5 Nov
 * 2026); the picture is one avatar button that opens the drawn people and Upload in a popover, as on a card.
 * → POST members/ (the server emails the invite), then the role and picture are saved; the done step shows the
 * three things to send them.
 */
export function AddPerson({
  slotLine,
  onCreated,
  onClose,
}: {
  slotLine: string;
  onCreated: (member: Member) => void;
  onClose: () => void;
}): ReactElement {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [pictureNote, setPictureNote] = useState("");
  const [pictureError, setPictureError] = useState("");
  /** Added, but the picture didn't save: say so on the done step (it can be set on their card). */
  const [pictureFailed, setPictureFailed] = useState("");
  const [added, setAdded] = useState<Member | null>(null);
  const [copied, setCopied] = useState<"" | "all" | "newid" | "fail">("");
  /** The picture popover beside Name (owner, 5 Nov 2026): one avatar button opens the drawn people and Upload. */
  const [picOpen, setPicOpen] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const avRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (added) titleRef.current?.focus();
    else document.getElementById("n-name")?.focus();
  }, [added]);

  // On a phone the form is a full-screen sheet, so Escape closes it there (on desktop it is inline and keeps the draft).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || window.innerWidth > 760) return;
      if (document.querySelector('[role="dialog"]')) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Esc and a click outside close the picture popover (focus goes back to the avatar button), as on a person's card.
  useEffect(() => {
    if (!picOpen) return;
    (popRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? popRef.current?.querySelector<HTMLElement>("button"))?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && popRef.current?.parentElement?.contains(t)) return;
      setPicOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPicOpen(false);
      avRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [picOpen]);

  const closePicker = () => {
    setPicOpen(false);
    avRef.current?.focus();
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setError("");
  };

  const setPicture = (next: Draft["picture"]) => {
    setDraft((d) => {
      if (d.picture?.kind === "photo") URL.revokeObjectURL(d.picture.preview);
      return { ...d, picture: next };
    });
  };

  const onPhoto = async (file: File) => {
    setPhotoBusy(true);
    setPictureError("");
    setPictureNote("");
    try {
      const shrunk = await shrinkPhoto(file);
      setPicture({ kind: "photo", ...shrunk, preview: URL.createObjectURL(shrunk.blob) });
      setPictureNote(`Photo ready (${shrunk.kb} KB). It's saved when you add them.`);
      closePicker();
    } catch (err) {
      setPictureError(pictureErrorMessage(err));
    } finally {
      setPhotoBusy(false);
    }
  };

  /** After the person exists: save the picture picked in the form. Never blocks adding them. */
  const savePicture = async (member: Member): Promise<Member> => {
    const picture = draft.picture;
    if (!picture) return member;
    try {
      const saved =
        picture.kind === "avatar" ? await setMemberAvatar(member.id, picture.key) : await uploadMemberPhoto(member.id, picture.blob);
      rememberPicture(member.id, saved);
      return { ...member, picture: saved };
    } catch (err) {
      setPictureFailed(`${pictureErrorMessage(err)} You can set their picture on their card.`);
      return member;
    }
  };

  const create = async (event?: FormEvent) => {
    event?.preventDefault();
    if (pending) return;
    const name = draft.name.trim();
    const email = draft.email.trim();
    if (!name) {
      setError("Add their name.");
      document.getElementById("n-name")?.focus();
      return;
    }
    if (!EMAIL_RE.test(email)) {
      setError("Add their full work email; the invite goes there.");
      document.getElementById("n-email")?.focus();
      return;
    }
    setPending(true);
    setError("");
    try {
      let member = await createMember({ name, email });
      try {
        member = await setMemberRole(member.id, draft.role);
      } catch {
        /* The person is added; the role can be set on their card. */
      }
      setPictureFailed("");
      member = await savePicture(member);
      setPicture(null);
      setPictureNote("");
      onCreated(member);
      setAdded(member);
      setCopied("");
    } catch (err) {
      const fieldErrors = apiFieldErrors(err, FIELDS);
      setError(fieldErrors.email ?? fieldErrors.name ?? apiFormError(err, FIELDS) ?? "We couldn't add them. Try again.");
    } finally {
      setPending(false);
    }
  };

  const addAnother = () => {
    setAdded(null);
    setCopied("");
    setDraft(EMPTY);
    setPicOpen(false);
  };

  const copyId = async () => {
    if (!added) return;
    setCopied((await copyText(added.member_id)) ? "newid" : "fail");
  };

  const dl = downloadPage();
  const first = added ? firstName(added.name) : "";

  return (
    <section id="add-sheet" className="z-card zt-add" aria-label="Add a person">
      {added ? (
        <>
          <div className="zt-done-head">
            <span className="zt-done-mark" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <div className="zt-done-text">
              <h2 id="added-title" ref={titleRef} tabIndex={-1}>
                {added.name} is added
              </h2>
              <span>We emailed {added.email} their Member ID and the download link. Their PC appears here once they connect and agree.</span>
              {pictureFailed ? (
                <span role="alert" className="zt-err-note">
                  {pictureFailed}
                </span>
              ) : null}
            </div>
          </div>
          {/* What the new person needs, in order. Copy all puts the three steps on the clipboard to paste anywhere. */}
          <div className="zt-send" role="group" aria-labelledby="send-title">
            <div className="zt-send__head">
              <b id="send-title">Send {first} this</b>
              <CopyDetails member={added} onCopied={(ok) => setCopied(ok ? "all" : "fail")} />
            </div>
            <ol className="zt-steps">
              <li>
                <span className="zt-step" aria-hidden="true">
                  1
                </span>
                <span>
                  Download Zinwe:{" "}
                  <a className="z-mono" href={dl.href} target="_blank" rel="noopener" style={{ fontWeight: 600 }}>
                    {dl.label}
                  </a>
                </span>
              </li>
              <li>
                <span className="zt-step" aria-hidden="true">
                  2
                </span>
                <span>
                  Work email <b>{added.email}</b> and Member ID
                </span>
                <b className="z-mono zt-newid">{added.member_id}</b>
                <button type="button" className="z-btn sm" onClick={() => void copyId()} aria-label={`Copy Member ID ${added.member_id}`}>
                  {copied === "newid" ? "Copied" : "Copy"}
                </button>
              </li>
              <li>
                <span className="zt-step" aria-hidden="true">
                  3
                </span>
                <span>Open Zinwe and agree on screen</span>
              </li>
            </ol>
            <span role="status" className="zt-ok-note">
              {copied === "all"
                ? "All three steps copied. Paste them into an email or chat."
                : copied === "newid"
                  ? "Member ID copied."
                  : copied === "fail"
                    ? "Couldn't copy. Select the text and copy it instead."
                    : ""}
            </span>
          </div>
          <div className="zt-add-act zt-add-act--end">
            <button type="button" className="z-btn sm" onClick={addAnother}>
              Add another
            </button>
            <button type="button" className="z-btn sm dark" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <form className="zt-add-form" onSubmit={(e) => void create(e)} noValidate>
          <div className="zt-add-top">
            <h2>Add a person</h2>
            <button type="button" className="z-btn sm" onClick={onClose}>
              Cancel
            </button>
          </div>
          <div className="zt-add-grid">
            <div className="zt-fld">
              <span className="zt-lab" id="n-pic-lab">
                Picture
              </span>
              <div className="zt-pop">
                <button
                  ref={avRef}
                  type="button"
                  className="zt-av zt-add-av"
                  aria-labelledby="n-pic-lab"
                  aria-describedby="n-pic-state"
                  aria-haspopup="dialog"
                  aria-expanded={picOpen}
                  disabled={pending}
                  onClick={() => setPicOpen((o) => !o)}
                >
                  <MemberAvatar member={{ name: draft.name.trim() || "?", role: draft.role, picture: previewOf(draft.picture) }} size={44} />
                  <span className="zt-add-av__plus" aria-hidden="true">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </span>
                  <span className="z-sr" id="n-pic-state">
                    {draft.picture ? (draft.picture.kind === "photo" ? "Photo picked" : `${draft.picture.label} picked`) : "Optional. Their initials for now"}
                  </span>
                </button>
                {picOpen ? (
                  <div ref={popRef} className="zt-popover" role="dialog" aria-label="Picture for the new person">
                    <div className="zt-pop-head">
                      <b>Choose a picture</b>
                      <button type="button" className="z-btn sm" onClick={closePicker}>
                        Done
                      </button>
                    </div>
                    <PicturePicker
                      idPrefix="n-pic"
                      name={draft.name}
                      role={draft.role}
                      value={previewOf(draft.picture)}
                      busy={photoBusy || pending}
                      onAvatar={(key, label) => {
                        setPicture({ kind: "avatar", key, label });
                        setPictureError("");
                        setPictureNote(`${label} picture picked.`);
                        closePicker();
                      }}
                      onUpload={(file) => void onPhoto(file)}
                      onRemove={() => {
                        setPicture(null);
                        setPictureError("");
                        setPictureNote("Initials it is.");
                        closePicker();
                      }}
                      note={pictureNote}
                      error={pictureError}
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <div className="zt-fld">
              <label className="zt-lab" htmlFor="n-name">
                Name
              </label>
              <input
                id="n-name"
                className="zt-inp"
                autoComplete="off"
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Rohan Iyer"
                aria-invalid={error === "Add their name." ? true : undefined}
              />
            </div>
            <div className="zt-fld">
              <label className="zt-lab" htmlFor="n-email">
                Work email
              </label>
              <input
                id="n-email"
                type="email"
                inputMode="email"
                className="zt-inp"
                autoComplete="off"
                value={draft.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="rohan@kitecrestdigital.com"
                aria-invalid={error.startsWith("Add their full work email") ? true : undefined}
              />
            </div>
            <div className="zt-fld">
              <label className="zt-lab" htmlFor="n-role">
                Role
              </label>
              <select id="n-role" className="zt-inp" value={draft.role} onChange={(e) => set("role", e.target.value as MemberRole)}>
                {MEMBER_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {/* The server always emails the invite today, so this stays on (see the Track D report). */}
          <label className="zt-check">
            <input type="checkbox" checked disabled readOnly />
            Email them the invite with their Member ID and download link
          </label>
          {error ? (
            <p role="alert" className="zt-err">
              {error}
            </p>
          ) : null}
          <div className="zt-add-act">
            <span className="zt-slot">{slotLine}</span>
            <button type="submit" className="z-btn dark" disabled={pending} aria-busy={pending || undefined}>
              {pending ? "Adding…" : "Add person"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
