import { describe, expect, it } from "vitest";
import type { AgentCliProbes } from "../../../shared/models/ecosystem-plugin";
import {
	composeCortexConfigureCommand,
	cortexConfigureHandler,
	detectConfigureShell,
} from "../../../src/features/plugins/components/PluginsPanelDialog";

const found = (path: string) => ({
	kind: "found" as const,
	path,
	version: null,
});
const notFound = { kind: "not-found" as const };

/** Build a full AgentCliProbes with sane defaults; override per-test. */
const probes = (over: Partial<AgentCliProbes> = {}): AgentCliProbes => ({
	claude: notFound,
	codex: notFound,
	ezio: notFound,
	cursor: notFound,
	antigravity: notFound,
	...over,
});

const SETUP =
	"ai-cortex history install-hooks; ai-cortex memory install-prompt-guide";

describe("composeCortexConfigureCommand (posix)", () => {
	it("includes guarded mcp add for claude + codex, then the ai-cortex setup", () => {
		const p = probes({ claude: found("/c"), codex: found("/x") });
		expect(composeCortexConfigureCommand(p, "posix")).toBe(
			"claude mcp get ai-cortex >/dev/null 2>&1 || claude mcp add -s user ai-cortex -- ai-cortex mcp; " +
				"codex mcp get ai-cortex >/dev/null 2>&1 || codex mcp add ai-cortex -- ai-cortex mcp; " +
				SETUP,
		);
	});

	it("omits an agent's mcp add when that CLI is absent", () => {
		const p = probes({ claude: found("/c") });
		const cmd = composeCortexConfigureCommand(p, "posix");
		expect(cmd).toContain("claude mcp add");
		expect(cmd).not.toContain("codex mcp add");
	});

	it("never registers ezio; setup commands always run even with no agents", () => {
		const p = probes({ ezio: found("/e") });
		expect(composeCortexConfigureCommand(p, "posix")).toBe(SETUP);
	});

	it("handles null probes (not yet loaded) → just the setup commands", () => {
		expect(composeCortexConfigureCommand(null, "posix")).toBe(SETUP);
	});
});

describe("composeCortexConfigureCommand (powershell)", () => {
	it("emits PowerShell-valid guards — no `||`, no `>/dev/null`", () => {
		const p = probes({ claude: found("/c"), codex: found("/x") });
		const cmd = composeCortexConfigureCommand(p, "powershell");
		// PowerShell 5.1 has no `||` (parse error) and no `/dev/null`.
		expect(cmd).not.toContain("||");
		expect(cmd).not.toContain("/dev/null");
		expect(cmd).toBe(
			"claude mcp get ai-cortex 2>$null | Out-Null; if ($LASTEXITCODE -ne 0) { claude mcp add -s user ai-cortex -- ai-cortex mcp }; " +
				"codex mcp get ai-cortex 2>$null | Out-Null; if ($LASTEXITCODE -ne 0) { codex mcp add ai-cortex -- ai-cortex mcp }; " +
				SETUP,
		);
	});

	it("still skips absent agents and always runs the setup", () => {
		const p = probes({ claude: found("/c") });
		const cmd = composeCortexConfigureCommand(p, "powershell");
		expect(cmd).toContain("if ($LASTEXITCODE -ne 0) { claude mcp add");
		expect(cmd).not.toContain("codex mcp add");
		expect(cmd.endsWith(SETUP)).toBe(true);
	});
});

describe("detectConfigureShell", () => {
	it("returns posix when navigator.platform is not Windows (jsdom/node)", () => {
		// In the test env navigator.platform is "" or undefined → posix, matching
		// macOS/Linux behaviour.
		expect(detectConfigureShell()).toBe("posix");
	});
});

describe("cortexConfigureHandler", () => {
	it("returns undefined while probes are loading (null) so Configure is hidden", () => {
		// Guards spec D5: never offer Configure before probes resolve, or a click
		// would compose a subset command that omits the MCP registrations.
		expect(cortexConfigureHandler(null, () => {})).toBeUndefined();
	});

	it("returns a handler that composes the FULL command once probes resolve", () => {
		const p = probes({ claude: found("/c"), codex: found("/x") });
		const calls: string[] = [];
		const handler = cortexConfigureHandler(p, (cmd) => calls.push(cmd));
		expect(handler).toBeTypeOf("function");
		handler?.();
		expect(calls).toEqual([composeCortexConfigureCommand(p)]);
		// The full command includes both MCP registrations (not a subset).
		expect(calls[0]).toContain("claude mcp add");
		expect(calls[0]).toContain("codex mcp add");
	});
});
