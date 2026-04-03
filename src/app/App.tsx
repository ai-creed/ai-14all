import { useState } from "react";
import type { Repository } from "../../shared/models/repository";
import type { Worktree } from "../../shared/models/worktree";
import { RepositoryInput } from "../features/repository/RepositoryInput";
import { WorktreeList } from "../features/worktrees/WorktreeList";
import { TerminalPane } from "../features/terminals/TerminalPane";
import { useTerminalSession } from "../features/terminals/useTerminalSession";
import { FileList } from "../features/viewer/FileList";
import { FileViewer } from "../features/viewer/FileViewer";

export function App() {
  const [repository, setRepository] = useState<Repository | null>(null);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(
    null,
  );
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { sessions, createSession, stopSession } = useTerminalSession();

  function handleLoad(repo: Repository, wts: Worktree[]) {
    setRepository(repo);
    setWorktrees(wts);
    setSelectedWorktreeId(null);
    setSelectedFile(null);
    setError(null);
    setLoading(false);
  }

  // When the selected worktree changes, clear the selected file
  function handleSelectWorktree(id: string) {
    setSelectedWorktreeId(id);
    setSelectedFile(null);
  }

  function handleAddTerminal() {
    if (!selectedWorktreeId) return;
    const wt = worktrees.find((w) => w.id === selectedWorktreeId);
    if (!wt) return;
    createSession(selectedWorktreeId, wt.path).catch((err: unknown) => {
      console.error("Failed to create terminal session:", err);
    });
  }

  // Sessions for the currently selected worktree.
  const activeSessions = sessions.filter(
    (s) => s.worktreeId === selectedWorktreeId,
  );

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>oneforall Phase 0</h1>

      <section>
        <h2>Repository</h2>
        <RepositoryInput onLoad={handleLoad} />
        {error && <p style={{ color: "red" }}>Error: {error}</p>}
      </section>

      {repository && (
        <section style={{ marginTop: 24 }}>
          <h2>Worktrees — {repository.name}</h2>
          {loading ? (
            <p>Loading…</p>
          ) : (
            <WorktreeList
              worktrees={worktrees}
              selectedWorktreeId={selectedWorktreeId}
              onSelect={handleSelectWorktree}
            />
          )}
          {selectedWorktreeId && (
            <p style={{ marginTop: 12 }}>
              Selected: <code>{selectedWorktreeId}</code>
            </p>
          )}
        </section>
      )}

      {selectedWorktreeId && (
        <section style={{ marginTop: 24 }}>
          <h2>Terminals</h2>

          <div style={{ marginBottom: 8, display: "flex", gap: 8 }}>
            <button onClick={handleAddTerminal}>Open Terminal</button>
          </div>

          {/*
           * Render ALL sessions but hide those not belonging to the
           * currently selected worktree. This keeps xterm instances alive
           * so output continues to buffer while the user is on another worktree.
           */}
          {sessions.length === 0 && (
            <p style={{ color: "#888" }}>No terminal sessions.</p>
          )}

          {sessions.map((session) => {
            const isVisible = session.worktreeId === selectedWorktreeId;
            return (
              <div key={session.id} style={{ display: isVisible ? "block" : "none" }}>
                <TerminalPane session={session} visible={isVisible} />
                <div
                  style={{
                    marginBottom: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: "0.85em",
                  }}
                >
                  <span>
                    Status:{" "}
                    <strong>{session.status}</strong>
                  </span>
                  {(session.status === "running" || session.status === "idle") && (
                    <button
                      onClick={() => {
                        stopSession(session.id).catch((err: unknown) => {
                          console.error("Failed to stop session:", err);
                        });
                      }}
                    >
                      Stop Terminal
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {activeSessions.length === 0 && sessions.length > 0 && (
            <p style={{ color: "#888" }}>
              No terminals for this worktree. Sessions for other worktrees are
              running in the background.
            </p>
          )}
        </section>
      )}

      {selectedWorktreeId && (() => {
        const wt = worktrees.find((w) => w.id === selectedWorktreeId);
        if (!wt) return null;
        return (
          <section style={{ marginTop: 24 }}>
            <h2>Files</h2>
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ width: 280, flexShrink: 0 }}>
                <FileList
                  worktreePath={wt.path}
                  selectedFile={selectedFile}
                  onSelect={setSelectedFile}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {selectedFile ? (
                  <FileViewer
                    worktreePath={wt.path}
                    relativePath={selectedFile}
                  />
                ) : (
                  <p style={{ color: "#888", fontSize: "0.85em" }}>
                    Select a file to view its contents.
                  </p>
                )}
              </div>
            </div>
          </section>
        );
      })()}
    </main>
  );
}
