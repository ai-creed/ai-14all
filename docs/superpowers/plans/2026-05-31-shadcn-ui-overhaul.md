# shadcn/ui Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic `shell.css` (4,326 lines) with Tailwind CSS utility classes and shadcn/ui components while keeping the current UI/UX unchanged.

**Architecture:** Install Tailwind v4 + shadcn/ui into the Electron renderer, map existing CSS custom properties into shadcn's theme variable system, swap all Radix UI imports for shadcn component wrappers, convert all BEM CSS classes to Tailwind utility classes, then delete `shell.css`.

**Tech Stack:** Tailwind CSS v4, shadcn/ui, Radix UI (via shadcn), class-variance-authority, clsx, tailwind-merge, lucide-react

**Spec:** `docs/superpowers/specs/2026-05-31-shadcn-ui-overhaul-design.md`

---

## File Structure

### New files
- `components.json` — shadcn configuration
- `src/lib/utils.ts` — `cn()` utility
- `src/index.css` — Tailwind import + theme variables + globals (replaces `shell.css`)
- `src/components/ui/*.tsx` — All shadcn components (generated via CLI)

### Modified files (58 total)
- `electron.vite.config.ts` — add Tailwind plugin to renderer
- `tsconfig.json` — add baseUrl + paths
- `package.json` — add/remove dependencies
- `src/main.tsx` — change CSS import from `shell.css` to `index.css`
- `src/components/AppDialog.tsx` — rewrite to use shadcn Dialog
- `src/ui/ToggleSwitch.tsx` — rewrite to use shadcn Switch
- `src/features/ui/toast/ToastProvider.tsx` — rewrite to use Sonner
- `src/features/ui/toast/use-toast.ts` — update to Sonner API
- `src/app/App.tsx` — convert shell-* classes to Tailwind
- `src/app/components/MainColumnChrome.tsx` — convert to Tailwind
- `src/app/components/SidebarPanel.tsx` — convert to Tailwind
- `src/app/components/TerminalPanel.tsx` — convert to Tailwind
- `src/app/components/ReviewArea.tsx` — convert to Tailwind + shadcn ScrollArea/Tabs
- `src/app/components/ReviewChipBar.tsx` — convert to Tailwind
- `src/app/components/RestoreBanner.tsx` — convert to Tailwind
- `src/app/components/AgentAttentionBanner.tsx` — convert to Tailwind
- `src/app/components/DialogStack.tsx` — convert to Tailwind
- `src/features/workspace/components/SessionSidebar.tsx` — shadcn ContextMenu + Tailwind
- `src/features/workspace/components/SessionHeader.tsx` — convert to Tailwind
- `src/features/workspace/components/SessionChipBar.tsx` — convert to Tailwind
- `src/features/workspace/components/ContextPanel.tsx` — convert to Tailwind + shadcn Input/Label
- `src/features/workspace/components/NoteSheet.tsx` — rewrite to shadcn Sheet
- `src/features/workspace/components/NewWorktreeDialog.tsx` — shadcn Dialog/Input/Button
- `src/features/workspace/components/RemoveWorktreeDialog.tsx` — shadcn Dialog/Button
- `src/features/workspace/components/LoadWorkspaceDialog.tsx` — shadcn Dialog/Input/Button
- `src/features/terminals/components/TerminalPane.tsx` — convert to Tailwind + shadcn Button
- `src/features/terminals/components/TerminalActions.tsx` — shadcn DropdownMenu + Tailwind
- `src/features/terminals/components/TerminalLayoutDialog.tsx` — shadcn Dialog + Tailwind
- `src/features/terminals/components/PresetManager.tsx` — shadcn Button/Input
- `src/features/viewer/components/InlineEditor.tsx` — convert to Tailwind
- `src/features/viewer/components/DiffViewer.tsx` — convert to Tailwind
- `src/features/viewer/components/EditorDirtyBar.tsx` — convert to Tailwind + shadcn Button
- `src/features/viewer/components/MarkdownPreviewModal.tsx` — shadcn Dialog
- `src/features/viewer/components/ConfirmCloseDialog.tsx` — shadcn Button
- `src/features/viewer/components/SaveConflictDialog.tsx` — shadcn Button
- `src/features/viewer/components/WorktreeTree.tsx` — shadcn ContextMenu + Tailwind
- `src/features/review/components/ReviewExpandedPortal.tsx` — convert to Tailwind
- `src/features/review/components/ReviewQueuePanel.tsx` — convert to Tailwind
- `src/features/review/components/ReviewCommentForm.tsx` — convert to Tailwind
- `src/features/review/components/ReviewBarButton.tsx` — convert to Tailwind
- `src/features/review/components/InlineCommentThread.tsx` — convert to Tailwind
- `src/features/review/components/InlineDraftThread.tsx` — convert to Tailwind
- `src/features/review/components/AgentInstallCta.tsx` — shadcn Button + Tailwind
- `src/features/review/components/AgentInstallModal.tsx` — shadcn Button + Tailwind
- `src/features/review/components/InlineMountsBridge.tsx` — convert to Tailwind
- `src/features/review/logic/inline-comment-widgets.ts` — update CSS class references
- `src/features/review/logic/diff-editor-decorations.ts` — update CSS class references
- `src/features/review/logic/inline-thread-mount.ts` — update CSS class references
- `src/features/git/components/CommitList.tsx` — shadcn ContextMenu + Tailwind
- `src/features/git/components/ChangesList.tsx` — shadcn ContextMenu + Tailwind
- `src/features/git/components/CommitDiffStack.tsx` — shadcn Collapsible + Tailwind
- `src/features/git/components/DiscardChangeDialog.tsx` — shadcn Button
- `src/features/git/components/ForcePushDialog.tsx` — shadcn Button
- `src/features/files/FilesOverlay.tsx` — shadcn Dialog + Tailwind
- `src/features/shortcuts/ShortcutsHelp.tsx` — shadcn Dialog + Tailwind
- `src/features/repository/RepositoryInput.tsx` — shadcn Button/Input + Tailwind
- `src/features/repository/RestorePrompt.tsx` — shadcn Button + Tailwind
- `src/features/updater/UpdateBanner.tsx` — convert to Tailwind

### Deleted files
- `src/app/shell.css`
- `src/features/updater/UpdateBanner.css`

---

## Task 1: Install dependencies and configure build tooling

**Files:**
- Modify: `package.json`
- Modify: `electron.vite.config.ts`
- Modify: `tsconfig.json`
- Create: `components.json`
- Create: `src/lib/utils.ts`

- [ ] **Step 1: Install Tailwind CSS and shadcn dependencies**

