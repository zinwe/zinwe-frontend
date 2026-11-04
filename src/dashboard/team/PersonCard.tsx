import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import {
  deactivateMember,
  errorMessage,
  MEMBER_ROLES,
  rotateMemberId,
  setMemberRole,
  type Device,
  type Member,
  type MemberRole,
  type MemberTag,
  type MemberTodo,
} from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { MemberData } from "../components/MemberData";
import { MemberUsage } from "../components/MemberUsage";
import { UsbRestore } from "../components/UsbRestore";
import { useChatBubble } from "../features/chatBubble";
import { consentOf, consentReminder } from "../features/memberStatus";
import type { SecondPc } from "../fixtures/pcs";
import { TheirTodos } from "../tasks/TheirTodos";
import { TipBody } from "../ui/Tooltip";
import type { Tip } from "../ui/useTip";
import { MemberAvatar } from "./Avatar";
import { roleColors } from "./avatars";
import { dayMonthYear, firstName } from "./format";
import { PicturePicker } from "./PicturePicker";
import { useMemberPicture, usePictureSaver } from "./pictureState";
import { STATUS, systemFull, systemShort, type CardStatus, type MemberWeek } from "./teamData";

export interface PersonCardProps {
  member: Member;
  device: Device | undefined;
  status: CardStatus;
  statusRows: [string, string][];
  tag: MemberTag | null;
  week: MemberWeek | undefined;
  weekFailed: boolean;
  today: string;
  now: number;
  second: SecondPc | undefined;
  chatOn: boolean;
  /** Their own to-dos from the Zinwe app; undefined while loading. */
  todos: MemberTodo[] | undefined;
  todosFailed: boolean;
  tip: Tip;
  /** Opened from a #m=<first> link: outline the card. */
  linked: boolean;
  onUpdated: (member: Member) => void;
  onRemoved: (member: Member) => void;
  onDeviceChanged: () => void;
  onKeepBoth: () => void;
  onRemoveSecond: () => void;
}

type Panel = null | "remove" | "rotate";

const SVG_COPY = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a1 1 0 0 1 1-1h10" />
  </svg>
);
const SVG_CHECK = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#17663F" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

