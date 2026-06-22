import * as Dialog from "@radix-ui/react-dialog";
import React, { useEffect, useState } from "react";
import type {
	AgentCliProbes,
	EcosystemPluginId,
} from "../../../../shared/models/ecosystem-plugin";
import { plugins, system } from "../../../lib/desktop-client";
import { usePluginsState } from "../hooks/use-plugins-state";
import { PluginCard, type PluginDescriptor } from "./PluginCard";

/**
 * Which shell the Configure command must be valid in. The command runs in the
 * terminal's default shell: PowerShell on Windows, a POSIX shell elsewhere.
 * They need different conditional syntax (POSIX `||` is a parse error in Windows
 * PowerShell, and `>/dev/null` is meaningless there), so we emit per-shell.
 */
export type ConfigureShell = "posix" | "powershell";

export function detectConfigureShell(): ConfigureShell {
	return typeof navigator !== "undefined" &&
		/win/i.test(navigator.platform ?? "")
		? "powershell"
		: "posix";
}

/**
 * Compose the ai-cortex "Configure" command from the agent-CLI probes.
 * - One guarded `mcp add` per INSTALLED agent (claude/codex); ezio excluded.
 *   The guard makes a re-run safe when the server already exists — `mcp get`
 *   succeeds, so `mcp add` is skipped.
 * - The two ai-cortex setup commands always run (idempotent).
 * - Steps joined with `;` (a valid separator in both shells) so one failure
 *   does not abort the rest.
 *
 * POSIX uses `<get> >/dev/null 2>&1 || <add>`. Windows PowerShell has no `||`,
 * so it uses `<get> 2>$null | Out-Null; if ($LASTEXITCODE -ne 0) { <add> }`,
 * which also works in pwsh 7 — so we never need to distinguish the two.
 */
export function composeCortexConfigureCommand(
	probes: AgentCliProbes | null,
	shell: ConfigureShell = detectConfigureShell(),
): string {
	const guarded = (check: string, add: string) =>
		shell === "powershell"
			? `${check} 2>$null | Out-Null; if ($LASTEXITCODE -ne 0) { ${add} }`
			: `${check} >/dev/null 2>&1 || ${add}`;
	const steps: string[] = [];
	if (probes?.claude.kind === "found")
		steps.push(
			guarded(
				"claude mcp get ai-cortex",
				"claude mcp add -s user ai-cortex -- ai-cortex mcp",
			),
		);
	if (probes?.codex.kind === "found")
		steps.push(
			guarded(
				"codex mcp get ai-cortex",
				"codex mcp add ai-cortex -- ai-cortex mcp",
			),
		);
	steps.push("ai-cortex history install-hooks");
	steps.push("ai-cortex memory install-prompt-guide");
	return steps.join("; ");
}

/**
 * Build the cortex "Configure" click handler — or `undefined` while the agent-CLI
 * probes are still loading (`probes === null`). Returning `undefined` hides the
 * Configure button until probes resolve, so a click can never compose a command
 * that omits the per-agent MCP registrations (composing from null probes would
 * drop them — a subset wiring that violates spec D5).
 */
export function cortexConfigureHandler(
	probes: AgentCliProbes | null,
	onConfigure: (command: string) => void,
	shell: ConfigureShell = detectConfigureShell(),
): (() => void) | undefined {
	if (!probes) return undefined;
	return () => onConfigure(composeCortexConfigureCommand(probes, shell));
}

const DESCRIPTORS: Record<EcosystemPluginId, PluginDescriptor> = {
	whisper: {
		title: "ai-whisper",
		pitch:
			"Pair two coding agents on a worktree with autonomous review workflows. ai-14all shows live workflow status and escalations once enabled.",
		installCommand: "npm i -g ai-whisper",
		repoUrl: "https://github.com/ai-creed/ai-whisper",
	},
	cortex: {
		title: "ai-cortex",
		pitch:
			"Substrate knowledge for your agents — a memory layer they recall from and record to across sessions — and its index unlocks code navigation inside ai-14all (go-to-definition, references, symbol search) as a power feature. Enable it, then Configure to register the MCP server and install the capture hooks + memory prompt guide.",
		installCommand: "npm i -g ai-cortex",
		repoUrl: "https://github.com/ai-creed/ai-cortex",
	},
	samantha: {
		title: "ai-samantha",
		pitch:
			"Your voice-first supervising companion. Once enabled, ai-14all streams a rich, per-worktree view of what your agents are doing — and what just happened — to Samantha so she can keep you oriented and speak up when something needs you.",
		installCommand: "",
		repoUrl: "https://github.com/ai-creed/ai-samantha",
	},
};

