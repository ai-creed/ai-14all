import type { Worktree } from "../../shared/models/worktree.js";

/**
 * Parses the output of `git worktree list --porcelain` into Worktree objects.
 *
 * Records are separated by blank lines. Each record has the form:
 *   worktree <path>
 *   HEAD <sha>
 *   branch refs/heads/<name>   (or "detached" for detached HEAD)
 */
export function parseWorktreePorcelain(
	input: string,
	repositoryId: string,
): Worktree[] {
	const records = input.split(/\n\n+/).filter((r) => r.trim().length > 0);

	return records.map((record, index) => {
		const lines = record.split("\n").filter((l) => l.trim().length > 0);

		let worktreePath = "";
		let headSha = "";
		let branchRef = "";
		let isDetached = false;

		for (const line of lines) {
			if (line.startsWith("worktree ")) {
				worktreePath = line.slice("worktree ".length);
			} else if (line.startsWith("HEAD ")) {
				headSha = line.slice("HEAD ".length);
			} else if (line.startsWith("branch ")) {
				branchRef = line.slice("branch ".length);
			} else if (line.trim() === "detached") {
				isDetached = true;
			}
		}

		// Normalize refs/heads/<name> to <name>
		let branchName: string;
		if (isDetached || branchRef === "") {
			branchName = headSha;
		} else {
			branchName = branchRef.replace(/^refs\/heads\//, "");
		}

		const label = worktreePath.split("/").filter(Boolean).pop() ?? branchName;
		const isMain = index === 0;

		return {
			id: worktreePath,
			repositoryId,
			branchName,
			path: worktreePath,
			label,
			isMain,
		};
	});
}
