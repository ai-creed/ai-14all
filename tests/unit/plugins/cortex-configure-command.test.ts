import { describe, expect, it } from "vitest";
import type { AgentCliProbes } from "../../../shared/models/ecosystem-plugin";
import { composeCortexConfigureCommand } from "../../../src/features/plugins/components/PluginsPanelDialog";

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
