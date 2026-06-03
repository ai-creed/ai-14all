import { Button } from "@/components/ui/button";

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
			<Button type="button" variant="default" size="sm" onClick={onOpenInstall}>
				Install…
			</Button>
		</div>
	);
}
