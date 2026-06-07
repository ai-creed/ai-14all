// Ensure Electron's app bundle is FULLY installed (needed for the E2E
// `_electron.launch`). electron@41's bundled `extract-zip` leaves
// `Electron.app` incomplete under Node 24 — it writes the ~34KB launcher but
// omits `Contents/Frameworks/Electron Framework.framework`, and also skips
// writing `path.txt`. Playwright then fails to launch electron with a dyld
// "Library not loaded: @rpath/Electron Framework.framework" error.
//
// Fix: if the framework is missing, re-extract the (already downloaded) cached
// electron zip with macOS `ditto`, which handles the .app bundle correctly, and
// (re)write the `path.txt` that electron's index.js reads.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const electronPkgJson = require.resolve("electron/package.json");
const electronDir = path.dirname(electronPkgJson);
const { version } = require(electronPkgJson);
// @electron/get and extract-zip are electron's own deps (nested under it in the
// pnpm store, not hoisted), so resolve them from electron's location.
const electronRequire = createRequire(electronPkgJson);
const dist = path.join(electronDir, "dist");

const platformPath =
	process.platform === "darwin"
		? "Electron.app/Contents/MacOS/Electron"
		: process.platform === "win32"
			? "electron.exe"
			: "electron";

function appComplete() {
	if (process.platform === "darwin") {
		return fs.existsSync(
			path.join(
				dist,
				"Electron.app/Contents/Frameworks/Electron Framework.framework/Electron Framework",
			),
		);
	}
	return fs.existsSync(path.join(dist, platformPath));
}

async function main() {
	if (!appComplete()) {
		console.log("[ensure-electron] app bundle incomplete — re-extracting");
		const { downloadArtifact } = electronRequire("@electron/get");
		const zip = await downloadArtifact({
			version,
			artifactName: "electron",
			platform: process.platform,
			arch: process.arch,
		});
		fs.rmSync(dist, { recursive: true, force: true });
		fs.mkdirSync(dist, { recursive: true });
		if (process.platform === "darwin") {
			execFileSync("ditto", ["-x", "-k", zip, dist], { stdio: "inherit" });
		} else {
			const extract = electronRequire("extract-zip");
			await extract(zip, { dir: dist });
		}
		if (!appComplete()) {
			throw new Error("electron app still incomplete after re-extraction");
		}
	}
	fs.writeFileSync(path.join(electronDir, "path.txt"), platformPath);
	require("electron");
	console.log("[ensure-electron] electron resolves OK:", require("electron"));
}

main().catch((err) => {
	console.error("[ensure-electron] failed:", err);
	process.exit(1);
});
