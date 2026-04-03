import { useState, useEffect } from "react";
import { files } from "../../lib/desktop-client";

interface FileListProps {
  worktreePath: string;
  selectedFile: string | null;
  onSelect: (relativePath: string) => void;
}

export function FileList({ worktreePath, selectedFile, onSelect }: FileListProps) {
  const [fileList, setFileList] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!worktreePath) return;
    setLoading(true);
    setError(null);
    files
      .list(worktreePath)
      .then((list) => {
        setFileList(list);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [worktreePath]);

  if (loading) return <p style={{ color: "#888", fontSize: "0.85em" }}>Loading files…</p>;
  if (error) return <p style={{ color: "red", fontSize: "0.85em" }}>Error: {error}</p>;
  if (fileList.length === 0) return <p style={{ color: "#888", fontSize: "0.85em" }}>No files found.</p>;

  return (
    <div
      style={{
        overflowY: "auto",
        maxHeight: 300,
        border: "1px solid #ccc",
        borderRadius: 4,
        fontFamily: "monospace",
        fontSize: "0.8em",
      }}
    >
      {fileList.map((relativePath) => (
        <div
          key={relativePath}
          onClick={() => onSelect(relativePath)}
          style={{
            padding: "4px 8px",
            cursor: "pointer",
            backgroundColor: selectedFile === relativePath ? "#0055cc" : "transparent",
            color: selectedFile === relativePath ? "#fff" : "inherit",
            userSelect: "none",
          }}
        >
          {relativePath}
        </div>
      ))}
    </div>
  );
}
