import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_FILE = ".env.local";
if (!existsSync(ENV_FILE)) {
	console.error(
		`${ENV_FILE} not found. Copy .env.local.example and fill in your signing credentials.`,
	);
	process.exit(1);
}

// Minimal KEY=VALUE parser (ignores blank lines and # comments).
for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
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
	process.env[key] = value;
}

// If the API key is provided inline, materialize it to a temp .p8 file.
if (process.env.APPLE_API_KEY_P8 && !process.env.APPLE_API_KEY) {
	const dir = mkdtempSync(join(tmpdir(), "ai14all-signing-"));
	const keyPath = join(dir, "AuthKey.p8");
	writeFileSync(keyPath, process.env.APPLE_API_KEY_P8);
	process.env.APPLE_API_KEY = keyPath;
}

const result = spawnSync("pnpm", ["package:mac"], {
	stdio: "inherit",
	env: process.env,
	shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