```bash
cd /Users/tringuyen/side-project/ai-14all
pnpm add tailwindcss @tailwindcss/vite class-variance-authority clsx tailwind-merge lucide-react
```

- [ ] **Step 2: Add Tailwind plugin to electron-vite renderer config**

In `electron.vite.config.ts`, add the tailwindcss import and plugin:

```ts
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	main: {
		build: {
			rollupOptions: {
				input: {
					index: "./electron/main/index.ts",
					"usage-worker": "./electron/main/services/usage-worker.ts",
				},
				external: ["node-pty"],
			},
		},
	},
	preload: {
		build: {
			rollupOptions: {
				input: "./electron/preload/index.ts",
				output: {
					format: "cjs",
				},
			},
		},
	},
	renderer: {
		root: ".",
		build: {
			rollupOptions: {
				input: "./index.html",
			},
		},
		plugins: [react(), tailwindcss()],
	},
});
```

- [ ] **Step 3: Add path aliases to tsconfig.json**

```json
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "ESNext",
		"moduleResolution": "Bundler",
		"lib": ["ES2022", "DOM", "DOM.Iterable"],
		"jsx": "react-jsx",
		"strict": true,
		"noUnusedLocals": true,
		"noUnusedParameters": true,
		"noFallthroughCasesInSwitch": true,
		"skipLibCheck": true,
		"allowArbitraryExtensions": true,
		"composite": true,
		"outDir": "dist/renderer",
		"baseUrl": ".",
		"paths": {
			"@/*": ["./src/*"]
		}
	},
	"include": ["src", "shared"]
}
```

- [ ] **Step 4: Create components.json**

```json
{
	"$schema": "https://ui.shadcn.com/schema.json",
	"style": "default",
	"rsc": false,
	"tsx": true,
	"tailwind": {
		"config": "",
		"css": "src/index.css",
		"baseColor": "slate",
		"cssVariables": true
	},
	"aliases": {
		"components": "@/components",
		"utils": "@/lib/utils",
		"ui": "@/components/ui",
		"hooks": "@/hooks"
	}
}
```

- [ ] **Step 5: Create src/lib/utils.ts**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
```

- [ ] **Step 6: Install all shadcn components**

```bash
pnpm dlx shadcn@latest add --all
```

If the CLI prompts for confirmation, accept defaults. This creates `src/components/ui/*.tsx` with all 73+ components.

- [ ] **Step 7: Verify build**

```bash
pnpm build
```

Expected: Build succeeds. shadcn components exist alongside the old shell.css. No breakage yet since nothing imports the new components.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: install tailwind + shadcn/ui infrastructure"
```

---

## Task 2: Create the new index.css with theme variables and globals

**Files:**
- Create: `src/index.css`
- Modify: `src/main.tsx` — change CSS import

- [ ] **Step 1: Create src/index.css**

This file replaces `shell.css`. It contains the Tailwind import, theme variables for all three themes, the font-face, keyframe animations, body gradients, xterm/Monaco overrides, and reduced-motion support. Read the full current `shell.css` to extract all `@keyframes`, `@property`, `@font-face`, xterm selectors, and the `prefers-reduced-motion` block. Copy them into `src/index.css` after the theme variables below.

```css
@import "tailwindcss";

/* ── Font ─────────────────────────────────────────────────────── */
@font-face {
	font-family: "AI14All Terminal Powerline";
	src: url("./assets/fonts/meslo-lg-m-dz-powerline-regular.ttf")
		format("truetype");
	font-weight: 400;
	font-style: normal;
	font-display: swap;
}

/* ── Theme: Dark (default) ────────────────────────────────────── */
:root {
	--background: #0b1116;
	--foreground: #eef7fa;
	--card: #111a21;
	--card-foreground: #eef7fa;
	--popover: #16232c;
	--popover-foreground: #eef7fa;
	--primary: #67d4b0;
	--primary-foreground: #0b1116;
	--secondary: #16232c;
	--secondary-foreground: #8fa4b1;
	--muted: #16232c;
	--muted-foreground: #6f8593;
	--accent: #15383d;
	--accent-foreground: #67d4b0;
	--destructive: #d98c8c;
	--border: #24313d;
	--input: #24313d;
	--ring: #67d4b0;
	--radius: 0.25rem;

	/* App-specific extensions */
	--panel-border-strong: #345767;
	--warning: #f0c37a;
	--sha: #a78bfa;
	--provider-claude: #d97706;
	--provider-codex: #2563eb;
	--pane-border-sessions: rgba(79, 179, 255, 0.5);
	--pane-border-session-info: rgba(246, 169, 74, 0.5);
	--pane-border-terminal: rgba(67, 211, 158, 0.5);
	--pane-border-review: rgba(243, 107, 138, 0.5);

	--font-ui: "SF Mono", "SFMono-Regular", ui-monospace, Menlo, Monaco,
		monospace;
	--font-terminal: "AI14All Terminal Powerline",
		"Meslo LG M DZ for Powerline", "Meslo LG M for Powerline",
		"Meslo LG M DZ Regular for Powerline", "Hack", ui-monospace, Menlo,
		Monaco, monospace;

	font-family: var(--font-ui);
	font-size: 13px;
	color: var(--foreground);
	background: var(--background);
}

/* ── Theme: Light ─────────────────────────────────────────────── */
[data-theme="light"] {
	--background: #f0f2f5;
	--foreground: #1e2530;
	--card: #ffffff;
	--card-foreground: #1e2530;
	--popover: #f5f7f9;
	--popover-foreground: #1e2530;
	--primary: #1a7fc1;
	--primary-foreground: #ffffff;
	--secondary: #f5f7f9;
	--secondary-foreground: #4a5a70;
	--muted: #f5f7f9;
	--muted-foreground: #7a8a9a;
	--accent: #ddeeff;
	--accent-foreground: #1a7fc1;
	--destructive: #c0404a;
	--border: #d0d7e0;
	--input: #d0d7e0;
	--ring: #1a7fc1;

	--panel-border-strong: #a8b8cc;
	--warning: #b07800;
	--sha: #6d4cbc;
	--provider-claude: #b45309;
	--provider-codex: #1d4ed8;
	--pane-border-sessions: rgba(30, 120, 220, 0.4);
	--pane-border-session-info: rgba(180, 120, 30, 0.4);
	--pane-border-terminal: rgba(30, 160, 100, 0.4);
	--pane-border-review: rgba(200, 60, 80, 0.4);

	color: var(--foreground);
	background: var(--background);
}

