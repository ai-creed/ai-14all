# Sidebar Shell Summary Design

**Date:** 2026-04-11
**Status:** Approved
**Problem:** The left-sidebar worktree cards currently show shell labels and a generic running indicator, but they do not communicate the actual live state of each terminal shell well enough. A running shell may be actively producing output, quietly attached, blocked on user input, or already exited. The current list makes those cases hard to distinguish at a glance.

## Goals

1. Make each sidebar shell row communicate a truthful, glanceable shell state
2. Distinguish `action required`, `active`, `idle`, and `exited` without adding noisy card chrome
3. Keep the existing worktree card structure broadly intact
4. Stay shell-oriented rather than pretending to fully understand provider-specific agent states

## Non-Goals

- redesigning the overall sidebar layout
- adding a new backend service just for sidebar status
- introducing provider-specific states like "thinking" or "waiting on tool"
- storing terminal scrollback or long output history
- expanding the card into a multi-line process inspector

## Summary

The recommended approach is to replace the current sidebar process rows with a compact shell summary row:

`<status dot> <shell label> <context text>`

This keeps the existing sidebar visually quiet while making each shell row explain what is actually happening.

The status dot is the primary state cue.

The shell label identifies the row.

The trailing context text explains the current shell condition using either a last-output preview or a quiet/exit hint.

## Row Layout

Each shell row should remain a single line.

The visual priority should be:

1. status dot
2. shell label
3. context text

The row should avoid badges or heavy state containers unless later usage proves they are necessary.

The intended form is:

- `red-dot claude Continue? [y/N]`
- `green-dot npm run dev compiled in 124ms`
- `gray-dot claude quiet for 18s`
- `muted-dot tests exit 1`

Context text should use a more muted treatment than the label so the row remains scannable in a dense sidebar.

## Sidebar State Model

The sidebar should expose four shell states:

- `action required`
- `active`
- `idle`
- `exited`

These are sidebar-facing derived states, not a new backend process-state source of truth.

### Derived State Rules

`action required`

- process status is `running`
- latest attention state is `actionRequired`
- context text shows the last output preview

`active`

- process status is `running`
- attention is not `actionRequired`
- output was seen within the last `10s`
- context text shows the last output preview

`idle`

- process status is `running`
- no output has been seen for more than `10s`
- context text shows a quiet-age hint such as `quiet for 18s`

`exited`

- process status is `exited`, `error`, or `restarting`
- context text shows `exit 0`, `exit 1`, `error`, or `restarting`

### Priority Order

When multiple signals are present, the row should resolve using this order:

1. `error` / `exited` / `restarting`
2. `action required`
3. `active`
4. `idle`

This keeps the row honest when a process has both older output and a newer terminal lifecycle transition.

## Dot Semantics

The existing indicator dot should become the main state signal through color treatment:

- `red` for `action required`
- `green` for `active`
- `gray` for `idle`
- `muted` or `outlined` for `exited`

This preserves the compact current design while making row state legible without additional card-level noise.

## Context Text Rules

The trailing context text should explain the shell state with minimal width.

For `action required` and `active`:

- show a short preview of the last meaningful output line

For `idle`:

- do not keep showing stale shell output
- show a quiet-age hint such as `quiet for 14s`

For `exited`:

- show `exit 0`, `exit 1`, `error`, or `restarting`

## Last Output Preview

The current model already tracks `status`, `attentionState`, and `lastActivityAt`.

To support useful sidebar context text, `ProcessSession` should gain one new lightweight field:

- `lastOutputPreview: string | null`

This field should not store scrollback or broad history.

It should hold only the latest useful single-line preview for sidebar display.

### Preview Extraction Rules

On terminal output:

- extract the last non-empty visible line from the incoming output chunk
- strip ANSI escape sequences
- collapse repeated whitespace
- trim leading and trailing whitespace
- truncate aggressively so the row stays compact
- ignore blank or obviously useless noise-only lines

If no useful preview line is available from a given output chunk, keep the prior preview. Do not clear the stored preview on empty or noise-only output chunks, because that would make active rows flicker and reduce sidebar usefulness.

## Worktree Card Behavior

The worktree card should stay close to its current structure.

The primary change is inside the shell list:

- each shell becomes a compact status-summary row
- rows should sort by severity first, then recency
- cards should show only a small number of shell rows, such as `2-3`
- if more shells exist than are shown, the card may continue to use an aggregate overflow hint rather than expanding vertically

This keeps the sidebar useful in dense repositories without turning the card into a process dashboard.

## Architecture Boundaries

This change should remain inside the existing renderer session model.

Recommended scope:

- extend `ProcessSession` with `lastOutputPreview`
- update that field from the existing terminal output event path
- derive sidebar shell-summary state from `status`, `attentionState`, `lastActivityAt`, and `lastOutputPreview`
- keep Electron main, preload, and IPC thin unless implementation reveals a genuine shared-contract need

Do not add:

- a provider-aware agent-state system
- a new backend summary service
- a second sidebar-specific state store

## Testing

### Unit tests

1. Derived row-state logic resolves `action required`, `active`, `idle after 10s`, and `exited` correctly
2. Quiet-age formatting is stable and readable
3. Preview extraction strips ANSI sequences, skips empty lines, and truncates as expected

### Component tests

4. Sidebar rows render dot semantics correctly for all four states
5. Rows show last-output preview for `action required` and `active`
6. Rows show quiet-age context for `idle`
7. Rows show exit context for `exited`
8. Rows sort by severity and recency as intended

### E2E coverage

9. A shell producing output appears as active in the sidebar
10. After `10s` of quiet, that shell appears as idle with a quiet-age hint
11. A prompt or failure message surfaces as action-required in the sidebar

## UX Outcome

If this polish is successful, the user should be able to scan the left sidebar and answer three questions immediately:

- which shell needs me right now
- which shell is alive but currently quiet
- what each visible shell is doing without opening it first

The sidebar should feel more truthful and operationally useful without materially changing the product's current session-first UI shape.
