type Props = {
	onOpenInstall: () => void;
};

export function AgentInstallCta({ onOpenInstall }: Props) {
	return (
		<div
			className="shell-review-comment-sidebar__cta"
			data-testid="agent-install-cta"
		>
			<p className="shell-review-comment-sidebar__cta-copy">
				<strong>Install fix-review skill</strong> — let your Claude Code or
				Codex agent address these comments.
			</p>
			<button
				type="button"
				className="shell-button shell-button--compact shell-button--primary"
				onClick={onOpenInstall}
			>
				Install…
			</button>
		</div>
	);
}