/* ── Theme: Warm ──────────────────────────────────────────────── */
[data-theme="warm"] {
	--background: #221c15;
	--foreground: #f6efe4;
	--card: #2a231b;
	--card-foreground: #f6efe4;
	--popover: #342c22;
	--popover-foreground: #f6efe4;
	--primary: #e58a5e;
	--primary-foreground: #221c15;
	--secondary: #342c22;
	--secondary-foreground: #cab999;
	--muted: #342c22;
	--muted-foreground: #9a8366;
	--accent: #3d2817;
	--accent-foreground: #e58a5e;
	--destructive: #d97058;
	--border: #4a3f31;
	--input: #4a3f31;
	--ring: #e58a5e;

	--panel-border-strong: #6d5b46;
	--warning: #dda85e;
	--sha: #c4a0db;
	--provider-claude: #e58a5e;
	--provider-codex: #5a9bd6;
	--pane-border-sessions: rgba(108, 188, 184, 0.6);
	--pane-border-session-info: rgba(228, 158, 80, 0.6);
	--pane-border-terminal: rgba(226, 140, 96, 0.6);
	--pane-border-review: rgba(220, 122, 110, 0.6);

	color: var(--foreground);
	background: var(--background);
}

/* ── Global resets ────────────────────────────────────────────── */
* {
	box-sizing: border-box;
}

body {
	margin: 0;
	background: radial-gradient(circle at top, #10181f 0%, var(--background) 55%);
	color: var(--foreground);
	font-size: 13px;
}

[data-theme="light"] body {
	background: radial-gradient(
		circle at top,
		#e8edf4 0%,
		var(--background) 55%
	);
}

[data-theme="warm"] body {
	background: radial-gradient(
		circle at top,
		#2c2318 0%,
		var(--background) 60%
	);
}

button,
input,
textarea,
select {
	font: inherit;
	font-size: 13px;
}

/* ── sr-only utility ──────────────────────────────────────────── */
.sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border-width: 0;
}

/* ── Keyframe animations (sidebar attention system) ───────────── */
/* Copy ALL @property declarations and @keyframes from shell.css  */
/* Search shell.css for: @property, @keyframes, and the           */
/* prefers-reduced-motion block. Paste them here verbatim.         */

/* ── xterm overrides ──────────────────────────────────────────── */
/* Copy ALL .xterm* selectors from shell.css verbatim.             */

/* ── Monaco overrides ─────────────────────────────────────────── */
/* Copy any Monaco-specific CSS from shell.css if present.         */
```

**IMPORTANT:** The comment blocks at the bottom ("Copy ALL @property...", "Copy ALL .xterm*...") are instructions, not placeholders. When implementing this step, you MUST:
1. Read `src/app/shell.css` fully
2. Find every `@property` declaration (there are 2: `--attention-angle`, `--attention-opacity`)
3. Find every `@keyframes` block (there are 6: `shell-sidebar-attention-rotate`, `shell-sidebar-attention-pulse`, `shell-sidebar-attention-shimmer`, `shell-sidebar-action-ring`, `shell-sidebar-action-glow`, `shell-sidebar-process-dot-pulse`)
4. Find the `@media (prefers-reduced-motion: reduce)` block
5. Find all `.xterm*` selectors
6. Find all selectors that reference Monaco-specific classes
7. Also find any selectors for classes that are set programmatically in `.ts` logic files (see: `shell-review-selection-pill`, `shell-review-plus-decoration`, `shell-inline-thread-host`) — these must remain as global CSS since they're applied by imperative code, not React components
8. Copy all of the above into `src/index.css`, replacing the comment blocks

- [ ] **Step 2: Update src/main.tsx CSS import**

Change `import "./app/shell.css";` to `import "./index.css";`

```ts
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.js";
import { installKnownRendererErrorHandler } from "./app/logic/known-renderer-errors.js";
import "./index.css";
```

- [ ] **Step 3: Verify build with both CSS systems**

At this point `shell.css` is no longer imported, so only `index.css` provides styles. Run:

```bash
pnpm build
```

Expected: Build succeeds. The app will look broken visually (shell-* classes now have no CSS definitions), but it compiles. This is expected for the big-bang approach.

- [ ] **Step 4: Commit**

```bash
git add src/index.css src/main.tsx
git commit -m "feat: add index.css with tailwind + theme variables, switch CSS entry"
```

---

## Task 3: Rewrite AppDialog to use shadcn Dialog

**Files:**
- Modify: `src/components/AppDialog.tsx`

- [ ] **Step 1: Read the shadcn Dialog component**

Read `src/components/ui/dialog.tsx` to understand shadcn's Dialog API (DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose).

- [ ] **Step 2: Rewrite AppDialog.tsx**

```tsx
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogDescription,
	DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Children, isValidElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type AppDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	size?: "default" | "wide";
	children: ReactNode;
};

export function Title({ children }: { children: ReactNode }) {
	return <DialogTitle className="text-base font-semibold">{children}</DialogTitle>;
}
Title.displayName = "AppDialog.Title";

export function Description({ children }: { children: ReactNode }) {
	return (
		<DialogDescription className="text-sm text-muted-foreground mt-1">
			{children}
		</DialogDescription>
	);
}
Description.displayName = "AppDialog.Description";

export function Body({ children }: { children: ReactNode }) {
	return <div className="mt-3 space-y-3">{children}</div>;
}
Body.displayName = "AppDialog.Body";

export function Footer({ children }: { children: ReactNode }) {
	return (
		<div className="mt-4 flex justify-end gap-2">{children}</div>
	);
}
Footer.displayName = "AppDialog.Footer";

function hasDescriptionChild(children: ReactNode): boolean {
	return Children.toArray(children).some(
		(child) => isValidElement(child) && child.type === Description,
	);
}

export function AppDialog({
	open,
	onOpenChange,
	size = "default",
	children,
}: AppDialogProps) {
	const contentProps = hasDescriptionChild(children)
		? {}
		: { "aria-describedby": undefined };
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className={cn(
					"p-5",
					size === "wide"
						? "max-w-[min(640px,calc(100vw-32px))]"
						: "max-w-[min(460px,calc(100vw-32px))]",
				)}
				{...contentProps}
			>
				{children}
			</DialogContent>
		</Dialog>
	);
}

