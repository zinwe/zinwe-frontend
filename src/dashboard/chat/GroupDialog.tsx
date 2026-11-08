import { useState, type ReactElement } from "react";
import { errorMessage, GROUP_ICONS, GROUP_NAME_MAX, type ChatGroup } from "../../lib/api";
import { Modal } from "../components/Modal";
import { Avatar } from "../tasks/Avatar";
import type { TaskPerson } from "../tasks/model";
import { GroupGlyph } from "./GroupAvatar";
import { GROUP_ICON } from "./groupModel";
import { editGroup, makeGroup } from "./groupsSource";

type Person = TaskPerson & { memberId: number };

/**
 * New group / Edit group (board DashChat + logic/chat_groups.py; a bottom sheet on a phone, board DashPhoneChat):
 * name, one of six pictures, people (chips of who's in, "Add a whole team" by department = Member.role, search, a
 * checklist), "Only you can post". Make group → the page opens it (the server adds "You made the group and added …");
 * Save → the server adds a line for each change. The owner is in every group and isn't listed.
 */
export function GroupDialog({
  group,
  people,
  groups,
  onClose,
  onSaved,
}: {
  /** The group being edited; leave out for New group. */
  group?: ChatGroup | null;
  people: readonly Person[];
  /** Every group (a name can't be used twice). */
  groups: readonly ChatGroup[];
  onClose: () => void;
  onSaved: (saved: ChatGroup, made: boolean) => void;
}): ReactElement {
  const editing = !!group;
  const [name, setName] = useState(group?.name ?? "");
  // The picture as the API stores it: an SVG path (a seeded group may have its own).
  const [icon, setIcon] = useState<string>(group?.icon || GROUP_ICON.people.d);
  // Only people who are still on the team can be ticked; a group's old member who left drops out on Save.
  const [ids, setIds] = useState<number[]>(() => (group ? group.member_ids.filter((id) => people.some((p) => p.memberId === id)) : []));
  const [announce, setAnnounce] = useState(group?.announce ?? false);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [pending, setPending] = useState(false);

  const roleOf = (p: Person) => (p.member?.role ? p.role : "");
  const roles = [...new Set(people.map(roleOf).filter(Boolean))];
  const query = q.trim().toLowerCase();
  const shown = people.filter((p) => !query || p.name.toLowerCase().includes(query) || p.role.toLowerCase().includes(query));
  const picked = ids.map((id) => people.find((p) => p.memberId === id)).filter((p): p is Person => !!p);
  const toggle = (id: number) => {
    setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setErr("");
  };

  const save = async () => {
    const clean = name.trim();
    if (!clean) return setErr("Give the group a name.");
    if (!ids.length) return setErr("Pick at least one person.");
    const clash = groups.find((g) => g.id !== group?.id && g.name.trim().toLowerCase() === clean.toLowerCase());
    if (clash) return setErr(`There is already a group called ${clash.name}.`);
    setPending(true);
    setErr("");
    try {
      const saved = group
        ? await editGroup(group.id, {
            ...(clean !== group.name ? { name: clean } : {}),
            ...(icon !== group.icon ? { icon } : {}),
            ...(announce !== group.announce ? { announce } : {}),
            ...(ids.length !== group.member_ids.length || ids.some((id) => !group.member_ids.includes(id)) ? { member_ids: ids } : {}),
          })
        : await makeGroup({ name: clean, icon, member_ids: ids, announce });
      onSaved(saved, !group);
    } catch (e) {
      setErr(errorMessage(e));
      setPending(false);
    }
  };

  const foot = editing ? "Changes show as a line in the group chat." : ids.length ? `You and ${ids.length} ${ids.length === 1 ? "person" : "people"}. It appears in their Zinwe app.` : "Pick who is in the group.";

  return (
    <Modal open onClose={onClose} title={editing ? "Edit group" : "New group"}>
      <div className="zng">
        <div className="zng__b">
          <div className="zng__top">
            <span className="zng__pic" aria-hidden="true">
              <GroupGlyph icon={icon} size={24} />
            </span>
            <label className="zng__name">
              <span className="zk-lab">Group name</span>
              <input
                className="zk-inp"
                value={name}
                maxLength={GROUP_NAME_MAX}
                onChange={(e) => {
                  setName(e.target.value);
                  setErr("");
                }}
                placeholder="Like Design, or Mumbai office"
                // A new group starts with its name.
                autoFocus={!editing}
              />
            </label>
          </div>
          <div>
            <span className="zk-lab">Picture</span>
            <div className="zng__pics" role="group" aria-label="Group picture">
              {GROUP_ICONS.map((k) => (
                <button key={k} type="button" aria-pressed={icon === GROUP_ICON[k].d} aria-label={GROUP_ICON[k].label} title={GROUP_ICON[k].label} onClick={() => setIcon(GROUP_ICON[k].d)}>
                  <GroupGlyph icon={k} size={18} />
                </button>
              ))}
            </div>
          </div>
          <div className="zng__ppl">
            <div className="zng__lh">
              <span className="zk-lab">People · {ids.length + 1}</span>
              <span className="zng__you">You’re in every group as the admin.</span>
            </div>
            {picked.length ? (
              <div className="zng__picked">
                {picked.map((p) => (
                  <span key={p.memberId} className="zng__chip">
                    <Avatar person={p} size={24} />
                    {p.first}
                    <button type="button" aria-label={`Remove ${p.name}`} onClick={() => toggle(p.memberId)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            {roles.length ? (
              <div className="zng__teams">
                <span>Add a whole team:</span>
                {roles.map((r) => {
                  const of = people.filter((p) => roleOf(p) === r).map((p) => p.memberId);
                  const all = of.every((id) => ids.includes(id));
                  return (
                    <button
                      key={r}
                      type="button"
                      className="zng__team"
                      aria-pressed={all}
                      onClick={() => {
                        setIds((cur) => (all ? cur.filter((id) => !of.includes(id)) : [...cur, ...of.filter((id) => !cur.includes(id))]));
                        setErr("");
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      {r}
                      <small>{of.length}</small>
                    </button>
                  );
                })}
              </div>
            ) : null}
            <label className="zng__search">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
              </svg>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" />
            </label>
            <div className="zng__list" role="listbox" aria-multiselectable="true" aria-label="People">
              {shown.map((p) => (
                <button key={p.memberId} type="button" role="option" aria-selected={ids.includes(p.memberId)} className="zng__row" onClick={() => toggle(p.memberId)}>
                  <span className="zng__box" aria-hidden="true">
                    ✓
                  </span>
                  <Avatar person={p} size={24} />
                  <span className="zng__n">
                    <b>{p.name}</b>
                    <small>{p.role}</small>
                  </span>
                </button>
              ))}
              {shown.length === 0 ? <span className="zng__none">Nobody matches “{q.trim()}”.</span> : null}
            </div>
          </div>
          <button type="button" className="zng__sw" role="switch" aria-checked={announce} onClick={() => setAnnounce((a) => !a)}>
            <span>
              <b>Only you can post</b>
              <small>For news and notices. Members read and react, they can’t reply in the group.</small>
            </span>
            <i aria-hidden="true" />
          </button>
          {err ? (
            <span className="zng__err" role="alert">
              {err}
            </span>
          ) : null}
        </div>
        <div className="zng__f">
          <span>{foot}</span>
          <button type="button" className="z-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="z-btn pri" onClick={() => void save()} disabled={pending}>
            {pending ? (editing ? "Saving…" : "Making…") : editing ? "Save" : "Make group"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
