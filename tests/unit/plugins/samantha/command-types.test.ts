import { describe, expect, it } from "vitest";
import {
	errorResult,
	okResult,
	parseCommandFrame,
	serializeCommandResult,
} from "../../../../services/plugins/samantha/command-types";

describe("command-types", () => {
	it("parses a valid command frame", () => {
		const r = parseCommandFrame({
			type: "command",
			capabilityId: "focus-worktree",
			requestId: "req_1",
			args: { worktree: "ai-14all/main" },
		});
		expect(r).toEqual({
			ok: true,
			frame: {
				type: "command",
				capabilityId: "focus-worktree",
				requestId: "req_1",
				args: { worktree: "ai-14all/main" },
			},
		});
	});

	it("parses an arg-free command frame", () => {
		const r = parseCommandFrame({
			type: "command",
			capabilityId: "session-report",
			requestId: "req_2",
		});
		expect(r.ok).toBe(true);
	});

	it("rejects a frame missing requestId and reports no recoverable id", () => {
		const r = parseCommandFrame({ type: "command", capabilityId: "x" });
		expect(r).toEqual({ ok: false, requestId: null });
	});

	it("rejects a bad type but salvages a recoverable requestId", () => {
		const r = parseCommandFrame({ type: "event", requestId: "req_3" });
		expect(r).toEqual({ ok: false, requestId: "req_3" });
	});

	it("treats an empty-string requestId as unrecoverable (null)", () => {
		expect(parseCommandFrame({ type: "event", requestId: "" })).toEqual({
			ok: false,
			requestId: null,
		});
	});

	it("serializes ok and error results", () => {
		expect(
			JSON.parse(serializeCommandResult(okResult("req_1", { focused: "a/b" }))),
		).toEqual({
			type: "commandResult",
			requestId: "req_1",
			status: "ok",
			result: { focused: "a/b" },
		});
		expect(
			JSON.parse(
				serializeCommandResult(
					errorResult("req_1", "ambiguous-worktree", "two"),
				),
			),
		).toEqual({
			type: "commandResult",
			requestId: "req_1",
			status: "error",
			error: { code: "ambiguous-worktree", message: "two" },
		});
	});
});
