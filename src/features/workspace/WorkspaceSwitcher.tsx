type WorkspaceSwitcherProps = {
	workspaces: { workspaceId: string; name: string }[];
	activeWorkspaceId: string | null;
	onSelect: (workspaceId: string) => void;
};

export function WorkspaceSwitcher({ workspaces, activeWorkspaceId, onSelect }: WorkspaceSwitcherProps) {
	return (
		<nav aria-label="Workspaces" className="workspace-switcher">
			{workspaces.map((ws) => (
				<button
					key={ws.workspaceId}
					type="button"
					className="workspace-switcher__item"
					data-selected={ws.workspaceId === activeWorkspaceId}
					onClick={() => onSelect(ws.workspaceId)}
				>
					{ws.name}
				</button>
			))}
		</nav>
	);
}
