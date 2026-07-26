import { parseManifest } from "../../../shared/update/manifest.js";
import {
	compareStableVersions,
	isStableVersion,
} from "../../../shared/update/semver.js";
import type { UpdateInfo } from "../../../shared/contracts/commands.js";

export type UpdateDecision =
	| { kind: "notify"; info: UpdateInfo }
	| { kind: "silent"; reason: string };

export interface DecideInput {
	currentVersion: string;
	manifestYaml: string;
	/** Allow non-stable current versions to proceed past the semver guard.
	 *  Set to true in E2E mode so beta builds can exercise the manifest-file
	 *  decision path. When set and currentVersion IS stable, the version
	 *  comparison still runs normally. */
	skipVersionCheck?: boolean;
}

export function decideUpdateAction(input: DecideInput): UpdateDecision {
	if (!input.skipVersionCheck && !isStableVersion(input.currentVersion)) {
		return { kind: "silent", reason: "current version is not stable" };
	}
	const parsed = parseManifest(input.manifestYaml);
	if (!parsed.ok) {
		return { kind: "silent", reason: `invalid manifest: ${parsed.reason}` };
	}
	const m = parsed.value;
	// When skipVersionCheck is set the current version may be a pre-release, so
	// skip the numeric comparison (any manifest that reaches here is "newer").
	if (!input.skipVersionCheck || isStableVersion(input.currentVersion)) {
		if (compareStableVersions(m.version, input.currentVersion) <= 0) {
			return { kind: "silent", reason: "manifest not newer than current" };
		}
	}
	return {
		kind: "notify",
		info: { version: m.version, url: m.path, releaseDate: m.releaseDate },
	};
}

const STARTUP_DELAY_MS = 3_000;

export interface UpdaterLike {
	autoDownload: boolean;
	autoInstallOnAppQuit: boolean;
	on(event: string, listener: (...args: unknown[]) => void): UpdaterLike;
	checkForUpdates(): Promise<unknown>;
	quitAndInstall(): void;
}

/**
 * Consulted on every install request. Once a native update quit has begun
 * (the native autoUpdater emitted "before-quit-for-update") but the window
 * is still open — its close sweep was prevented — the quit is suspended,
 * not dead: Electron's native updater keeps its WindowList observer
 * registered. Re-invoking quitAndInstall() then would register that
 * observer a second time (an observer-invariant violation), so the guard
 * resumes the armed quit by closing the window through the normal close
 * path instead.
 */
export interface UpdateQuitGuard {
	isUpdateQuitArmed(): boolean;
	resumeUpdateQuit(): void;
}

export interface UpdateServiceArgs {
	updater: UpdaterLike;
	currentVersion: string;
	isPackaged: boolean;
	send: (channel: string, payload?: unknown) => void;
	logger?: { warn(msg: string, err?: unknown): void; info(msg: string): void };
	/**
	 * Host platform/arch, injectable for tests; default to the live process.
	 * The updater does not start on Windows non-x64 builds: arm64 is
	 * manual-download-only in Phase 2 because x64 owns the single Windows
	 * `latest.yml` auto-update channel, and electron-updater would otherwise
	 * fall back to the x64 installer for an arm64 build. macOS (incl.
	 * Apple-Silicon arm64) and Windows x64 are unaffected — the guard is
	 * win32-scoped.
	 */
	platform?: NodeJS.Platform;
	arch?: string;
	quitGuard?: UpdateQuitGuard;
}

export interface UpdateServiceHandle {
	dispose: () => void;
	installUpdate: () => void;
}

interface UpstreamUpdateInfo {
	version: string;
	releaseDate?: string;
}

function toUpdateInfo(info: UpstreamUpdateInfo): UpdateInfo {
	// electron-updater has no single download URL on the info object; the
	// renderer's "Restart now / Later" UI never uses `url`, so it is left empty.
	return {
		version: info.version,
		url: "",
		releaseDate: info.releaseDate ?? new Date().toISOString(),
	};
}