function offlineSince(iso: string | null | undefined, now: number): string {
  if (!iso) return "Offline";
  const at = new Date(iso);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(new Date(now)) - day(at)) / 86_400_000);
  const label = at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  if (diff <= 0) return `Offline since ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  if (diff === 1) return `Offline since yesterday (${label})`;
  return `Offline since ${label}`;
}

/**
 * One person on Team & PCs (DashTeam card): picture, name (→ chat), status, "⋮" menu, role, playful tag, PC,
 * consent, Member ID (click copies), the two-PC block (sample, FR-36), last 7 days of active time and internet
 * data, their own to-dos (read-only), and the typed-confirm Remove.
 */
export function PersonCard(props: PersonCardProps): ReactElement {
  const { member, device, status, statusRows, tag, week, weekFailed, today, now, second, chatOn, tip, linked } = props;
  const first = firstName(member.name);
  const firstKey = first.toLowerCase();
  const pc = member.device;
  const invited = !pc;
  const st = STATUS[status];
  const [line] = roleColors(member.role);
  const picture = useMemberPicture(member.id, member.picture);
  const saver = usePictureSaver(member.id, member.name, picture);
  const bubble = useChatBubble();

  const [menuOpen, setMenuOpen] = useState(false);
  const [picOpen, setPicOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [rmText, setRmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState("");
  const [roleBusy, setRoleBusy] = useState(false);
  const [pcRemoving, setPcRemoving] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const avRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);

  // Esc and a click outside close the "⋮" menu and the picture popover (focus goes back to their button).
  useEffect(() => {
    if (!menuOpen && !picOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && (menuRef.current?.parentElement?.contains(t) || popRef.current?.parentElement?.contains(t))) return;
      setMenuOpen(false);
      setPicOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (menuOpen) {
        setMenuOpen(false);
        moreRef.current?.focus();
      } else if (picOpen) {
        setPicOpen(false);
        avRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, picOpen]);

  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menuOpen]);
  useEffect(() => {
    if (!picOpen) return;
    const root = popRef.current;
    (root?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? root?.querySelector<HTMLElement>("button"))?.focus();
  }, [picOpen]);
  useEffect(() => {
    if (panel) document.getElementById(`${panel === "remove" ? "rm" : "rot"}-${member.id}`)?.focus();
  }, [panel, member.id]);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);
  useEffect(() => {
    if (linked) cardRef.current?.scrollIntoView({ block: "center" });
  }, [linked]);

  const copyId = async () => {
    setCopied(await copyText(member.member_id));
  };

  const changeRole = async (role: MemberRole | "") => {
    setRoleBusy(true);
    setActionError("");
    try {
      props.onUpdated(await setMemberRole(member.id, role));
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setRoleBusy(false);
    }
  };

  const rotate = async (asResend: boolean) => {
    setBusy(true);
    setActionError("");
    try {
      const next = await rotateMemberId(member.id, { email: true });
      props.onUpdated(next);
      setPanel(null);
      setMsg(
        asResend
          ? `Invite resent to ${member.email} with a new Member ID. The old one no longer works.`
          : `New Member ID ready. We emailed it to ${first}; the old ID and invite no longer work.`,
      );
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (rmText.trim().toLowerCase() !== firstKey) return;
    setBusy(true);
    setActionError("");
    try {
      props.onRemoved(await deactivateMember(member.id));
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(false);
    }
  };

  const menuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    const at = items.indexOf(document.activeElement as HTMLElement);
    let n = -1;
    if (e.key === "ArrowDown") n = (at + 1) % items.length;
    else if (e.key === "ArrowUp") n = (at - 1 + items.length) % items.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = items.length - 1;
    else if (e.key === "Tab") setMenuOpen(false);
    if (n >= 0) {
      e.preventDefault();
      items[n].focus();
    }
  };

  // ---- What each part says.
  const consent = consentOf(pc, device);
  const consentPill =
    consent === "none"
      ? { text: "Not asked yet", cls: "" }
      : consent === "given"
        ? { text: pc?.consent_at ? `Agreed ${dayMonthYear(pc.consent_at)}` : "Agreed", cls: "green" }
        : consent === "declined"
          ? { text: "Declined", cls: "red" }
          : { text: "Waiting for them", cls: "amber" };
  const consentTip =
    consent === "none" ? (
      <TipBody text={`${first} sees the question when Zinwe first opens on their PC.`} />
    ) : consent === "given" ? (
      <TipBody
        rows={[{ label: "Agreed on", value: pc?.consent_at ? dayMonthYear(pc.consent_at) : "Yes" }]}
        text={`What ${first} agreed to: apps, websites, data use and PC time. Never keystrokes or screens.`}
      />
    ) : consent === "declined" ? (
      <TipBody text="They said no on their PC. Zinwe collects nothing from it; work hours and chat still work." />
    ) : (
      <TipBody text="They’ll be asked on their Zinwe widget. Under India’s DPDP Act, monitoring needs their own consent." />
    );

  const multi = Boolean(second && pc);
  const pcName = pc ? pc.hostname || "Unnamed PC" : "Not connected yet";
  const pcLabel = multi ? "2 PCs" : pcName;
  const system = systemShort(device) || "Windows";
  const pcState = invited
    ? "Waiting for install"
    : multi
      ? pc?.is_online
        ? `Both online · ${system}`
        : `${pcName} offline · ${second?.name} online`
      : pc?.is_online
        ? `Online · ${system}`
        : offlineSince(pc?.last_seen_at, now);
  const pcWhere = invited ? "" : multi ? "both PCs" : pcName;
  const lastRow = statusRows[statusRows.length - 1];
  // The key fact from the status tooltip, shown in the card on phones and touch screens.
  const since = lastRow ? `${lastRow[0]} ${lastRow[1] === "Today" ? "today" : lastRow[1]}` : "";
  const unread = member.unread ?? 0;
  const chatHref = `/app/chat/${member.id}`;
  const activityHref = `/app/activity#m=${encodeURIComponent(firstKey)}`;
  const reportHref = `/app/reports#m=${encodeURIComponent(firstKey)}`;

  const nameTip = tip.anchor(`name-${member.id}`, <TipBody text={`Open chat with ${first}`} />);
  const statusTip = tip.anchor(
    `status-${member.id}`,
    <TipBody title={st.label} color={st.sq} rows={statusRows.map(([label, value]) => ({ label, value }))} text={st.means} />,
    { wide: true },
  );
  const pcTip = tip.anchor(
    `pc-${member.id}`,
    <TipBody
      rows={
        multi
          ? [
              { label: "System", value: `${system}, both` },
              { label: "Last seen", value: pc?.is_online ? "Both online now" : "See each PC" },
            ]
          : [
              { label: "System", value: systemFull(device) || system },
              { label: "Last seen", value: pc?.is_online ? "Online now" : offlineSince(pc?.last_seen_at, now).replace(/^Offline since /, "") },
            ]
      }
      hint={`See ${first}’s day on Activity`}
    />,
    { wide: true },
  );
  const consentA = tip.anchor(`consent-${member.id}`, consentTip, { wide: true });
  const tagA = tag
    ? tip.anchor(`tag-${member.id}`, <TipBody title={<><span aria-hidden="true">{tag.emoji}</span> {tag.label}</>} text={tag.why} />, { wide: true })
    : null;
  const idTip = tip.anchor(`id-${member.id}-${copied ? 1 : 0}`, <TipBody text={copied ? "Copied" : "Copy Member ID"} />);

  return (
    <article
      ref={cardRef}
      id={`card-${firstKey}`}
      className={`z-card zt-card${linked ? " is-linked" : ""}`}
      style={{ borderTop: `3px solid ${line}` }}
      aria-label={member.name}
    >
      <div className="zt-top">
        <div className="zt-pop">
          <button
            ref={avRef}
            type="button"
            className="zt-av"
            aria-label={`Change picture for ${member.name}`}
            aria-haspopup="dialog"
            aria-expanded={picOpen}
            onClick={() => {
              setPicOpen((o) => !o);
              setMenuOpen(false);
              tip.hide();
            }}
          >
            <MemberAvatar member={{ ...member, picture }} size={44} />
          </button>
          {picOpen ? (
            <div ref={popRef} className="zt-popover" role="dialog" aria-label={`Picture for ${member.name}`}>
              <div className="zt-pop-head">
                <b>Picture</b>
                <button
                  type="button"
                  className="z-btn sm"
                  onClick={() => {
                    setPicOpen(false);
                    avRef.current?.focus();
                  }}
                >
                  Done
                </button>
              </div>
              <PicturePicker
                idPrefix={`pic-${member.id}`}
                name={member.name}
                role={member.role}
                value={picture}
                busy={saver.busy}
                onAvatar={saver.pickAvatar}
                onUpload={(file) => void saver.upload(file)}
                onRemove={saver.remove}
                note={saver.note}
                error={saver.error}
              />
              <span className="zt-hint zt-pop-foot">{first} can change it from their Zinwe app too.</span>
            </div>
          ) : null}
        </div>
        <div className="zt-who">
          <Link className="zt-name" to={chatHref} aria-label={`Open chat with ${member.name}${unread ? `, ${unread} unread` : ""}`} {...nameTip}>
            {member.name}
          </Link>
          {unread > 0 ? (
            <span className="zt-unread" aria-hidden="true">
              {unread} new
            </span>
          ) : null}
          <span className="zt-email" title={member.email}>
            {member.email}
          </span>
          {since ? <span className="zt-since">{since}</span> : null}
        </div>
        <div className="zt-top-right">
          <button
            type="button"
            className={`z-pill ${st.pill} zt-pill`}
            aria-label={`Status: ${st.label}. ${statusRows.map(([k, v]) => `${k} ${v}`).join(", ")}`}
            {...statusTip}
          >
            {st.label}
          </button>
          <div className="zt-pop">
            <button
              ref={moreRef}
              type="button"
              className="zt-dots"
              aria-label={`More for ${member.name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => {
                setMenuOpen((o) => !o);
                setPicOpen(false);
                tip.hide();
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setMenuOpen(true);
                }
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="12" cy="5" r="1.9" />
                <circle cx="12" cy="12" r="1.9" />
                <circle cx="12" cy="19" r="1.9" />
              </svg>
            </button>
            {menuOpen ? (
              <div ref={menuRef} className="zt-menu" role="menu" aria-label={`More for ${member.name}`} onKeyDown={menuKey}>
                <Link role="menuitem" className="zt-mi" tabIndex={-1} to={activityHref}>
                  Open activity
                </Link>
                <Link role="menuitem" className="zt-mi" tabIndex={-1} to={chatHref}>
                  Open chat
                </Link>
                <Link role="menuitem" className="zt-mi" tabIndex={-1} to={reportHref}>
                  Their report
                </Link>
                {device ? (
                  <Link role="menuitem" className="zt-mi" tabIndex={-1} to={`/app/alerts?device=${device.id}`}>
                    View alerts
                  </Link>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="zt-mi"
                  tabIndex={-1}
                  onClick={() => {
                    setMenuOpen(false);
                    void copyId();
                    moreRef.current?.focus();
                  }}
                >
                  Copy Member ID
                </button>
                <button type="button" role="menuitem" className="zt-mi" tabIndex={-1} onClick={() => {
                    setMenuOpen(false);
                    setPicOpen(true);
                  }}>
                  Change picture
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="zt-mi"
                  tabIndex={-1}
                  onClick={() => {
                    setMenuOpen(false);
                    setActionError("");
                    setPanel("rotate");
                  }}
                >
                  Get a new ID
                </button>
                <div role="separator" className="zt-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="zt-mi red"
                  tabIndex={-1}
                  onClick={() => {
                    setMenuOpen(false);
                    setActionError("");
                    setRmText("");
                    setPanel("remove");
                  }}
                >
                  Remove from team
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="zt-role-row">
        <label className="z-lbl zt-k" htmlFor={`role-${member.id}`}>
          Role
        </label>
        <select
          id={`role-${member.id}`}
          className="zt-sel"
          value={member.role ?? ""}
          disabled={roleBusy}
          onChange={(e) => void changeRole(e.target.value as MemberRole | "")}
        >
          {member.role ? null : <option value="">Choose a role</option>}
          {MEMBER_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        {tag && tagA ? (
          <button type="button" className="zt-tag" aria-label={`${tag.label}: ${tag.why}`} {...tagA}>
            <span aria-hidden="true">{tag.emoji}</span>
            {tag.label}
          </button>
        ) : null}
      </div>

      <div className="zt-facts">
        <div className="zt-min0">
          <span className="z-lbl zt-k zt-block">PC</span>
          {invited ? (
            <b className="z-mono zt-pcname">{pcLabel}</b>
          ) : (
            <Link className="zt-zlink z-mono zt-pcname" to={activityHref} aria-label={`${pcLabel}. See ${first}’s day on Activity`} {...pcTip}>
              {pcLabel}
            </Link>
          )}
          <span className="zt-pcstate">
            <span className="zt-dot" style={{ background: pc?.is_online ? "#17663F" : "#6B6B6B" }} aria-hidden="true" />
            {pcState}
          </span>
        </div>
        <div>
          <span className="z-lbl zt-k zt-block">Consent</span>
          <button
            type="button"
            className={`z-pill ${consentPill.cls} zt-pill`}
            aria-label={consent === "none" ? "Consent: not asked yet" : `Consent: ${consentPill.text}`}
            {...consentA}
          >
            {consentPill.text}
          </button>
          {(consent === "pending" || consent === "declined") && chatOn ? (
            <button
              type="button"
              className="zt-linkbtn zt-block"
              onClick={() =>
                bubble.open({
                  person: { id: member.id, name: member.name, email: member.email, hostname: pc?.hostname },
                  draft: consentReminder(member.name, consent),
                })
              }
            >
              {consent === "declined" ? `Talk to ${first}` : `Remind ${first}`}
            </button>
          ) : null}
        </div>
        <div className="zt-idrow">
          <span className="z-lbl zt-k">Member ID</span>
          <button
            type="button"
            className="zt-id"
            aria-label={`Copy ${first}’s Member ID ${member.member_id}`}
            {...idTip}
            onClick={() => void copyId()}
          >
            {member.member_id}
            {copied ? SVG_CHECK : SVG_COPY}
          </button>
          <span role="status" className="zt-ok-note zt-sm">
            {copied ? "Copied" : ""}
          </span>
          {invited ? (
            <button type="button" className="z-btn sm zt-push" disabled={busy} onClick={() => void rotate(true)}>
              {busy && !panel ? "Sending…" : "Resend invite"}
            </button>
          ) : null}
        </div>
      </div>

      {device?.usb_locked_at ? (
        <div className="zt-usb">
          <UsbRestore device={device} onRestored={props.onDeviceChanged} />
        </div>
      ) : null}

      {multi && second && second.isNew && !pcRemoving ? (
        <div role="status" className="zt-newpc">
          <b>
            {first} connected a second PC today at {second.connectedAt}
          </b>
          <span>{second.name} agreed on its own screen and is protected. If you didn’t expect it, remove it.</span>
          <div className="zt-row-btns">
            <button type="button" className="z-btn sm" onClick={() => setPcRemoving(true)}>
              Remove a PC
            </button>
            <button type="button" className="z-btn sm" onClick={props.onKeepBoth}>
              Keep both
            </button>
          </div>
        </div>
      ) : null}
      {multi && second ? (
        <div className="zt-multi">
          <div className="zt-multi__head">
            <span className="z-lbl zt-k">{pcLabel}</span>
            <span className="z-pill green">Both protected</span>
          </div>
          {[
            { name: pcName, state: pc?.is_online ? "Online · working day here" : offlineSince(pc?.last_seen_at, now), online: Boolean(pc?.is_online), sample: false },
            { name: second.name, state: second.state, online: true, sample: true },
          ].map((c) => (
            <div key={c.name} className="zt-multi__row">
              <span className="zt-multi__name">
                <span className="zt-dot" style={{ background: c.online ? "#17663F" : "#6B6B6B" }} aria-hidden="true" />
                <b className="z-mono">{c.name}</b>
              </span>
              <span className="zt-multi__state">
                <span>{c.state}</span>
                {pcRemoving && c.sample ? (
                  <button
                    type="button"
                    className="z-btn sm zt-red"
                    aria-label={`Remove ${c.name}`}
                    onClick={() => {
                      setPcRemoving(false);
                      props.onRemoveSecond();
                      setMsg(`${c.name} removed. ${first} now has 1 PC, and the slot is free.`);
                    }}
                  >
                    Remove
                  </button>
                ) : null}
              </span>
            </div>
          ))}
          {pcRemoving ? (
            <div className="zt-pcrm">
              <span>
                Pick the PC to remove. Protection stops there, the slot frees up, and {first} sees it in the Zinwe app.
              </span>
              <button type="button" className="z-btn sm" onClick={() => setPcRemoving(false)}>
                Cancel
              </button>
            </div>
          ) : null}
          <span className="zt-hint">Both PCs are protected. The work day runs on one PC at a time, so time is never counted twice.</span>
        </div>
      ) : null}
      {msg ? (
        <span role="status" className="zt-ok-note">
          {msg}
        </span>
      ) : null}

      <MemberUsage memberId={member.id} name={member.name} week={week} failed={weekFailed} today={today} tip={tip} />
      <MemberData memberId={member.id} connected={!invited} bytes={week?.dataBytes} tip={tip} />
      {chatOn ? <TheirTodos todos={props.todos} failed={props.todosFailed} first={first} memberId={member.id} collapsible /> : null}

      {panel === "rotate" ? (
        <div role="group" aria-label={`Get a new Member ID for ${first}`} className="zt-confirm zt-confirm--amber">
          <b>Get a new Member ID for {first}?</b>
          <span>
            Their old ID and the invite email we sent stop working straight away. We’ll email the new ID to {first}. If their PC is
            already connected it keeps running; you only need the new ID to connect a PC again.
          </span>
          {actionError ? (
            <span role="alert" className="zt-err">
              {actionError}
            </span>
          ) : null}
          <div className="zt-row-btns">
            <button id={`rot-${member.id}`} type="button" className="z-btn sm dark" disabled={busy} onClick={() => void rotate(false)}>
              {busy ? "Getting a new ID…" : "Get a new ID"}
            </button>
            <button
              type="button"
              className="z-btn sm"
              disabled={busy}
              onClick={() => {
                setPanel(null);
                moreRef.current?.focus();
              }}
            >
              Keep
            </button>
          </div>
        </div>
      ) : null}

      {panel === "remove" ? (
        <div role="group" aria-label={`Remove ${first} from the team`} className="zt-confirm">
          <b className="zt-confirm__title">Remove {first} from the team?</b>
          <span>
            {invited
              ? `Their Member ID and invite stop working, and the PC slot stays free. You can add ${first} again later.`
              : `Monitoring stops on ${pcWhere}, the PC slot frees up, and ${first} sees "removed" in the Zinwe app. Their history stays for your plan's period.`}
          </span>
          <label htmlFor={`rm-${member.id}`} className="zt-confirm__lab">
            Type {first} to confirm
          </label>
          <input
            id={`rm-${member.id}`}
            className="zt-inp zt-inp--sm"
            autoComplete="off"
            value={rmText}
            onChange={(e) => setRmText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void remove();
            }}
          />
          {actionError ? (
            <span role="alert" className="zt-err">
              {actionError}
            </span>
          ) : null}
          <div className="zt-row-btns">
            <button type="button" className="z-btn sm zt-danger" disabled={busy || rmText.trim().toLowerCase() !== firstKey} onClick={() => void remove()}>
              {busy ? "Removing…" : "Remove"}
            </button>
            <button
              type="button"
              className="z-btn sm"
              disabled={busy}
              onClick={() => {
                setPanel(null);
                setRmText("");
                moreRef.current?.focus();
              }}
            >
              Keep
            </button>
          </div>
        </div>
      ) : null}
      {actionError && !panel ? (
        <span role="alert" className="zt-err">
          {actionError}
        </span>
      ) : null}
    </article>
  );
}
