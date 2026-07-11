import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { useInlineThreadMounts } from "../../../src/features/review/hooks/use-inline-thread-mounts";
import type { editor as MonacoEditor } from "monaco-editor";
import type { ReviewComment } from "../../../shared/models/review-comment";
import type { ThreadActions } from "../../../src/features/review/logic/inline-thread-mount";

function fakeEditor() {
	const zones = new Map<string, { node: HTMLDivElement; line: number }>();
	let nextId = 0;
	const overflowGuard = document.createElement("div");
	overflowGuard.className = "overflow-guard";
	const editorDom = document.createElement("div");
	editorDom.appendChild(overflowGuard);
	document.body.appendChild(editorDom);
	const modified = {
		changeViewZones(
			cb: (a: {
				addZone(z: {
					afterLineNumber: number;
					domNode: HTMLDivElement;
					heightInPx: number;
				}): string;
				removeZone(id: string): void;
			}) => void,
		) {
			cb({
				addZone(z) {
					const id = `z${++nextId}`;
					zones.set(id, { node: z.domNode, line: z.afterLineNumber });
					return id;
				},
				removeZone(id) {
					zones.delete(id);
				},
			});
		},
		getDomNode: () => editorDom,
		getContainerDomNode: () => editorDom,
		getScrollTop: () => 0,
		getLayoutInfo: () => ({ contentLeft: 0, contentWidth: 600 }),
		onDidScrollChange: () => ({ dispose: () => {} }),
		onDidLayoutChange: () => ({ dispose: () => {} }),
	};
	const editor = {
		getModifiedEditor: () => modified,
	} as unknown as MonacoEditor.IStandaloneDiffEditor;
	return { editor, zones };
}

const c = (over: Partial<ReviewComment> = {}): ReviewComment => ({
	id: "1",
	worktreeId: "w1",
	filePath: "a.ts",
	startLine: 3,
	endLine: 3,
	snippet: "x",
	body: "hello",
	status: "open",
	source: "working-tree",
	commitSha: null,
	createdAt: "2026-05-14T00:00:00.000Z",
	addressedAt: null,
	...over,
});

function Harness({
	editor,
	comments,
}: {
	editor: MonacoEditor.IStandaloneDiffEditor;
	comments: ReviewComment[];
}) {
	const threadActions = useRef(new Map<string, ThreadActions>());
	useInlineThreadMounts({
		editor,
		comments,
		onSave: vi.fn(),
		onToggleAddressed: vi.fn(),
		onDelete: vi.fn(),
		onCancelEdit: vi.fn(),
		threadActions,
		draft: null,
		draftBody: "",
		onDraftChange: vi.fn(),
		onSubmitDraft: vi.fn(),
		onCancelDraft: vi.fn(),
	});
	return null;
}

function NullHarness({ comments }: { comments: ReviewComment[] }) {
	const threadActions = useRef(new Map<string, ThreadActions>());
	useInlineThreadMounts({
		editor: null,
		comments,
		onSave: vi.fn(),
		onToggleAddressed: vi.fn(),
		onDelete: vi.fn(),
		onCancelEdit: vi.fn(),
		threadActions,
		draft: null,
		draftBody: "",
		onDraftChange: vi.fn(),
		onSubmitDraft: vi.fn(),
		onCancelDraft: vi.fn(),
	});
	return null;
}

describe("useInlineThreadMounts", () => {
	it("mounts one view-zone per comment and unmounts when removed", () => {
		const { editor, zones } = fakeEditor();
		const { rerender } = render(
			<Harness
				editor={editor}
				comments={[c({ id: "1" }), c({ id: "2", startLine: 5 })]}
			/>,
		);
		expect(zones.size).toBe(2);
		rerender(
			<Harness editor={editor} comments={[c({ id: "2", startLine: 5 })]} />,
		);
		expect(zones.size).toBe(1);
	});

	it("no zones when no comments and no draft", () => {
		const { editor, zones } = fakeEditor();
		render(<Harness editor={editor} comments={[]} />);
		expect(zones.size).toBe(0);
	});

	it("does nothing when editor is null", () => {
		render(<NullHarness comments={[c()]} />);
		expect(
			document.querySelectorAll('[class*="shell-inline-thread"]').length,
		).toBe(0);
	});
});
