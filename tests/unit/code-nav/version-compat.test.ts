import { describe, expect, it } from "vitest";
import { isSupportedSchemaVersion } from "../../../electron/code-nav/source/version-compat.js";

describe("isSupportedSchemaVersion", () => {
	it("rejects a lower minor within the same major", () => {
		expect(isSupportedSchemaVersion("3.0")).toBe(false);
	});
	it("accepts the written-against minor and higher minors", () => {
		expect(isSupportedSchemaVersion("3.1")).toBe(true);
		expect(isSupportedSchemaVersion("3.2")).toBe(true);
		expect(isSupportedSchemaVersion("3.10")).toBe(true);
	});
	it("rejects other majors", () => {
		expect(isSupportedSchemaVersion("2.9")).toBe(false);
		expect(isSupportedSchemaVersion("4.0")).toBe(false);
	});
	it("rejects malformed / non-numeric / non-two-part versions", () => {
		expect(isSupportedSchemaVersion("")).toBe(false);
		expect(isSupportedSchemaVersion("3")).toBe(false);
		expect(isSupportedSchemaVersion("3.x")).toBe(false);
		expect(isSupportedSchemaVersion("3.1.0")).toBe(false); // extra segments → reject
		expect(isSupportedSchemaVersion("3.1.2")).toBe(false);
	});
});
