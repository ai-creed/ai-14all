import type { TerminalTab } from "../../../shared/models/worktree-session";

type Props = {
  tabs: TerminalTab[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onAdd: () => void;
  onClose: (sessionId: string) => void;
};

export function TerminalTabs({ tabs, activeSessionId, onSelect, onAdd, onClose }: Props) {
  return (
    <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderBottom: "1px solid #d0d7de" }}>
      <button type="button" onClick={onAdd} aria-label="New terminal">+ Terminal</button>
      {tabs.map((tab) => (
        <div key={tab.sessionId} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            data-active={String(tab.sessionId === activeSessionId)}
            onClick={() => onSelect(tab.sessionId)}
          >
            {tab.label}
          </button>
          <button type="button" aria-label={`Close ${tab.label}`} onClick={() => onClose(tab.sessionId)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
