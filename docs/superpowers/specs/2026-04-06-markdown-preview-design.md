# Markdown Preview — Design Spec

**Date:** 2026-04-06
**Branch:** `enhance/resizeable-area`
**Status:** Approved — updated 2026-04-07 (scroll fix + viewer panel preview)

## Overview

Add a right-click context menu to `.md` files in the file list that opens a centered modal overlay rendering the file as full-featured GitHub-Flavored Markdown with syntax-highlighted code blocks.

**Amendment (2026-04-07):** Two follow-up items based on testing:
1. **Scroll fix** — long markdown content in the modal did not scroll due to a CSS flex layout issue.
2. **Viewer panel preview** — right-clicking the viewer panel header (where Monaco displays the current file) also offers "Preview" for `.md` files, using the same modal.

## Trigger & Interaction

**File list (FileList):**
- Right-clicking a `.md` file node in `FileList` opens a Radix `ContextMenu` with a single "Preview" item.
- Non-`.md` files are unaffected — no context menu is added for them.
- Clicking "Preview" opens the markdown preview modal.
- The modal is dismissed by: ESC key, clicking the backdrop, or clicking the close button in the modal header.

**Viewer panel (FileViewer):**
- Right-clicking anywhere on the `shell-viewer__header` area opens a Radix `ContextMenu` with a "Preview" item, but only when the currently-displayed file is a `.md` file.
- For non-`.md` files, no context menu is shown in the header.
- Note: Monaco editor captures pointer events internally — the context menu trigger covers the viewer header only, not the Monaco editor canvas. This is expected behaviour.

## Components

### `MarkdownPreviewModal.tsx` — scroll fix

The modal's scrollable region uses `@radix-ui/react-scroll-area`. Inside a flex column layout, the `ScrollArea.Root` must have `min-height: 0` to shrink below its natural content height and enable overflow scrolling. The fix is:
- Add `min-height: 0` to `.shell-md-modal__scroll` in `shell.css`.
- Ensure `.shell-md-modal__body` (the `ScrollArea.Viewport`) has `height: 100%`.

### `FileList.tsx` (modified)

- `TreeNode` gains an `onPreview?: (path: string) => void` prop.
- For `.md` files, the existing `<button>` is wrapped in `@radix-ui/react-context-menu` (`Root`, `Trigger`, `Portal`, `Content`, `Item`).
- `FileList` holds `previewPath: string | null` state. "Preview" item calls `onPreview(node.path)`, which sets `previewPath`. Closing the modal resets it to `null`.

### `MarkdownPreviewModal.tsx` (new — `src/features/viewer/`)

Props:
```ts
interface Props {
  worktreePath: string;
  relativePath: string;
  open: boolean;
  onClose: () => void;
}
```

- Wraps content in `@radix-ui/react-dialog` (`Root`, `Overlay`, `Content`).
- Modal header: filename (`relativePath`) on the left, close button (`✕`) on the right.
- On open: calls `files.read(worktreePath, relativePath)` to fetch content.
- Loading state: shown while fetch is in progress.
- Error state: inline error message + Retry button (re-triggers `files.read`).
- Success state: renders content via `react-markdown` with `remark-gfm` and `rehype-highlight`.
- Modal body is scrollable for long documents.

### `FileViewer.tsx` (new context menu)

- Wrap the `shell-viewer__header` div in `@radix-ui/react-context-menu` (`Root`, `Trigger`, `Portal`, `Content`, `Item`).
- Show the "Preview" `ContextMenu.Item` only when `relativePath.endsWith('.md')`.
- `FileViewer` manages `previewOpen: boolean` state locally. "Preview" sets it to `true`; `onClose` resets it to `false`.
- Renders `<MarkdownPreviewModal>` when `previewOpen` is true, using the existing `worktreePath` and `relativePath` props.

## Data Flow

**File list path:**
1. User right-clicks `.md` file in FileList → Radix `ContextMenu` opens.
2. User clicks "Preview" → `onPreview(node.path)` → `FileList` sets `previewPath = node.path`.
3. `MarkdownPreviewModal` mounts with `open=true` → fetches file via `files.read(worktreePath, relativePath)`.
4. Content renders via `react-markdown`. Loading and error states shown as appropriate.
5. User dismisses modal → `onClose` → `FileList` sets `previewPath = null`.

**Viewer panel path:**
1. User right-clicks the viewer header → Radix `ContextMenu` opens (only for `.md` files).
2. User clicks "Preview" → `FileViewer` sets `previewOpen = true`.
3. `MarkdownPreviewModal` mounts, fetches, and renders the same file already loaded in the viewer.
4. User dismisses modal → `onClose` → `FileViewer` sets `previewOpen = false`.

File content is fetched fresh on each modal open. No caching in V1.

## Markdown Rendering

**New dependencies:**
- `react-markdown` — core renderer
- `remark-gfm` — GitHub-Flavored Markdown (tables, task lists, strikethrough, autolinks)
- `rehype-highlight` — syntax highlighting in fenced code blocks

**Rendered features:** headings, bold/italic, inline code, fenced code blocks with language-aware syntax highlighting, tables, task lists, strikethrough, blockquotes, links.

## Error Handling

| Scenario | Behaviour |
|---|---|
| `files.read` fails | Inline error message + Retry button inside the modal |
| Empty file | Renders normally (`react-markdown` handles empty string) |
| Very large file | Modal is scrollable (after scroll fix); no size cap in V1 |
| Non-`.md` right-click | No context menu shown |

## Visual Design

- Centered overlay, approximately 80% viewport width.
- Dark backdrop (`rgba(0,0,0,0.6)`).
- Modal body uses `@radix-ui/react-scroll-area` (already installed) for the scrollable content area.
- Styling follows existing `shell-*` CSS conventions.

## Testing

### Unit Tests

**`MarkdownPreviewModal`:**
- Renders headings, bold/italic, inline code, fenced code blocks (with language class), GFM tables, task lists, strikethrough.
- Shows loading state while fetching.
- Shows error message + Retry button on fetch failure; Retry re-fetches.

**`TreeNode` / `FileList`:**
- Context menu is rendered for `.md` files only.
- "Preview" item calls `onPreview` with the correct path.
- Non-`.md` files have no context menu.

**`FileViewer`:**
- Right-clicking the header on a `.md` file shows a "Preview" context menu item.
- Right-clicking the header on a non-`.md` file shows no context menu.
- Clicking "Preview" opens the `MarkdownPreviewModal` (shows loading state).

### E2E Tests

- Right-click a `.md` file in FileList → "Preview" appears in context menu.
- Click "Preview" → modal opens with rendered markdown content.
- ESC key closes the modal.
- Right-click the viewer panel header when a `.md` file is selected → "Preview" context menu appears.
- Click "Preview" → same modal opens.
