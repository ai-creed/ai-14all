export function describeRepositoryLoadError(err: unknown): string {
	const message = err instanceof Error ? err.message : String(err);
	const normalized = message.toLowerCase();

	if (
		normalized.includes("enoent") ||
		normalized.includes("no such file or directory")
	) {
		return "Path does not exist.";
	}
	if (normalized.includes("not a git repository")) {
		return "Path is not a Git repository.";
	}
	if (
		normalized.includes("repository metadata") ||
		normalized.includes("git config")
	) {
		return "Repository metadata could not be read.";
	}
	return message;
}
