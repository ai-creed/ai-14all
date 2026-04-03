import { useReducer, useState } from "react";
import type { Repository } from "../../shared/models/repository";
import type { Worktree } from "../../shared/models/worktree";
import { RepositoryInput } from "../features/repository/RepositoryInput";
import { SessionSidebar } from "../features/workspace/SessionSidebar";
import { SessionHeader } from "../features/workspace/SessionHeader";
import { ContextPanel } from "../features/workspace/ContextPanel";
import { createWorkspaceState, workspaceReducer } from "../features/workspace/workspace-state";
import { TerminalPane } from "../features/terminals/TerminalPane";
import { useTerminalSession } from "../features/terminals/useTerminalSession";
import { FileList } from "../features/viewer/FileList";
import { FileViewer } from "../features/viewer/FileViewer";

export function App() {
  const [repository, setRepository] = useState<Repository | null>(null);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [workspaceState, dispatch] = useReducer(workspaceReducer, createWorkspaceState([]));
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { sessions, createSession, stopSession } = useTerminalSession();

  function handleLoad(repo: Repository, wts: Worktree[]) {
    setRepository(repo);
    setWorktrees(wts);
    dispatch({ type: "workspace/loadWorktrees", worktrees: wts });
    setSelectedFile(null);
    setError(null);
  }

  const activeWorktree = worktrees.find((w) => w.id === workspaceState.selectedWorktreeId) ?? null;
  const activeSession = workspaceState.selectedWorktreeId
    ? workspaceState.sessionsByWorktreeId[workspaceState.selectedWorktreeId] ?? null
    : null;

  function handleAddTerminal() {
    if (!activeWorktree) return;
    createSession(activeWorktree.id, activeWorktree.path).catch((err: unknown) => {
      console.error("Failed to create terminal session:", err);
    });
  }

  // Sessions for the currently selected worktree.
  const activeSessions = sessions.filter(
    (s) => s.worktreeId === workspaceState.selectedWorktreeId,
  );

  if (!repository) {
    return (
      <main style={{ padding: 24, fontFamily: "sans-serif" }}>
        <h1>oneforall</h1>
        <section>
          <h2>Repository</h2>
          <RepositoryInput onLoad={handleLoad} />
          {error && <p style={{ color: "red" }}>Error: {error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "240px 1fr 280px" }}>
      <SessionSidebar
        worktrees={worktrees}
        selectedWorktreeId={workspaceState.selectedWorktreeId}
        onSelect={(worktreeId) => {
          dispatch({ type: "session/selectWorktree", worktreeId });
          setSelectedFile(null);
        }}
      />

      <section style={{ display: "grid", gridTemplateRows: "auto auto 1fr" }}>
        {activeWorktree && (
          <SessionHeader
            title={activeWorktree.label}
            branchName={activeWorktree.branchName}
            changedFileCount={0}
          />
        )}

        {workspaceState.selectedWorktreeId && (
          <div style={{ padding: "16px 20px" }}>
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
              const isVisible = session.worktreeId === workspaceState.selectedWorktreeId;
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
          </div>
        )}

        {activeWorktree && (
          <div style={{ padding: "0 20px 20px" }}>
            <h3>Files</h3>
            <div style={{ display: "flex", gap: 16 }}>
              <div style={{ width: 280, flexShrink: 0 }}>
                <FileList
                  worktreePath={activeWorktree.path}
                  selectedFile={selectedFile}
                  onSelect={setSelectedFile}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {selectedFile ? (
                  <FileViewer
                    worktreePath={activeWorktree.path}
                    relativePath={selectedFile}
                  />
                ) : (
                  <p style={{ color: "#888", fontSize: "0.85em" }}>
                    Select a file to view its contents.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {activeWorktree && activeSession && (
        <ContextPanel
          branchName={activeWorktree.branchName}
          worktreePath={activeWorktree.path}
          note={activeSession.note}
          onNoteChange={(note) =>
            dispatch({ type: "session/setNote", worktreeId: activeWorktree.id, note })
          }
        />
      )}
    </main>
  );
}
