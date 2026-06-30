import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const RELEASE_DIR = "release";

/** List every .dmg in a directory listing (ignores .blockmap and other files),
 *  sorted for deterministic order. The universal+arm64 build produces TWO dmgs
 *  (`…-arm64.dmg` and `…-universal.dmg`) and BOTH must be signed/notarized/
 *  stapled. Throws if zero .dmg are present — that means packaging produced no
 *  installer, a real error we must not sail past. */
export function listDmgs(entries, dir = RELEASE_DIR) {
	const dmgs = entries.filter((name) => name.endsWith(".dmg"));
	if (dmgs.length === 0) {
		throw new Error(`no .dmg found in ${dir}/`);
	}
	return dmgs.sort().map((name) => join(dir, name));
}

/** Parse `security find-identity -v -p codesigning` output into {hash,name}. */
export function parseIdentities(output) {
	const ids = [];
	for (const line of output.split("\n")) {
		const m = line.match(/^\s*\d+\)\s+([0-9A-Fa-f]+)\s+"(.+)"\s*$/);
		if (m) ids.push({ hash: m[1], name: m[2] });
	}
	return ids;
}

/** Find the "Developer ID Application: … (TEAMID)" identity for a team. */
export function findDeveloperIdApplication(identities, teamId) {
	return (
		identities.find(
			(id) =>
				id.name.startsWith("Developer ID Application") &&
				id.name.includes(`(${teamId})`),
		) ?? null
	);
}

export function buildCodesignArgs({ dmg, identity, keychain }) {
	return [
		"--force",
		"--timestamp",
		"--sign",
		identity,
		...(keychain ? ["--keychain", keychain] : []),
		dmg,
	];
}

export function buildNotarizeArgs({ dmg, keyPath, keyId, issuer }) {
	return [
		"submit",
		dmg,
		"--key",
		keyPath,
		"--key-id",
		keyId,
		"--issuer",
		issuer,
		"--wait",
	];
}

export function buildStapleArgs(dmg) {
	return ["staple", dmg];
}

function run(cmd, args, label) {
	const result = spawnSync(cmd, args, { stdio: "inherit" });
	if (result.status !== 0) {
		throw new Error(`${label} failed (exit ${result.status ?? "signal"})`);
	}
}

/** Sign + notarize + staple the DMG that electron-builder produced. The app
 *  inside is already signed/notarized/stapled; electron-builder does not handle
 *  the DMG container, so this closes that gap. Identity must be reachable via
 *  `security find-identity` (true on dev machines; CI imports the cert first). */
export function main() {
	const teamId = process.env.APPLE_TEAM_ID;
	const keyPath = process.env.APPLE_API_KEY;
	const keyId = process.env.APPLE_API_KEY_ID;
	const issuer = process.env.APPLE_API_ISSUER;
	const missing = [
		["APPLE_TEAM_ID", teamId],
		["APPLE_API_KEY", keyPath],
		["APPLE_API_KEY_ID", keyId],
		["APPLE_API_ISSUER", issuer],
	]
		.filter(([, v]) => !v)
		.map(([k]) => k);
	if (missing.length) {
		throw new Error(`missing required env: ${missing.join(", ")}`);
	}

	const dmgs = listDmgs(readdirSync(RELEASE_DIR));

	const found = spawnSync(
		"security",
		["find-identity", "-v", "-p", "codesigning"],
		{ encoding: "utf8" },
	);
	const identity = findDeveloperIdApplication(
		parseIdentities(found.stdout ?? ""),
		teamId,
	);
	if (!identity) {
		throw new Error(
			`No "Developer ID Application: … (${teamId})" identity found in the keychain. ` +
				"On a dev machine import your Developer ID cert; in CI import CSC_LINK first.",
		);
	}

	// Sign + notarize + staple EVERY produced dmg (arm64 and universal). The
	// identity is the same for all; resolve it once, then process each dmg.
	for (const dmg of dmgs) {
		process.stdout.write(`Signing DMG ${dmg} with ${identity.name}\n`);
		run(
			"codesign",
			buildCodesignArgs({ dmg, identity: identity.name }),
			"codesign",
		);

		process.stdout.write(`Notarizing DMG ${dmg} (waiting on Apple)…\n`);
		run(
			"xcrun",
			["notarytool", ...buildNotarizeArgs({ dmg, keyPath, keyId, issuer })],
			"notarytool submit",
		);

		process.stdout.write(`Stapling DMG ${dmg}\n`);
		run("xcrun", ["stapler", ...buildStapleArgs(dmg)], "stapler staple");

		process.stdout.write(`DMG signed, notarized, and stapled: ${dmg}\n`);
	}
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
	try {
		main();
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}
