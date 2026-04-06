# Beta Release Packaging And Versioning Design

## Purpose

This spec defines the first beta release flow for `ai-14all`.

The goal is to let a technical tester install and run the app on another macOS machine without cloning the repository or performing the normal developer setup workflow.

This spec is intentionally narrow. It covers macOS packaging, beta versioning, release tagging, and a single-command local release flow. It does not introduce CI/CD pipelines, notarization, or public release infrastructure.

## Problem

The app is now beta-ready from a product perspective, but there is no distribution path.

Current limitations:

- the repo has build scripts but no packaging configuration
- there is no installable beta artifact for another Mac
- there is no release checkpointing model that ties app version, packaged artifact, and Git tag together
- releasing would currently require manual command sequencing that is easy to get wrong

For a private beta, the main problem is operational friction, not missing runtime features.

## Goals

This release slice should:

- produce a distributable macOS app artifact
- avoid requiring testers to clone the repo or run build commands
- define a clear beta version format and Git tagging model
- provide a single local release command that runs verification, packages the app, and tags the release on success
- allow rebuilding the same tagged release commit without creating a duplicate tag
- document the runtime expectations for technical beta testers

## Non-Goals

This spec should not include:

- Apple signing or notarization
- GitHub Actions or remote release automation
- public release publishing flows
- Windows or Linux packaging
- auto-update infrastructure
- onboarding or first-run setup UX
- removing runtime prerequisites such as Git or optional CLI tools

## Product Direction

This is a private technical beta distribution flow, not a consumer launch flow.

That means the release system should optimize for:

- reproducibility
- low operator effort
- artifact clarity
- minimal release bureaucracy

It does not need to optimize for:

- seamless Gatekeeper behavior
- one-click public install
- cross-platform release parity

## Recommended Approach

The recommended approach is:

1. add `electron-builder` for macOS packaging
2. produce a zipped `.app` as the primary beta artifact
3. optionally also produce a `.dmg` from the same config if it is low-cost
4. manage beta versions in `package.json`
5. add one release script that:
   - verifies the repo state
   - computes or reuses the beta version
   - builds and packages the app
   - creates the Git tag automatically only after packaging succeeds

This is preferable to a manual checklist because the release operator explicitly wants to avoid multi-step release work.

It is preferable to introducing CI first because this is still a private beta for trusted technical testers and does not yet justify release-pipeline overhead.

## Packaging Format

### Primary Artifact

The primary beta artifact should be:

- a zipped macOS `.app`

Why:

- simplest practical beta handoff
- works well for trusted technical testers
- avoids unnecessary installer complexity for the first beta

### Optional Secondary Artifact

The packaging config may also emit:

- a `.dmg`

This is optional for beta. If it comes essentially for free from the packaging tool, it is worth keeping. If it adds noticeable friction or instability, the `.zip` should remain sufficient.

## Packaging Tooling

The packaging tool should be:

- `electron-builder`

Reasons:

- strong fit for Electron desktop packaging
- straightforward macOS target support
- practical path from unsigned private beta now to signed/notarized builds later
- minimal custom scripting required for first release

## Beta Versioning Model

### Version Format

The beta series should use:

- app version: `0.1.0-beta.N`
- Git tag: `v0.1.0-beta.N`

Examples:

- `0.1.0-beta.1`
- `0.1.0-beta.2`
- `0.1.0-beta.3`

This keeps the versioning legible and leaves a clean path to `0.1.0` later.

### Fixed Beta Base

For the first beta cycle, the base version should stay fixed at:

- `0.1.0`

Only the beta suffix increments.

This avoids unnecessary version-policy complexity while the product is still validating its first external tester workflow.

## Release Semantics

The release flow should distinguish between:

- building a new beta checkpoint
- rebuilding an already tagged beta checkpoint

### New Beta Checkpoint

If `HEAD` is different from the commit referenced by the latest `v0.1.0-beta.*` tag:

1. compute the next beta suffix
2. update `package.json` version to that value
3. create a release commit for the version bump
4. run verification
5. package the app
6. create Git tag `v0.1.0-beta.N`

### Rebuild Existing Checkpoint

If `HEAD` already has a matching beta tag:

1. reuse that version
2. rerun verification if configured to do so
3. rebuild the artifact
4. do not create a new tag

This allows artifact regeneration without creating duplicate release identifiers.

## Release Command

The release flow should be available through a single local command.

Recommended shape:

- `pnpm release:beta`

That command should:

1. verify the working tree is clean
2. determine whether `HEAD` is already tagged with a beta version
3. if not tagged, compute the next beta version and commit the version bump
4. run the required verification commands
5. run the production build
6. package the macOS artifact(s)
7. create the Git tag if this is a new beta release and packaging succeeded
8. print the final version, tag, and artifact paths

The command should fail fast on any verification or packaging error.

## Verification Before Tagging

This beta flow does not require GitHub Actions.

For now, the release command should enforce release quality locally by running:

- `pnpm test`
- `pnpm typecheck`
- `pnpm test:e2e`
- packaging build

The release tag should only be created after these steps succeed.

This gives the project release discipline without requiring CI setup before the first private beta.

## Git Tagging Policy

The release tag should be created automatically by the beta release command only after packaging succeeds.

Rules:

- tag format: `v0.1.0-beta.N`
- one tag per beta release checkpoint
- no new tag when rebuilding the exact same tagged `HEAD`
- tagging should happen after successful verification and packaging, not before

This ensures the tag corresponds to a real packaged artifact, not just an intended release point.

## Artifact Output

The release flow should produce artifacts in a predictable location.

The exact directory may follow the packaging tool’s default output if it is clean and stable. A custom output directory is only needed if the defaults make release handling confusing.

The release command should print:

- resolved app version
- Git tag status
- final artifact path(s)

That is sufficient for first beta distribution.

## Tester Expectations

The beta distribution should include a short note for testers covering:

- the app is unsigned
- macOS may require right-click/Open or equivalent bypass for Gatekeeper
- Git must be installed and available in the shell environment
- external CLIs like `codex` or `claude` are not bundled and must already exist if the tester wants to use them

This is not a no-prerequisites product release. It is a packaged app for technical users.

## Failure Handling

### Dirty Working Tree

If the working tree is not clean, the release command should fail before versioning or packaging.

### Verification Failure

If tests, typecheck, or e2e verification fail:

- do not package
- do not tag
- leave the failure visible and explicit

### Packaging Failure

If packaging fails:

- do not create the tag
- keep the release version commit only if the workflow intentionally committed it before packaging
- print the packaging failure clearly

The implementation may choose whether to create the version-bump commit before or after verification, but the tag must always remain guarded behind successful packaging.

## Testing Expectations

This release slice should add coverage for:

- beta version calculation from existing tags
- reusing the existing version when `HEAD` is already tagged
- refusing release on dirty working tree
- refusing tag creation when verification fails
- refusing tag creation when packaging fails
- successful release flow producing the expected tag and artifact path output

It should also include one practical end-to-end validation on macOS that the packaged beta app launches successfully.

## Open Questions Resolved By This Spec

This spec makes the following decisions explicit:

- macOS only for first beta
- unsigned private beta is acceptable
- zipped `.app` is the primary artifact
- GitHub Actions are not required before the first beta tag
- versioning starts at `0.1.0-beta.N`
- the beta release command auto-tags only after packaging succeeds
- rebuilding the same tagged `HEAD` should reuse the same version without creating a new tag
