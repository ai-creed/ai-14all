import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { TerminalTab } from "../../../shared/models/worktree-session";
import type { TerminalSession } from "../../../shared/models/terminal-session";

type Props = {
	tabs: TerminalTab[];
	activeSessionId: string | null;
	sessionStatuses?: Record<string, TerminalSession["status"]>;
	onSelect: (sessionId: string) => void;
	onAdd: () => void;
	onClose: (sessionId: string) => void;
};

const statusSuffix: Partial<Record<TerminalSession["status"], string>> = {
	exited: " (exited)",
	error: " (error)",
};

export function TerminalTabs({
	tabs,
	activeSessionId,
	sessionStatuses,
	onSelect,
	onAdd,
	onClose,
}: Props) {
	return (
		<Tooltip.Provider delayDuration={150}>
			<Tabs.Root
				value={activeSessionId ?? undefined}
				className="shell-panel shell-terminal-tabs"
			>
				<div className="shell-terminal-tabs__bar">
					<Tabs.List
						aria-label="Terminal sessions"
						className="shell-terminal-tabs__list"
					>
						{tabs.map((tab) => {
							const status = sessionStatuses?.[tab.sessionId] ?? "running";
							const suffix = statusSuffix[status] ?? "";
							return (
								<div key={tab.sessionId} className="shell-terminal-tabs__item">
									<Tabs.Trigger
										value={tab.sessionId}
										className="shell-terminal-tab"
										data-status={status}
										onClick={() => onSelect(tab.sessionId)}
									>
										{tab.label}
										{suffix}
									</Tabs.Trigger>
									<Tooltip.Root>
										<Tooltip.Trigger asChild>
											<button
												type="button"
												className="shell-terminal-tab__close"
												aria-label={`Close ${tab.label}`}
												onClick={() => onClose(tab.sessionId)}
											>
												×
											</button>
										</Tooltip.Trigger>
										<Tooltip.Portal>
											<Tooltip.Content className="shell-tooltip" sideOffset={8}>
												Close terminal
											</Tooltip.Content>
										</Tooltip.Portal>
									</Tooltip.Root>
								</div>
							);
						})}
					</Tabs.List>

					<button
						type="button"
						className="shell-button"
						onClick={onAdd}
						aria-label="New terminal"
					>
						+ Terminal
					</button>
				</div>
			</Tabs.Root>
		</Tooltip.Provider>
	);
}
