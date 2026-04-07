import { existsSync } from "node:fs";

export function getGitBinaryPath(): string {
	if (process.env.AI14ALL_GIT_PATH) {
		return process.env.AI14ALL_GIT_PATH;
	}

	if (process.platform === "darwin") {
		const candidates = [
			"/usr/bin/git",          // Xcode Command Line Tools
			"/opt/homebrew/bin/git", // Homebrew on Apple Silicon
			"/usr/local/bin/git",    // Homebrew on Intel
		];
		const found = candidates.find((p) => existsSync(p));
		if (found) return found;
	}

	return "git";
}
