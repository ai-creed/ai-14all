import { useState } from "react";
import type { Repository } from "../../shared/models/repository";
import type { Worktree } from "../../shared/models/worktree";
import { RepositoryInput } from "../features/repository/RepositoryInput";
import { WorktreeList } from "../features/worktrees/WorktreeList";

export function App() {
  const [repository, setRepository] = useState<Repository | null>(null);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleLoad(repo: Repository, wts: Worktree[]) {
    setRepository(repo);
    setWorktrees(wts);
    setSelectedWorktreeId(null);
    setError(null);
    setLoading(false);
  }

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
              onSelect={setSelectedWorktreeId}
            />
          )}
          {selectedWorktreeId && (
            <p style={{ marginTop: 12 }}>
              Selected: <code>{selectedWorktreeId}</code>
            </p>
          )}
        </section>
      )}
    </main>
  );
}
