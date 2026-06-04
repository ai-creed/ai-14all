import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export type AvailabilityReason = "no-cortex" | "unsupported-schema";

export interface AvailabilityMarker {
	reason: AvailabilityReason;
	schemaVersion?: string;
	checkedAt: string;
}

interface MarkerKeys {
	repoKey: string;
	worktreeKey: string;
}

function markerPath(codeNavCacheRoot: string, keys: MarkerKeys): string {
	return join(
		codeNavCacheRoot,
		keys.repoKey,
		`${keys.worktreeKey}.unavailable.json`,
	);
}

export function writeAvailabilityMarker(
	codeNavCacheRoot: string,
	keys: MarkerKeys,
	reason: AvailabilityReason,
	schemaVersion?: string,
): void {
	const p = markerPath(codeNavCacheRoot, keys);
	mkdirSync(dirname(p), { recursive: true });
	const marker: AvailabilityMarker = {
		reason,
		checkedAt: new Date().toISOString(),
		...(schemaVersion ? { schemaVersion } : {}),
	};
	writeFileSync(p, JSON.stringify(marker, null, 2));
}

export function clearAvailabilityMarker(
	codeNavCacheRoot: string,
	keys: MarkerKeys,
): void {
	rmSync(markerPath(codeNavCacheRoot, keys), { force: true });
}

export function readAvailabilityMarker(
	codeNavCacheRoot: string,
	keys: MarkerKeys,
): AvailabilityMarker | null {
	const p = markerPath(codeNavCacheRoot, keys);
	if (!existsSync(p)) return null;
	try {
		return JSON.parse(readFileSync(p, "utf8")) as AvailabilityMarker;
	} catch {
		return null;
	}
}
