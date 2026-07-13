import { describe, expect, it } from "vitest";
import { resolveViewerMode } from "../../../src/features/viewer/logic/resolve-viewer-mode";

describe("resolveViewerMode", () => {
	it.each([
		["README.md", "markdown"],
		["a.MD", "markdown"],
		["pic.png", "image"],
		["pic.SVG", "image"],
		["main.ts", "source"],
		["Makefile", "source"],
		["notes.md.bak", "source"],
	])("%s → %s", (p, mode) => {
		expect(resolveViewerMode(p)).toBe(mode);
	});
});
