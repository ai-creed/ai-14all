# Spec B: Plugin Dialogs & Review "Viewed" — Discoverability, Density & a Layout Fix

**Status:** Design approved (2026-07-01) via interactive brainstorming with the user. Not yet
implemented.

**Scope:** Three self-contained UX-hardening changes across the two agent-integration dialogs and
the review rail:

1. **Skills-installer discoverability (item 5).** Auto-surface ai-14all's own agent integration via
   a calm, dismissible top-of-app banner whenever the install is *incomplete*, and rewrite the
   installer copy in plain, benefit-first language.
2. **Plugins-dialog density (item 6).** Make the "Agent CLIs" section collapsible with a found-count
   summary, and rewrite the plugin/dialog copy benefit-first.
3. **Review "Viewed" layout (item 7).** Fix the stranded "Mark viewed" button — a grid/fragment
   layout bug — by moving the viewed control inline onto each changed-file row, in both the Changes
   and Commits tabs.

The three are independent and could ship separately; they are grouped because they continue the same
UX-hardening batch as Spec A and all concern first-run legibility and review-surface polish.

**Non-goals:**
- No unification of the installer modal (`AgentInstallModal`) into the Plugins panel
  (`PluginsPanelDialog`). The user chose to keep them separate and only improve discoverability (D-B1).
- No change to *what* the installer installs (the ai-14all review skill + MCP-server registration) or
  to the per-provider install/uninstall/CLI-override flow inside the modal — only how it is surfaced
  and worded.
- No change to how agents *report* status or to the ecosystem plugins' behavior — only dialog copy
  and the Agent-CLIs section's collapse chrome.
- No first-run onboarding wizard. The banner is the only proactive surface, and it is gated on a real
  install gap, not on "first launch."

**Related prior work:** `2026-07-01-sidebar-status-legibility-design.md` (Spec A; this spec is
"Spec B", named there as a follow-up), `2026-04-28-dialog-redesign-design.md`,
`2026-04-28-fix-review-installer-cli-detection-design.md`,
`2026-06-14-terminal-chrome-header-and-agent-launchers-design.md`,
`2026-06-26-ui-ux-hardening-slice-1/2-design.md` (the hardening series this continues).

---

## 1. Goal & context

Two agent-integration dialogs and the review rail each carry a small first-run/legibility problem:

- **The skills installer is under-discovered.** `AgentInstallModal` wires ai-14all's review skill +
  MCP server into an agent CLI so the agent can address review comments and report status. Today it is
  reachable only from the app menu item *"Install agent integration…"*
  (`electron/main/menu.ts:36`) and a CTA in the review rail (`AgentInstallCta`, shown only while
  `installCtaVisible`). Nothing surfaces it proactively, so a user who never opens that menu — or who
  connects one agent but not a second — may never wire it up. The modal's title,
  *"Install ai-14all-fix-review skill + MCP server"*, leads with jargon.
- **The Plugins dialog opens dense.** `PluginsPanelDialog` renders an always-expanded "Agent CLIs"
  section listing five probes (`claude`, `codex`, `ezio`, `cursor`, `antigravity`) with versions,
  paths, and install hints before the three ecosystem cards. The list pushes the actual plugin cards
  down and reads as setup noise. The copy is long and product-pitchy.
- **The review "Mark viewed" button is stranded.** In the Changes (and Commits) tab, once a file is
  open the button floats in dead space in the middle of the rail and the changed-files list is shoved
  to the bottom. Root cause is a CSS-grid / React-Fragment mismatch (see §4.3).

All three are small, orthogonal, and live in the agent-integration/review surfaces, so they ship as
one spec with three sections.

## 2. Current state → gap

| Area | Today | Target |
|---|---|---|
| Installer discoverability | Menu item + review CTA only; no proactive surface | Calm, dismissible top-of-app banner when the install is *incomplete* (§4.1) |
| Installer copy | "Install ai-14all-fix-review skill + MCP server"; CTA "Install fix-review skill…" | Plain, benefit-first title + subtle technical subline (§4.2) |
| Plugins "Agent CLIs" | Always expanded; 5 rows with version/path/hint (`PluginsPanelDialog.tsx:162-212`) | Collapsible; default collapsed with "N of 5 found" summary; state remembered (§5.1) |
| Plugins copy | Long ecosystem description + product pitches (`:120-142`, `:251-254`) | Benefit-first, shorter (§5.2) |
| Review viewed control | Header `MarkViewedToggle` in a 2-child Fragment header slot → grid bug strands it; per-row `✓` is read-only | Header slot carries progress only; per-row `○/✓ Viewed` toggle, clickable on the open file (§6) |

