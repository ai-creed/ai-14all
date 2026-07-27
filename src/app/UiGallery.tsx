import { useState } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NeedsYouSignal } from "../features/workspace/components/NeedsYouSignal";
import { SidebarTooltip } from "../features/workspace/components/SidebarTooltip";
import { WorkflowRow } from "../features/workflows/components/WorkflowRow";
import { TourStepCard } from "../features/onboarding/components/TourStepCard";
import { TOUR_STEPS } from "../features/onboarding/logic/tour-steps";
import { CoachmarkCard } from "../features/onboarding/components/CoachmarkCard";
import { COACHMARKS } from "../features/onboarding/logic/coachmarks";
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

	// C2 fix (review 2026-07-27): derive the phone-bridge fixture's
	// line-height RATIO from <html>'s own computed style, not a hardcoded
	// per-theme copy — a hardcoded copy is exactly the silent-drift class
	// this guard exists to catch (a tokens.css or Tailwind preflight
	// line-height edit would go unnoticed by both the fixture and, since the
	// fixture would stay pinned, by the height-equality guard too). Must be
	// the RATIO, not the resolved px: the px value (24px/22.4px) is resolved
	// against <html>'s 16px font-size and would flatten the fixture's
	// 11/12/13px children if applied directly. `palette` isn't referenced
	// here on purpose — this reads the live DOM, so it stays correct even if
	// that state ever drifts from the actual data-theme attribute.
	const rootComputedStyle = getComputedStyle(document.documentElement);
	const rootLineHeightRatio =
		parseFloat(rootComputedStyle.lineHeight) /
		parseFloat(rootComputedStyle.fontSize);

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
				<Section title="Onboarding">
					<div data-testid="gallery-onboarding-tour">
						<TourStepCard
							step={TOUR_STEPS[0]}
							index={0}
							total={TOUR_STEPS.length}
							onNext={() => {}}
							onBack={() => {}}
							onSkip={() => {}}
						/>
					</div>
					<div data-testid="gallery-onboarding-coachmark" className="mt-4">
						<CoachmarkCard
							title={COACHMARKS[0].title}
							body={COACHMARKS[0].body}
							onDismiss={() => {}}
						/>
					</div>
				</Section>

				<Section title="Phone bridge — capability ledger">
					{/* Fixed to the real dialog's content width (.plugins-panel is
					    560px with 16px padding each side; 526px uniformly per review;
					    documentary, not load-bearing — see dialogs.css:264-311).
					    lineHeight counters this page's own `text-sm` utility (line 67
					    above), which sets an unwanted unitless 1.42857
					    (Tailwind's --text-sm--line-height) that would otherwise inherit
					    into this subtree. Production never has that leak —
					    .phone-bridge there inherits directly from <html>, whose
					    line-height is Tailwind preflight's 1.5, or 1.4 under
					    [data-theme="tui"] (tokens.css:319). rootLineHeightRatio (above)
					    reads that value from <html> at runtime rather than hardcoding a
					    per-theme copy, so a tokens.css or preflight edit can't silently
					    drift the fixture away from production — it and the
					    css-refactor.visual.spec.ts drift assertion are the same guard
					    the review 2026-07-27 fix added. */}
					<div
						data-testid="gallery-phone-bridge"
						className="phone-bridge flex flex-col gap-4"
						style={{ maxWidth: 526, lineHeight: rootLineHeightRatio }}
					>
						{/* GROUP 1 — production's real stacking order, in production's
						    BLOCK layout (the gap-4 flex above only separates the groups):
						    status strip -> view slot -> relay disclosure. Structural, not
						    decorative: `.phone-bridge__strip` has a border-bottom +
						    12px margin-bottom and `.phone-bridge__relay` a border-top +
						    12px margin-top, so putting the disclosure directly under the
						    strip collapses those margins into TWO full-width rules 12px
						    apart (2px rules under tui). That artifact shipped once,
						    precisely because no fixture carried the strip. It does now. */}
						<div data-testid="gallery-pb-panel">
							<div className="phone-bridge__strip">
								<span className="phone-bridge__dot phone-bridge__dot--on" />
								<span className="phone-bridge__addr">
									Listening on 192.168.1.51:52329
								</span>
								{/* Doubles as the visual spec's focus anchor: it is the real
								    element that precedes Unpair in production's tab order, so
								    Tab from here reaches Unpair with a KEYBOARD-originated
								    focus (what :focus-visible requires) without injecting a
								    test-only control into the device header. */}
								<Switch
									checked
									onCheckedChange={() => {}}
									data-testid="gallery-pb-focus-anchor"
									aria-label="Enable phone bridge"
								/>
							</div>

							{/* Full grants, both controls armed. A real .phone-bridge__view
							    so its height can be compared against the idle view below —
							    that comparison is what guards the raised min-height. */}
							<div
								data-testid="gallery-pb-view-paired"
								className="phone-bridge__view"
							>
								<div className="phone-bridge__label">Paired device</div>
								<div
									data-testid="gallery-pb-ledger-full"
									className="phone-bridge__device"
								>
									<PbDeviceHeader unpairTestId="gallery-pb-unpair" />
									<div className="phone-bridge__caps">
										<PbFactRow label={PB_REPORTS_LABEL} />
										<PbFactRow label={PB_ACT_LABEL} />
										<PbControlRow armed {...PB_NOTIFY} />
										<PbFactRow
											label={PB_INSPECT.label}
											hint={PB_INSPECT.hint}
										/>
										<PbControlRow armed {...PB_PTY} />
									</div>
								</div>
							</div>

							<details
								data-testid="gallery-pb-relay-collapsed"
								className="phone-bridge__relay"
							>
								<summary>Off-network relay · off</summary>
							</details>
						</div>

						{/* GROUP 2 — the SHORTEST real view (`idle`) with the disclosure
						    open beneath it, same production stacking. Paired above + idle
						    here are the two ends of the min-height requirement: both are
						    pinned to min-height when the value is large enough, so their
						    heights are EQUAL. If min-height is deleted, lowered, or simply
						    set below the tallest resting view, paired grows past idle and
						    the equality test fails — per palette, which is what catches
						    the tui-only case. */}
						<div>
							<div
								data-testid="gallery-pb-view-idle"
								className="phone-bridge__view"
							>
								<div className="phone-bridge__label">Pairing</div>
								<p className="phone-bridge__hint">No phone paired.</p>
								<button
									type="button"
									className="phone-bridge__btn phone-bridge__btn--primary"
								>
									Pair a phone
								</button>
							</div>

							<details
								data-testid="gallery-pb-relay-open"
								className="phone-bridge__relay"
								open
							>
								<summary>Off-network relay · registered</summary>
								<div className="phone-bridge__relay-body">
									<label
										className="phone-bridge__label"
										htmlFor="gallery-pb-relay-url"
									>
										Relay URL
									</label>
									<input
										id="gallery-pb-relay-url"
										className="phone-bridge__input"
										type="text"
										readOnly
										value="wss://relay.example.com"
									/>
									<p className="phone-bridge__hint phone-bridge__relay-hint">
										Lets a phone reach this Mac when it is not on your Wi-Fi.
										Leave empty for local network only.
									</p>
								</div>
							</details>
						</div>

						{/* Granted, both controls disarmed — [ ] must read as distinct from
						    the denied · below. Full four-row set inside a real
						    .phone-bridge__device, because production NEVER renders a caps
						    block anywhere else: on --background these swatches were
						    guarding a surface the app cannot produce. The hints are
						    likewise not optional — production renders one for every row
						    where armed !== null, without exception. */}
						<div
							data-testid="gallery-pb-ledger-disarmed"
							className="phone-bridge__device"
						>
							<PbDeviceHeader />
							<div className="phone-bridge__caps">
								<PbFactRow label={PB_REPORTS_LABEL} />
								<PbFactRow label={PB_ACT_LABEL} />
								<PbControlRow armed={false} {...PB_NOTIFY} />
								<PbFactRow label={PB_INSPECT.label} hint={PB_INSPECT.hint} />
								<PbControlRow armed={false} {...PB_PTY} />
							</div>
						</div>

						{/* Legacy pre-2b.2 record: one granted, three denied. */}
						<div
							data-testid="gallery-pb-ledger-legacy"
							className="phone-bridge__device"
						>
							<PbDeviceHeader />
							<div className="phone-bridge__caps">
								<PbFactRow label={PB_REPORTS_LABEL} />
								<PbFactRow denied label={PB_ACT_LABEL} />
								<PbFactRow denied label={PB_NOTIFY.label} />
								<PbFactRow denied label={PB_INSPECT.label} />
								<PbFactRow denied label={PB_PTY.label} />
								<p className="phone-bridge__cap-hint">
									Pair this phone again to grant the newer capabilities.
								</p>
							</div>
						</div>
					</div>
				</Section>
			</main>
		</div>
	);
}