AppDialog.Title = Title;
AppDialog.Description = Description;
AppDialog.Body = Body;
AppDialog.Footer = Footer;
```

Note: shadcn's DialogContent already renders an overlay and close button. If the existing close button styling or "×" glyph needs to match exactly, customize the DialogContent's close button via the shadcn component source.

- [ ] **Step 3: Update all imports across the codebase**

Search for all files that import from `AppDialog` and verify imports still work. The compound component pattern (`AppDialog.Title`, etc.) is preserved, so consumers should work unchanged. However, check whether any consumer imports `Title`, `Description`, `Body`, or `Footer` as named exports — if so, those imports still work.

- [ ] **Step 4: Verify build**

```bash
pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/AppDialog.tsx
git commit -m "refactor: rewrite AppDialog to shadcn Dialog"
```

---

## Task 4: Rewrite ToggleSwitch to use shadcn Switch

**Files:**
- Modify: `src/ui/ToggleSwitch.tsx`

- [ ] **Step 1: Rewrite ToggleSwitch.tsx**

```tsx
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

type Props = {
	checked: boolean;
	onChange: () => void;
	label: string;
	ariaLabel?: string;
	id?: string;
};

export function ToggleSwitch({
	checked,
	onChange,
	label,
	ariaLabel,
	id,
}: Props): React.ReactElement {
	return (
		<div className="flex items-center gap-2">
			<Label htmlFor={id} className="text-xs text-muted-foreground uppercase tracking-wider cursor-pointer">
				{label}
			</Label>
			<Switch
				id={id}
				checked={checked}
				onCheckedChange={() => onChange()}
				aria-label={ariaLabel ?? label}
			/>
		</div>
	);
}
```

- [ ] **Step 2: Verify build**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/ToggleSwitch.tsx
git commit -m "refactor: rewrite ToggleSwitch to shadcn Switch"
```

---

## Task 5: Rewrite ToastProvider to use Sonner

**Files:**
- Modify: `src/features/ui/toast/ToastProvider.tsx`
- Modify: `src/features/ui/toast/use-toast.ts` (if it exists)

- [ ] **Step 1: Install sonner**

```bash
pnpm add sonner
```

- [ ] **Step 2: Read the shadcn Sonner component**

Read `src/components/ui/sonner.tsx` to understand the wrapper.

- [ ] **Step 3: Rewrite ToastProvider.tsx**

```tsx
import { Toaster, toast } from "sonner";

// Imperative bridge: code outside the provider can call notifyToast().
export function notifyToast(message: string): void {
	toast(message);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
	return (
		<>
			{children}
			<Toaster
				position="bottom-right"
				toastOptions={{
					className:
						"bg-popover text-popover-foreground border border-border shadow-md font-[var(--font-ui)] text-[13px]",
				}}
			/>
		</>
	);
}

export function useToastContext() {
	return {
		show: (message: string) => toast(message),
		dismiss: (id: string) => toast.dismiss(id),
	};
}
```

- [ ] **Step 4: Update use-toast.ts**

Read `src/features/ui/toast/use-toast.ts` and update it to re-export from the new ToastProvider, or if it simply re-exports `useToastContext`, verify it still works.

- [ ] **Step 5: Verify build**

```bash
pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add src/features/ui/toast/ToastProvider.tsx src/features/ui/toast/use-toast.ts
git commit -m "refactor: rewrite toast system to use Sonner"
```

---

## Task 6: Rewrite NoteSheet to use shadcn Sheet

**Files:**
- Modify: `src/features/workspace/components/NoteSheet.tsx`

- [ ] **Step 1: Read the shadcn Sheet component**

Read `src/components/ui/sheet.tsx` to understand the Sheet API.

- [ ] **Step 2: Rewrite NoteSheet.tsx**

```tsx
import { useState } from "react";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

type Props = {
	open: boolean;
	note: string;
	onNoteChange: (note: string) => void;
	onClose: () => void;
};

export function NoteSheet({ open, note, onNoteChange, onClose }: Props) {
	const [mode, setMode] = useState<"edit" | "preview">("edit");

	return (
		<Sheet
			open={open}
			onOpenChange={(v) => {
				if (!v) onClose();
			}}
		>
			<SheetContent
				side="right"
				className="w-[clamp(280px,28vw,420px)] flex flex-col"
				aria-describedby={undefined}
			>
				<SheetHeader className="flex flex-row items-center justify-between gap-2">
					<SheetTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
						Session note
					</SheetTitle>
					<div className="flex items-center gap-1">
						<div
							className="flex rounded border border-border"
							role="group"
							aria-label="Session note mode"
						>
							<Button
								variant={mode === "edit" ? "secondary" : "ghost"}
								size="sm"
								className="h-6 rounded-none rounded-l text-xs"
								onClick={() => setMode("edit")}
							>
								Edit
							</Button>
							<Button
								variant={mode === "preview" ? "secondary" : "ghost"}
								size="sm"
								className="h-6 rounded-none rounded-r text-xs"
								onClick={() => setMode("preview")}
							>
								Preview
							</Button>
						</div>
					</div>
				</SheetHeader>
				{mode === "edit" ? (
					<Textarea
						aria-label="Session note"
						className="flex-1 resize-none mt-3 bg-card border-border font-[var(--font-ui)] text-[13px]"
						value={note}
						onChange={(e) => onNoteChange(e.target.value)}
						placeholder="Write a note for this session…"
						autoFocus
					/>
				) : (
					<div
						className="flex-1 overflow-auto mt-3 prose prose-invert prose-sm max-w-none"
						role="region"
						aria-label="Session note preview"
					>
						<ReactMarkdown
							remarkPlugins={[remarkGfm]}
							rehypePlugins={[rehypeHighlight]}
						>
							{note}
						</ReactMarkdown>
					</div>
				)}
			</SheetContent>
		</Sheet>
	);
}
```

- [ ] **Step 3: Verify build**

```bash
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add src/features/workspace/components/NoteSheet.tsx
git commit -m "refactor: rewrite NoteSheet to shadcn Sheet"
```

---

## Task 7: Convert TerminalActions to shadcn DropdownMenu

**Files:**
- Modify: `src/features/terminals/components/TerminalActions.tsx`

- [ ] **Step 1: Read the shadcn DropdownMenu component**

Read `src/components/ui/dropdown-menu.tsx`.

- [ ] **Step 2: Rewrite TerminalActions.tsx**

