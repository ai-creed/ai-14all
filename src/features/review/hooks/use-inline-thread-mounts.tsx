import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { editor as MonacoEditor } from "monaco-editor";
import type { ReviewComment } from "../../../../shared/models/review-comment";
import {
	createInlineThreadMount,
	type InlineThreadHandle,
	type InlineThreadMount,
	type ThreadActions,
} from "../logic/inline-thread-mount";
import { InlineCommentThread } from "../components/InlineCommentThread";
import { InlineDraftThread } from "../components/InlineDraftThread";

type DraftSpec = {
	startLine: number;
	endLine: number;
} | null;

type Args = {
	editor: MonacoEditor.IStandaloneDiffEditor | null;
	comments: ReviewComment[];
	onSave: (id: string, body: string) => Promise<boolean>;
	onToggleAddressed: (id: string) => void;
	onDelete: (id: string) => void;
	onCancelEdit: () => void;
	threadActions: React.MutableRefObject<Map<string, ThreadActions>>;
	draft: DraftSpec;
	draftBody: string;
	onDraftChange: (body: string) => void;
	onSubmitDraft: () => void;
	onCancelDraft: () => void;
};

const DEFAULT_HEIGHT = 96;

// Defer root.unmount() outside the current render cycle to avoid the React 18
// "Attempted to synchronously unmount a root while React was already rendering" error.
function safeUnmount(root: Root): void {
	queueMicrotask(() => root.unmount());
}

export function useInlineThreadMounts(args: Args): void {
	const mountRef = useRef<InlineThreadMount | null>(null);
	const handlesRef = useRef<
		Map<string, { handle: InlineThreadHandle; root: Root }>
	>(new Map());
	const draftRef = useRef<{
		handle: InlineThreadHandle;
		root: Root;
		endLine: number;
	} | null>(null);

	useEffect(() => {
		if (!args.editor) return;
		mountRef.current = createInlineThreadMount(args.editor);
		return () => {
			for (const { root, handle } of handlesRef.current.values()) {
				handle.remove();
				safeUnmount(root);
			}
			handlesRef.current.clear();
			args.threadActions.current.clear();
			if (draftRef.current) {
				draftRef.current.handle.remove();
				safeUnmount(draftRef.current.root);
				draftRef.current = null;
			}
			mountRef.current?.disposeAll();
			mountRef.current = null;
		};
	}, [args.editor, args.threadActions]);

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		const handles = handlesRef.current;
		const currentIds = new Set(args.comments.map((c) => c.id));
		for (const [id, { handle, root }] of [...handles.entries()]) {
			if (!currentIds.has(id)) {
				handle.remove();
				safeUnmount(root);
				handles.delete(id);
				args.threadActions.current.delete(id);
			}
		}
		for (const c of args.comments) {
			let entry = handles.get(c.id);
			if (!entry) {
				const handle = mount.addThread({
					lineNumber: c.endLine,
					initialHeight: DEFAULT_HEIGHT,
				});
				const root = createRoot(handle.domNode);
				entry = { handle, root };
				handles.set(c.id, entry);
			}
			const entrySnapshot = entry;
			entry.root.render(
				<InlineCommentThread
					comment={c}
					onSave={async (body) => args.onSave(c.id, body)}
					onToggleAddressed={() => args.onToggleAddressed(c.id)}
					onDelete={() => args.onDelete(c.id)}
					onCancelEdit={args.onCancelEdit}
					onRegisterActions={(a) => {
						const map = args.threadActions.current;
						if (a) map.set(c.id, a);
						else map.delete(c.id);
					}}
					onMeasureChange={() => {
						const el = entrySnapshot.handle.domNode
							.firstElementChild as HTMLElement | null;
						const px = (el?.offsetHeight ?? 0) || DEFAULT_HEIGHT;
						entrySnapshot.handle.setHeight(px);
					}}
				/>,
			);
		}
	}, [
		args.comments,
		args.onSave,
		args.onToggleAddressed,
		args.onDelete,
		args.onCancelEdit,
		args.threadActions,
	]);

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		if (!args.draft) {
			if (draftRef.current) {
				draftRef.current.handle.remove();
				safeUnmount(draftRef.current.root);
				draftRef.current = null;
			}
			return;
		}
		const spec = args.draft;
		const needsNewZone =
			!draftRef.current || draftRef.current.endLine !== spec.endLine;
		if (needsNewZone) {
			if (draftRef.current) {
				draftRef.current.handle.remove();
				safeUnmount(draftRef.current.root);
			}
			const handle = mount.addThread({
				lineNumber: spec.endLine,
				initialHeight: DEFAULT_HEIGHT,
			});
			const root = createRoot(handle.domNode);
			draftRef.current = { handle, root, endLine: spec.endLine };
		}

		const entry = draftRef.current!;
		entry.root.render(
			<InlineDraftThread
				range={spec}
				body={args.draftBody}
				onChange={args.onDraftChange}
				onSubmit={args.onSubmitDraft}
				onCancel={args.onCancelDraft}
				onMeasureChange={() => {
					const el = entry.handle.domNode
						.firstElementChild as HTMLElement | null;
					const px = (el?.offsetHeight ?? 0) || DEFAULT_HEIGHT;
					entry.handle.setHeight(px);
				}}
			/>,
		);
	}, [
		args.draft,
		args.draftBody,
		args.onDraftChange,
		args.onSubmitDraft,
		args.onCancelDraft,
	]);
}
