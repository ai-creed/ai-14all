import { describe, expect, it } from "vitest";
import {
	HAX_HEADER_MARKER,
	HAX_USAGE_MARKER,
	parseHaxLine,
} from "../../../services/usage/hax-source.js";
import type { ParseCtx } from "../../../services/usage/providers/types.js";

const HEADER = JSON.stringify({
	type: "session",
	version: 1,
	id: "3aa5eb43-2523-4456-b560-d5ed328f0b76",
	timestamp: "2026-07-17T08:50:11Z",
	cwd: "/Users/me/Dev/app/.worktrees/feat",
	provider: "codex",
	model: "gpt-5.6-terra",
	effort: "xhigh",
});

const usageLine = (usage: unknown, model = "gpt-5.6-terra"): string =>
	JSON.stringify({ kind: "turn_usage", provider: "codex", model, usage });

describe("parseHaxLine: session header", () => {
	it("mutates ctx with absolute cwd + protocol session id and returns no event", () => {
		const ctx: ParseCtx = { sessionId: "2026-07-17T08-50-11Z_3aa5eb43" };
		expect(parseHaxLine(HEADER, ctx)).toBeNull();
		expect(ctx.cwd).toBe("/Users/me/Dev/app/.worktrees/feat");
		expect(ctx.sessionId).toBe("3aa5eb43-2523-4456-b560-d5ed328f0b76");
	});
});

describe("parseHaxLine: turn_usage", () => {
	const ctx: ParseCtx = { cwd: "/Users/me/Dev/app", sessionId: "s1" };

	it("maps a real sampled row to an event with ctx cwd, row model, and 0 timestamp", () => {
		const line = usageLine({ input: 137422, output: 580, cached: 9728, elapsed_ms: 15135 });
		expect(parseHaxLine(line, { ...ctx })).toEqual({
			provider: "ezio",
			timestampMs: 0,
			cwd: "/Users/me/Dev/app",
			sessionId: "s1",
			model: "gpt-5.6-terra",
			input: 127694,
			output: 580,
			billable: 128274,
			raw: 138002,
		});
	});

	it("drops a turn_usage row whose usage is absent, null, or a non-object (each fixture)", () => {
		expect(parseHaxLine(JSON.stringify({ kind: "turn_usage", model: "m" }), { ...ctx })).toBeNull();
		expect(parseHaxLine(usageLine(null), { ...ctx })).toBeNull();
		expect(parseHaxLine(usageLine("usage-as-string"), { ...ctx })).toBeNull();
		expect(parseHaxLine(usageLine(42), { ...ctx })).toBeNull();
		expect(parseHaxLine(usageLine([1, 2]), { ...ctx })).toBeNull();
	});

	it("treats an empty usage object as a zero-token event", () => {
		expect(parseHaxLine(usageLine({}), { ...ctx })).toMatchObject({
			input: 0,
			output: 0,
			billable: 0,
			raw: 0,
		});
	});

	it("coerces non-numeric fields to 0 while valid siblings still count", () => {
		const line = usageLine({ input: "1000", output: 200, cached: null });
		expect(parseHaxLine(line, { ...ctx })).toMatchObject({
			input: 0, // "1000" is not a number → 0
			output: 200,
			billable: 200,
			raw: 200,
		});
	});

	it("falls back to empty model/cwd/sessionId when absent", () => {
		const line = JSON.stringify({ kind: "turn_usage", usage: { output: 5 } });
		expect(parseHaxLine(line, {})).toMatchObject({ model: "", cwd: "", sessionId: "" });
	});
});

describe("parseHaxLine: everything else", () => {
	const ctx: ParseCtx = { cwd: "/x", sessionId: "s" };

	it("ignores other row kinds, malformed JSON, and marker-free lines", () => {
		expect(parseHaxLine(JSON.stringify({ kind: "turn_boundary" }), { ...ctx })).toBeNull();
		expect(parseHaxLine(JSON.stringify({ kind: "assistant", text: "hi" }), { ...ctx })).toBeNull();
		expect(parseHaxLine("not json but contains " + HAX_USAGE_MARKER, { ...ctx })).toBeNull();
		expect(parseHaxLine("", { ...ctx })).toBeNull();
	});

	it("a user row that GENUINELY passes the usage-marker prefilter yields no event and no ctx change", () => {
		// A text value of exactly "turn_usage" serializes as …"text":"turn_usage"} —
		// the value's own delimiting quotes form the raw marker bytes. (Quotes INSIDE
		// a string value would escape to \" and never match, so this is the shape a
		// real marker-prefiltered user row takes.)
		const trap = JSON.stringify({ kind: "user", text: "turn_usage" });
		expect(trap.includes(HAX_USAGE_MARKER)).toBe(true); // fixture sanity: reaches the classifier
		const c: ParseCtx = { cwd: "/x", sessionId: "s" };
		expect(parseHaxLine(trap, c)).toBeNull();
		expect(c).toEqual({ cwd: "/x", sessionId: "s" });
	});

	it("a non-header row that passes the header-marker prefilter yields no event and no ctx change", () => {
		// A nested object serializes the raw bytes "type":"session" without the top
		// level being a header (top-level `type` is absent; `kind` is a tool row).
		const trap = JSON.stringify({
			kind: "tool_call",
			arguments: { type: "session" },
		});
		expect(trap.includes(HAX_HEADER_MARKER)).toBe(true); // fixture sanity: reaches the classifier
		const c: ParseCtx = { cwd: "/x", sessionId: "s" };
		expect(parseHaxLine(trap, c)).toBeNull();
		expect(c).toEqual({ cwd: "/x", sessionId: "s" });
	});
});
