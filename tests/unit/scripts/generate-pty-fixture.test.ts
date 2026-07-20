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

	const LONG = "row\r\n".repeat(40); // 40 retained rows — larger than tail, so backfill exists

	it("emits a schema-valid tailPage and a MULTI-page backward chain with contiguous per-page windows (cases 1 + 2)", async () => {
		const cap = 5; // small page cap forces the chain to span more than one page
		const artifact = await generateFixture(LONG, 40, 6, cap, 5);
		expect(PtyFixtureArtifactSchema.safeParse(artifact).success).toBe(true);
		expect(artifact.tailPage).toBeDefined();
		expect(artifact.tailPage!.rows.length).toBe(5);
		expect(artifact.tailPage!.moreBefore).toBe(true);
		// The cap forces MORE THAN ONE backward page — verifies the chain-until-
		// moreBefore:false loop, not a single first-response shortcut.
		expect(artifact.backwardPages!.length).toBeGreaterThan(1);
		// Each stored page is <= cap and contiguous-ascending; adjacent pages in
		// sequential-pull order step strictly downward with no gap/overlap.
		let expectedEnd = artifact.tailPage!.rows[0].line - 1;
		for (const page of artifact.backwardPages!) {
			expect(page.rows.length).toBeGreaterThan(0);
			expect(page.rows.length).toBeLessThanOrEqual(cap);
			const startAbs = page.rows[0].line;
			const endAbs = page.rows.at(-1)!.line;
			expect(page.rows.map((r) => r.line)).toEqual(
				page.rows.map((_, i) => startAbs + i),
			);
			expect(endAbs).toBe(expectedEnd);
			expectedEnd = startAbs - 1;
		}
		// Chain terminus (child §4 test 2): the stored chain ends specifically at
		// moreBefore === false with no cursorBefore. An element that omits
		// cursorBefore while moreBefore is still true would stop the generator's
		// loop early yet still reconstruct — this pins the terminal channel state.
		const terminal = artifact.backwardPages!.at(-1)!;
		expect(terminal.moreBefore).toBe(false);
		expect(terminal.cursorBefore).toBeUndefined();
		// Reconstruction: reverse the page array, flatten, append tailPage.
		const reconstructed = [
			...[...artifact.backwardPages!].reverse().flatMap((p) => p.rows),
			...artifact.tailPage!.rows,
		].map((r) => r.line);
		const full = artifact.pages.flatMap((p) => p.rows).map((r) => r.line);
		expect(reconstructed).toEqual(full);
	});

	it("is deterministic including tailPage/backwardPages (case 3)", async () => {
		const a = await generateFixture(LONG, 40, 6, 5, 5);
		const b = await generateFixture(LONG, 40, 6, 5, 5);
		expect(b).toEqual(a);
	});

	it("a pre-L2 { subscribe, pages } artifact still validates (case 4)", () => {
		const oldShape = {
			subscribe: { cols: 80, epoch: 1, watermark: 3 },
			pages: [
				{
					epoch: 1,
					cols: 80,
					altScreen: false,
					watermark: 3,
					trimmedBefore: 0,
					rows: [{ line: 0, text: "hi", runs: [{ start: 0, len: 2 }] }],
					cursor: "",
					more: false,
				},
			],
		};
		expect(PtyFixtureArtifactSchema.safeParse(oldShape).success).toBe(true);
	});

	it("no-history sample yields backwardPages: [], never a forward page (case 5)", async () => {
		// Whole buffer fits within tail → moreBefore false, cursorBefore undefined.
		const artifact = await generateFixture(
			"a\r\nb\r\nc\r\n",
			40,
			6,
			undefined,
			50,
		);
		expect(artifact.tailPage!.moreBefore).toBe(false);
		expect(artifact.tailPage!.cursorBefore).toBeUndefined();
		expect(artifact.backwardPages).toEqual([]); // length 0, NOT a forward page
	});

	it("rejects a stored ok key on tailPage or backwardPages[i] (case 6)", async () => {
		const artifact = await generateFixture(LONG, 40, 6, 5, 5);
		const tamperedTail = {
			...artifact,
			tailPage: { ...artifact.tailPage!, ok: true },
		};
		expect(PtyFixtureArtifactSchema.safeParse(tamperedTail).success).toBe(
			false,
		);
		const tamperedBack = {
			...artifact,
			backwardPages: [
				{ ...artifact.backwardPages![0], ok: true },
				...artifact.backwardPages!.slice(1),
			],
		};
		expect(PtyFixtureArtifactSchema.safeParse(tamperedBack).success).toBe(
			false,
		);
	});
});
