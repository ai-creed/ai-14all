import { describe, expect, it } from "vitest";
import {
	createInlineThreadMount,
	type InlineThreadMount,
} from "../../../src/features/review/logic/inline-thread-mount";
import type { editor as MonacoEditor } from "monaco-editor";

type ZoneAccessor = {
	addZone: (zone: unknown) => string;
	removeZone: (id: string) => void;
	layoutZone: (id: string) => void;
};

function fakeEditor() {
	const added: Array<{ id: string; zone: unknown }> = [];
	const removed: string[] = [];
	let nextId = 0;
	const modified = {
		changeViewZones: (cb: (accessor: ZoneAccessor) => void) => {
			cb({
				addZone(z) {
					const id = `z${++nextId}`;
					added.push({ id, zone: z });
					return id;
				},
				removeZone(id) {
					removed.push(id);
				},
				layoutZone() {},
			});
		},
	};
	const editor = {
		getModifiedEditor: () => modified,
	} as unknown as MonacoEditor.IStandaloneDiffEditor;
	return { editor, added, removed };
}

describe("createInlineThreadMount", () => {
	it("addThread inserts a zone for the given line", () => {
		const { editor, added } = fakeEditor();
		const mount: InlineThreadMount = createInlineThreadMount(editor);
		const handle = mount.addThread({ lineNumber: 5, initialHeight: 80 });
		expect(handle).toBeTruthy();
		expect(added).toHaveLength(1);
	});

	it("removeThread removes the zone", () => {
		const { editor, removed } = fakeEditor();
		const mount = createInlineThreadMount(editor);
		const handle = mount.addThread({ lineNumber: 5, initialHeight: 80 });
		handle.remove();
		expect(removed).toHaveLength(1);
	});

	it("setHeight updates the zone height", () => {
		const { editor } = fakeEditor();
		const mount = createInlineThreadMount(editor);
		const handle = mount.addThread({ lineNumber: 5, initialHeight: 80 });
		handle.setHeight(120);
		// no throw; layoutZone called internally — see contract: mount.getHeight returns latest
		expect(handle.getHeight()).toBe(120);
	});

	it("disposeAll clears every mount", () => {
		const { editor, removed } = fakeEditor();
		const mount = createInlineThreadMount(editor);
		mount.addThread({ lineNumber: 1, initialHeight: 80 });
		mount.addThread({ lineNumber: 3, initialHeight: 80 });
		mount.disposeAll();
		expect(removed).toHaveLength(2);
	});

	it("addThread returns a target HTMLDivElement that can be portaled into", () => {
		const { editor } = fakeEditor();
		const mount = createInlineThreadMount(editor);
		const handle = mount.addThread({ lineNumber: 5, initialHeight: 80 });
		expect(handle.domNode).toBeInstanceOf(HTMLDivElement);
	});
});
