# Windows Download Link on ai-creed + Release Automation — Design

- **Date:** 2026-06-21
- **Project:** ai-14all (distribution) — changes span the **ai-creed** site repo and the ai-14all **release.yml**
- **Status:** Design approved (decisions captured below); pending implementation plan
- **Author:** Vu Phan (with Claude)
- **Predecessor:** `2026-06-20-windows-distribution-phase2-design.md`. Phase 2 shipped the unsigned NSIS installer + auto-update and explicitly deferred "Automating the ai-creed download-page/manifest publish" for Windows. This design closes that follow-up.

## 1. Background & Goal

The ai-creed landing page (`https://ai-creed.dev`, an Astro site in `~/Dev/ai-creed`) lists ai-14all with a single macOS **dmg** download. Now that Phase 2 produces an unsigned Windows **NSIS installer** (`ai-14all-<ver>-x64-Setup.exe`) published to the GitHub Release, the page should also offer the Windows download, and the existing release automation that keeps the macOS link current should keep the Windows link current too.

**Goal:** show a Windows download alongside macOS on the ai-14all project page, and extend the release automation so both links' versions stay current on every release — with the smallest, lowest-risk change.

## 2. How it works today (verified against the repos, 2026-06-21)

- **Schema:** `~/Dev/ai-creed/src/content.config.ts:17` — the `projects` collection has `download: z.string().url().optional()` (a single URL).
- **Rendering:** `~/Dev/ai-creed/src/pages/projects/[...slug].astro:35-36` renders one CTA: `{data.download && (<a class="download-cta" href={data.download} download>↓ download</a>)}`. The `.download-cta` style is defined in the same file (`:104`, `:114`).
- **Content:** `~/Dev/ai-creed/src/content/projects/ai-14all.mdx` references the macOS dmg in **two** places — frontmatter `download:` (line 7, feeds the CTA) and the body "## download" section (line 46, with macOS-only prose). The "## requirements" and "## known limits" sections (lines 56-65) state macOS-only ("no Intel, Windows, or Linux artifacts"). The site currently shows **v0.8.1** (the last release; ai-14all's `package.json` is ahead at 0.9.3).
- **Automation (the only thing touching ai-creed on release):** ai-14all's `.github/workflows/release.yml`, mac job, step **"Publish manifest to ai-creed"** clones `git@github.com:ai-creed/ai-creed.git`, copies `latest-mac.yml` into `public/ai-14all/`, then `sed`-bumps three patterns in the mdx and commits + pushes to ai-creed `master`:

  ```bash
  sed -i.bak -E \
    -e "s|ai-14all-[0-9]+\.[0-9]+\.[0-9]+-arm64\.dmg|ai-14all-${target}-arm64.dmg|g" \
    -e "s|releases/download/v[0-9]+\.[0-9]+\.[0-9]+/|releases/download/v${target}/|g" \
    -e "s|\*\*v[0-9]+\.[0-9]+\.[0-9]+\*\*|**v${target}**|g" \
    "$mdx"
  ```

- **The Windows asset** (`ai-14all-<ver>-x64-Setup.exe`) is uploaded to the **same** GitHub Release by the **separate** `release-windows.yml`, which builds for ~tens of minutes and finishes after the mac job.

## 3. Key Decisions (made 2026-06-21)

- **UI:** **two labeled CTAs** — render `download` as "↓ macOS" and a new `downloadWindows` as "↓ Windows", plus list both in the body "## download" section. No client JS (the page stays static). (Rejected: OS-detect single CTA — adds JS and can guess wrong; body-link-only — Windows too easy to miss.)
- **Schema:** add a single optional field `downloadWindows: z.string().url().optional()`; keep `download` as the macOS dmg. (Rejected: generalizing to a `downloads[]` array — only ai-14all uses `download`, so YAGNI.)
- **Automation ownership:** **extend the existing mac `release.yml` ai-creed step** to also bump the Windows installer filename — one pusher, one new `sed` line. (Rejected: a second ai-creed updater in `release-windows.yml` — avoids the 404 window below but adds a second concurrent pusher to ai-creed master and rebase/retry complexity.)
- **Sequencing:** **land the site + automation changes now; the Windows link activates on the next release tag.** Seed `downloadWindows` in the mdx at the mdx's current version so the release `sed` bumps both links together. (Accepted tradeoff in §6.)

## 4. Scope

**In scope:**
- ai-creed: schema field, two-CTA rendering, and `ai-14all.mdx` content (Windows frontmatter + body + corrected requirements/known-limits).
- ai-14all: one added `sed` pattern in `release.yml`'s ai-creed step.
- Verification: ai-creed Astro build green; release.yml `sed` dry-run bumps both links.

**Out of scope (unchanged / deferred):**
- `release-windows.yml` owning its own ai-creed update (the rejected alternative).
- arm64 Windows on the page beyond a mention (x64 installer is the featured download; arm64 stays a manual zip per Phase 2).
- Any change to `latest.yml` / auto-update behavior (Phase 2 already covers it).
- Signing / winget / MSIX (still deferred per Phase 2).

## 5. Design

### 5.1 ai-creed schema — add `downloadWindows`

In `src/content.config.ts`, add next to `download`:

```ts
download: z.string().url().optional(),
downloadWindows: z.string().url().optional(),
```

Optional → every other project's frontmatter is unaffected.

### 5.2 ai-creed rendering — two CTAs

In `src/pages/projects/[...slug].astro`, replace the single CTA with two conditional ones, reusing `.download-cta`. Label `download` as macOS only when a Windows download is also present, so any future single-download project keeps the generic label:

```astro
{data.download && (
  <a class="download-cta" href={data.download} download>
    ↓ {data.downloadWindows ? "macOS" : "download"}
  </a>
)}
{data.downloadWindows && (
  <a class="download-cta" href={data.downloadWindows} download>↓ Windows</a>
)}
```

No style change required; two `.download-cta` anchors sit side by side.

### 5.3 ai-creed content — `ai-14all.mdx`

- **Frontmatter:** add `downloadWindows:` pointing at the x64 installer at the **same version** as the current `download:` line (so both bump together on release):

  ```yaml
  download: "https://github.com/ai-creed/ai-14all/releases/download/v0.8.1/ai-14all-0.8.1-arm64.dmg"
  downloadWindows: "https://github.com/ai-creed/ai-14all/releases/download/v0.8.1/ai-14all-0.8.1-x64-Setup.exe"
  ```

- **"## download" body:** present both platforms; macOS keeps the signed/notarized note, Windows gets the unsigned + SmartScreen note. Both links use the same `releases/download/v<ver>/…` shape the `sed` already updates:

  > Latest stable release: **v0.8.1**
  >
  > - **macOS** (Apple Silicon) — [ai-14all-0.8.1-arm64.dmg](…/v0.8.1/ai-14all-0.8.1-arm64.dmg) — signed + notarized; opens normally.
  > - **Windows** (x64) — [ai-14all-0.8.1-x64-Setup.exe](…/v0.8.1/ai-14all-0.8.1-x64-Setup.exe) — unsigned: Windows SmartScreen may warn on first run → **More info → Run anyway**. x64 auto-updates in the background; arm64 is a manual zip download.

- **"## requirements":** add "Windows 10/11 on x64" alongside the macOS line.
- **"## known limits":** replace "macOS / Apple Silicon only … (no Intel, Windows, or Linux artifacts)" with the accurate state: macOS (Apple Silicon, signed) + Windows (x64 installer, unsigned, auto-updates; arm64 manual zip); no Intel macOS or Linux artifacts.

### 5.4 ai-14all automation — one added `sed` pattern

In `.github/workflows/release.yml`, the "Publish manifest to ai-creed" step, add one `-e` to the existing `sed` so the Windows installer filename bumps too (the `releases/download/v<ver>/` and `**v<ver>**` patterns already handle the URL + version string for both):

```bash
  -e "s|ai-14all-[0-9]+\.[0-9]+\.[0-9]+-x64-Setup\.exe|ai-14all-${target}-x64-Setup.exe|g" \
```

`git add` already stages the whole mdx, so no other release.yml change is needed.

## 6. Risks & Open Items

- **Windows link 404 window (accepted).** Because the mac job updates ai-creed before `release-windows.yml` finishes uploading the installer (~the Windows build duration), the Windows link can 404 for a window after each release tag until the upload completes. Accepted for simplicity (single pusher); if it becomes a problem, the fallback is moving the Windows-link bump into `release-windows.yml`'s own post-upload ai-creed step.
- **Dead link until first Windows release (accepted, per §3 sequencing).** No Windows installer exists on any Release yet, so the seeded `v0.8.1` Windows link 404s until the next release tag is cut (which bumps both links and publishes the installer). The macOS link is unaffected.
- **Two repos.** The change spans ai-creed (3 files) and ai-14all (1 file). The implementation plan must treat them as separate commits/PRs in their respective repos.
- **Cross-check before relying on a tag.** Per project rule, dry-run the release.yml `sed` against a copy of the mdx with a fake version and confirm BOTH the dmg and the Setup.exe filenames bump, before the next real release.

## 7. Acceptance Criteria

- ai-creed `pnpm build` (Astro) succeeds with the new `downloadWindows` field and two-CTA rendering; the ai-14all project page shows "↓ macOS" and "↓ Windows" buttons.
- `ai-14all.mdx` body lists both platforms with the SmartScreen note; "requirements"/"known limits" no longer claim macOS-only.
- Running the updated `release.yml` `sed` on a copy of the mdx with `target=9.9.9` rewrites **both** `ai-14all-9.9.9-arm64.dmg` and `ai-14all-9.9.9-x64-Setup.exe` and the `releases/download/v9.9.9/` URLs.
- No change to macOS behavior: the macOS CTA, dmg link, and `latest-mac.yml` publish are unchanged; other projects' pages are unaffected (both download fields optional).

## 8. Task Breakdown (phased; spans 2 repos)

1. **ai-creed schema + rendering** — add `downloadWindows` to `content.config.ts`; two-CTA rendering in `[...slug].astro`. Verify `pnpm build`.
2. **ai-creed content** — `ai-14all.mdx` frontmatter + body + requirements/known-limits. Verify `pnpm build` + visual check.
3. **ai-14all automation** — add the Windows `sed` pattern to `release.yml`; dry-run the `sed` on a mdx copy with a fake version.
4. **Verification** — ai-creed build green; sed dry-run bumps both; confirm mac path untouched.

## 9. Future (not now)

- Move the Windows-link bump into `release-windows.yml` (post-upload) to eliminate the 404 window.
- Add arm64 Windows / Linux downloads if/when those artifacts ship.
- OS-detection to highlight the visitor's platform.
