import { useCallback, useState, type ReactElement } from "react";
import { useAuth } from "../../auth/authContext";
import { DEFAULT_FILE_MAX_MB, errorMessage, FILE_COPY, planMaxBytes, settingsHelpText, type ChatSettings } from "../../lib/api";
import { Modal } from "../components/Modal";
import { SAMPLES_ON, sampleStore } from "../fixtures";
import { useResource } from "../useResource";
import { rememberChatSettings } from "./fileSharing";
import { loadChatSettings, storeChatSettings } from "./groupsSource";

/** SAMPLE: "Quiet after work hours" has no API field yet (v1.4 §1b only has allow_member_dm). */
const quietStore = sampleStore<{ quiet: boolean }>("chat-quiet", () => ({ quiet: true }));

/**
 * Chat settings (owner, board DashChat): whether members may message each other, which is also the one place that
 * says the admin can't read chats between team members, and how long the plan keeps chat history.
 * v1.5: "Allow file sharing" (`allow_files`) beside it, only when the server knows the setting (an older backend
 * leaves it out, and then there is no file sharing at all). Turning it off stops new files, the owner's too;
 * files already sent stay downloadable. Round 2: the help line names the plan's per-file limit in GB.
 */
export function ChatSettingsDialog({ onClose }: { onClose: () => void }): ReactElement {
  const { account } = useAuth();
  const load = useCallback(
    (signal: AbortSignal) =>
      loadChatSettings(signal).then((s) => {
        rememberChatSettings(s);
        return s;
      }),
    [],
  );
  const settings = useResource(load);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quiet, setQuiet] = useState(() => quietStore.get().quiet);
  const days = account?.entitlements?.chat_history_days ?? 0;

  const flip = async (patch: Partial<ChatSettings>) => {
    if (!settings.data) return;
    const before = settings.data;
    settings.setData({ ...before, ...patch });
    setSaving(true);
    setError(null);
    try {
      const saved = await storeChatSettings(patch);
      settings.setData(saved);
      rememberChatSettings(saved);
    } catch (e) {
      settings.setData(before);
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const dm = settings.data?.allow_member_dm ?? true;
  const files = settings.data?.allow_files;
  // Round 2: the plan's own limit (the settings' number, else the plan's file_max_mb, else Free's 1 GB).
  const maxBytes = planMaxBytes(settings.data) ?? planMaxBytes(account?.entitlements) ?? DEFAULT_FILE_MAX_MB * 1024 * 1024;
  return (
    <Modal open onClose={onClose} title="Chat settings" size="sm">
      <div className="cv-set">
        <button type="button" className="zng__sw" role="switch" aria-checked={dm} disabled={!settings.data || saving} onClick={() => void flip({ allow_member_dm: !dm })}>
          <span>
            <b>Team members can message each other</b>
            <small>The admin can’t read chats between team members. You see a message only when someone reports it to you.</small>
          </span>
          <i aria-hidden="true" />
        </button>
        {files !== undefined ? (
          <button type="button" className="zng__sw" role="switch" aria-checked={files} disabled={saving} onClick={() => void flip({ allow_files: !files })}>
            <span>
              <b>{FILE_COPY.settingsSwitch}</b>
              <small>{settingsHelpText(maxBytes)}</small>
            </span>
            <i aria-hidden="true" />
          </button>
        ) : null}
        {SAMPLES_ON ? (
          <button
            type="button"
            className="zng__sw"
            role="switch"
            aria-checked={quiet}
            onClick={() => {
              quietStore.set({ quiet: !quiet });
              setQuiet(!quiet);
            }}
          >
            <span>
              <b>Quiet after work hours</b>
              <small>No chat pop-ups on their PC after their work day ends. They see new messages the next morning.</small>
            </span>
            <i aria-hidden="true" />
          </button>
        ) : null}
        {days > 0 ? <p className="cv-set__note">Your plan keeps chat history for {days} days. Groups, and chats between team members, follow the same limit.</p> : null}
        {settings.error && !settings.data ? (
          <p role="alert" className="cv-set__err">
            {errorMessage(settings.error)}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="cv-set__err">
            {error}
          </p>
        ) : null}
        <div className="dash-confirm__actions">
          <button type="button" className="z-btn pri" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
