import type { TerminalTab } from "../../../shared/models/worktree-session";
import type { TerminalSession } from "../../../shared/models/terminal-session";

type Props = {
  tabs: TerminalTab[];
  activeSessionId: string | null;
  sessionStatuses?: Record<string, TerminalSession["status"]>;
  onSelect: (sessionId: string) => void;
  onAdd: () => void;
  onClose: (sessionId: string) => void;
};

const statusSuffix: Partial<Record<TerminalSession["status"], string>> = {
  exited: " (exited)",
  error: " (error)",
};

export function TerminalTabs({ tabs, activeSessionId, sessionStatuses, onSelect, onAdd, onClose }: Props) {
  return (
    <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderBottom: "1px solid #d0d7de" }}>
      <button type="button" onClick={onAdd} aria-label="New terminal">+ Terminal</button>
      {tabs.map((tab) => {
        const status = sessionStatuses?.[tab.sessionId] ?? "running";
        const suffix = statusSuffix[status] ?? "";
        const isDead = status === "exited" || status === "error";
        return (
          <div key={tab.sessionId} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button
              type="button"
              data-active={String(tab.sessionId === activeSessionId)}
              data-status={status}
              style={isDead ? { opacity: 0.5 } : undefined}
              onClick={() => onSelect(tab.sessionId)}
            >
              {tab.label}{suffix}
            </button>
            <button type="button" aria-label={`Close ${tab.label}`} onClick={() => onClose(tab.sessionId)}>
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