// --- Phone-bridge fixture parts ---
// Copy kept identical to phone-bridge-format.ts's capabilityRows so the swatches
// depict states the app can actually produce; the mark spans carry aria-hidden
// for the same reason PhoneBridgePanel's do (decorative glyphs).
const PB_REPORTS_LABEL = "Read session reports";
const PB_ACT_LABEL = "Act on workflows";
const PB_NOTIFY = {
	label: "Send notifications to this phone",
	hint: "Pings the phone when a workflow finishes or needs you.",
};
// control:inspect — granted at pairing but with NO kill switch, so it renders
// as a bare fact row that still carries a hint (spec D10).
const PB_INSPECT = {
	label: "Read terminal output",
	hint: "The phone can live-tail agent terminals — everything they print — and resize the one it watches.",
};
const PB_PTY = {
	label: "Type into terminals",
	hint: "Sends keystrokes to running agents.",
};

/** Device-card header — exactly production's two content children plus Unpair. */
function PbDeviceHeader({ unpairTestId }: { unpairTestId?: string }) {
	return (
		<div className="phone-bridge__device-main">
			<div className="phone-bridge__device-icon" aria-hidden="true" />
			<div className="phone-bridge__device-lines">
				<div className="phone-bridge__device-name">Phone</div>
				<div>Paired just now</div>
			</div>
			<button
				type="button"
				data-testid={unpairTestId}
				className="phone-bridge__btn phone-bridge__btn--quiet-danger phone-bridge__device-action"
			>
				Unpair
			</button>
		</div>
	);
}

