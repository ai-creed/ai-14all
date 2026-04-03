# Style And Tabs Migration Design

## Purpose

The current codebase is readable enough to work in, but the formatting style is not serving the user's preference well.

The most important issue is indentation. The repo is almost entirely space-indented today, which makes nested TypeScript and React code feel too compact for the user's reading style.

This design introduces a modern lint and formatting baseline with tab indentation as the primary readability goal.

## Problem

The repo currently has:

- no ESLint configuration
- no Prettier configuration
- no `.editorconfig`
- no enforced shared style baseline for future edits

The practical result is that style is whatever the last editor produced.

The current tracked source paths are effectively space-indented across the board. That makes a tabs-first preference impossible to maintain without explicit tooling.

## Goals

This migration should:

- make tabs the default indentation style for tracked source files
- enforce a small, modern style baseline that matches the user's preferences
- keep generated and bundled output out of the migration
- create stable tooling so future changes do not drift back to mixed formatting

This migration is about readability and consistency, not about introducing a large rule surface.

## Scope

Apply the migration to tracked source-of-truth files only.

Include:

- `src/`
- `electron/`
- `services/`
- `shared/`
- `tests/`
- `scripts/`
- root config files such as:
  - `package.json`
  - `playwright.config.ts`
  - `tsconfig*.json`
  - `vitest.config.ts`

Exclude:

- `out/`
- `dist/`
- `test-results/`
- `node_modules/`
- `.worktrees/`

The migration should not format generated, bundled, or ephemeral output.

## Tooling Direction

Do not introduce `tslint`.

Use a modern split instead:

- `Prettier` for mechanical formatting
- `ESLint` for semantic linting and lightweight code-quality rules
- `.editorconfig` for editor defaults

This is the most maintainable way to enforce tabs without re-creating deprecated `tslint` behavior in a fragile way.

## Rule Translation

The user's original preferences map well to a practical first-pass baseline.

### Prettier Should Own

- tabs for indentation
- double quotes
- semicolons
- trailing commas for multiline structures

These rules are mechanical and should be auto-formatted consistently.

### ESLint Should Own

- `no-var`
- `no-eval`
- no duplicate declarations where ESLint or TypeScript can catch them
- basic whitespace hygiene not already handled by Prettier

### EditorConfig Should Reinforce

- `indent_style = tab`
- a final newline at end of file
- trimmed trailing whitespace

## Explicit Deferrals

Do not force the following in the first migration:

- `typedef`
- `typedef-whitespace`
- strict variable naming conventions
- legacy `tslint` whitespace micro-rules
- style checks that fight normal TypeScript inference

These rules create disproportionate noise for a repo-wide migration and are not required to achieve the user's main readability goal.

## Migration Strategy

The migration should be done in this order:

1. add config files and package scripts
2. install the chosen lint and formatting dependencies
3. run one repo-wide formatting pass on the scoped tracked source set
4. run lint, typecheck, and tests
5. fix any remaining lint issues manually only if auto-formatting does not resolve them

This should be done in a dedicated formatting change, not mixed into product work.

## Risk And Tradeoffs

The main cost is churn.

A repo-wide tabs migration will touch a large number of files. That is acceptable if it is isolated into a dedicated style change and clearly scoped.

Tradeoffs:

- short-term diff noise increases
- blame history becomes noisier for formatting-heavy files
- long-term readability and future consistency improve materially

This trade is worth making because the repo currently has no shared enforcement at all.

## Expected Impact On Current Code

The most visible changes will be:

- indentation changes across most tracked source files
- line wrapping differences where Prettier reformats nested JSX or object literals
- trailing comma normalization
- minor quote normalization in files that still differ from the preferred style

The biggest readability improvement should be in files with deep nesting, especially:

- `src/app/App.tsx`
- `src/features/workspace/workspace-state.ts`
- `src/features/terminals/TerminalPane.tsx`
- service-layer files with nested async and error-handling blocks

## Package Scripts

The repo should gain explicit commands for:

- linting
- lint autofix
- formatting check
- formatting write

The exact tool names can be decided during implementation, but they should be easy to run locally and easy to use in future branch verification.

## Acceptance Criteria

This migration is successful when:

- tracked source files use tab indentation
- generated and bundled paths are untouched
- the repo has a modern lint and format setup
- editor defaults reinforce tabs for future edits
- package scripts exist for lint and format workflows
- the repo is clean after formatting, linting, typechecking, and test verification

## Non-Goals

This migration does not aim to:

- introduce every possible style rule from the original `tslint` config
- refactor product code behavior
- change generated output handling
- make formatting decisions for files outside the tracked source boundary

The goal is narrower: make the source code easier to read, with tabs as the primary improvement, and make that style sustainable going forward.
