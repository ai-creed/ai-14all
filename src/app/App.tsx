import { useReducer, useState } from "react";
import type { Repository } from "../../shared/models/repository";
import type { Worktree } from "../../shared/models/worktree";
import { RepositoryInput } from "../features/repository/RepositoryInput";
import { SessionSidebar } from "../features/workspace/SessionSidebar";
import { SessionHeader } from "../features/workspace/SessionHeader";
import { ContextPanel } from "../features/workspace/ContextPanel";
import { createWorkspaceState, workspaceReducer } from "../features/workspace/workspace-state";
import { TerminalTabs } from "../features/terminals/TerminalTabs";
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

  const { sessions, createSession, stopSession, removeSession } = useTerminalSession();

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

  async function handleAddTerminal() {
    if (!activeWorktree) return;
    const session = await createSession(activeWorktree.id, activeWorktree.path);
    dispatch({
      type: "session/registerTerminal",
      worktreeId: activeWorktree.id,
      terminalSessionId: session.id,
    });
  }

  async function handleCloseTerminal(sessionId: string) {
    if (!activeWorktree) return;
    const session = sessions.find((entry) => entry.id === sessionId);
    try {
      if (session && (session.status === "running" || session.status === "idle")) {
        await stopSession(sessionId);
      }
    } finally {
      removeSession(sessionId);
      dispatch({
        type: "session/closeTerminal",
        worktreeId: activeWorktree.id,
        terminalSessionId: sessionId,
      });
    }
  }

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
            <TerminalTabs
              tabs={activeSession?.terminalTabs ?? []}
              activeSessionId={activeSession?.activeTerminalSessionId ?? null}
              onAdd={handleAddTerminal}
              onSelect={(terminalSessionId) =>
                dispatch({
                  type: "session/selectTerminal",
                  worktreeId: activeWorktree!.id,
                  terminalSessionId,
                })
              }
              onClose={handleCloseTerminal}
            />

            {sessions
              .filter((session) => session.worktreeId === activeWorktree?.id)
              .map((session) => (
                <TerminalPane
                  key={session.id}
                  session={session}
                  visible={session.id === activeSession?.activeTerminalSessionId}
                />
              ))}
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