## 3. Design decisions

| # | Decision | Rationale / source |
|---|----------|--------------------|
| D-B1 | **Keep the installer modal separate** from the Plugins panel; improve discoverability instead of unifying | User choice over folding item 5 into item 6. Smallest blast radius; two loosely-coupled changes. |
| D-B2 | **Auto-surface via a dismissible banner**, triggered on install *incompleteness* — any *detected* CLI missing the integration — not only zero-installed | User choice. Covers "connected Claude but not Codex", the common partial state. |
| D-B3 | **Dismissal is keyed to the current gap's signature**; the banner returns when the gap *changes*, and the stored dismissal is **cleared once the install is complete** (empty signature) so a resolved-then-reopened gap re-nudges | User choice ("when the gap changes"). Respects dismissal, re-nudges on a genuinely new gap and on a gap that returns after being fixed. |
| D-B4 | **Agent-CLIs section collapsible, default collapsed**, with a "N of 5 found" summary; state remembered | User choice over smart-default and default-expanded. Reclaims top space; detail on demand. |
| D-B5 | **Fix the grid bug by wrapping the header slot in one always-present container** | Robust to header child count; the grid's flexible row always maps to the scroll list. |
| D-B6 | **Move the viewed control inline onto file rows**; clickable only on the currently-open file | User choice (GitHub-style, "same line as the file"). Open-file-only preserves the content-hash auto-reset with no new fetching. |
| D-B7 | **Apply the inline toggle to both Changes and Commits tabs**; keep `⌘⇧V` + command palette | User choice. Consistent behavior; the grid bug affects both tabs anyway. |
| D-B8 | **Copy rewrite is plain-language, benefit-first** across the installer + Plugins dialog | User choice. Jargon (MCP, skill IDs) demoted to a secondary line, not the headline. |
| D-B9 | **Banner placement = slim top-of-app strip** above the main content | User choice over bottom-chrome and sidebar-card. Most discoverable regardless of active panel. |

---

## 4. Item 5 — Incomplete-install banner + installer reword

### 4.1 The banner: trigger, signature, dismissal

**Provider set.** The installer operates on the three providers from
`useAgentInstallStatus` (`src/features/review/hooks/use-agent-install-status.ts`): `claude-code`,
`codex`, `ezio`. Each `Provider` carries `cliAvailable` (the CLI is present) and `installed` (ai-14all's
skill + MCP are wired into it). This set is **distinct** from item 6's five-CLI probe list — item 5 is
about wiring the three installable agents into ai-14all; item 6 is a passive probe display.

**"Detected but not connected".** A provider is a *gap* when `cliAvailable && !installed`. A provider
with no CLI is not a gap — you cannot install a skill into a CLI you do not have.

**Trigger.** The banner is shown when at least one provider is a gap:
`providers.some(p => p.cliAvailable && !p.installed)`. This subsumes the zero-installed case and adds
the partial case. When no CLI is detected at all, there is no gap and no banner (nothing to connect —
the menu item and Plugins panel remain the discovery path for that user).

**Gap signature.** Reduce the current gap to a stable string: the sorted list of gap provider ids,
joined with `,` (e.g. `"codex"` or `"claude-code,codex"`). The empty string means "complete".

**Dismissal (D-B3).** A new hook `use-install-gap-dismissal` (mirroring
`src/features/workspace/logic/use-collapsed-workspaces.ts`) persists the last *dismissed signature*
in `localStorage` under key `ai14all.dismissedInstallGap`. The banner renders when the current
signature is **non-empty and not equal to** the dismissed signature. Dismissing `[×]` stores the
current signature. **When the current signature is empty (the install is complete), the hook clears
the stored dismissed signature.** This clear-on-complete rule is what makes a dismissal silence only
the specific gap that was open when the user dismissed — never a *later* re-occurrence of that same
gap after it was resolved. Without it, dismissing `"codex"`, then completing the install (signature
`""`), then re-opening the same `"codex"` gap would leave the current signature equal to the still
stored `"codex"` and the banner would stay wrongly hidden. Consequences:
- Dismiss silences *this* gap (this exact set of gap providers).
- A newly-detected missing agent changes the signature → the banner returns.
- Completing the install empties the signature → no banner, **and the stored dismissal is cleared**;
  if a later removal reopens the *same* gap, the current signature no longer equals the (now-cleared)
  stored signature → the banner returns.