// Quiet, inline install hints for the agent-CLI prerequisites. Never surfaced
// as a popup — missing CLIs are a calm inline notice in the panel only.
const CLI_INSTALL_HINTS: Record<keyof AgentCliProbes, string> = {
	claude: "npm i -g @anthropic-ai/claude-code",
	codex: "npm i -g @openai/codex",
	ezio: "see your ezio distribution",
};

const CLI_ORDER: Array<keyof AgentCliProbes> = ["claude", "codex", "ezio"];

function AgentClisSection({
	probes,
}: {
	probes: AgentCliProbes | null;
}): React.ReactElement {
	return (
		<section className="plugins-panel__agent-clis">
			<h3 className="plugins-panel__section-title">Agent CLIs</h3>
			{probes === null ? (
				<p className="plugins-panel__agent-cli-line plugins-panel__agent-cli-line--pending">
					Checking…
				</p>
			) : (
				CLI_ORDER.map((name) => {
					const probe = probes[name];
					if (probe.kind === "found") {
						return (
							<p
								key={name}
								className="plugins-panel__agent-cli-line"
								data-cli={name}
								data-found="true"
							>
								<span className="plugins-panel__agent-cli-name">{name}</span> —
								found{" "}
								{probe.version ? `v${probe.version}` : "(version unknown)"}{" "}
								<span className="plugins-panel__agent-cli-path">
									({probe.path})
								</span>
							</p>
						);
					}
					return (
						<p
							key={name}
							className="plugins-panel__agent-cli-line"
							data-cli={name}
							data-found="false"
						>
							<span className="plugins-panel__agent-cli-name">{name}</span> —
							not found{" "}
							<span className="plugins-panel__agent-cli-hint">
								{CLI_INSTALL_HINTS[name]}
							</span>
						</p>
					);
				})
			)}
		</section>
	);
}

export function PluginsPanelDialog(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onInstall: (command: string) => void;
	onConfigure: (command: string) => void;
}): React.ReactElement {
	const snapshots = usePluginsState();
	const [agentClis, setAgentClis] = useState<AgentCliProbes | null>(null);
	const [samanthaLink, setSamanthaLink] = useState<string>("connecting");

	useEffect(() => {
		if (!props.open) return;
		// Spec: opening the panel is itself a re-probe trigger.
		void plugins.reprobe();
		void plugins.agentClis().then(setAgentClis);
	}, [props.open]);

	useEffect(() => plugins.onSamanthaHealth((h) => setSamanthaLink(h.link)), []);

	return (
		<Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="plugins-panel__overlay" />
				<Dialog.Content
					className="plugins-panel"
					data-testid="plugins-panel-dialog"
				>
					<Dialog.Title className="plugins-panel__title">Plugins</Dialog.Title>
					<Dialog.Description className="plugins-panel__description">
						Optional integrations with the rest of the ecosystem. ai-14all works
						fully without any of them.
					</Dialog.Description>

					<AgentClisSection probes={agentClis} />

					<div className="plugins-panel__cards">
						{snapshots.map((snapshot) => (
							<React.Fragment key={snapshot.id}>
								<PluginCard
									descriptor={DESCRIPTORS[snapshot.id]}
									snapshot={snapshot}
									onToggle={(id, enabled) => {
										void plugins.setEnabled(id, enabled);
									}}
									onInstall={props.onInstall}
									onConfigure={
										snapshot.id === "cortex"
											? cortexConfigureHandler(agentClis, props.onConfigure)
											: undefined
									}
									onReprobe={() => {
										void plugins.reprobe();
									}}
									onReadMore={(url) => {
										void system.openExternal(url).catch(() => undefined);
									}}
								/>
								{snapshot.id === "samantha" &&
								snapshot.status.state === "on-healthy" ? (
									<p
										className="plugin-substatus"
										data-samantha-link={samanthaLink}
									>
										Samantha link: {samanthaLink.replace(/-/g, " ")}
									</p>
								) : null}
							</React.Fragment>
						))}
					</div>

					<Dialog.Close asChild>
						<button type="button" className="plugins-panel__close">
							Close
						</button>
					</Dialog.Close>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
