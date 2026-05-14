import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useInlineThreadMounts } from "../../../src/features/review/hooks/use-inline-thread-mounts";
import type { editor as MonacoEditor } from "monaco-editor";
import type { ReviewComment } from "../../../shared/models/review-comment";

function fakeEditor() {
	const zones = new Map<string, { node: HTMLDivElement; line: number }>();
	let nextId = 0;
	const modified = {
		changeViewZones(cb: (a: {
			addZone(z: { afterLineNumber: number; domNode: HTMLDivElement; heightInPx: number }): string;
			removeZone(id: string): void;
		}) => void) {
			cb({
				addZone(z) {
					const id = `z${++nextId}`;
					zones.set(id, { node: z.domNode, line: z.afterLineNumber });
					document.body.appendChild(z.domNode);
					return id;
				},
				removeZone(id) {
					const z = zones.get(id);
					z?.node.remove();
					zones.delete(id);
				},
			});
		},
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

function Harness({ editor, comments }: { editor: MonacoEditor.IStandaloneDiffEditor; comments: ReviewComment[] }) {
	useInlineThreadMounts({
		editor,
		comments,
		onSave: vi.fn(),
		onToggleAddressed: vi.fn(),
		onDelete: vi.fn(),
		draft: null,
		draftBody: "",
		onDraftChange: vi.fn(),
		onSubmitDraft: vi.fn(),
		onCancelDraft: vi.fn(),
	});
	return null;
}

function NullHarness({ comments }: { comments: ReviewComment[] }) {
	useInlineThreadMounts({
		editor: null,
		comments,
		onSave: vi.fn(),
		onToggleAddressed: vi.fn(),
		onDelete: vi.fn(),
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
		const { rerender } = render(<Harness editor={editor} comments={[c({ id: "1" }), c({ id: "2", startLine: 5 })]} />);
		expect(zones.size).toBe(2);
		rerender(<Harness editor={editor} comments={[c({ id: "2", startLine: 5 })]} />);
		expect(zones.size).toBe(1);
	});

	it("no zones when no comments and no draft", () => {
		const { editor, zones } = fakeEditor();
		render(
			<Harness
				editor={editor}
				comments={[]}
			/>,
		);
		expect(zones.size).toBe(0);
	});

	it("does nothing when editor is null", () => {
		render(<NullHarness comments={[c()]} />);
		expect(document.querySelectorAll('[class*="shell-inline-thread"]').length).toBe(0);
	});
});