/** `armed === null` row: a bare ✓ states a fact, · marks an absent grant. */
function PbFactRow({
	label,
	denied,
	hint,
}: {
	label: string;
	denied?: boolean;
	hint?: string;
}) {
	return (
		<>
			<p
				className={`phone-bridge__cap${denied ? " phone-bridge__cap--denied" : ""}`}
			>
				<span className="phone-bridge__cap-mark" aria-hidden="true">
					{denied ? "·" : "✓"}
				</span>
				<span className="phone-bridge__cap-name">{label}</span>
				{denied && <span className="phone-bridge__cap-deny">not granted</span>}
			</p>
			{hint && <p className="phone-bridge__cap-hint">{hint}</p>}
		</>
	);
}

/** Control row: [brackets] mark a live switch, always followed by its hint. */
function PbControlRow({
	label,
	hint,
	armed,
}: {
	label: string;
	hint: string;
	armed: boolean;
}) {
	return (
		<>
			<button
				type="button"
				className="phone-bridge__cap"
				role="switch"
				aria-checked={armed}
			>
				<span className="phone-bridge__cap-mark" aria-hidden="true">
					{armed ? "[✓]" : "[ ]"}
				</span>
				<span className="phone-bridge__cap-name">{label}</span>
			</button>
			<p className="phone-bridge__cap-hint">{hint}</p>
		</>
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
