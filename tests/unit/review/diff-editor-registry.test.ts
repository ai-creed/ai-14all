import { describe, it, expect } from "vitest";
import { createDiffEditorRegistry } from "../../../src/features/review/logic/diff-editor-registry";

const fakeEditor = (id: string) =>
	({
		__id: id,
	}) as unknown as import("monaco-editor").editor.IStandaloneDiffEditor;

describe("DiffEditorRegistry", () => {
	it("registers and retrieves by file path", () => {
		const r = createDiffEditorRegistry();
		const e = fakeEditor("a");
		r.register("src/foo.ts", e);
		expect(r.get("src/foo.ts")).toBe(e);
	});

	it("unregister removes the entry", () => {
		const r = createDiffEditorRegistry();
		r.register("src/foo.ts", fakeEditor("a"));
		r.unregister("src/foo.ts");
		expect(r.get("src/foo.ts")).toBeUndefined();
	});

	it("notifies on register/unregister", () => {
		const r = createDiffEditorRegistry();
		const events: string[] = [];
		const off = r.subscribe((e) => events.push(e.kind + ":" + e.filePath));
		r.register("a", fakeEditor("1"));
		r.unregister("a");
		off();
		expect(events).toEqual(["registered:a", "unregistered:a"]);
	});
});
