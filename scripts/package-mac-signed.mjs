import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_FILE = ".env.local";

/** Minimal KEY=VALUE parser (ignores blank lines and # comments, strips quotes).
 *  NOTE: one line per variable — it cannot represent multi-line values such as
 *  a PEM. That limitation is why APPLE_API_KEY_P8 (a multi-line .p8) must not be
 *  pasted into .env.local; use APPLE_API_KEY (a file path) locally instead. */
export function parseEnvFile(text) {
	const env = {};
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		env[key] = value;
	}
	return env;
}

/** A complete PEM has both the BEGIN and END armor lines. A multi-line .p8 that
 *  was flattened by the line parser keeps only the BEGIN line, so this returns
 *  false — which is exactly the misconfiguration we want to catch. */
export function isCompletePem(text) {
	if (typeof text !== "string") return false;
	return /-----BEGIN [^-]+-----/.test(text) && /-----END [^-]+-----/.test(text);
}

/** Decide how the App Store Connect API key is provided, or throw a clear error.
 *  - APPLE_API_KEY set  → use it as a file path (preferred for local builds).
 *  - else APPLE_API_KEY_P8 set → must be a COMPLETE PEM (CI injects it intact);
 *    an incomplete value means a multi-line paste got truncated by parseEnvFile.
 *  - neither → error. */
export function validateApiKeyConfig(env) {
	if (env.APPLE_API_KEY) {
		return { mode: "path", path: env.APPLE_API_KEY };
	}
	if (env.APPLE_API_KEY_P8) {
		if (!isCompletePem(env.APPLE_API_KEY_P8)) {
			throw new Error(
				"APPLE_API_KEY_P8 is not a complete PEM (missing the -----END----- line). " +
					"A multi-line .p8 pasted into .env.local gets truncated to its first line. " +
					"For local builds set APPLE_API_KEY to the .p8 file path instead, e.g.\n" +
					"  APPLE_API_KEY=/path/to/AuthKey_XXXXXXXXXX.p8\n" +
					"and leave APPLE_API_KEY_P8 empty. (APPLE_API_KEY_P8 is for CI secrets only.)",
			);
		}
		return { mode: "contents", contents: env.APPLE_API_KEY_P8 };
	}
	throw new Error(
		"No App Store Connect API key configured. Set APPLE_API_KEY (path to the " +
			".p8) or APPLE_API_KEY_P8 (the .p8 contents) in .env.local.",
	);
}

export function main() {
	if (!existsSync(ENV_FILE)) {
		console.error(
			`${ENV_FILE} not found. Copy .env.local.example and fill in your signing credentials.`,
		);
		process.exit(1);
	}

	const parsed = parseEnvFile(readFileSync(ENV_FILE, "utf8"));
	for (const [key, value] of Object.entries(parsed)) {
		process.env[key] = value;
	}

	let config;
	try {
		config = validateApiKeyConfig(process.env);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}

	if (config.mode === "contents") {
		const dir = mkdtempSync(join(tmpdir(), "ai14all-signing-"));
		const keyPath = join(dir, "AuthKey.p8");
		writeFileSync(keyPath, config.contents);
		process.env.APPLE_API_KEY = keyPath;
	}

	const result = spawnSync("pnpm", ["package:mac"], {
		stdio: "inherit",
		env: process.env,
		shell: process.platform === "win32",
	});
	process.exit(result.status ?? 1);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
	main();
}
