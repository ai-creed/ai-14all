import { readFileSync } from "node:fs";

export function readClaudeTier(credentialsPath: string): string {
	try {
		const parsed = JSON.parse(readFileSync(credentialsPath, "utf8")) as {
			claudeAiOauth?: { rateLimitTier?: unknown };
		};
		const tier = parsed?.claudeAiOauth?.rateLimitTier;
		return typeof tier === "string" ? tier : "";
	} catch {
		return "";
	}
}