/**
 * Wire electron-updater's autoUpdater into the renderer IPC. Background-download
 * with prompt-to-restart. Stable-channel only; disabled in dev. An E2E hook
 * (AI14ALL_E2E_UPDATE_DOWNLOADED=1) simulates a finished download with no real
 * network or signing so the restart UI is testable.
 */
export function startUpdateService(
	args: UpdateServiceArgs,
): UpdateServiceHandle {
	const log = args.logger ?? {
		warn: (m: string, e?: unknown) => console.warn(`[update] ${m}`, e ?? ""),
		info: (m: string) => console.info(`[update] ${m}`),
	};
	const e2eDownloaded = process.env.AI14ALL_E2E_UPDATE_DOWNLOADED === "1";

	if (e2eDownloaded) {
		const info: UpdateInfo = {
			version: process.env.AI14ALL_E2E_UPDATE_VERSION ?? "99.0.0",
			url: "",
			releaseDate:
				process.env.AI14ALL_E2E_UPDATE_RELEASE_DATE ?? new Date().toISOString(),
		};
		const timer = setTimeout(
			() => args.send("update:downloaded", info),
			STARTUP_DELAY_MS,
		);
		return {
			dispose: () => clearTimeout(timer),
			installUpdate: () => {
				type Capture = { __AI14ALL_E2E_INSTALL_CALLS__?: number };
				const g = globalThis as Capture;
				g.__AI14ALL_E2E_INSTALL_CALLS__ =
					(g.__AI14ALL_E2E_INSTALL_CALLS__ ?? 0) + 1;
			},
		};
	}

	const platform = args.platform ?? process.platform;
	const arch = args.arch ?? process.arch;
	if (platform === "win32" && arch !== "x64") {
		// Phase 2: x64 owns the single Windows latest.yml channel; arm64 is
		// manual-download-only. Without this gate an arm64 build would read the
		// x64 manifest and try to install the x64 NSIS installer (emulated).
		log.info(`updater skipped: no auto-update channel for win32/${arch}`);
		return { dispose: () => {}, installUpdate: () => {} };
	}

	if (!args.isPackaged) {
		log.info("updater disabled in dev");
		return { dispose: () => {}, installUpdate: () => {} };
	}
	if (!isStableVersion(args.currentVersion)) {
		log.info("updater skipped: current version is not stable");
		return { dispose: () => {}, installUpdate: () => {} };
	}

	// Single-flight latch: during MacUpdater's deferred wait (Squirrel has
	// not fetched the update yet), every extra quitAndInstall() call stacks
	// another native update-downloaded listener that would later re-invoke
	// the native updater. Cleared on updater error so a retry stays possible.
	let installRequestPending = false;

	args.updater.autoDownload = true;
	args.updater.autoInstallOnAppQuit = true;
	args.updater.on("update-available", (...a: unknown[]) => {
		args.send("update:available", toUpdateInfo(a[0] as UpstreamUpdateInfo));
	});
	args.updater.on("update-downloaded", (...a: unknown[]) => {
		args.send("update:downloaded", toUpdateInfo(a[0] as UpstreamUpdateInfo));
	});
	args.updater.on("error", (...a: unknown[]) => {
		// Spec §2: fire update:error IPC, log, and stay silent to the user
		// (the renderer does not surface a banner for this channel).
		const err = a[0];
		installRequestPending = false;
		log.warn("updater error", err);
		const message =
			typeof err === "object" && err !== null && "message" in err
				? String((err as { message: unknown }).message)
				: String(err);
		args.send("update:error", message);
	});
	void args.updater
		.checkForUpdates()
		.catch((err) => log.warn("checkForUpdates failed", err));

	return {
		dispose: () => {},
		installUpdate: () => {
			if (args.quitGuard?.isUpdateQuitArmed()) {
				args.quitGuard.resumeUpdateQuit();
				return;
			}
			if (installRequestPending) return;
			installRequestPending = true;
			args.updater.quitAndInstall();
		},
	};
}
