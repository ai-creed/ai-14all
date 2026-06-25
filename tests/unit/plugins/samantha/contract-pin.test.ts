import { describe, expect, it } from "vitest";
import {
	COMMAND_ERROR_CODES,
	CommandFrameSchema,
	SAMANTHA_CONTRACT_VERSION,
} from "../../../../services/plugins/samantha/command-types";

// The canonical contract, written out literally. ai-14all OWNS these values.
// Samantha's tests/unit/main/connector-contract-pin.test.ts pins the SAME
// literals; a change here without the matching Samantha change is the drift this
// guard exists to catch.
const CANONICAL_ERROR_CODES = [
	"unknown-capability",
	"unknown-worktree",
	"ambiguous-worktree",
	"invalid-args",
	"no-live-agent",
	"session-busy",
	"acting-disabled",
	"unauthorized",
	"internal",
];

describe("samantha command contract (canonical pin)", () => {
	it("pins the error-code set exactly (order + membership)", () => {
		expect([...COMMAND_ERROR_CODES]).toEqual(CANONICAL_ERROR_CODES);
	});

	it("pins the contract version", () => {
		expect(SAMANTHA_CONTRACT_VERSION).toBe(1);
	});

	it("pins the command frame shape including the optional token", () => {
		const ok = CommandFrameSchema.safeParse({
			type: "command",
			capabilityId: "instruct-session",
			requestId: "r1",
			args: { worktree: "a/b", instruction: "go" },
			token: "secret",
		});
		expect(ok.success).toBe(true);
		// token is optional
		const noToken = CommandFrameSchema.safeParse({
			type: "command",
			capabilityId: "focus-worktree",
			requestId: "r2",
		});
		expect(noToken.success).toBe(true);
	});
});
