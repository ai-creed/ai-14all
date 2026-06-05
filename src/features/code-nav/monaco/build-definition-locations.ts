// Monaco-free so it is unit-testable (importing monaco-editor in vitest/jsdom
// throws on document.queryCommandSupported). The provider imports this and adds
// the monaco Uri/Range wrapping.
import type { DefinitionRowPayload } from "../../../../shared/contracts/commands.js";
import type { ProvisionRef } from "./model-provisioner.js";

export type DefRow = DefinitionRowPayload;

export interface BuiltDefLocation {
	uriString: string;
	range: {
		startLine: number;
		startCol: number;
		endLine: number;
		endCol: number;
	};
}

/**
 * For each ranked row, provision a model and produce a file:// location with a
 * precise range. Rows whose model can't be provisioned (binary/unreadable) are
 * omitted. Order (best-first) is preserved. Sets the __codeNavTestLastDefUri
 * e2e seam here so the unit test covers it.
 */
export async function buildDefinitionLocations(
	rows: DefRow[],
	ref: ProvisionRef,
	ensureModel: (ref: ProvisionRef, relFile: string) => Promise<string | null>,
): Promise<BuiltDefLocation[]> {
	const located = await Promise.all(
		rows.map(async (r) => {
			const uriString = await ensureModel(ref, r.file);
			if (!uriString) return null;
			const startCol = r.col ?? 1;
			return {
				uriString,
				range: {
					startLine: r.line,
					startCol,
					endLine: r.end_line ?? r.line,
					endCol: r.end_col ?? startCol,
				},
			} satisfies BuiltDefLocation;
		}),
	);
	const result = located.filter((l): l is BuiltDefLocation => l !== null);
	// E2E seam: the top definition target URI (a file:// URI).
	if (typeof window !== "undefined") {
		(
			window as unknown as { __codeNavTestLastDefUri?: string }
		).__codeNavTestLastDefUri = result[0]?.uriString;
	}
	return result;
}
