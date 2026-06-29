import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");
// Static import-graph guard: NOTHING in shared/ or the renderer (src/) may import
// the node-only driver modules. The capability DTO is canonical in shared and the
// dependency must point services -> shared, never the reverse.
const NODE_ONLY = /from\s+["'][^"']*services\/usage\/providers/;

function tsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) out.push(...tsFiles(full));
		else if (/\.tsx?$/.test(name)) out.push(full);
	}
	return out;
}

describe("type boundary", () => {
	it("no file in shared/ or renderer src/ imports the node-only driver module", () => {
		const offenders = [
			...tsFiles(join(ROOT, "shared")),
			...tsFiles(join(ROOT, "src")),
		].filter((f) => NODE_ONLY.test(readFileSync(f, "utf8")));
		expect(offenders).toEqual([]);
	});

	it("driver types import the shared capability DTO", () => {
		const src = readFileSync(
			join(ROOT, "services/usage/providers/types.ts"),
			"utf8",
		);
		expect(src).toContain("ProviderTelemetryCapabilities");
		expect(src).toMatch(/shared\/models\/usage\.js/);
	});
});
