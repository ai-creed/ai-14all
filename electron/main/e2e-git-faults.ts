import { existsSync, readFileSync, writeFileSync } from "node:fs";

type GitFaultState = {
	readSummaryFailuresRemaining?: number;
	readCommitHistoryFailuresRemaining?: number;
	readCommitDetailFailuresRemaining?: number;
	readDiffFailuresRemaining?: number;
};

export function consumeE2eGitFault(key: keyof GitFaultState): boolean {
	if (!process.env.AI14ALL_E2E || !process.env.AI14ALL_E2E_GIT_FAULTS_PATH) return false;
	const controlPath = process.env.AI14ALL_E2E_GIT_FAULTS_PATH;
	if (!existsSync(controlPath)) return false;

	const state = JSON.parse(readFileSync(controlPath, "utf8")) as GitFaultState;
	const remaining = state[key] ?? 0;
	if (remaining <= 0) return false;

	state[key] = remaining - 1;
	writeFileSync(controlPath, JSON.stringify(state));
	return true;
}