- `localStorage` unavailable (private mode) degrades to in-memory state, exactly as
  `use-collapsed-workspaces` does.

**Placement (D-B9) & action.** A new `IncompleteInstallBanner` component renders a slim strip at the
top of the main content area in `App.tsx` (above the shell body, not over the sidebar). It is
non-blocking and never takes focus. `[Install…]` calls the existing `setInstallModalOpen(true)`
(`App.tsx:554-557`) — reusing the current modal and its open listener unchanged. `[×]` dismisses.

### 4.2 Installer reword (D-B8)

Concrete copy (final wording is reviewable here, not a placeholder):

- **Banner, one gap:** `⚡ Connect Codex to ai-14all — let it fix review comments and report status`
  with `[Install…]` and `[×]`. The agent name is the single gap provider's `displayName`.
- **Banner, multiple gaps:** `⚡ 2 agents aren't connected to ai-14all` with `[Install…]` and `[×]`.
- **Modal title** (`AgentInstallModal.tsx:36-38`): `Connect your coding agents to ai-14all`
  (was *"Install ai-14all-fix-review skill + MCP server"*).
- **Modal secondary line** (new, subtle, under the title — keeps the technical truth):
  `Installs the ai-14all review skill and registers its MCP server so your agent can address review
  comments and report status.`
- **Review-rail CTA** (`AgentInstallCta.tsx:13-16`), aligned with the banner voice:
  `Connect your agent — let Claude Code or Codex address these comments.`

The per-provider rows, checkbox behavior, CLI-locate flow, and Install button are unchanged.

---

## 5. Item 6 — Plugins dialog: collapsible Agent CLIs + copy

### 5.1 Collapsible Agent CLIs (D-B4)

`AgentClisSection` (`PluginsPanelDialog.tsx:162-212`) becomes collapsible:

- A disclosure header replaces the always-on `<h3>`: a `<button>` with `aria-expanded`, label
  `Agent CLIs — N of 5 found` and a `▸`/`▾` caret. `N` = probes with `kind === "found"`; the total is
  `CLI_ORDER.length` (5). While `probes === null`, the label reads `Agent CLIs — checking…` and the
  body stays collapsed.
- **Default collapsed.** The per-CLI detail (name, version, path, or not-found hint) renders only when
  expanded. Collapsed shows the summary line alone.
- **Persistence.** A boolean in `localStorage` under `ai14all.pluginsAgentClisCollapsed` (default
  `true`), read/written with the same try/catch degradation pattern as `use-collapsed-workspaces`.
  Kept as a small local hook or inline `useState` initializer in `PluginsPanelDialog`.

The found/not-found rows, `data-cli`/`data-found` attributes, and install hints are unchanged inside
the expanded body (existing tests that query them still pass once the section is expanded).

### 5.2 Plugins copy reword (D-B8)

- **Dialog description** (`PluginsPanelDialog.tsx:251-254`):
  `Optional add-ons from the ai-14all ecosystem. All off by default — ai-14all works fully without
  them.`
- **Plugin pitches** (`DESCRIPTORS`, `:120-142`) — benefit-first, shorter:
  - **ai-whisper:** `Pair two coding agents on a worktree with autonomous review workflows. Live
    status and escalations appear here once enabled.`
  - **ai-cortex:** `A memory layer your agents recall from and record to across sessions — and it
    powers code navigation (go-to-definition, references, symbol search) here. Enable, then Configure.`
  - **ai-samantha:** `A voice-first companion that watches your agents and speaks up when something
    needs you.`

`installCommand` / `repoUrl` and the Configure/Enable wiring are unchanged.

---

## 6. Item 7 — Inline per-file "Viewed" toggle + grid fix

### 6.1 The grid bug (D-B5)

