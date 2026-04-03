import Editor from "@monaco-editor/react";

type Props = {
  path: string;
  content: string;
};

export function DiffViewer({ path, content }: Props) {
  return (
    <div style={{ border: "1px solid #d0d7de", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "6px 10px", borderBottom: "1px solid #d0d7de", fontFamily: "monospace" }}>
        {path}
      </div>
      <Editor
        height="420px"
        language="plaintext"
        value={content}
        options={{ readOnly: true, minimap: { enabled: false } }}
      />
    </div>
  );
}