```tsx
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { CommandPreset } from "../../../../shared/models/command-preset";

type Props = {
	presets: CommandPreset[];
	addDisabled: boolean;
	onAddAdHoc: () => void;
	onLaunchPreset: (presetId: string) => void;
	onOpenPresetManager: () => void;
	onOpenLayoutDialog: () => void;
};

export function TerminalActions({
	presets,
	addDisabled,
	onAddAdHoc,
	onLaunchPreset,
	onOpenPresetManager,
	onOpenLayoutDialog,
}: Props) {
	return (
		<div className="flex items-center gap-1">
			<Button
				variant="ghost"
				size="sm"
				className="h-7 text-xs gap-1"
				data-testid="terminal-add-shell"
				aria-label="Add shell"
				disabled={addDisabled}
				onClick={onAddAdHoc}
			>
				<span aria-hidden="true">＋</span>
				Shell
			</Button>
			<Button
				variant="ghost"
				size="sm"
				className="h-7 text-xs gap-1"
				data-testid="terminal-layout-button"
				aria-label="Choose layout"
				title="Choose layout (⌘⇧L)"
				onClick={onOpenLayoutDialog}
			>
				<span aria-hidden="true">▦</span>
				Layout
			</Button>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
						<span aria-hidden="true">⚙</span>
						Presets
						<span aria-hidden="true">▾</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent className="bg-popover border-border">
					{presets.length === 0 ? (
						<DropdownMenuItem disabled className="text-xs text-muted-foreground">
							No presets yet
						</DropdownMenuItem>
					) : (
						presets.map((preset) => (
							<DropdownMenuItem
								key={preset.id}
								className="text-xs"
								onSelect={() => onLaunchPreset(preset.id)}
							>
								{preset.label}
							</DropdownMenuItem>
						))
					)}
					<DropdownMenuSeparator />
					<DropdownMenuItem
						className="text-xs"
						onSelect={onOpenPresetManager}
					>
						Manage presets
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
```

- [ ] **Step 3: Verify build**

```bash
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add src/features/terminals/components/TerminalActions.tsx
git commit -m "refactor: rewrite TerminalActions to shadcn DropdownMenu"
```

---

## Task 8: Convert remaining dialog components to shadcn

**Files:**
- Modify: `src/features/terminals/components/TerminalLayoutDialog.tsx`
- Modify: `src/features/viewer/components/MarkdownPreviewModal.tsx`
- Modify: `src/features/shortcuts/ShortcutsHelp.tsx`
- Modify: `src/features/files/FilesOverlay.tsx`

- [ ] **Step 1: Read each file**

Read all four files to understand their current Radix Dialog usage patterns.

- [ ] **Step 2: Convert TerminalLayoutDialog.tsx**

Replace `import * as Dialog from "@radix-ui/react-dialog"` with shadcn imports:
```tsx
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
```

Replace `Dialog.Root` → `Dialog`, `Dialog.Portal` + `Dialog.Overlay` + `Dialog.Content` → `DialogContent`, `Dialog.Title` → `DialogTitle`. Convert all `shell-layout-dialog*` classes to Tailwind utilities matching the existing visual layout (grid, tiles, cells).

- [ ] **Step 3: Convert MarkdownPreviewModal.tsx**

Replace Radix Dialog with shadcn Dialog. Convert `shell-md-modal*` classes to Tailwind. Key layout: fixed center, `w-[min(80vw,1200px)]`, scrollable body with prose styling for markdown.

- [ ] **Step 4: Convert ShortcutsHelp.tsx**

Replace Radix Dialog with shadcn Dialog. Convert `shell-shortcuts-help*` classes to Tailwind. Key layout: `max-w-[800px]`, two-column masonry via `columns-2`, `break-inside-avoid` for groups.

- [ ] **Step 5: Convert FilesOverlay.tsx**

Replace Radix Dialog with shadcn Dialog. Convert `shell-files-overlay*` classes to Tailwind. Keep the virtualizer integration and keyboard navigation unchanged — only swap the Dialog wrapper and CSS classes.

- [ ] **Step 6: Verify build**

```bash
pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add src/features/terminals/components/TerminalLayoutDialog.tsx \
       src/features/viewer/components/MarkdownPreviewModal.tsx \
       src/features/shortcuts/ShortcutsHelp.tsx \
       src/features/files/FilesOverlay.tsx
git commit -m "refactor: convert remaining dialogs to shadcn Dialog"
```

---

## Task 9: Convert ContextMenu consumers to shadcn

**Files:**
- Modify: `src/features/workspace/components/SessionSidebar.tsx`
- Modify: `src/features/viewer/components/WorktreeTree.tsx`
- Modify: `src/features/git/components/ChangesList.tsx`
- Modify: `src/features/git/components/CommitList.tsx`

- [ ] **Step 1: Read shadcn ContextMenu component**

Read `src/components/ui/context-menu.tsx`.

- [ ] **Step 2: Convert SessionSidebar.tsx**

Replace `import * as ContextMenu from "@radix-ui/react-context-menu"` with:
```tsx
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
```

Replace `ContextMenu.Root` → `ContextMenu`, `ContextMenu.Trigger` → `ContextMenuTrigger`, `ContextMenu.Portal` + `ContextMenu.Content` → `ContextMenuContent`, `ContextMenu.Item` → `ContextMenuItem`, `ContextMenu.Separator` → `ContextMenuSeparator`.

Also convert all `shell-sidebar*` CSS classes in this file to Tailwind utilities. This is the largest sidebar file (~472 lines) with many visual states (`data-selected`, `data-attention`, collapsed state). Preserve all data attributes and animation class references (the keyframe animations live in `index.css`).

- [ ] **Step 3: Convert WorktreeTree.tsx**

Same ContextMenu swap pattern. Convert `shell-list__item`, `shell-list__item--tree`, `shell-list__item--dir`, `shell-list__item--ignored` to Tailwind.

- [ ] **Step 4: Convert ChangesList.tsx**

Same ContextMenu swap pattern. Convert `shell-list*`, `shell-toolbar-menu*`, and `shell-review-comment-badge` classes to Tailwind.

- [ ] **Step 5: Convert CommitList.tsx**

Same ContextMenu swap pattern. Convert `shell-commit-list*`, `shell-commit-push-strip*` classes to Tailwind. The commit timeline uses `before:` pseudo-element for the vertical line — use Tailwind's `before:content-[''] before:absolute before:left-2 before:top-0 before:bottom-0 before:w-px before:bg-border` pattern.

- [ ] **Step 6: Verify build**

```bash
pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add src/features/workspace/components/SessionSidebar.tsx \
       src/features/viewer/components/WorktreeTree.tsx \
       src/features/git/components/ChangesList.tsx \
       src/features/git/components/CommitList.tsx
git commit -m "refactor: convert context menus to shadcn ContextMenu"
```

---

## Task 10: Convert ReviewArea to shadcn ScrollArea + Tabs

**Files:**
- Modify: `src/app/components/ReviewArea.tsx`

- [ ] **Step 1: Read the current ReviewArea.tsx fully**

This is 871 lines and the most complex component. Read it in chunks to understand the full ScrollArea and Tabs usage.

- [ ] **Step 2: Replace Radix imports with shadcn**

