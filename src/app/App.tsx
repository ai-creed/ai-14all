import { useEffect, useReducer, useState } from "react";
import type { Repository } from "../../shared/models/repository";
import type { Worktree } from "../../shared/models/worktree";
import type { GitChange } from "../../shared/models/git-change";
import type { GitDiff } from "../../shared/models/git-diff";
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
import { ChangesList } from "../features/git/ChangesList";
import { DiffViewer } from "../features/viewer/DiffViewer";
import { git } from "../lib/desktop-client";

export function App() {
  const [repository, setRepository] = useState<Repository | null>(null);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [workspaceState, dispatch] = useReducer(workspaceReducer, createWorkspaceState([]));
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [activeDiff, setActiveDiff] = useState<GitDiff | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const { sessions, createSession, stopSession, removeSession } = useTerminalSession();

  function handleLoad(repo: Repository, wts: Worktree[]) {
    setRepository(repo);
    setWorktrees(wts);
    dispatch({ type: "workspace/loadWorktrees", worktrees: wts });
    setError(null);
  }

  const activeWorktree = worktrees.find((w) => w.id === workspaceState.selectedWorktreeId) ?? null;
  const activeSession = workspaceState.selectedWorktreeId
    ? workspaceState.sessionsByWorktreeId[workspaceState.selectedWorktreeId] ?? null
    : null;

  // Fetch changed files when active worktree changes
  useEffect(() => {
    setChanges([]);
    setActiveDiff(null);
    if (!activeWorktree?.path) return;
    let cancelled = false;
    git.listChanges(activeWorktree.path)
      .then((result) => { if (!cancelled) setChanges(result); })
      .catch(() => { if (!cancelled) setChanges([]); });
    return () => { cancelled = true; };
  }, [activeWorktree?.path, refreshKey]);

  function handleRefreshChanges() {
    setRefreshKey((k) => k + 1);
  }

  // Fetch diff when selected changed file changes
  useEffect(() => {
    if (!activeWorktree?.path || !activeSession?.selectedChangedFilePath) {
      setActiveDiff(null);
      return;
    }
    let cancelled = false;
    git.readDiff(activeWorktree.path, activeSession.selectedChangedFilePath)
      .then((result) => { if (!cancelled) setActiveDiff(result); })
      .catch(() => { if (!cancelled) setActiveDiff(null); });
    return () => { cancelled = true; };
  }, [activeWorktree?.path, activeSession?.selectedChangedFilePath, refreshKey]);

  function handleSelectChangedFile(relativePath: string) {
    if (!activeWorktree) return;
    dispatch({
      type: "session/selectChangedFile",
      worktreeId: activeWorktree.id,
      relativePath,
    });
  }

  async function handleAddTerminal() {
    if (!activeWorktree) return;
    try {
      const session = await createSession(activeWorktree.id, activeWorktree.path);
      dispatch({
        type: "session/registerTerminal",
        worktreeId: activeWorktree.id,
        terminalSessionId: session.id,
      });
    } catch (err) {
      console.error("Failed to create terminal session:", err);
    }
  }

  async function handleCloseTerminal(sessionId: string) {
    if (!activeWorktree) return;
    const session = sessions.find((entry) => entry.id === sessionId);
    try {
      if (session && (session.status === "running" || session.status === "idle")) {
        await stopSession(sessionId);
      }
    } catch (err) {
      console.error("Failed to stop terminal session:", err);
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
        }}
      />

      <section style={{ display: "grid", gridTemplateRows: "auto auto 1fr" }}>
        {activeWorktree && (
          <SessionHeader
            title={activeWorktree.label}
            branchName={activeWorktree.branchName}
            changedFileCount={changes.length}
          />
        )}

        {workspaceState.selectedWorktreeId && (
          <div style={{ padding: "16px 20px" }}>
            <TerminalTabs
              tabs={activeSession?.terminalTabs ?? []}
              activeSessionId={activeSession?.activeTerminalSessionId ?? null}
              sessionStatuses={Object.fromEntries(
                sessions.map((s) => [s.id, s.status]),
              )}
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

            {sessions.map((session) => (
              <TerminalPane
                key={session.id}
                session={session}
                visible={
                  session.worktreeId === activeWorktree?.id &&
                  session.id === activeSession?.activeTerminalSessionId
                }
              />
            ))}
          </div>
        )}

        {activeWorktree && (
          <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, padding: 16 }}>
            <section>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({ type: "session/setReviewMode", worktreeId: activeWorktree.id, reviewMode: "files" })
                  }
                >
                  Files
                </button>
                <button
                  type="button"
                  onClick={() =>
                    dispatch({ type: "session/setReviewMode", worktreeId: activeWorktree.id, reviewMode: "changes" })
                  }
                >
                  Changes
                </button>
                {activeSession?.reviewMode === "changes" && (
                  <button type="button" onClick={handleRefreshChanges}>
                    Refresh
                  </button>
                )}
              </div>

              {activeSession?.reviewMode === "files" ? (
                <FileList
                  worktreePath={activeWorktree.path}
                  selectedFile={activeSession.selectedFilePath}
                  onSelect={(relativePath) =>
                    dispatch({ type: "session/selectFile", worktreeId: activeWorktree.id, relativePath })
                  }
                />
              ) : (
                <ChangesList
                  changes={changes}
                  selectedPath={activeSession?.selectedChangedFilePath ?? null}
                  onSelect={handleSelectChangedFile}
                />
              )}
            </section>

            <section>
              {activeSession?.reviewMode === "files" && activeSession.selectedFilePath ? (
                <FileViewer worktreePath={activeWorktree.path} relativePath={activeSession.selectedFilePath} />
              ) : activeSession?.reviewMode === "changes" && activeDiff ? (
                <DiffViewer path={activeDiff.path} content={activeDiff.content} />
              ) : (
                <p style={{ color: "#57606a" }}>Select a file or changed file to inspect it.</p>
              )}
            </section>
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
