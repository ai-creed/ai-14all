import { describe, expect, it } from "vitest";
import {
	AGENT_BINARIES,
	validateResumeCommand,
} from "../../../shared/models/resume-command";

const ok = (cmd: string) => validateResumeCommand(cmd, AGENT_BINARIES);

describe("validateResumeCommand", () => {
	it.each([
		["claude --resume 5c3a1b2e-0000-4000-8000-000000000000"],
		["codex resume 019a2b3c"],
		["agent --resume=chat_123"],
		["ezio resume session:abc.def/ghi@2"],
	])("accepts %s", (cmd) => {
		expect(ok(cmd)).toEqual({ ok: true });
	});

	it.each([
		["newline", "claude --resume abc\nrm -rf /tmp/pwned"],
		["carriage return", "claude --resume abc\rrm x"],
		["single ampersand", "claude --resume abc & rm x"],
		["double ampersand", "claude --resume abc && rm x"],
		["or", "claude --resume abc || rm x"],
		["semicolon", "claude --resume abc; rm x"],
		["pipe", "claude --resume abc | tee y"],
		["redirect out", "claude --resume abc > /tmp/x"],
		["redirect in", "claude --resume abc < /tmp/x"],
		["backtick", "claude --resume `id`"],
		["subshell", "claude --resume $(id)"],
		["var expansion", "claude --resume $HOME"],
		["double quote", 'claude --resume "abc"'],
		["single quote", "claude --resume 'abc'"],
		["tab", "claude --resume\tabc"],
	])("rejects %s as forbidden_characters", (_name, cmd) => {
		expect(ok(cmd)).toEqual({ ok: false, reason: "forbidden_characters" });
	});

	it("rejects unknown first token", () => {
		expect(ok("bash --resume abc")).toEqual({ ok: false, reason: "unknown_binary" });
	});
	it("rejects empty and whitespace-only", () => {
		expect(ok("")).toEqual({ ok: false, reason: "empty" });
		expect(ok("   ")).toEqual({ ok: false, reason: "empty" });
	});
	it("rejects strings over 256 chars", () => {
		expect(ok(`claude ${"a".repeat(256)}`)).toEqual({ ok: false, reason: "too_long" });
	});
});
