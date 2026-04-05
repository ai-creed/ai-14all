export function getGitBinaryPath(): string {
	if (process.env.AI14ALL_GIT_PATH) {
		return process.env.AI14ALL_GIT_PATH;
	}

	if (process.platform === "darwin") {
		return "/usr/bin/git";
	}

	return "git";
}
