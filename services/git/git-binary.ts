import { existsSync as defaultExistsSync } from "node:fs";

export type GetGitBinaryOptions = {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	existsSync?: (p: string) => boolean;
};

export function getGitBinaryPath(options: GetGitBinaryOptions = {}): string {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const existsSync = options.existsSync ?? defaultExistsSync;

	if (env.AI14ALL_GIT_PATH) {
		return env.AI14ALL_GIT_PATH;
	}

	if (platform === "darwin") {
		const candidates = [
			"/usr/bin/git", // Xcode Command Line Tools
			"/opt/homebrew/bin/git", // Homebrew on Apple Silicon
			"/usr/local/bin/git", // Homebrew on Intel
		];
		const found = candidates.find((p) => existsSync(p));
		if (found) return found;
		return "git";
	}

	if (platform === "win32") {
		const localAppData = env.LOCALAPPDATA;
		const candidates = [
			"C:\\Program Files\\Git\\cmd\\git.exe",
			"C:\\Program Files (x86)\\Git\\cmd\\git.exe",
			...(localAppData ? [`${localAppData}\\Programs\\Git\\cmd\\git.exe`] : []),
		];
		const found = candidates.find((p) => existsSync(p));
		if (found) return found;
		// child_process on Windows resolves the literal name against PATH; the
		// `.exe` suffix is required (PATHEXT is not applied without a shell).
		return "git.exe";
	}

	return "git";
}
