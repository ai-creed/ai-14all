import { describe, expect, it } from "vitest";
import { isEditable } from "../../../shared/editor/editable-files";

describe("isEditable", () => {
	it("matches known extensions (case-insensitive)", () => {
		expect(isEditable("README.md")).toBe(true);
		expect(isEditable("pkg.JSON")).toBe(true);
		expect(isEditable("script.TS")).toBe(true);
		expect(isEditable("style.scss")).toBe(true);
		expect(isEditable("env.TOML")).toBe(true);
	});

	it("matches exact basenames case-sensitively", () => {
		expect(isEditable(".gitignore")).toBe(true);
		expect(isEditable(".editorconfig")).toBe(true);
		expect(isEditable("Dockerfile")).toBe(true);
		expect(isEditable("Makefile")).toBe(true);
		expect(isEditable("LICENSE")).toBe(true);
		expect(isEditable("README")).toBe(true);
		expect(isEditable(".gitattributes")).toBe(true);
		expect(isEditable(".prettierignore")).toBe(true);
		expect(isEditable(".eslintignore")).toBe(true);
		expect(isEditable(".npmrc")).toBe(true);
		expect(isEditable(".nvmrc")).toBe(true);
		expect(isEditable(".dockerignore")).toBe(true);
		expect(isEditable("dockerfile")).toBe(false);
		expect(isEditable("makefile")).toBe(false);
	});

	it("rejects unknown files", () => {
		expect(isEditable("image.png")).toBe(false);
		expect(isEditable("app.exe")).toBe(false);
		expect(isEditable("")).toBe(false);
	});

	it("accepts dotfile-style config files with no conventional extension", () => {
		expect(isEditable(".prettierrc")).toBe(true);
	});

	it("accepts the full .env* family", () => {
		expect(isEditable(".env")).toBe(true);
		expect(isEditable(".env.local")).toBe(true);
		expect(isEditable(".env.production")).toBe(true);
		expect(isEditable(".env.development")).toBe(true);
		expect(isEditable(".env.test")).toBe(true);
		expect(isEditable(".envrc")).toBe(false); // different family (direnv) — not whitelisted
	});
});
