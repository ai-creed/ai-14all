import type { SessionReportResult } from "@ai-creed/command-contract";
import { buildSessionReport } from "./samantha-command-capabilities";
import type { ObserveInput, WorktreeIdentity } from "./observe-types";
import type { WhisperWorktreeState } from "../../../shared/models/ecosystem-plugin";
import type { SamanthaSessionSlice } from "../../../shared/contracts/plugins";

export type SessionReportSources = {
	getIdentities: () => Promise<Record<string, WorktreeIdentity>>;
	getReviewCount: (worktreeId: string) => number;
	getWhisperStates: () => Promise<WhisperWorktreeState[]>;
	getSessionSlice: () => SamanthaSessionSlice | null;
};

export function createSessionReportProvider(
	sources: SessionReportSources,
): () => Promise<SessionReportResult> {
	return async () => {
		const [identities, whisper] = await Promise.all([
			sources.getIdentities(),
			sources.getWhisperStates(),
		]);
		const reviewCounts: Record<string, number> = {};
		for (const id of Object.keys(identities)) reviewCounts[id] = sources.getReviewCount(id);
		const input: ObserveInput = { identities, reviewCounts, whisper, session: sources.getSessionSlice() };
		return buildSessionReport(input);
	};
}
