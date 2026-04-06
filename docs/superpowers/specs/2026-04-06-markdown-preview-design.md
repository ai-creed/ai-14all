# Markdown Preview — Design Spec

**Date:** 2026-04-06
**Branch:** `enhance/resizeable-area`
**Status:** Approved

## Overview

Add a right-click context menu to `.md` files in the file list that opens a centered modal overlay rendering the file as full-featured GitHub-Flavored Markdown with syntax-highlighted code blocks.

## Trigger & Interaction

- Right-clicking a `.md` file node in `FileList` opens a Radix `ContextMenu` with a single "Preview" item.
- Non-`.md` files are unaffected — no context menu is added for them.
- Clicking "Preview" opens the markdown preview modal.
- The modal is dismissed by: ESC key, clicking the backdrop, or clicking the close button in the modal header.

## Components

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

## Data Flow

1. User right-clicks `.md` file → Radix `ContextMenu` opens.
2. User clicks "Preview" → `onPreview(node.path)` → `FileList` sets `previewPath = node.path`.
3. `MarkdownPreviewModal` mounts with `open=true` → fetches file via `files.read(worktreePath, relativePath)`.
4. Content renders via `react-markdown`. Loading and error states shown as appropriate.
5. User dismisses modal → `onClose` → `FileList` sets `previewPath = null`.

File content is fetched fresh on each open. No caching in V1.

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
| Very large file | Modal is scrollable; no size cap in V1 |
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

### E2E Tests

- Right-click a `.md` file → "Preview" appears in context menu.
- Click "Preview" → modal opens with rendered markdown content.
- ESC key closes the modal.