Replace:
```tsx
import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Tabs from "@radix-ui/react-tabs";
```
With:
```tsx
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
```

- [ ] **Step 3: Convert ScrollArea usage**

Replace `ScrollArea.Root` → `ScrollArea`, `ScrollArea.Viewport` → remove (shadcn handles internally), `ScrollArea.Scrollbar` → `ScrollBar`.

- [ ] **Step 4: Convert Tabs usage**

Replace `Tabs.Root` → `Tabs`, `Tabs.List` → `TabsList`, `Tabs.Trigger` → `TabsTrigger`. The existing 3-column grid segment control maps to TabsList with TabsTrigger children.

- [ ] **Step 5: Convert all shell-* classes to Tailwind**

Convert `shell-review-shell`, `shell-review-grid`, `shell-review-rail`, `shell-review-tabs__segments`, `shell-review-tab`, `shell-panel`, `shell-viewer-panel`, `shell-empty-state`, `shell-error`, `shell-inline-warning`, and the resize handle classes to Tailwind utilities.

The review grid resize handle uses `::before` pseudo-element — use Tailwind's `before:` variant.

- [ ] **Step 6: Verify build**

```bash
pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add src/app/components/ReviewArea.tsx
git commit -m "refactor: convert ReviewArea to shadcn ScrollArea + Tabs"
```

---

## Task 11: Convert all Button consumers to shadcn Button

**Files (all use `.shell-button` classes):**
- Modify: `src/features/repository/RepositoryInput.tsx`
- Modify: `src/features/repository/RestorePrompt.tsx`
- Modify: `src/features/terminals/components/PresetManager.tsx`
- Modify: `src/features/terminals/components/TerminalPane.tsx`
- Modify: `src/features/workspace/components/NewWorktreeDialog.tsx`
- Modify: `src/features/workspace/components/RemoveWorktreeDialog.tsx`
- Modify: `src/features/workspace/components/LoadWorkspaceDialog.tsx`
- Modify: `src/features/viewer/components/ConfirmCloseDialog.tsx`
- Modify: `src/features/viewer/components/SaveConflictDialog.tsx`
- Modify: `src/features/viewer/components/EditorDirtyBar.tsx`
- Modify: `src/features/git/components/DiscardChangeDialog.tsx`
- Modify: `src/features/git/components/ForcePushDialog.tsx`
- Modify: `src/features/review/components/AgentInstallCta.tsx`
- Modify: `src/features/review/components/AgentInstallModal.tsx`

- [ ] **Step 1: Establish the Button variant mapping**

| Old class | shadcn equivalent |
|---|---|
| `shell-button` | `<Button variant="outline">` |
| `shell-button shell-button--primary` | `<Button variant="default">` |
| `shell-button shell-button--danger` | `<Button variant="destructive">` |
| `shell-button shell-button--compact` | `<Button variant="outline" size="sm">` |
| `shell-button shell-button--xs` | `<Button variant="outline" size="sm" className="h-[22px] text-[0.7rem]">` |
| `shell-button shell-button--icon` | `<Button variant="outline" size="icon">` |
| `shell-button shell-button--round` | `<Button variant="outline" className="rounded-full">` |

- [ ] **Step 2: Convert each file**

For each file listed above:
1. Add `import { Button } from "@/components/ui/button";`
2. Replace `<button className="shell-button shell-button--primary" ...>` with `<Button variant="default" size="sm" ...>`
3. Replace `<button className="shell-button shell-button--danger" ...>` with `<Button variant="destructive" size="sm" ...>`
4. Replace `<button className="shell-button shell-button--compact" ...>` with `<Button variant="outline" size="sm" ...>`
5. Replace `<button className="shell-button" ...>` with `<Button variant="outline" ...>`
6. Also convert any `shell-input` in these files to `import { Input } from "@/components/ui/input"` and replace `<input className="shell-input" ...>` with `<Input ...>`
7. Also convert any `shell-label` to `import { Label } from "@/components/ui/label"` and use `<Label>`
8. Convert any remaining `shell-*` classes in each file to Tailwind utilities

- [ ] **Step 3: Verify build**

```bash
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add src/features/repository/RepositoryInput.tsx \
       src/features/repository/RestorePrompt.tsx \
       src/features/terminals/components/PresetManager.tsx \
       src/features/terminals/components/TerminalPane.tsx \
       src/features/workspace/components/NewWorktreeDialog.tsx \
       src/features/workspace/components/RemoveWorktreeDialog.tsx \
       src/features/workspace/components/LoadWorkspaceDialog.tsx \
       src/features/viewer/components/ConfirmCloseDialog.tsx \
       src/features/viewer/components/SaveConflictDialog.tsx \
       src/features/viewer/components/EditorDirtyBar.tsx \
       src/features/git/components/DiscardChangeDialog.tsx \
       src/features/git/components/ForcePushDialog.tsx \
       src/features/review/components/AgentInstallCta.tsx \
       src/features/review/components/AgentInstallModal.tsx
git commit -m "refactor: convert all button/input consumers to shadcn"
```

---

## Task 12: Convert review system components to Tailwind

**Files:**
- Modify: `src/features/review/components/ReviewExpandedPortal.tsx`
- Modify: `src/features/review/components/ReviewQueuePanel.tsx`
- Modify: `src/features/review/components/ReviewCommentForm.tsx`
- Modify: `src/features/review/components/ReviewBarButton.tsx`
- Modify: `src/features/review/components/InlineCommentThread.tsx`
- Modify: `src/features/review/components/InlineDraftThread.tsx`
- Modify: `src/features/review/components/InlineMountsBridge.tsx`
- Modify: `src/app/components/ReviewChipBar.tsx`

- [ ] **Step 1: Read each file**

Read all 8 files to understand their shell-* class usage.

- [ ] **Step 2: Convert each file's CSS classes to Tailwind**

For each file, replace every `shell-*` className with equivalent Tailwind utilities. Key mappings:

- `shell-review-chipbar` → `flex items-center h-9 px-3 border-t border-[var(--pane-border-review)]`
- `shell-review-chipbar__label` → `text-[10px] uppercase tracking-wider text-muted-foreground`
- `shell-review-queue` → `grid grid-rows-[auto_minmax(0,1fr)]`
- `shell-review-queue__header` → `flex items-center justify-between px-3 py-2 border-b border-border`
- `shell-inline-thread` → `border-l-2 border-[var(--pane-border-review)] bg-card p-3`
- `shell-inline-thread__header` → `flex items-center gap-2 text-xs text-muted-foreground`
- `shell-inline-thread__textarea` → use shadcn `Textarea` component
- `shell-review-comment-form` → `flex flex-col gap-2`
- `shell-review-expanded-portal` → `fixed inset-x-0 bottom-0 z-[49] flex flex-col bg-background border-t border-[var(--pane-border-review)]`

