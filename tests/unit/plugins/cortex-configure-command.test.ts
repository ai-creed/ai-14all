import { describe, expect, it } from "vitest";
import type { AgentCliProbes } from "../../../shared/models/ecosystem-plugin";
import {
	composeCortexConfigureCommand,
	cortexConfigureHandler,
} from "../../../src/features/plugins/components/PluginsPanelDialog";

const found = (path: string) => ({
	kind: "found" as const,
	path,
	version: null,
});
const notFound = { kind: "not-found" as const };

const SETUP =
	"ai-cortex history install-hooks; ai-cortex memory install-prompt-guide";

describe("composeCortexConfigureCommand", () => {
	it("includes guarded mcp add for claude + codex, then the ai-cortex setup", () => {
		const probes: AgentCliProbes = {
			claude: found("/c"),
			codex: found("/x"),
			ezio: notFound,
		};
		expect(composeCortexConfigureCommand(probes)).toBe(
			"claude mcp get ai-cortex >/dev/null 2>&1 || claude mcp add -s user ai-cortex -- ai-cortex mcp; " +
				"codex mcp get ai-cortex >/dev/null 2>&1 || codex mcp add ai-cortex -- ai-cortex mcp; " +
				SETUP,
		);
	});

	it("omits an agent's mcp add when that CLI is absent", () => {
		const probes: AgentCliProbes = {
			claude: found("/c"),
			codex: notFound,
			ezio: notFound,
		};
		const cmd = composeCortexConfigureCommand(probes);
		expect(cmd).toContain("claude mcp add");
		expect(cmd).not.toContain("codex mcp add");
	});

	it("never registers ezio; setup commands always run even with no agents", () => {
		const probes: AgentCliProbes = {
			claude: notFound,
			codex: notFound,
			ezio: found("/e"),
		};
		expect(composeCortexConfigureCommand(probes)).toBe(SETUP);
	});

	it("handles null probes (not yet loaded) → just the setup commands", () => {
		expect(composeCortexConfigureCommand(null)).toBe(SETUP);
	});
});

describe("cortexConfigureHandler", () => {
	it("returns undefined while probes are loading (null) so Configure is hidden", () => {
		// Guards spec D5: never offer Configure before probes resolve, or a click
		// would compose a subset command that omits the MCP registrations.
		expect(cortexConfigureHandler(null, () => {})).toBeUndefined();
	});

	it("returns a handler that composes the FULL command once probes resolve", () => {
		const probes: AgentCliProbes = {
			claude: found("/c"),
			codex: found("/x"),
			ezio: notFound,
		};
		const calls: string[] = [];
		const handler = cortexConfigureHandler(probes, (cmd) => calls.push(cmd));
		expect(handler).toBeTypeOf("function");
		handler?.();
		expect(calls).toEqual([composeCortexConfigureCommand(probes)]);
		// The full command includes both MCP registrations (not a subset).
		expect(calls[0]).toContain("claude mcp add");
		expect(calls[0]).toContain("codex mcp add");
	});
});
