import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import type {
	WhisperCommand,
	WhisperCommandResult,
} from "../../../../shared/contracts/plugins";
import type { WhisperWorktreeState } from "../../../../shared/models/ecosystem-plugin";
import { plugins } from "../../../lib/desktop-client";

type TellTarget = "claude" | "codex" | "ezio";

function truncate(text: string | null, max = 200): string {
	if (!text) return "";
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function WorkflowDetail(props: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	state: (WhisperWorktreeState & { stale?: boolean }) | null;
	workspaceId: string;
	worktreeId: string;
	/**
	 * Surfaces a command's failure (whisper's actual stderr) or a settled
	 * fire-and-forget reply through the app's toast mechanism. App threads this
	 * down from its ToastProvider.
	 */
	onCommandError: (message: string) => void;
	onCommandReply?: (message: string) => void;
}) {
	const { state, workspaceId, worktreeId } = props;
	const [inFlight, setInFlight] = useState(false);
	const [resumeOpen, setResumeOpen] = useState(false);
	const [resumeMessage, setResumeMessage] = useState("");
	const [tellTarget, setTellTarget] = useState<TellTarget>("claude");
	const [tellInstruction, setTellInstruction] = useState("");
	const [tellStatus, setTellStatus] = useState<string | null>(null);

	const ref = { workspaceId, worktreeId } as const;
	const workflowId = state?.workflow?.workflowId ?? null;
	const status = state?.workflow?.status ?? null;

	// Awaiting variant for the blocking buttons (pause/resume/cancel/recover):
	// disables the controls while a command is in flight and surfaces stderr.
	async function run(command: WhisperCommand): Promise<WhisperCommandResult> {
		setInFlight(true);
		try {
			const result = await plugins.runWhisperCommand(command);
			if (!result.ok) {
				props.onCommandError(
					result.stderr.trim() || `whisper command failed (${command.kind})`,
				);
			}
			return result;
		} finally {
			setInFlight(false);
		}
	}

	const pause = () => {
		if (!workflowId) return;
		void run({ kind: "workflow-pause", workflowId, ...ref });
	};
	const resume = (message: string | null) => {
		if (!workflowId) return;
		void run({ kind: "workflow-resume", workflowId, message, ...ref });
		setResumeOpen(false);
		setResumeMessage("");
	};
	const cancel = () => {
		if (!workflowId) return;
		void run({ kind: "workflow-cancel", workflowId, ...ref });
	};
	const recoverDaemon = () => {
		void run({ kind: "collab-recover", ...ref });
	};

	// `collab tell` can block for minutes. Fire WITHOUT awaiting and WITHOUT the
	// in-flight gate: show an inline "waiting for reply" hint and toast the reply
	// (or stderr) when it settles.
	const tell = (target: TellTarget, instruction: string) => {
		if (!instruction.trim()) return;
		setTellStatus("instruction sent — waiting for reply");
		void plugins
			.runWhisperCommand({ kind: "collab-tell", target, instruction, ...ref })
			.then((result) => {
				setTellStatus(null);
				if (!result.ok) {
					props.onCommandError(result.stderr.trim() || "tell failed");
				} else {
					props.onCommandReply?.(result.stdout.trim() || "agent replied");
				}
			});
		setTellInstruction("");
	};

	const wf = state?.workflow ?? null;
	const isRunning = status === "running";
	const isResumable = status === "paused" || status === "halted";
	const isCancelable =
		status === "running" || status === "paused" || status === "halted";

	return (
		<Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className="workflow-detail__overlay" />
				<Dialog.Content
					className="workflow-detail"
					data-testid="workflow-detail-dialog"
				>
					<Dialog.Title className="workflow-detail__title">
						{wf ? wf.workflowType : "Workflow"}
						{wf && (
							<span className="workflow-detail__status" data-status={wf.status}>
								{wf.status}
							</span>
						)}
					</Dialog.Title>
					<Dialog.Description className="workflow-detail__description">
						Live workflow state and audited actions for this worktree.
					</Dialog.Description>

					{state?.stale && (
						<p className="workflow-detail__stale">
							Showing last-known state — the latest read failed and will retry.
						</p>
					)}

					{!state || !wf ? (
						<p className="workflow-detail__empty">No active workflow.</p>
					) : (
						<>
							{wf.haltReason && (
								<p className="workflow-detail__halt-reason">{wf.haltReason}</p>
							)}
							<p className="workflow-detail__phase">
								{wf.phaseName ?? "—"}
								{wf.round && (
									<span className="workflow-detail__round">
										{" "}
										{wf.round.current}/{wf.round.max}
									</span>
								)}
							</p>

							{state.bindings.length > 0 && (
								<section className="workflow-detail__bindings">
									<h3 className="workflow-detail__section-title">Bindings</h3>
									<ul>
										{state.bindings.map((b) => (
											<li key={b.agentType} data-binding-state={b.bindingState}>
												{b.agentType} — {b.bindingState}
											</li>
										))}
									</ul>
								</section>
							)}

							{state.handoffs.length > 0 && (
								<section className="workflow-detail__handoffs">
									<h3 className="workflow-detail__section-title">
										Handback history
									</h3>
									<ul>
										{state.handoffs.map((h) => (
											<li
												key={h.handoffId}
												className="workflow-detail__handoff"
											>
												<span className="workflow-detail__handoff-agents">
													{h.senderAgent} → {h.targetAgent}
												</span>
												{h.roundNumber !== null && (
													<span className="workflow-detail__handoff-round">
														round {h.roundNumber}
													</span>
												)}
												<span className="workflow-detail__handoff-request">
													{truncate(h.requestText)}
												</span>
												{h.handbackText && (
													<span className="workflow-detail__handoff-handback">
														{truncate(h.handbackText)}
													</span>
												)}
												{h.orchestratorVerdict && (
													<span className="workflow-detail__handoff-verdict">
														{h.orchestratorVerdict}
													</span>
												)}
											</li>
										))}
									</ul>
								</section>
							)}

							<section className="workflow-detail__actions">
								{isRunning && (
									<button
										type="button"
										className="workflow-detail__action"
										disabled={inFlight}
										onClick={pause}
									>
										Pause
									</button>
								)}
								{isResumable &&
									(resumeOpen ? (
										<div className="workflow-detail__resume">
											<input
												aria-label="Resume message"
												value={resumeMessage}
												onChange={(e) => setResumeMessage(e.target.value)}
												placeholder="Optional message"
											/>
											<button
												type="button"
												className="workflow-detail__action"
												disabled={inFlight}
												onClick={() =>
													resume(resumeMessage.trim() ? resumeMessage : null)
												}
											>
												Resume
											</button>
										</div>
									) : (
										<button
											type="button"
											className="workflow-detail__action"
											disabled={inFlight}
											onClick={() => setResumeOpen(true)}
										>
											Resume
										</button>
									))}
								{isCancelable && (
									<button
										type="button"
										className="workflow-detail__action workflow-detail__action--danger"
										disabled={inFlight}
										onClick={cancel}
									>
										Cancel
									</button>
								)}
							</section>

							<section className="workflow-detail__tell">
								<h3 className="workflow-detail__section-title">Tell agent</h3>
								<select
									aria-label="Target agent"
									value={tellTarget}
									onChange={(e) => setTellTarget(e.target.value as TellTarget)}
								>
									<option value="claude">claude</option>
									<option value="codex">codex</option>
									<option value="ezio">ezio</option>
								</select>
								<input
									aria-label="Instruction"
									value={tellInstruction}
									onChange={(e) => setTellInstruction(e.target.value)}
									placeholder="Instruction"
								/>
								<button
									type="button"
									className="workflow-detail__action"
									onClick={() => tell(tellTarget, tellInstruction)}
								>
									Send
								</button>
								{tellStatus && (
									<span className="workflow-detail__tell-status">
										{tellStatus}
									</span>
								)}
							</section>
						</>
					)}

					{state && !state.daemonAlive && (
						<section className="workflow-detail__daemon">
							<p className="workflow-detail__daemon-down">daemon not running</p>
							<button
								type="button"
								className="workflow-detail__action"
								disabled={inFlight}
								onClick={recoverDaemon}
							>
								Restart daemon
							</button>
						</section>
					)}

					<Dialog.Close asChild>
						<button type="button" className="workflow-detail__close">
							Close
						</button>
					</Dialog.Close>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
