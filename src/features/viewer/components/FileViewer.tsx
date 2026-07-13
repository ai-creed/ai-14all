import { forwardRef, useEffect, useRef, useState } from "react";
import {
	InlineEditor,
	type InlineEditorHandle,
	type InlineEditorProps,
} from "./InlineEditor";
import { MarkdownPreview } from "./MarkdownPreview";
import { ImagePreview } from "./ImagePreview";
import { resolveViewerMode } from "../logic/resolve-viewer-mode";

/**
 * Files-mode viewer that owns the single [Preview │ Source] toggle. Resolves the
 * viewer mode from the path: markdown files default to the rendered preview with
 * a toggle into the in-place editor; images render read-only with no toggle;
 * everything else passes straight through to the InlineEditor. The forwarded ref
 * resolves to the inner editor handle only while the editor is mounted (source
 * mode), and `null` in preview/image modes — so the host's dirty-guard treats
 * those modes as "no unsaved edits".
 */
export const FileViewer = forwardRef<InlineEditorHandle, InlineEditorProps>(
	function FileViewer(props, ref) {
		const mode = resolveViewerMode(props.relativePath);
		const [mdView, setMdView] = useState<"preview" | "source">("preview");
		const editorRef = useRef<InlineEditorHandle | null>(null);

		useEffect(() => {
			setMdView("preview");
		}, [props.relativePath]);

		// Forward the inner handle only while the editor is mounted.
		useEffect(() => {
			if (typeof ref === "function") ref(editorRef.current);
			else if (ref) ref.current = editorRef.current;
		});

		if (mode === "image")
			return (
				<ImagePreview
					workspaceId={props.workspaceId}
					worktreeId={props.worktreeId}
					relativePath={props.relativePath}
				/>
			);

		if (mode === "source")
			return <InlineEditor ref={mergeRef(ref, editorRef)} {...props} />;

		const showingSource = mdView === "source";
		return (
			<div className="shell-file-viewer">
				<div className="shell-file-viewer__header">
					<button
						type="button"
						className="shell-file-viewer__mode-btn"
						aria-pressed={!showingSource}
						onClick={() => {
							if (!showingSource) return;
							const handle = editorRef.current;
							if (!handle) {
								setMdView("preview");
								return;
							}
							void handle.requestSwitch().then((answer) => {
								if (answer === "proceed") setMdView("preview");
							});
						}}
					>
						Preview
					</button>
					<button
						type="button"
						className="shell-file-viewer__mode-btn"
						aria-pressed={showingSource}
						onClick={() => setMdView("source")}
					>
						Source
					</button>
				</div>
				{showingSource ? (
					<InlineEditor ref={mergeRef(ref, editorRef)} {...props} />
				) : (
					<MarkdownPreview
						workspaceId={props.workspaceId}
						worktreeId={props.worktreeId}
						relativePath={props.relativePath}
					/>
				)}
			</div>
		);
	},
);

function mergeRef(
	outer: React.Ref<InlineEditorHandle>,
	inner: React.MutableRefObject<InlineEditorHandle | null>,
) {
	return (value: InlineEditorHandle | null) => {
		inner.current = value;
		if (typeof outer === "function") outer(value);
		else if (outer)
			(outer as React.MutableRefObject<InlineEditorHandle | null>).current =
				value;
	};
}
