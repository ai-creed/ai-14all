// tests/unit/xbp/pty-input-contract-smoke.test.ts
// Consumption pins for the vendored contract v8 pty-input surface (umbrella
// §5.3). Control-byte cases build strings via String.fromCharCode — never
// literal control bytes in source (umbrella §10).
import { describe, expect, it } from "vitest";
import {
	COMMAND_CONTRACT_VERSION,
	CONTROL_PTY_WRITE,
	PtyInputArgs,
	PtyInputChunk,
	PtyInputResult,
	ptyInputCapability,
} from "@ai-creed/command-contract";

describe("pty-input contract v8 smoke", () => {
	it("pins the contract version and capability identity", () => {
		expect(COMMAND_CONTRACT_VERSION).toBe(8);
		expect(ptyInputCapability.id).toBe("xavier.control.pty-input");
		expect(ptyInputCapability.permission).toBe(CONTROL_PTY_WRITE);
		expect(CONTROL_PTY_WRITE).toBe("control:pty-write");
		expect(ptyInputCapability.risk).toBe("high");
		expect(ptyInputCapability.requiresConfirmation).toBe(false);
	});

	it("accepts exactly-one-field chunks with printable text", () => {
		expect(PtyInputChunk.safeParse({ text: "hello" }).success).toBe(true);
		expect(PtyInputChunk.safeParse({ text: "héllo 🚀" }).success).toBe(true);
		expect(PtyInputChunk.safeParse({ key: "enter" }).success).toBe(true);
	});

	it("rejects a both-fields chunk (strict members — never silently stripped)", () => {
		const parsed = PtyInputChunk.safeParse({ text: "continue", key: "enter" });
		expect(parsed.success).toBe(false);
	});

	it("rejects neither-field, empty-text, and unknown-key chunks", () => {
		expect(PtyInputChunk.safeParse({}).success).toBe(false);
		expect(PtyInputChunk.safeParse({ text: "" }).success).toBe(false);
		expect(PtyInputChunk.safeParse({ key: "ctrl-z" }).success).toBe(false);
	});

	it("rejects every control byte free text could smuggle: ETX, ESC, CR, LF, NUL, DEL, C1 (PtyText, umbrella §5.3)", () => {
		const controls = [0x03, 0x1b, 0x0d, 0x0a, 0x00, 0x7f, 0x80, 0x9f];
		for (const code of controls) {
			const smuggled = `safe${String.fromCharCode(code)}safe`;
			expect(PtyInputChunk.safeParse({ text: smuggled }).success).toBe(false);
			expect(
				PtyInputChunk.safeParse({ text: String.fromCharCode(code) }).success,
			).toBe(false);
		}
	});

	it("rejects an empty chunks list", () => {
		const parsed = PtyInputArgs.safeParse({
			worktreeId: "wt-1",
			agentId: "a-1",
			chunks: [],
		});
		expect(parsed.success).toBe(false);
	});

	it("round-trips an ordered mixed args object", () => {
		const args = {
			worktreeId: "wt-1",
			agentId: "a-1",
			chunks: [{ text: "y" }, { key: "enter" }, { key: "up" }],
		};
		const parsed = PtyInputArgs.safeParse(args);
		expect(parsed.success).toBe(true);
		expect(parsed.success && parsed.data).toEqual(args);
	});

	it("accepts both result branches and rejects a negative appliedAt", () => {
		expect(
			PtyInputResult.safeParse({ ok: true, appliedAt: 1753221600000 }).success,
		).toBe(true);
		expect(
			PtyInputResult.safeParse({
				ok: false,
				code: "no-live-agent",
				message: "agent pty is not live",
			}).success,
		).toBe(true);
		expect(PtyInputResult.safeParse({ ok: true, appliedAt: -1 }).success).toBe(
			false,
		);
	});
});
