import { useState, type ReactElement } from "react";
import { ApiError, errorMessage, type ChatGroup } from "../../lib/api";
import { Modal } from "../components/Modal";
import { removeGroup } from "./groupsSource";

/**
 * Delete group (v1.4.1): a small confirm from the group's ⋮ or Edit group. DELETE /api/chat/groups/<id>/ → 204; the
 * group and its lines go for everyone, tasks posted there stay on Tasks. A 404 means it was already deleted
 * elsewhere: the page treats that the same way (it drops out of the list).
 */
export function DeleteGroupDialog({
  group,
  onClose,
  onDeleted,
}: {
  group: ChatGroup;
  onClose: () => void;
  /** Gone: `already` when someone (another tab) deleted it first. */
  onDeleted: (group: ChatGroup, already: boolean) => void;
}): ReactElement {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");

  const remove = async () => {
    setPending(true);
    setErr("");
    try {
      await removeGroup(group.id);
      onDeleted(group, false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        onDeleted(group, true);
        return;
      }
      setErr(errorMessage(e));
      setPending(false);
    }
  };

  return (
    <Modal open onClose={pending ? () => {} : onClose} title={`Delete ${group.name}?`} size="sm">
      <div className="cv-delg">
        <p>The group and everything said in it go for everyone. Tasks posted here stay on the Tasks page.</p>
        {err ? (
          <span className="zng__err" role="alert">
            {err}
          </span>
        ) : null}
        <div className="cv-delg__f">
          <button type="button" className="z-btn" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="z-btn cv-danger" onClick={() => void remove()} disabled={pending}>
            {pending ? "Deleting…" : "Delete group"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
