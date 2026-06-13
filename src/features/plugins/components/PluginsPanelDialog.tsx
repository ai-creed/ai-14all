import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import type {
	AgentCliProbes,
	EcosystemPluginId,
} from "../../../../shared/models/ecosystem-plugin";
import { plugins } from "../../../lib/desktop-client";
import { usePluginsState } from "../hooks/use-plugins-state";
import { PluginCard, type PluginDescriptor } from "./PluginCard";

const DESCRIPTORS: Record<EcosystemPluginId, PluginDescriptor> = {
	whisper: {
		title: "ai-whisper",
		pitch:
			"Pair two coding agents on a worktree with autonomous review workflows. ai-14all shows live workflow status and escalations once enabled.",
		installCommand: "npm i -g ai-whisper",
	},
	cortex: {
		title: "ai-cortex",
		pitch:
			"Code-intelligence index that powers code navigation. Already consumed by the viewer when an index exists; formal driver coming later.",
		installCommand: "npm i -g ai-cortex",
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
}): React.ReactElement {
	const snapshots = usePluginsState();
	const [agentClis, setAgentClis] = useState<AgentCliProbes | null>(null);

	useEffect(() => {
		if (!props.open) return;
		// Spec: opening the panel is itself a re-probe trigger.
		void plugins.reprobe();
		void plugins.agentClis().then(setAgentClis);
	}, [props.open]);

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
							<PluginCard
								key={snapshot.id}
								descriptor={DESCRIPTORS[snapshot.id]}
								snapshot={snapshot}
								onToggle={(id, enabled) => {
									void plugins.setEnabled(id, enabled);
								}}
								onInstall={props.onInstall}
								onReprobe={() => {
									void plugins.reprobe();
								}}
							/>
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
