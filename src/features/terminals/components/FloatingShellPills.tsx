import { Icon } from "@/components/ui/icon";
import type { ProcessSession } from "../../../../shared/models/process-session";

type Props = {
	floatingShellIds: string[];
	processSessionsById: Record<string, ProcessSession>;
	expandedId: string | null;
	onExpand: (processId: string) => void;
	onClose: (processId: string) => void;
};

/**
 * Minimized throwaway shells rendered as pills in the terminal header, left of
 * the `+ Shell` action. One may be expanded into a popover at a time (see
 * FloatingShellPopover). Clicking a pill body expands it; the ✕ kills it.
 */
export function FloatingShellPills({
	floatingShellIds,
	processSessionsById,
	expandedId,
	onExpand,
	onClose,
}: Props) {
	if (floatingShellIds.length === 0) return null;
	return (
		<div className="floating-shell-pills" data-testid="floating-shell-pills">
			{floatingShellIds.map((id) => {
				const process = processSessionsById[id];
				if (!process) return null;
				const exited =
					process.status === "exited" || process.status === "error";
				return (
					<div
						key={id}
						className="floating-shell-pill"
						data-testid={`floating-shell-pill-${id}`}
						data-status={process.status}
						data-active={id === expandedId ? "true" : "false"}
					>
						<button
							type="button"
							className="floating-shell-pill__body"
							onClick={() => onExpand(id)}
						>
							<span
								className="floating-shell-pill__dot"
								data-exited={exited ? "true" : "false"}
								aria-hidden="true"
							/>
							<span className="floating-shell-pill__label">
								{process.label}
								{exited ? " ✓" : ""}
							</span>
						</button>
						<button
							type="button"
							className="floating-shell-pill__close"
							aria-label="Kill floating shell"
							title="Kill"
							data-testid={`floating-shell-pill-close-${id}`}
							onClick={() => onClose(id)}
						>
							<Icon name="close" />
						</button>
					</div>
				);
			})}
		</div>
	);
}
