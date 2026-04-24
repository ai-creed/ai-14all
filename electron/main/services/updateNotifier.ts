import { readFileSync } from "node:fs";
import type { WebContents } from "electron";
import { parseManifest } from "../../../shared/update/manifest.js";
import { compareStableVersions, isStableVersion } from "../../../shared/update/semver.js";
import type { UpdateInfo } from "../../../shared/contracts/commands.js";

export type UpdateDecision =
	| { kind: "notify"; info: UpdateInfo }
	| { kind: "silent"; reason: string };

export interface DecideInput {
	currentVersion: string;
	manifestYaml: string;
}

export function decideUpdateAction(input: DecideInput): UpdateDecision {
	if (!isStableVersion(input.currentVersion)) {
		return { kind: "silent", reason: "current version is not stable" };
	}
	const parsed = parseManifest(input.manifestYaml);
	if (!parsed.ok) {
		return { kind: "silent", reason: `invalid manifest: ${parsed.reason}` };
	}
	const m = parsed.value;
	if (compareStableVersions(m.version, input.currentVersion) <= 0) {
		return { kind: "silent", reason: "manifest not newer than current" };
	}
	return {
		kind: "notify",
		info: { version: m.version, url: m.path, releaseDate: m.releaseDate },
	};
}

const MANIFEST_URL = "https://ai-creed.dev/ai-14all/latest-mac.yml";
const FETCH_TIMEOUT_MS = 5_000;
const STARTUP_DELAY_MS = 3_000;

export interface StartArgs {
	currentVersion: string;
	webContents: WebContents;
	isPackaged: boolean;
	logger?: { warn(msg: string, err?: unknown): void; info(msg: string): void };
}

export function startUpdateNotifier(args: StartArgs): () => void {
	const log = args.logger ?? {
		warn: (m: string, e?: unknown) => console.warn(`[update] ${m}`, e ?? ""),
		info: (m: string) => console.info(`[update] ${m}`),
	};
	const e2eForce = process.env.AI14ALL_E2E_UPDATE_FORCE === "1";
	const e2eFile = process.env.AI14ALL_E2E_UPDATE_MANIFEST_FILE;
	const e2eUrl = process.env.AI14ALL_E2E_UPDATE_MANIFEST_URL;
	if (!args.isPackaged && !e2eForce && !e2eFile && !e2eUrl) {
		log.info("notifier disabled in dev");
		return () => {};
	}
	let cancelled = false;
	const timer = setTimeout(() => {
		if (cancelled) return;
		void runOnce().catch((err) => log.warn("notifier run failed", err));
	}, STARTUP_DELAY_MS);
	return () => {
		cancelled = true;
		clearTimeout(timer);
	};

	async function runOnce(): Promise<void> {
		if (e2eForce) {
			const info = {
				version: process.env.AI14ALL_E2E_UPDATE_VERSION ?? "99.0.0",
				url:
					process.env.AI14ALL_E2E_UPDATE_URL ??
					"https://downloads.ai-creed.dev/ai-14all/99.0.0/ai-14all-99.0.0-arm64.dmg",
				releaseDate:
					process.env.AI14ALL_E2E_UPDATE_RELEASE_DATE ?? new Date().toISOString(),
			};
			args.webContents.send("update:available", info);
			return;
		}
		let text: string;
		if (e2eFile) {
			try {
				text = readFileSync(e2eFile, "utf8");
			} catch (err) {
				log.warn(`failed to read fixture ${e2eFile}`, err);
				return;
			}
		} else {
			const url = e2eUrl ?? MANIFEST_URL;
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
			try {
				const resp = await fetch(url, { signal: controller.signal });
				if (!resp.ok) {
					log.warn(`fetch failed with status ${resp.status}`);
					return;
				}
				text = await resp.text();
			} catch (err) {
				log.warn("fetch failed", err);
				return;
			} finally {
				clearTimeout(timeout);
			}
		}
		const decision = decideUpdateAction({
			currentVersion: args.currentVersion,
			manifestYaml: text,
		});
		if (decision.kind === "silent") {
			log.info(`silent: ${decision.reason}`);
			return;
		}
		args.webContents.send("update:available", decision.info);
	}
}