Use `import { Button } from "@/components/ui/button"` for any action buttons, `import { Textarea } from "@/components/ui/textarea"` for text areas.

- [ ] **Step 3: Verify build**

```bash
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add src/features/review/components/*.tsx src/app/components/ReviewChipBar.tsx
git commit -m "refactor: convert review system components to Tailwind"
```

---

## Task 13: Convert git components to Tailwind + shadcn Collapsible

**Files:**
- Modify: `src/features/git/components/CommitDiffStack.tsx`

- [ ] **Step 1: Read shadcn Collapsible component**

Read `src/components/ui/collapsible.tsx`.

- [ ] **Step 2: Convert CommitDiffStack.tsx**

Replace `shell-commit-diff-section` expandable sections with shadcn `Collapsible`:
```tsx
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
```

Each diff section's header becomes a `CollapsibleTrigger` and the body becomes `CollapsibleContent`. Convert all `shell-commit-diff*`, `shell-viewer*`, `shell-empty-state`, `shell-error` classes to Tailwind.

- [ ] **Step 3: Verify build**

```bash
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add src/features/git/components/CommitDiffStack.tsx
git commit -m "refactor: convert CommitDiffStack to shadcn Collapsible"
```

---

## Task 14: Convert layout components to Tailwind

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/components/SidebarPanel.tsx`
- Modify: `src/app/components/TerminalPanel.tsx`
- Modify: `src/app/components/MainColumnChrome.tsx`
- Modify: `src/app/components/RestoreBanner.tsx`
- Modify: `src/app/components/AgentAttentionBanner.tsx`
- Modify: `src/app/components/DialogStack.tsx`

- [ ] **Step 1: Read all layout component files**

Read each file to understand their shell-* class usage.

- [ ] **Step 2: Convert App.tsx**

This is the largest file (1643 lines). Convert all shell-* classes:
- `shell-app` → `h-screen overflow-hidden bg-transparent`
- `shell-app--setup` → `grid place-items-center p-6`
- `shell-layout` → `grid h-screen gap-4 p-4` (the grid-template-columns are dynamic via inline style)
- `shell-main-column` → `flex flex-col gap-4 min-w-0 min-h-0 overflow-hidden`
- `shell-terminal-layer` → existing layout classes
- `shell-terminal-host` → conditional display via data-active
- `shell-panel` → `bg-transparent border border-border rounded`
- `shell-setup-panel` → setup-specific styling
- `shell-empty-state` → `text-sm text-muted-foreground italic`
- `shell-error` → `text-sm text-destructive`

- [ ] **Step 3: Convert SidebarPanel.tsx**

- `shell-sidebar-column` → `relative flex min-h-0`
- `shell-sidebar-column__resize-handle` → `absolute top-0 -right-2 w-4 h-full cursor-col-resize z-10` with `before:content-[''] before:absolute before:top-0 before:bottom-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors hover:before:bg-primary`

- [ ] **Step 4: Convert TerminalPanel.tsx**

- `shell-terminal-section` → `grid grid-rows-[minmax(0,1fr)] flex-1 overflow-hidden`
- `shell-terminal-panel__grid` → `grid gap-x-1` (columns set dynamically)
- `shell-terminal-slot` → `flex flex-col min-h-0 min-w-0`
- `shell-terminal-slot__header` → `flex items-center gap-1 px-1 py-0.5 text-[11px]`
- `shell-terminal-slot__badge` → data-attention driven badge with Tailwind

- [ ] **Step 5: Convert MainColumnChrome.tsx, RestoreBanner.tsx, AgentAttentionBanner.tsx, DialogStack.tsx**

Convert all shell-* classes to Tailwind equivalents. These are smaller files (26-121 lines each).

- [ ] **Step 6: Verify build**

```bash
pnpm build
```

- [ ] **Step 7: Commit**

```bash
git add src/app/App.tsx \
       src/app/components/SidebarPanel.tsx \
       src/app/components/TerminalPanel.tsx \
       src/app/components/MainColumnChrome.tsx \
       src/app/components/RestoreBanner.tsx \
       src/app/components/AgentAttentionBanner.tsx \
       src/app/components/DialogStack.tsx
git commit -m "refactor: convert layout components to Tailwind"
```

---

## Task 15: Convert workspace feature components to Tailwind

**Files:**
- Modify: `src/features/workspace/components/SessionHeader.tsx`
- Modify: `src/features/workspace/components/SessionChipBar.tsx`
- Modify: `src/features/workspace/components/ContextPanel.tsx`

- [ ] **Step 1: Read each file**

- [ ] **Step 2: Convert SessionHeader.tsx**

- `shell-session-info` → `min-w-0 pr-4`
- `shell-session-info__header` → `flex items-center justify-start gap-3`
- `shell-session-info__title` → `text-base mt-1 leading-tight tracking-[0.01em]`
- `shell-session-info__description` → `mt-1.5 text-secondary-foreground text-[13px] leading-snug`
- `shell-session-info__strip` → `flex gap-3 items-center text-secondary-foreground text-[13px] flex-1 min-w-0`
- `shell-session-info__meta` → `flex flex-wrap gap-3 mt-3 text-secondary-foreground text-[13px]`
- `shell-session-info__path` → `block mt-2 text-secondary-foreground whitespace-pre-wrap break-words p-1.5 bg-muted border border-border rounded-sm text-[13px]`
- `shell-session-info__path-group` → `mt-3`

Use `Label` for any label elements.

- [ ] **Step 3: Convert SessionChipBar.tsx**

- `shell-chip-bar` → `flex items-center h-9`
- `shell-chip-bar__identity` → `flex items-center gap-1.5`
- `shell-chip-bar__title` → `font-semibold truncate`
- `shell-chip-bar__actions` → `ml-auto flex items-center gap-1`
- `shell-chip-bar__action` → use shadcn `Button variant="ghost" size="icon" className="h-7 w-7"`
- `shell-chip-bar__dirty-chip` → shadcn `Badge`
- `shell-chip-bar__note-dot` → `w-2 h-2 rounded-full bg-primary`
- `shell-chip-bar__sep` → shadcn `Separator orientation="vertical" className="h-4"`

- [ ] **Step 4: Convert ContextPanel.tsx**

Replace `shell-label` → shadcn `Label`, `shell-input` → shadcn `Input`. Convert `shell-session-note` → `min-w-0 pl-4 border-l border-border`.

- [ ] **Step 5: Verify build**

```bash
pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add src/features/workspace/components/SessionHeader.tsx \
       src/features/workspace/components/SessionChipBar.tsx \
       src/features/workspace/components/ContextPanel.tsx
