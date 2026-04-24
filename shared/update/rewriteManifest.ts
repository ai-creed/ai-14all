import { dump as dumpYaml, load as parseYaml } from "js-yaml";

const BASE = "https://downloads.ai-creed.dev/ai-14all";

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
	const versionedBase = `${BASE}/${targetVersion}/`;
	const rewrittenFiles = doc.files.map((file) => {
		if (file.url.startsWith("http")) {
			throw new Error(`files[].url already absolute: ${file.url}`);
		}
		return { ...file, url: `${versionedBase}${file.url}` };
	});
	const dmg = rewrittenFiles.find((f) => f.url.endsWith(".dmg"));
	if (!dmg) {
		throw new Error("emitted manifest has no .dmg file entry");
	}
	const published: EmittedManifest = {
		version: doc.version,
		releaseDate: doc.releaseDate,
		path: dmg.url,
		sha512: dmg.sha512,
		files: rewrittenFiles,
	};
	return dumpYaml(published, { lineWidth: -1, quotingType: "'" });
}
