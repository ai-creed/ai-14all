import {
	clearAvailabilityMarker,
	writeAvailabilityMarker,
	type AvailabilityReason,
} from "../source/availability-marker.js";
import type { IngestResult } from "../ingest/cortex-store-to-mirror.js";
import type { WorktreeKeys } from "../cortex-index-service.js";

export type CodeNavEvent =
	| "code-nav:worktreeIndexRefreshed"
	| "code-nav:worktreeUnavailable";

export interface ReconcileDeps {
	codeNavCacheRoot: string;
	cortexIndex: { invalidate(keys: WorktreeKeys): void };
	emit(event: CodeNavEvent, payload: Record<string, unknown>): void;
}

const REASON_MAP: Record<
	"no-store" | "unsupported-schema",
	AvailabilityReason
> = {
	"no-store": "no-cortex",
	"unsupported-schema": "unsupported-schema",
};

/** Single place the marker write/clear + availability events happen. */
export function reconcileAvailability(
	deps: ReconcileDeps,
	keys: WorktreeKeys,
	ids: { workspaceId: string; worktreeId: string },
	result: IngestResult,
): void {
	if (result.unavailable) {
		const reason = REASON_MAP[result.reason];
		writeAvailabilityMarker(
			deps.codeNavCacheRoot,
			keys,
			reason,
			result.schemaVersion,
		);
		deps.emit("code-nav:worktreeUnavailable", { ...ids, reason });
		return;
	}
	clearAvailabilityMarker(deps.codeNavCacheRoot, keys);
	if (!result.skipped) {
		deps.cortexIndex.invalidate(keys);
		deps.emit("code-nav:worktreeIndexRefreshed", ids);
	}
}
