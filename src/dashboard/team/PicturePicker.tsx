import { useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactElement } from "react";
import type { MemberPicture, MemberRole } from "../../lib/api";
import { PictureArt } from "./Avatar";
import { AVATARS, roleColors } from "./avatars";
import { PHOTO_ACCEPT } from "./photo";
import { initialsOf, PICTURE_PRIVACY } from "./pictureState";

/**
 * FR-44 picture picker (Team card popover and Add a person): initials + the 16 drawn people, "Upload a photo",
 * and Remove. The grid is one Tab stop; arrow keys move between pictures, Enter / Space picks one (so moving
 * around never saves anything). Every target is at least 44 px.
 */
export function PicturePicker({
  name,
  role,
  value,
  busy,
  onAvatar,
  onUpload,
  onRemove,
  note,
  error,
  idPrefix,
}: {
  name: string;
  role: MemberRole | "" | undefined;
  value: MemberPicture | null;
  busy: boolean;
  onAvatar: (key: string, label: string) => void;
  onUpload: (file: File) => void;
  onRemove: () => void;
  note: string;
  error: string;
  idPrefix: string;
}): ReactElement {
  const [, tint, ink] = roleColors(role || undefined);
  const who = name.trim() || "the new person";
  const first = name.trim().split(/\s+/)[0] || "them";
  const current = value?.kind === "avatar" ? value.key : value ? "photo" : "";
  const keys = ["", ...AVATARS.map((a) => a.key)];
  const [focusKey, setFocusKey] = useState<string>(keys.includes(current) ? current : "");
  const gridRef = useRef<HTMLDivElement>(null);

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = keys.indexOf(focusKey);
    const grid = gridRef.current;
    const cols = grid ? Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length) : 6;
    let next = -1;
    if (e.key === "ArrowRight") next = Math.min(keys.length - 1, at + 1);
    else if (e.key === "ArrowLeft") next = Math.max(0, at - 1);
    else if (e.key === "ArrowDown") next = Math.min(keys.length - 1, at + cols);
    else if (e.key === "ArrowUp") next = Math.max(0, at - cols);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = keys.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setFocusKey(keys[next]);
    gridRef.current?.querySelector<HTMLElement>(`[data-key="${keys[next]}"]`)?.focus();
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onUpload(file);
  };

  return (
    <div className="zt-picker" aria-busy={busy || undefined}>
      <div
        ref={gridRef}
        role="group"
        aria-label={`Pictures for ${who}`}
        className="zt-presets"
        onKeyDown={onGridKey}
      >
        <button
          type="button"
          data-key=""
          tabIndex={focusKey === "" ? 0 : -1}
          aria-label={name.trim() ? `Use ${first}’s initials` : "Use their initials"}
          aria-pressed={!value}
          className="zt-preset"
          disabled={busy}
          onFocus={() => setFocusKey("")}
          onClick={() => value && onRemove()}
        >
          <span aria-hidden="true" className="zt-preset__init" style={{ background: tint, color: ink }}>
            {initialsOf(name || "?")}
          </span>
        </button>
        {AVATARS.map((a) => (
          <button
            key={a.key}
            type="button"
            data-key={a.key}
            tabIndex={focusKey === a.key ? 0 : -1}
            aria-label={`Use the ${a.label.toLowerCase()} picture`}
            aria-pressed={current === a.key}
            className="zt-preset"
            disabled={busy}
            title={a.label}
            onFocus={() => setFocusKey(a.key)}
            onClick={() => current !== a.key && onAvatar(a.key, a.label)}
          >
            <span className="zt-preset__art" aria-hidden="true">
              <PictureArt picture={{ kind: "avatar", key: a.key }} size={36} />
            </span>
          </button>
        ))}
      </div>
      <div className="zt-pop-acts">
        <label className={`z-btn sm dark zt-upl${busy ? " is-busy" : ""}`} htmlFor={`${idPrefix}-file`}>
          <input id={`${idPrefix}-file`} type="file" accept={PHOTO_ACCEPT} onChange={onFile} disabled={busy} />
          {busy ? "Saving…" : value?.kind === "photo" ? "Upload a different photo" : "Upload a photo"}
        </label>
        {value ? (
          <button type="button" className="z-btn sm" onClick={onRemove} disabled={busy}>
            Remove picture
          </button>
        ) : null}
        <span className="zt-hint zt-pop-priv">{PICTURE_PRIVACY}</span>
      </div>
      {error ? (
        <span role="alert" className="zt-err-note">
          {error}
        </span>
      ) : note ? (
        <span role="status" className="zt-ok-note zt-with-ico">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          {note}
        </span>
      ) : null}
    </div>
  );
}
