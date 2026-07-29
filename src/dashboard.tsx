// Second renderer entry (electron.vite.config.ts renderer input map) for the
// detached insights window (design spec §2 decision 4): a standalone root
// that renders the SAME `InsightsDashboard` surface the main window's
// overlay uses, with host="window" so the titlebar/reattach affordance
// renders instead of the overlay's detach/close actions.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { InsightsDashboard } from "./features/insights/InsightsDashboard";
import { loadWorkspaceIndex } from "./features/insights/workspaceIndex";
import type { WorkspaceIndex } from "./features/insights/workspaceRows";
import { useTheme } from "./lib/use-theme";
// All app CSS flows through the single cascade authority (src/main.tsx does
// the same import) — see src/styles/index.css and
// docs/shared/styling-architecture.md.
import "./styles/index.css";

function DashboardRoot() {
	// Same call pattern as the main shell's tree (src/main.tsx -> App): applies
	// data-theme synchronously on first render and keeps it converged with
	// settings/menu changes, so the detached window never flashes the wrong
	// palette or drifts from the main window's theme.
	useTheme();
	const [workspaces, setWorkspaces] = useState<WorkspaceIndex>([]);
	useEffect(() => {
		void loadWorkspaceIndex().then(setWorkspaces);
	}, []);
	return (
		<InsightsDashboard
			host="window"
			workspaces={workspaces} // AC5: the detached host seeds the SAME registry rows as the overlay
			onReattach={() => void window.ai14all.insights.reattach()}
			onClose={() => window.close()}
			onDetach={() => {}}
			onOpenSettings={() => {}}
		/>
	);
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");
createRoot(rootEl).render(<DashboardRoot />);
