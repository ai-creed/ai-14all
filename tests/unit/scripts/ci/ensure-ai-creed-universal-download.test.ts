import { describe, expect, it } from "vitest";
import { transformAiCreedMdx } from "../../../../scripts/ci/ensure-ai-creed-universal-download.mjs";

const BASE = "https://github.com/ai-creed/ai-14all/releases/download/v0.11.1";

// A faithful subset of the live ai-creed src/content/projects/ai-14all.mdx in
// its pre-universal (arm64-only) shape.
const STALE = `---
name: "ai-14all"
status: "stable"
download: "${BASE}/ai-14all-0.11.1-arm64.dmg"
downloadWindows: "${BASE}/ai-14all-0.11.1-x64-Setup.exe"
---

## download

Latest stable release: **v0.11.1**

- **macOS** (Apple Silicon) — [ai-14all-0.11.1-arm64.dmg](${BASE}/ai-14all-0.11.1-arm64.dmg) — signed + notarized; opens normally.
- **Windows** (x64) — [ai-14all-0.11.1-x64-Setup.exe](${BASE}/ai-14all-0.11.1-x64-Setup.exe) — unsigned; SmartScreen may warn on first run → **More info → Run anyway**.

> Both builds auto-update in the background on launch, prompting **Restart now / Later**. Windows on arm64 is a manual zip from the [releases page](https://github.com/ai-creed/ai-14all/releases/latest); no Intel macOS or Linux artifacts yet.

## requirements

- macOS on Apple Silicon (arm64), or Windows 10/11 on x64
- Node 24+, pnpm, git

## known limits

- macOS (Apple Silicon, signed + notarized) and Windows (x64 installer, unsigned — SmartScreen warns once); Windows on arm64 is a manual zip. No Intel macOS or Linux artifacts yet.
`;

describe("transformAiCreedMdx", () => {
	it("promotes the universal dmg to the default frontmatter download", () => {
		const out = transformAiCreedMdx(STALE);
		expect(out).toMatch(
			/download: "https:\/\/[^"]*\/ai-14all-0\.11\.1-universal\.dmg"/,
		);
		expect(out).not.toMatch(/download: "https:\/\/[^"]*-arm64\.dmg"/);
	});

	it("exposes universal (default) and arm64 (secondary native) macOS bullets", () => {
		const out = transformAiCreedMdx(STALE);
		expect(out).toContain(
			`- **macOS** (Universal — Intel + Apple Silicon) — [ai-14all-0.11.1-universal.dmg](${BASE}/ai-14all-0.11.1-universal.dmg) — signed + notarized; runs on any Mac.`,
		);
		expect(out).toContain(
			`- **macOS** (Apple Silicon, native) — [ai-14all-0.11.1-arm64.dmg](${BASE}/ai-14all-0.11.1-arm64.dmg) — slimmer native download for Apple Silicon.`,
		);
		// Universal is listed first (the default), arm64 second.
		expect(out.indexOf("(Apple Silicon, native)")).toBeGreaterThan(
			out.indexOf("(Universal — Intel + Apple Silicon)"),
		);
		// The original single Apple-Silicon bullet is gone.
		expect(out).not.toContain(
			"- **macOS** (Apple Silicon) — [ai-14all-0.11.1-arm64.dmg]",
		);
	});

	it("drops the stale 'no Intel macOS' copy, preserving sentence case", () => {
		const out = transformAiCreedMdx(STALE);
		expect(out).not.toContain("Intel macOS");
		expect(out).toContain("no Linux artifacts yet."); // download blockquote
		expect(out).toContain("No Linux artifacts yet."); // known limits
	});

	it("notes Intel support in requirements and known limits", () => {
		const out = transformAiCreedMdx(STALE);
		expect(out).toContain(
			"- macOS on Apple Silicon (arm64) or Intel (x64), or Windows 10/11 on x64",
		);
		expect(out).toContain(
			"- macOS (Universal — Intel + Apple Silicon, signed + notarized) and Windows",
		);
	});

	it("preserves unrelated content (Windows download, frontmatter)", () => {
		const out = transformAiCreedMdx(STALE);
		expect(out).toContain(
			`- **Windows** (x64) — [ai-14all-0.11.1-x64-Setup.exe](${BASE}/ai-14all-0.11.1-x64-Setup.exe)`,
		);
		expect(out).toContain(
			`downloadWindows: "${BASE}/ai-14all-0.11.1-x64-Setup.exe"`,
		);
		expect(out).toContain('name: "ai-14all"');
	});

	it("is idempotent — a second pass changes nothing", () => {
		const once = transformAiCreedMdx(STALE);
		const twice = transformAiCreedMdx(once);
		expect(twice).toBe(once);
	});
});
