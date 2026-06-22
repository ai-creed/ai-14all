import { Icon } from "@/components/ui/icon";

type WorkspaceSwitcherProps = {
	workspaces: { workspaceId: string; name: string }[];
	activeWorkspaceId: string | null;
	onSelect: (workspaceId: string) => void;
	onRemove?: (workspaceId: string) => void;
};

export function WorkspaceSwitcher({
	workspaces,
	activeWorkspaceId,
	onSelect,
	onRemove,
}: WorkspaceSwitcherProps) {
	return (
		<nav aria-label="Workspaces" className="workspace-switcher">
			{workspaces.map((ws) => (
				<div key={ws.workspaceId} className="workspace-switcher__entry">
					<button
						type="button"
						className="workspace-switcher__item"
						data-selected={ws.workspaceId === activeWorkspaceId}
						onClick={() => onSelect(ws.workspaceId)}
					>
						{ws.name}
					</button>
					{onRemove && (
						<button
							type="button"
							className="workspace-switcher__remove"
							aria-label={`Remove ${ws.name}`}
							onClick={() => onRemove(ws.workspaceId)}
						>
							<Icon name="close" />
						</button>
					)}
				</div>
			))}
		</nav>
	);
}
