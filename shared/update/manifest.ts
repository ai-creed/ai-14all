import { load as parseYaml } from "js-yaml";
import { isStableVersion } from "./semver.js";

export interface UpdateManifestFile {
	url: string;
	sha512: string;
	size: number;
}

export interface UpdateManifest {
	version: string;
	releaseDate: string;
	path: string;
	sha512: string;
	files: UpdateManifestFile[];
}

export type ParseResult =
	| { ok: true; value: UpdateManifest }
	| { ok: false; reason: string };

const DOWNLOAD_HOST_PREFIX =
	"https://github.com/ai-creed/ai-14all/releases/download/";

export function parseManifest(raw: string): ParseResult {
	let doc: unknown;
	try {
		doc = parseYaml(raw);
	} catch (err) {
		return {
			ok: false,
			reason: `yaml parse failed: ${(err as Error).message}`,
		};
	}
	if (!isPlainObject(doc)) {
		return { ok: false, reason: "manifest must be a mapping" };
	}
	const version = doc.version;
	if (typeof version !== "string" || !isStableVersion(version)) {
		return {
			ok: false,
			reason: `version must be strict semver, got ${String(version)}`,
		};
	}
	const releaseDate = doc.releaseDate;
	if (typeof releaseDate !== "string" || releaseDate.length === 0) {
		return { ok: false, reason: "releaseDate must be a non-empty string" };
	}
	const path = doc.path;
	if (typeof path !== "string" || !path.startsWith(DOWNLOAD_HOST_PREFIX)) {
		return { ok: false, reason: `path must live on ${DOWNLOAD_HOST_PREFIX}` };
	}
	const topSha = doc.sha512;
	if (typeof topSha !== "string" || topSha.length === 0) {
		return { ok: false, reason: "sha512 must be a non-empty string" };
	}
	const filesRaw = doc.files;
	if (!Array.isArray(filesRaw) || filesRaw.length === 0) {
		return { ok: false, reason: "files must be a non-empty array" };
	}
	const files: UpdateManifestFile[] = [];
	for (const [i, entry] of filesRaw.entries()) {
		if (!isPlainObject(entry)) {
			return { ok: false, reason: `files[${i}] must be a mapping` };
		}
		const url = entry.url;
		if (typeof url !== "string" || !url.startsWith(DOWNLOAD_HOST_PREFIX)) {
			return {
				ok: false,
				reason: `files[${i}].url must live on ${DOWNLOAD_HOST_PREFIX}`,
			};
		}
		const sha512 = entry.sha512;
		if (typeof sha512 !== "string" || sha512.length === 0) {
			return {
				ok: false,
				reason: `files[${i}].sha512 must be a non-empty string`,
			};
		}
		const size = entry.size;
		if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
			return {
				ok: false,
				reason: `files[${i}].size must be a positive number`,
			};
		}
		files.push({ url, sha512, size });
	}
	return {
		ok: true,
		value: { version, releaseDate, path, sha512: topSha, files },
	};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