`.shell-review-rail` is a three-row grid: `grid-template-rows: auto auto minmax(0, 1fr)`
(`src/app/shell.css:1629-1636`). The intended rows are: tabs (`.shell-review-rail__header`), the
`header` slot, and the scrolling list (`.shell-review-rail__scroll`, the tall flexible row). But the
`header` slot is passed as a **React Fragment with two children** — `ReviewProgressHeader` +
(conditionally) `MarkViewedToggle` (`ReviewArea.tsx:530-545`). A Fragment adds no DOM node, so each
child becomes its own grid item. With a file open the rail has **four** grid items (tabs / progress /
mark-viewed / scroll); the `minmax(0, 1fr)` row lands on `MarkViewedToggle` (stranding it in the tall
empty row) and the scroll list overflows into an implicit auto row pinned to the bottom.

**Fix:** in `ReviewRail`, wrap the `{header}` slot in a single always-present container
`<div className="shell-review-rail__toolbar">{header}</div>`. The grid then always has exactly three
items (tabs / toolbar / scroll) regardless of how many children the header provides, so the flexible
row always maps to the scroll list. The toolbar carries no box when empty (`ReviewProgressHeader`
returns `null` at `total === 0`), so an empty toolbar row is invisible.

### 6.2 Inline viewed toggle (D-B6 / D-B7)

- **Header slot carries progress only.** `MarkViewedToggle` is removed from the `ReviewArea` header
  slot; the slot renders just `ReviewProgressHeader`.
- **Per-row toggle.** In `ChangesList` (`:91-100`) and `CommitList` (`:168-176`), the read-only `✓`
  reviewed-mark becomes an interactive `○ / ✓ Viewed` control **for the currently-open file's row
  only** (`selectedPath === change.path`, resp. `selectedCommitFilePath === file.path`). It calls a
  new `onToggleViewed(path)` prop. Non-open rows keep the read-only indicator (`✓` when reviewed,
  nothing when not).
- **No nested buttons.** Each list row is currently a single `<button>` (row-click selects the file);
  a nested toggle `<button>` would be invalid DOM. The row markup is restructured so the file-select
  control and the viewed toggle are **sibling** interactive elements inside the row container (the
  `ContextMenuTrigger` wraps the container). Non-open rows keep a plain `<span>` indicator, so only the
  open row introduces a second interactive control.
- **Wiring.** `onToggleViewed` threads `ReviewArea → ReviewRail → ChangesList`/`CommitList`. In
  `ReviewArea` it maps to the existing `handleMarkFileViewed` (`:388-394`), which toggles the
  *current* file using its loaded diff content and the reviewed-files hash. Because the toggle is
  clickable only on the open row, its `path` always equals `currentFilePath`, so the content is loaded
  and the hash-based **auto-reset-on-change** guarantee is preserved with no new fetching.
- **Keyboard / palette unchanged.** `review.markViewed` (`⌘⇧V`) and the command-palette "Mark file
  viewed" entry (`ReviewArea.tsx:459-467`) continue to toggle the open file.
- **Retire `MarkViewedToggle`.** The component (`src/features/review/components/MarkViewedToggle.tsx`)
  is no longer used in the header. Its `○/✓`, `aria-pressed`, and reviewed styling fold into the row
  toggle. Delete the component or repurpose it as the row control; the plan picks one. (It has no
  dedicated unit test today.)

---

## 7. Data model & files touched

**Item 5 (installer banner + copy)**
- New: `src/features/review/components/IncompleteInstallBanner.tsx` — the strip; props derive from
  `providers` + the dismissal hook.
- New: `src/features/review/logic/use-install-gap-dismissal.ts` (or `.../hooks/`) — signature +
  `localStorage` dismissal, mirroring `use-collapsed-workspaces`.
- `src/app/App.tsx` — render the banner in the top-of-app region; pass `providers`
  (already available via `useAgentInstallStatus`/`agentInstallStatus`) and `onInstall =>
  setInstallModalOpen(true)`.
- `src/features/review/components/AgentInstallModal.tsx` — title + new secondary line (§4.2).
- `src/features/review/components/AgentInstallCta.tsx` — reworded copy.
- `src/app/shell.css` — banner styles.

**Item 6 (Plugins dialog)**
- `src/features/plugins/components/PluginsPanelDialog.tsx` — `AgentClisSection` collapsible +
  found-count summary; dialog description + `DESCRIPTORS` pitch copy.
- Collapse persistence: small local hook or inline `useState` + `localStorage`
  (`ai14all.pluginsAgentClisCollapsed`).
