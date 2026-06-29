import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readNewLines } from "../../../services/usage/incremental-reader.js";

describe("readNewLines", () => {
	it("returns only complete new lines and advances the offset", () => {
		const dir = mkdtempSync(join(tmpdir(), "usage-"));
		const file = join(dir, "f.jsonl");
		writeFileSync(file, "a\nb\n");
		const first = readNewLines(file, 0, () => true);
		expect(first.lines).toEqual(["a", "b"]);
		expect(first.offset).toBe(4);

		appendFileSync(file, "c\npartial");
		const second = readNewLines(file, first.offset, () => true);
		expect(second.lines).toEqual(["c"]); // "partial" has no newline yet
		expect(second.offset).toBe(first.offset + 2); // only consumed "c\n"
	});
	it("readNewLines honors an end bound (toOffset)", () => {
		const dir = mkdtempSync(join(tmpdir(), "inc-"));
		const file = join(dir, "f.jsonl");
		writeFileSync(file, "aaa\nbbb\nccc\n");
		expect(readNewLines(file, 0, () => true).lines).toEqual([
			"aaa",
			"bbb",
			"ccc",
		]);
		// Bound to the first two lines only (8 bytes = "aaa\nbbb\n").
		expect(readNewLines(file, 0, () => true, 8).lines).toEqual(["aaa", "bbb"]);
	});
	it("applies the marker pre-filter", () => {
		const dir = mkdtempSync(join(tmpdir(), "usage-"));
		const file = join(dir, "f.jsonl");
		writeFileSync(file, "keep token_count\nskip me\n");
		const r = readNewLines(file, 0, (l) => l.includes("token_count"));
		expect(r.lines).toEqual(["keep token_count"]);
	});
});
