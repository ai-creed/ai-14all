// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateFixture } from "../../../scripts/generate-pty-fixture.js";
import { PtyFixtureArtifactSchema } from "../../../scripts/pty-fixture-schema.js";

const SAMPLE =
	"\x1b[1mwelcome\x1b[0m\r\n" +
	"\x1b[31m" +
	"r".repeat(70) +
	"\x1b[0m\r\n" +
	"the quick brown fox jumps over the lazy dog ".repeat(3).trim() +
	"\r\n" +
	"─".repeat(40) +
	"\r\n" +
	"done\r\n";

describe("generateFixture (reflow spec §3)", () => {
	it("emits an artifact that passes the artifact schema, with wrapped flags on soft-wrapped rows", async () => {
		const artifact = await generateFixture(SAMPLE, 40, 6);
		const parsed = PtyFixtureArtifactSchema.safeParse(artifact);
		expect(parsed.success, JSON.stringify(parsed)).toBe(true);
		expect(artifact.subscribe.cols).toBe(40);
		const rows = artifact.pages.flatMap((p) => p.rows);
		expect(rows.some((r) => r.wrapped === true)).toBe(true);
	});

	it("chains pages by cursor with no duplicated or omitted rows (reflow spec §3)", async () => {
		// Canonical: one uncapped page holds every row in serializer order.
		const canonical = await generateFixture(SAMPLE, 40, 6);
		expect(canonical.pages.length).toBe(1);
		// Capped: the same content forced through cursor chaining.
		const capped = await generateFixture(SAMPLE, 40, 6, 2);
		expect(capped.pages.length).toBeGreaterThan(1);
		for (const page of capped.pages.slice(0, -1)) {
			expect(page.more).toBe(true);
		}
		expect(capped.pages.at(-1)?.more).toBe(false);
		// Cursor progression is only correct if the flattened capped pages
		// reproduce the canonical rows exactly — same order, no duplicates,
		// no omissions (deep equality covers text, runs, and wrapped flags).
		const canonicalRows = canonical.pages.flatMap((p) => p.rows);
		const cappedRows = capped.pages.flatMap((p) => p.rows);
		expect(cappedRows).toEqual(canonicalRows);
	});

	it("is deterministic for the same byte file + geometry", async () => {
		const a = await generateFixture(SAMPLE, 40, 6);
		const b = await generateFixture(SAMPLE, 40, 6);
		expect(b).toEqual(a);
	});

	it("naked sub-shapes are rejected by the contract schemas — the envelope is load-bearing", async () => {
		const artifact = await generateFixture(SAMPLE, 40, 6);
		const { SubscribePtyResult } = await import("@ai-creed/command-contract");
		expect(SubscribePtyResult.safeParse(artifact.subscribe).success).toBe(
			false,
		);
		expect(
			SubscribePtyResult.safeParse({ ok: true, ...artifact.subscribe }).success,
		).toBe(true);
	});

	it("rejects a refusal-shaped page even though the envelope stamps ok: true (envelope must win)", async () => {
		const artifact = await generateFixture(SAMPLE, 40, 6);
		const tampered = {
			...artifact,
			pages: [{ ok: false, code: "internal" }, ...artifact.pages.slice(1)],
		};
		const parsed = PtyFixtureArtifactSchema.safeParse(tampered);
		expect(parsed.success).toBe(false);
	});

	it("rejects an otherwise-valid stored page that carries ok: true — elements are stored without the wire envelope (spec §3)", async () => {
		const artifact = await generateFixture(SAMPLE, 40, 6);
		const tampered = {
			...artifact,
			pages: [{ ...artifact.pages[0], ok: true }, ...artifact.pages.slice(1)],
		};
		const parsed = PtyFixtureArtifactSchema.safeParse(tampered);
		expect(parsed.success).toBe(false);
	});

	it("rejects a stored subscribe that carries ok: true — the exact naked shape is enforced (spec §3)", async () => {
		const artifact = await generateFixture(SAMPLE, 40, 6);
		const tampered = {
			...artifact,
			subscribe: { ...artifact.subscribe, ok: true },
		};
		const parsed = PtyFixtureArtifactSchema.safeParse(tampered);
		expect(parsed.success).toBe(false);
	});
});
