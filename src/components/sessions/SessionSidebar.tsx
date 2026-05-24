import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SessionMeta, ToastMessage } from "../../types";

interface SessionSidebarProps {
  visible: boolean;
  onClose: () => void;
  onToast: (text: string, type: ToastMessage["type"]) => void;
}

export default function SessionSidebar({
  visible,
  onClose,
  onToast,
}: SessionSidebarProps) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);

  const refresh = async () => {
    try {
      const list = await invoke<SessionMeta[]>("list_sessions");
      setSessions(list);
    } catch (_) {}
  };

  useEffect(() => {
    if (visible) refresh();
  }, [visible]);

  const handleDelete = async (key: string) => {
    try {
      await invoke("delete_session_by_key", { key });
      onToast("Session deleted", "info");
      refresh();
    } catch (e) {
      onToast(`Failed to delete: ${e}`, "error");
    }
  };

  if (!visible) return null;

  return (
    <div className="sidebar-overlay" onClick={onClose}>
      <div className="session-sidebar" onClick={(e) => e.stopPropagation()}>
        <div className="sidebar-header">
          <h3>Session History</h3>
          <button className="sidebar-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="sidebar-list">
          {sessions.length === 0 ? (
            <div className="sidebar-empty">No saved sessions</div>
          ) : (
            sessions.map((s) => (
              <div key={s.key} className="session-item">
                <div className="session-key">
                  {s.key.replace(/_/g, "/")}
                </div>
                <div className="session-preview">
                  {s.preview || "(empty)"}
                </div>
                <div className="session-meta-info">
                  {s.message_count} messages
                </div>
                <button
                  className="session-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(s.key);
                  }}
                >
                  &times;
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
