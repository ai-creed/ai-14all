import { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import type { FileView } from "../../../shared/models/file-view";
import { files } from "../../lib/desktop-client";

interface FileViewerProps {
  worktreePath: string;
  relativePath: string;
}

export function FileViewer({ worktreePath, relativePath }: FileViewerProps) {
  const [fileView, setFileView] = useState<FileView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!worktreePath || !relativePath) return;
    setLoading(true);
    setError(null);
    setFileView(null);
    files
      .read(worktreePath, relativePath)
      .then((view) => {
        setFileView(view);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [worktreePath, relativePath]);

  if (loading) return <p style={{ color: "#888", fontSize: "0.85em" }}>Loading {relativePath}…</p>;
  if (error) return <p style={{ color: "red", fontSize: "0.85em" }}>Error: {error}</p>;
  if (!fileView) return null;

  return (
    <div style={{ border: "1px solid #ccc", borderRadius: 4, overflow: "hidden" }}>
      <div
        style={{
          padding: "4px 8px",
          backgroundColor: "#f5f5f5",
          borderBottom: "1px solid #ccc",
          fontFamily: "monospace",
          fontSize: "0.8em",
          color: "#333",
        }}
      >
        {fileView.path}
      </div>
      <Editor
        height="400px"
        language={fileView.language}
        value={fileView.content}
        options={{ readOnly: true, minimap: { enabled: false } }}
      />
    </div>
  );
}
