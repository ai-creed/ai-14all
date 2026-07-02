import { useState } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NeedsYouSignal } from "../features/workspace/components/NeedsYouSignal";
import { SidebarTooltip } from "../features/workspace/components/SidebarTooltip";
import { WorkflowRow } from "../features/workflows/components/WorkflowRow";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";

const PALETTES = ["dark", "light", "warm", "tui"] as const;
type GalleryPalette = (typeof PALETTES)[number];

/**
 * Primitive gallery for visual theme review (docs/tui-css-spec.md §10.2).
 * Reached via the #/ui-gallery hash; renders every shadcn primitive in its
 * common states so a single screenshot per theme captures the whole design
 * surface. Not linked from anywhere in the app UI.
 */
export function UiGallery() {
	const [palette, setPalette] = useState<GalleryPalette>(() => {
		const current = document.documentElement.getAttribute("data-theme");
		return (PALETTES as readonly string[]).includes(current ?? "")
			? (current as GalleryPalette)
			: "dark";
	});

	const applyPalette = (next: GalleryPalette) => {
		document.documentElement.setAttribute("data-theme", next);
		setPalette(next);
	};

	return (
		<div
			data-testid="ui-gallery"
			className="min-h-screen bg-background p-6 font-mono text-sm text-foreground"
		>
			<header className="mb-6 flex items-center gap-4">
				<h1 className="text-base font-bold">UI Gallery</h1>
				<div className="flex gap-2" data-testid="gallery-theme-switcher">
					{PALETTES.map((p) => (
						<Button
							key={p}
							size="sm"
							variant={p === palette ? "default" : "outline"}
							data-testid={`gallery-theme-${p}`}
							onClick={() => applyPalette(p)}
						>
							{p}
						</Button>
					))}
				</div>
			</header>

			<main className="grid max-w-4xl gap-8">
				<Section title="Button — variants">
					<div className="flex flex-wrap items-center gap-3">
						<Button>Default</Button>
						<Button variant="secondary">Secondary</Button>
						<Button variant="outline">Outline</Button>
						<Button variant="ghost">Ghost</Button>
						<Button variant="destructive">Destructive</Button>
						<Button variant="link">Link</Button>
					</div>
				</Section>

				<Section title="Button — sizes & states">
					<div className="flex flex-wrap items-center gap-3">
						<Button size="sm">Small</Button>
						<Button size="lg">Large</Button>
						<Button size="icon" aria-label="Settings">
							<Settings />
						</Button>
						<Button disabled>Disabled</Button>
						<Button variant="outline" disabled>
							Disabled outline
						</Button>
					</div>
				</Section>

				<Section title="Input / Textarea">
					<div className="grid max-w-md gap-3">
						<Input placeholder="Placeholder text" />
						<Input defaultValue="Filled value" />
						<Input disabled defaultValue="Disabled" />
						<Textarea placeholder="Multiline placeholder" rows={3} />
					</div>
				</Section>

				<Section title="Switch">
					<div className="flex items-center gap-6">
						<Switch aria-label="Off switch" />
						<Switch defaultChecked aria-label="On switch" />
						<Switch disabled aria-label="Disabled switch" />
					</div>
				</Section>

				<Section title="Tabs">
					<Tabs defaultValue="terminal" className="max-w-md">
						<TabsList>
							<TabsTrigger value="terminal">Terminal</TabsTrigger>
							<TabsTrigger value="review">Review</TabsTrigger>
							<TabsTrigger value="files">Files</TabsTrigger>
						</TabsList>
						<TabsContent value="terminal" className="pt-2">
							Active tab content.
						</TabsContent>
					</Tabs>
				</Section>

				<Section title="ScrollArea">
					<ScrollArea className="h-24 max-w-md border border-border p-2">
						{Array.from({ length: 16 }, (_, i) => (
							<div key={i}>scrollback line {i + 1}</div>
						))}
					</ScrollArea>
				</Section>

				<Section title="Overlays (open via triggers)">
					<div className="flex flex-wrap items-center gap-3">
						<Dialog>
							<DialogTrigger asChild>
								<Button variant="outline" data-testid="gallery-open-dialog">
									Open dialog
								</Button>
							</DialogTrigger>
							<DialogContent data-testid="gallery-dialog-content">
								<DialogHeader>
									<DialogTitle>Dialog title</DialogTitle>
									<DialogDescription>
										Supporting description copy for the dialog body.
									</DialogDescription>
								</DialogHeader>
								<Input placeholder="Field inside dialog" />
								<DialogFooter>
									<Button variant="outline">Cancel</Button>
									<Button>Confirm</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline" data-testid="gallery-open-dropdown">
									Open dropdown
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent data-testid="gallery-dropdown-content">
								<DropdownMenuLabel>Worktree</DropdownMenuLabel>
								<DropdownMenuSeparator />
								<DropdownMenuItem>Open in editor</DropdownMenuItem>
								<DropdownMenuItem>Copy branch name</DropdownMenuItem>
								<DropdownMenuItem disabled>Merge (blocked)</DropdownMenuItem>
								<DropdownMenuItem className="text-destructive">
									Remove worktree
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>

						<ContextMenu>
							<ContextMenuTrigger asChild>
								<div
									data-testid="gallery-context-target"
									className="border border-dashed border-border px-4 py-2 text-muted-foreground"
								>
									Right-click me
								</div>
							</ContextMenuTrigger>
							<ContextMenuContent data-testid="gallery-context-content">
								<ContextMenuItem>Rename session</ContextMenuItem>
								<ContextMenuItem>Duplicate</ContextMenuItem>
								<ContextMenuItem className="text-destructive">
									Delete
								</ContextMenuItem>
							</ContextMenuContent>
						</ContextMenu>
					</div>
				</Section>

				<Section title="Mock pane (shell chrome)">
					<div className="tui-box max-w-md" data-testid="gallery-mock-pane">
						<div className="tui-box-title">SESSIONS</div>
						<div className="grid gap-1 pt-1">
							<div className="flex items-center justify-between px-2 py-1">
								<span>feat/terminal-ui-theme</span>
								<span className="text-muted-foreground">running</span>
							</div>
							<div className="flex items-center justify-between bg-primary px-2 py-1 text-primary-foreground">
								<span>fix/dialog-mount</span>
								<span>selected</span>
							</div>
							<div className="flex items-center justify-between px-2 py-1 text-muted-foreground">
								<span>chore/deps-bump</span>
								<span>idle</span>
							</div>
						</div>
					</div>
				</Section>

				<Section title="Agent launchers & collab status">
					<div
						className="shell-chip-bar__terminal-group"
						data-testid="gallery-launcher-group"
					>
						<button
							type="button"
							className="shell-chip-bar__action"
							data-provider="claude"
							data-testid="gallery-launch-claude"
						>
							<span className="shell-chip-bar__action-icon" aria-hidden="true">
								<Icon name="plus" />
							</span>
							Claude
						</button>
						<span
							className="agent-launcher-bar__status"
							data-tone="muted"
							data-testid="gallery-collab-muted"
						>
							mount an agent to start a collab
						</span>
						<span
							className="agent-launcher-bar__status"
							data-tone="amber"
							data-testid="gallery-collab-amber"
						>
							collab · 1 agent · need 1 more
						</span>
						<span
							className="agent-launcher-bar__status"
							data-tone="accent"
							data-testid="gallery-collab-accent"
						>
							collab · ready for workflows
						</span>
					</div>
				</Section>
				<Section title="Sidebar attention & tooltips">
					<TooltipProvider delayDuration={0} disableHoverableContent>
						<div className="flex flex-col gap-2" data-testid="gallery-sidebar">
							<div data-testid="gallery-needs-you">
								<NeedsYouSignal tier="actionRequired" />
							</div>
							<SidebarTooltip label="feature/very-long-branch-name-that-is-truncated">
								<div
									className="shell-sidebar__branch"
									data-testid="gallery-branch"
									tabIndex={0}
									style={{ maxWidth: 160 }}
								>
									feature/very-long-branch-name-that-is-truncated
								</div>
							</SidebarTooltip>
							<SidebarTooltip label="Refine demo recording hygiene — awaiting approval">
								<div
									className="shell-sidebar__card-task"
									data-testid="gallery-task-row"
									tabIndex={0}
									style={{ maxWidth: 160 }}
								>
									Refine demo recording hygiene — awaiting approval
								</div>
							</SidebarTooltip>
						</div>
					</TooltipProvider>
				</Section>
				<Section title="Workflow lens (status word + tier color)">
					<div
						className="flex flex-col gap-2"
						data-testid="gallery-workflow-lens"
						style={{ maxWidth: 280 }}
					>
						{(
							[
								{
									status: "running",
									escalated: false,
									phaseName: "code-review",
									roundLabel: "1/5",
								},
								{
									status: "done",
									escalated: false,
									phaseName: "implementation",
									roundLabel: "3/3",
								},
								{
									status: "halted",
									escalated: false,
									phaseName: "plan",
									roundLabel: "2/5",
								},
								{
									status: "running",
									escalated: true,
									phaseName: "deliberation",
									roundLabel: "4/5",
								},
							] as const
						).map((o, i) => (
							<WorkflowRow
								key={i}
								row={{
									worktreeId: `wt${i}`,
									workflowId: `wf${i}`,
									workflowType: "spec-driven-development",
									typeLabel: "SDD",
									artifact: "2026-07-02-session-view-p0-ux-design.md",
									phaseName: o.phaseName,
									roundLabel: o.roundLabel,
									status: o.status,
									escalated: o.escalated,
									daemonAlive: true,
									liveFeed: "socket",
								}}
								onOpenDetail={() => {}}
							/>
						))}
					</div>
				</Section>
			</main>
		</div>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section>
			<h2 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
				{title}
			</h2>
			{children}
		</section>
	);
}
