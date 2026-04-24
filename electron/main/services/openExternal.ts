import { shell } from "electron";

const ALLOWED_HOST = "github.com";
const E2E_CAPTURE_KEY = "__AI14ALL_E2E_OPEN_EXTERNAL_CALLS__";

export function isAllowedExternalUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	return parsed.protocol === "https:" && parsed.hostname === ALLOWED_HOST;
}

export async function openExternalUrl(url: string): Promise<void> {
	if (!isAllowedExternalUrl(url)) {
		throw new Error(`refusing to open URL outside ${ALLOWED_HOST}: ${url}`);
	}
	if (process.env.AI14ALL_E2E === "1") {
		const g = globalThis as unknown as Record<string, string[] | undefined>;
		const arr = (g[E2E_CAPTURE_KEY] ??= []);
		arr.push(url);
		return;
	}
	await shell.openExternal(url);
}
