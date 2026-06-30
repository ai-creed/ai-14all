#!/usr/bin/env node
// Idempotently update the ai-creed public download page
// (src/content/projects/ai-14all.mdx) so the macOS download exposes the
// UNIVERSAL dmg as the default and the arm64 dmg as a secondary "Apple Silicon
// (native)" link, and drop the stale "no Intel macOS" copy.
//
// Run from release.yml's "Publish manifest to ai-creed" step BEFORE the
// version-bump sed. This makes the FIRST universal release atomically expose
// the universal download at the exact moment the universal dmg becomes
// downloadable — avoiding the 404 window a pre-release manual edit would open
// (the universal artifact does not exist for older arm64-only versions). The
// subsequent sed keeps both dmg links pinned to the released version.
//
// Idempotent: every transformation matches only the original arm64-only shape,
// so a second run on already-transformed content is a no-op.

import { readFileSync, writeFileSync } from "node:fs";

export function transformAiCreedMdx(raw) {
	let out = raw;

	// 1. Frontmatter default download → universal dmg (runs on every Mac).
	out = out.replace(
		/^(download: "https:\/\/[^"]*\/)ai-14all-([0-9.]+)-arm64\.dmg"/m,
		'$1ai-14all-$2-universal.dmg"',
	);

	// 2. Split the single Apple-Silicon macOS bullet into universal (default) +
	//    arm64 (secondary, native). The version in the link text and the href
	//    are tied with a backreference. Matches only the original single-arm64
	//    bullet, so it is a no-op once already split.
	out = out.replace(
		/^- \*\*macOS\*\* \(Apple Silicon\) — \[ai-14all-([0-9.]+)-arm64\.dmg\]\((https:\/\/[^)]*\/)ai-14all-\1-arm64\.dmg\) — signed \+ notarized; opens normally\.$/m,
		(_match, ver, base) =>
			`- **macOS** (Universal — Intel + Apple Silicon) — [ai-14all-${ver}-universal.dmg](${base}ai-14all-${ver}-universal.dmg) — signed + notarized; runs on any Mac.\n` +
			`- **macOS** (Apple Silicon, native) — [ai-14all-${ver}-arm64.dmg](${base}ai-14all-${ver}-arm64.dmg) — slimmer native download for Apple Silicon.`,
	);

	// 3. Drop the "Intel macOS" clause wherever it appears (the download
	//    blockquote and the known-limits line), preserving the sentence's
	//    leading capitalization ("no …" vs "No …").
	out = out.replace(
		/([Nn])o Intel macOS or Linux artifacts yet\./g,
		"$1o Linux artifacts yet.",
	);

	// 4. Requirements: macOS now runs on Intel too.
	out = out.replace(
		/^- macOS on Apple Silicon \(arm64\), or Windows/m,
		"- macOS on Apple Silicon (arm64) or Intel (x64), or Windows",
	);

	// 5. Known limits: relabel the macOS line as Universal.
	out = out.replace(
		/^- macOS \(Apple Silicon, signed \+ notarized\) and Windows/m,
		"- macOS (Universal — Intel + Apple Silicon, signed + notarized) and Windows",
	);

	return out;
}

function main() {
	const file = process.argv[2];
	if (!file) {
		console.error(
			"usage: node scripts/ci/ensure-ai-creed-universal-download.mjs <ai-14all.mdx>",
		);
		process.exit(2);
	}
	const raw = readFileSync(file, "utf8");
	const out = transformAiCreedMdx(raw);
	if (out === raw) {
		process.stdout.write(`ai-creed download page already current: ${file}\n`);
	} else {
		writeFileSync(file, out);
		process.stdout.write(`ai-creed download page updated: ${file}\n`);
	}
}

// Run only when invoked directly, not when imported by the unit tests.
if (
	process.argv[1] &&
	import.meta.url === new URL(process.argv[1], "file:").href
) {
	main();
}
