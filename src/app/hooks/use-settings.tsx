import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import type { Ai14AllDesktopApi } from "../../../shared/contracts/commands";
import {
	DEFAULT_PERSISTED_SETTINGS,
	type PersistedSettingsV1,
	type SettingsPatch,
} from "../../../shared/models/persisted-settings";
import {
	readPersistedFontSize,
	STORAGE_KEY as TERMINAL_FONT_SIZE_STORAGE_KEY,
} from "../../features/terminals/hooks/use-terminal-font-size";

function bridge(): Ai14AllDesktopApi | undefined {
	return window.ai14all as Ai14AllDesktopApi | undefined;
}

/** Synchronous initial value — provided by the preload's sendSync read. */
export function initialSettings(): PersistedSettingsV1 {
	return bridge()?.settings?.initial ?? DEFAULT_PERSISTED_SETTINGS;
}

type SettingsContextValue = {
	settings: PersistedSettingsV1;
	update: (patch: SettingsPatch) => Promise<void>;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
	const [settings, setSettings] =
		useState<PersistedSettingsV1>(initialSettings);

	// Number of settings.write calls still in flight from this provider.
	// While > 0, external echoes are ignored so a stale broadcast can never
	// rewind an optimistic patch (same guard as use-terminal-font-size.ts:93-107).
	const pendingWritesRef = useRef(0);
	// Monotonic issue-id per write. Only the LATEST-issued write's resolve is
	// ever adopted — an older write's merged result predates newer optimistic
	// patches whether it settles in order or out of order (spec §5.3).
	const writeSeqRef = useRef(0);

	useEffect(() => {
		return bridge()?.events?.onSettingsChanged?.((next) => {
			if (pendingWritesRef.current > 0) return;
			setSettings(next);
		});
	}, []);

	// One-time legacy font-size migration (spec §3.3): on the first launch after
	// upgrading to persisted settings, push the localStorage value through so
	// the settings file matches what the user already sees.
	//
	// This keys off the preload's synchronous `settings.initialFirstRun` flag
	// (captured once, alongside `settings.initial`, from the same sendSync
	// settings:readSync call) rather than the async `settings.read()` result:
	// that same sendSync call is the ONLY point that can ever observe
	// firstRun: true, because it seeds the settings file as a side effect
	// before any async read() could run — so `read().firstRun` is always false
	// by the time renderer code can call it.
	useEffect(() => {
		if (!bridge()?.settings?.initialFirstRun) return;
		if (localStorage.getItem(TERMINAL_FONT_SIZE_STORAGE_KEY) == null) return;
		void bridge()
			?.settings?.write({ terminalFontSize: readPersistedFontSize() })
			.then((merged) => setSettings(merged))
			.catch(() => {});
		// Run once on mount only — this is a one-time migration.
	}, []);

	const applyPatchLocally = useCallback(
		(prev: PersistedSettingsV1, patch: SettingsPatch): PersistedSettingsV1 => ({
			...prev,
			...patch,
			usageTelemetry: {
				...prev.usageTelemetry,
				...(patch.usageTelemetry ?? {}),
			},
			phoneBridge: { ...prev.phoneBridge, ...(patch.phoneBridge ?? {}) },
			terminalConfirm: {
				...prev.terminalConfirm,
				...(patch.terminalConfirm ?? {}),
			},
			version: 1,
		}),
		[],
	);

	const update = useCallback(
		async (patch: SettingsPatch) => {
			const api = bridge();
			if (!api?.settings) return;
			setSettings((prev) => applyPatchLocally(prev, patch));
			const seq = ++writeSeqRef.current;
			pendingWritesRef.current += 1;
			let merged: PersistedSettingsV1 | null = null;
			try {
				merged = await api.settings.write(patch);
			} catch {
				// Persist failed — keep the optimistic value for this session.
				// The Settings dialog toggle remains the recovery path (spec §10).
			} finally {
				pendingWritesRef.current -= 1;
			}
			// Adopt only when BOTH hold (spec §5.3): this is the latest-issued
			// write (an older write's merged result predates newer optimistic
			// patches) AND no other write is still pending (the decremented
			// counter reached zero). Any resolve failing either condition is
			// discarded; convergence rides the onSettingsChanged echo once no
			// writes are pending.
			if (
				merged !== null &&
				seq === writeSeqRef.current &&
				pendingWritesRef.current === 0
			) {
				setSettings(merged);
			}
		},
		[applyPatchLocally],
	);

	const value = useMemo(() => ({ settings, update }), [settings, update]);
	return (
		<SettingsContext.Provider value={value}>
			{children}
		</SettingsContext.Provider>
	);
}

export function useSettings(): SettingsContextValue {
	const ctx = useContext(SettingsContext);
	if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
	return ctx;
}
