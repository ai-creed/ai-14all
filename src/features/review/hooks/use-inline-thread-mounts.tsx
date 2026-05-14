import { useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { editor as MonacoEditor } from "monaco-editor";
import type { ReviewComment } from "../../../../shared/models/review-comment";
import {
	createInlineThreadMount,
	type InlineThreadHandle,
	type InlineThreadMount,
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
	onSave: (id: string, body: string) => void;
	onToggleAddressed: (id: string) => void;
	onDelete: (id: string) => void;
	draft: DraftSpec;
	draftBody: string;
	onDraftChange: (body: string) => void;
	onSubmitDraft: () => void;
	onCancelDraft: () => void;
};

const DEFAULT_HEIGHT = 96;

export function useInlineThreadMounts(args: Args): void {
	const mountRef = useRef<InlineThreadMount | null>(null);
	const handlesRef = useRef<Map<string, { handle: InlineThreadHandle; root: Root }>>(new Map());
	const draftRef = useRef<{ handle: InlineThreadHandle; root: Root } | null>(null);

	useEffect(() => {
		if (!args.editor) return;
		mountRef.current = createInlineThreadMount(args.editor);
		return () => {
			for (const { root, handle } of handlesRef.current.values()) {
				root.unmount();
				handle.remove();
			}
			handlesRef.current.clear();
			if (draftRef.current) {
				draftRef.current.root.unmount();
				draftRef.current.handle.remove();
				draftRef.current = null;
			}
			mountRef.current?.disposeAll();
			mountRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [args.editor]);

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		const handles = handlesRef.current;
		const currentIds = new Set(args.comments.map((c) => c.id));
		for (const [id, { handle, root }] of [...handles.entries()]) {
			if (!currentIds.has(id)) {
				root.unmount();
				handle.remove();
				handles.delete(id);
			}
		}
		for (const c of args.comments) {
			let entry = handles.get(c.id);
			if (!entry) {
				const handle = mount.addThread({ lineNumber: c.endLine, initialHeight: DEFAULT_HEIGHT });
				const root = createRoot(handle.domNode);
				entry = { handle, root };
				handles.set(c.id, entry);
			}
			const entrySnapshot = entry;
			entry.root.render(
				<InlineCommentThread
					comment={c}
					onSave={(body) => args.onSave(c.id, body)}
					onToggleAddressed={() => args.onToggleAddressed(c.id)}
					onDelete={() => args.onDelete(c.id)}
					onMeasureChange={() => {
						const px = entrySnapshot.handle.domNode.offsetHeight || DEFAULT_HEIGHT;
						entrySnapshot.handle.setHeight(px);
					}}
				/>,
			);
		}
	}, [args.comments, args.onSave, args.onToggleAddressed, args.onDelete]);

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		if (!args.draft) {
			if (draftRef.current) {
				draftRef.current.root.unmount();
				draftRef.current.handle.remove();
				draftRef.current = null;
			}
			return;
		}
		const spec = args.draft;
		if (!draftRef.current) {
			const handle = mount.addThread({ lineNumber: spec.endLine, initialHeight: DEFAULT_HEIGHT });
			const root = createRoot(handle.domNode);
			draftRef.current = { handle, root };
		}
		const entry = draftRef.current;
		entry.root.render(
			<InlineDraftThread
				range={spec}
				body={args.draftBody}
				onChange={args.onDraftChange}
				onSubmit={args.onSubmitDraft}
				onCancel={args.onCancelDraft}
				onMeasureChange={() => {
					const px = entry.handle.domNode.offsetHeight || DEFAULT_HEIGHT;
					entry.handle.setHeight(px);
				}}
			/>,
		);
	}, [args.draft, args.draftBody, args.onDraftChange, args.onSubmitDraft, args.onCancelDraft]);
}
