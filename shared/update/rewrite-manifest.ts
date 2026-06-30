import { dump as dumpYaml, load as parseYaml } from "js-yaml";

const BASE = "https://github.com/ai-creed/ai-14all/releases/download";

interface EmittedFile {
	url: string;
	sha512: string;
	size: number;
}

interface EmittedManifest {
	version: string;
	releaseDate: string;
	path: string;
	sha512: string;
	files: EmittedFile[];
}

export function rewriteManifest(raw: string, targetVersion: string): string {
	const doc = parseYaml(raw) as EmittedManifest | undefined;
	if (!doc || typeof doc !== "object") {
		throw new Error("emitted manifest is not a mapping");
	}
	if (doc.version !== targetVersion) {
		throw new Error(
			`emitted version ${doc.version} does not match target ${targetVersion}`,
		);
	}
	if (!Array.isArray(doc.files) || doc.files.length === 0) {
		throw new Error("emitted manifest has no files");
	}
	const versionedBase = `${BASE}/v${targetVersion}/`;
	const rewrittenFiles = doc.files.map((file) => {
		if (file.url.startsWith("https://") || file.url.startsWith("http://")) {
			throw new Error(`files[].url already absolute: ${file.url}`);
		}
		return { ...file, url: `${versionedBase}${file.url}` };
	});
	const dmgs = rewrittenFiles.filter((f) => f.url.endsWith(".dmg"));
	if (dmgs.length === 0) {
		throw new Error("emitted manifest has no .dmg file entry");
	}
	// With both a universal and an arm64 dmg present, the legacy top-level
	// path/sha512 must be deterministic rather than order-dependent: prefer the
	// universal dmg (it runs on every Mac). electron-updater 6.x uses the
	// arch-filtered zip from files[] for mac auto-update, so this top-level
	// pointer is only a legacy fallback — see the design spec section 5.5.
	const dmg = dmgs.find((f) => /-universal\.dmg$/.test(f.url)) ?? dmgs[0];
	const published: EmittedManifest = {
		version: doc.version,
		releaseDate: doc.releaseDate,
		path: dmg.url,
		sha512: dmg.sha512,
		files: rewrittenFiles,
	};
	return dumpYaml(published, { lineWidth: -1, quotingType: "'" });
}