- `src/app/shell.css` — disclosure/summary styles for the collapsed section.

**Item 7 (review viewed)**
- `src/app/components/ReviewArea.tsx` — remove `MarkViewedToggle` from the header slot; pass
  `onToggleViewed` down.
- `src/features/review/components/ReviewRail.tsx` — wrap `{header}` in
  `.shell-review-rail__toolbar`; thread `onToggleViewed` + reviewed state to both lists.
- `src/features/git/components/ChangesList.tsx` — row restructure + open-row toggle.
- `src/features/git/components/CommitList.tsx` — same row restructure + open-row toggle.
- `src/features/review/components/MarkViewedToggle.tsx` — retired (delete or repurpose).
- `src/app/shell.css` — the `.shell-review-rail__toolbar` wrapper; per-row toggle styles.

**Type touch points**
- `IncompleteInstallBanner` props: the `Provider[]` shape already exists
  (`use-agent-install-status.ts`). No shared-model changes.
- `ChangesList`/`CommitList` gain an `onToggleViewed?: (path: string) => void` prop and a notion of the
  "open" path (already have `selectedPath` / `selectedCommitFilePath`). No shared-model changes.

---

## 8. Testing & edge cases

Following TDD: write the failing test first, then implement.

**Item 5**
- Gap predicate: none-detected → no banner; all-detected-and-installed → no banner;
  one detected+uninstalled → banner; partial (one installed, one not) → banner.
- Signature: correct sorted-join for one and multiple gaps; empty when complete.
- Dismissal: dismiss stores the signature; same signature → hidden; a new/removed gap changes the
  signature → re-shown; completing the install (empty signature) **clears the stored dismissal**;
  dismiss a gap → complete the install → re-open the *same* gap → banner re-shown (the clear-on-complete
  path); `localStorage` throwing degrades to in-memory (banner behaves per session).
- Banner copy: singular names the provider; plural shows the count.
- `[Install…]` opens the existing modal (asserts `setInstallModalOpen(true)` / modal visible).
- Reworded modal title + secondary line render; CTA copy updated.

**Item 6**
- Default collapsed: detail rows hidden on first open; summary shows `N of 5 found` with the correct
  count; `checking…` while probes are null.
- Toggle expands/collapses; state persists across remount via `localStorage`; storage-throw degrades
  gracefully.
- Reworded description + pitches render (update existing copy assertions).

**Item 7**
- Grid regression: a CSS-text test (mirroring Spec A's `tests/unit/styles/*`) asserting the rail grid
  template and the presence of the single `.shell-review-rail__toolbar` wrapper; a structural render
  test asserting the scroll list and toolbar are distinct single grid items with a file open.
- Open-row toggle: only the open file's row exposes a clickable toggle; other rows render a read-only
  indicator; clicking a non-open row selects/opens it (then its toggle is live).
- Toggle marks/unmarks the open file; the reviewed `✓` state and the `N / N reviewed` progress update.
- Auto-reset: re-marking after the file content changes clears "viewed" (hash invariant intact).
- `⌘⇧V` and the command-palette entry still toggle the open file.
- Both tabs: the above hold in Changes **and** Commits.
- No nested-button DOM (row select + toggle are siblings).

Existing tests to extend: `tests/unit/components/AgentInstallModal-locate.test.tsx` and
`tests/unit/components/AgentInstallCta.test.tsx` (installer copy/flow),
`tests/unit/plugins/PluginsPanelDialog.test.tsx`, `tests/unit/components/ChangesList.test.tsx`,
`tests/unit/components/CommitList.test.tsx`, and the review e2e specs that assert the header toggle /
reviewed marks. New tests: a `tests/unit/styles/*` grid-regression test, and unit tests for
`IncompleteInstallBanner` + the gap-dismissal hook. `MarkViewedToggle` has no dedicated unit test
today; update any test that references the header toggle when it moves inline.

## 9. Out of scope / follow-ups

- Unifying the installer into the Plugins panel (D-B1 kept them separate).
- A first-run onboarding wizard (the banner is gap-gated, not launch-gated).
- "Mark viewed" on files you have not opened (D-B6 chose open-file-only; the fetch-on-demand variant
  is a possible later enhancement).
- Any change to status reporting, the ecosystem plugins' behavior, or the installer's install
  mechanics.
