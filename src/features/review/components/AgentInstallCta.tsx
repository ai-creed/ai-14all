import { Button } from "@/components/ui/button";

type Props = {
	onOpenInstall: () => void;
};

export function AgentInstallCta({ onOpenInstall }: Props) {
	return (
		<div
			className="flex items-center gap-3 rounded-md border border-border bg-muted/50 p-3"
			data-testid="agent-install-cta"
		>
			<p className="flex-1 text-sm text-muted-foreground">
				<strong>Install fix-review skill</strong> — let your Claude Code or
				Codex agent address these comments.
			</p>
			<Button
				type="button"
				size="sm"
				onClick={onOpenInstall}
			>
				Install…
			</Button>
		</div>
	);
}
