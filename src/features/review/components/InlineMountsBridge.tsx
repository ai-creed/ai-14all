import { useEffect, useState } from "react";
import type { editor as MonacoEditor } from "monaco-editor";
import type { ReviewComment } from "../../../../shared/models/review-comment";
import type { DiffEditorRegistry } from "../logic/diff-editor-registry";
import type { ThreadActions } from "../logic/inline-thread-mount";
import { useInlineThreadMounts } from "../hooks/use-inline-thread-mounts";

type Props = {
	registry: DiffEditorRegistry;
	filePath: string | null;
	comments: ReviewComment[];
	draft: { startLine: number; endLine: number } | null;
	draftBody: string;
	onDraftChange: (body: string) => void;
	onSave: (id: string, body: string) => Promise<boolean>;
	onToggleAddressed: (id: string) => void;
	onDelete: (id: string) => void;
	onCancelEdit: () => void;
	threadActions: React.MutableRefObject<Map<string, ThreadActions>>;
	onSubmitDraft: () => void;
	onCancelDraft: () => void;
};

export function InlineMountsBridge(props: Props) {
	const { registry, filePath } = props;
	const [editor, setEditor] =
		useState<MonacoEditor.IStandaloneDiffEditor | null>(null);

	useEffect(() => {
		if (!filePath) {
			setEditor(null);
			return;
		}
		setEditor(registry.get(filePath) ?? null);
		const off = registry.subscribe((event) => {
			if (event.filePath !== filePath) return;
			setEditor(
				event.kind === "registered" ? (registry.get(filePath) ?? null) : null,
			);
		});
		return off;
	}, [registry, filePath]);

	useInlineThreadMounts({
		editor,
		comments: editor ? props.comments : [],
		onSave: props.onSave,
		onToggleAddressed: props.onToggleAddressed,
		onDelete: props.onDelete,
		onCancelEdit: props.onCancelEdit,
		threadActions: props.threadActions,
		draft: editor ? props.draft : null,
		draftBody: props.draftBody,
		onDraftChange: props.onDraftChange,
		onSubmitDraft: props.onSubmitDraft,
		onCancelDraft: props.onCancelDraft,
	});

	return null;
}