git commit -m "refactor: convert workspace components to Tailwind"
```

---

## Task 16: Convert viewer components to Tailwind

**Files:**
- Modify: `src/features/viewer/components/InlineEditor.tsx`
- Modify: `src/features/viewer/components/DiffViewer.tsx`

- [ ] **Step 1: Read both files**

- [ ] **Step 2: Convert InlineEditor.tsx (574 lines)**

- `shell-viewer` → `grid grid-rows-[auto_1fr]`
- `shell-viewer__header` → `flex items-center px-3 py-1 border-b border-border text-xs text-muted-foreground`
- `shell-viewer__title` → `text-base`
- `shell-inline-editor` → `flex flex-col h-full`
- `shell-inline-editor__status` → `h-1 w-1 rounded-full` (color via data attribute)
- `shell-inline-editor__readonly-chip` → shadcn `Badge variant="secondary" className="text-[10px]"`
- `shell-inline-editor__preview-btn` → shadcn `Button variant="ghost" size="sm"`
- `shell-empty-state` → `text-sm text-muted-foreground italic`
- `shell-error` → `text-sm text-destructive`

- [ ] **Step 3: Convert DiffViewer.tsx (88 lines)**

Same viewer header pattern. Straightforward class replacements.

- [ ] **Step 4: Verify build**

```bash
pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add src/features/viewer/components/InlineEditor.tsx \
       src/features/viewer/components/DiffViewer.tsx
git commit -m "refactor: convert viewer components to Tailwind"
```

---

## Task 17: Convert remaining feature components to Tailwind

**Files:**
- Modify: `src/features/updater/UpdateBanner.tsx`
- Modify: `src/features/review/logic/inline-comment-widgets.ts`
- Modify: `src/features/review/logic/diff-editor-decorations.ts`
- Modify: `src/features/review/logic/inline-thread-mount.ts`

- [ ] **Step 1: Convert UpdateBanner.tsx**

Read `src/features/updater/UpdateBanner.tsx` and `src/features/updater/UpdateBanner.css`. Convert all CSS to Tailwind utilities inline. The UpdateBanner.css file will be deleted in cleanup.

- [ ] **Step 2: Handle logic files with CSS class references**

These three `.ts` files create DOM elements or CSS class names programmatically:
- `inline-comment-widgets.ts` — uses `shell-review-selection-pill`
- `diff-editor-decorations.ts` — uses `shell-review-plus-decoration`
- `inline-thread-mount.ts` — uses `shell-inline-thread-host`

These classes are applied imperatively to Monaco editor widgets, NOT via React. They **cannot** be converted to Tailwind utility classes because Monaco's API expects CSS class names. The CSS rules for these classes must remain in `src/index.css` as global styles. 

In these `.ts` files, keep the class name strings unchanged. Verify the corresponding CSS rules exist in `src/index.css` (they should have been copied from `shell.css` in Task 2).

- [ ] **Step 3: Verify build**

```bash
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add src/features/updater/UpdateBanner.tsx \
       src/features/review/logic/inline-comment-widgets.ts \
       src/features/review/logic/diff-editor-decorations.ts \
       src/features/review/logic/inline-thread-mount.ts
git commit -m "refactor: convert remaining feature components to Tailwind"
```

---

## Task 18: Cleanup — delete old CSS, remove Radix packages, verify

**Files:**
- Delete: `src/app/shell.css`
- Delete: `src/features/updater/UpdateBanner.css`
- Modify: `package.json` — remove @radix-ui/* packages

- [ ] **Step 1: Delete shell.css and UpdateBanner.css**

```bash
rm src/app/shell.css
rm src/features/updater/UpdateBanner.css
```

- [ ] **Step 2: Remove @radix-ui packages from package.json**

```bash
cd /Users/tringuyen/side-project/ai-14all
pnpm remove @radix-ui/react-context-menu @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-scroll-area @radix-ui/react-separator @radix-ui/react-tabs @radix-ui/react-tooltip
```

- [ ] **Step 3: Verify no remaining shell-* class references**

```bash
grep -r "shell-" src/ --include="*.tsx" --include="*.ts" -l
```

Expected: Only the three logic files that use imperative CSS class names (`inline-comment-widgets.ts`, `diff-editor-decorations.ts`, `inline-thread-mount.ts`) should appear, and their referenced classes must exist in `src/index.css`.

- [ ] **Step 4: Verify no remaining @radix-ui imports**

```bash
grep -r "@radix-ui" src/ --include="*.tsx" --include="*.ts" -l
```

Expected: No results. All Radix usage now goes through shadcn wrappers.

- [ ] **Step 5: Run full verification**

```bash
pnpm typecheck && pnpm lint:fix && pnpm build
```

Fix any type errors, lint issues, or build failures.

- [ ] **Step 6: Run tests**

```bash
pnpm test
```

Fix any test failures caused by changed class names or imports.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: delete shell.css, remove @radix-ui packages"
```

---

## Task 19: Visual QA and final fixes

- [ ] **Step 1: Start dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Visual QA checklist**

Test each area of the app:
- [ ] Sidebar: workspace list, collapsed/expanded state, attention indicators, rename, context menus
- [ ] Top band: session info, collapse toggle
- [ ] Chip bar: title, dirty indicator, note dot, action buttons, terminal actions dropdown
- [ ] Terminal panel: slot grid, slot headers, badges, find box, empty slot CTA
- [ ] Review area: tabs (Changes/Commits/Files), scroll area, file list, commit list with timeline, diff viewer, inline editor
- [ ] Review system: comment cards, inline threads, draft threads, review queue panel, expanded portal, chip bar
- [ ] Dialogs: new worktree, remove worktree, load workspace, confirm close, save conflict, discard change, force push, agent install modal, preset manager
- [ ] Sheet: note sheet (edit + preview modes)
- [ ] Files overlay (Cmd+P): search, selection, keyboard navigation, gitignored toggle
- [ ] Shortcuts help dialog
- [ ] Markdown preview modal
- [ ] Terminal layout dialog
- [ ] Toast notifications
- [ ] Usage/telemetry popover
- [ ] Theme switching: dark → light → warm → dark
- [ ] Reduced motion: verify animations disabled when OS preference is set

- [ ] **Step 3: Fix visual regressions**

For each regression found, compare with the shell.css source to identify the missing Tailwind classes. Fix inline.

- [ ] **Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix: visual QA fixes across themes"
```
