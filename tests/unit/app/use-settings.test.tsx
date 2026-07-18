import {
	act,
	fireEvent,
	render,
	renderHook,
	screen,
	waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	SettingsProvider,
	useSettings,
} from "../../../src/app/hooks/use-settings";
import { DEFAULT_PERSISTED_SETTINGS } from "../../../shared/models/persisted-settings";

function installBridge(overrides: { initialFirstRun?: boolean } = {}) {
	const write = vi.fn().mockImplementation(async (patch) => ({
		...DEFAULT_PERSISTED_SETTINGS,
		theme: "warm",
		...patch,
	}));
	const read = vi.fn().mockResolvedValue({
		settings: { ...DEFAULT_PERSISTED_SETTINGS, theme: "warm" },
		firstRun: false,
	});
	(window as never as Record<string, unknown>).ai14all = {
		settings: {
			initial: { ...DEFAULT_PERSISTED_SETTINGS, theme: "warm" },
			initialFirstRun: overrides.initialFirstRun ?? false,
			read,
			write,
		},
		events: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
	};
	return { write, read };
}

describe("useSettings", () => {
	beforeEach(() => {
		localStorage.clear();
		installBridge();
	});

	it("boots from settings.initial synchronously", () => {
		const { result } = renderHook(() => useSettings(), {
			wrapper: SettingsProvider,
		});
		expect(result.current.settings.theme).toBe("warm");
	});

	it("update() writes through and applies the merged result", async () => {
		const { result } = renderHook(() => useSettings(), {
			wrapper: SettingsProvider,
		});
		await act(() => result.current.update({ agentResume: "off" }));
		expect(result.current.settings.agentResume).toBe("off");
	});

	it("does not migrate the legacy font-size value when initialFirstRun is false", () => {
		localStorage.setItem("ai14all.terminalFontSize", "15");
		const { write } = installBridge({ initialFirstRun: false });

		renderHook(() => useSettings(), { wrapper: SettingsProvider });

		expect(write).not.toHaveBeenCalled();
	});

	it("migrates the legacy font-size value on the first run after upgrading", () => {
		localStorage.setItem("ai14all.terminalFontSize", "15");
		const { write } = installBridge({ initialFirstRun: true });

		renderHook(() => useSettings(), { wrapper: SettingsProvider });

		expect(write).toHaveBeenCalledWith({ terminalFontSize: 15 });
	});

	it("skips the migration write when no legacy font-size value is stored", () => {
		const { write } = installBridge({ initialFirstRun: true });

		renderHook(() => useSettings(), { wrapper: SettingsProvider });

		expect(write).not.toHaveBeenCalled();
	});
});

describe("SettingsProvider optimistic update", () => {
	function setupBridge(overrides: {
		write?: (patch: unknown) => Promise<unknown>;
	}) {
		const onSettingsChanged = vi.fn((_cb: (s: unknown) => void) => () => {});
		(window as never as { ai14all: unknown }).ai14all = {
			settings: {
				initial: DEFAULT_PERSISTED_SETTINGS,
				initialFirstRun: false,
				write:
					overrides.write ??
					vi.fn((patch: unknown) =>
						Promise.resolve({
							...DEFAULT_PERSISTED_SETTINGS,
							...(patch as object),
						}),
					),
			},
			events: { onSettingsChanged },
		};
		return { onSettingsChanged };
	}

	function Probe() {
		const { settings, update } = useSettings();
		return (
			<button
				type="button"
				data-testid="probe"
				data-restart={String(settings.terminalConfirm.restart)}
				data-close={String(settings.terminalConfirm.close)}
				onClick={() => void update({ terminalConfirm: { close: false } })}
			>
				probe
			</button>
		);
	}

	it("keeps the patched value when the write rejects (silent, shared context)", async () => {
		setupBridge({ write: () => Promise.reject(new Error("disk full")) });
		render(
			<SettingsProvider>
				<Probe />
			</SettingsProvider>,
		);
		fireEvent.click(screen.getByTestId("probe"));
		await waitFor(() =>
			expect(screen.getByTestId("probe").dataset.close).toBe("false"),
		);
	});

	it("two overlapping writes: the FIRST write resolving while the second is in flight never rewinds", async () => {
		let resolveFirst!: (v: unknown) => void;
		let resolveSecond!: (v: unknown) => void;
		const write = vi
			.fn()
			.mockImplementationOnce(() => new Promise((res) => (resolveFirst = res)))
			.mockImplementationOnce(
				() => new Promise((res) => (resolveSecond = res)),
			);
		setupBridge({ write });

		function TwoWrites() {
			const { settings, update } = useSettings();
			return (
				<button
					type="button"
					data-testid="two"
					data-restart={String(settings.terminalConfirm.restart)}
					data-close={String(settings.terminalConfirm.close)}
					onClick={() => {
						void update({ terminalConfirm: { restart: false } });
						void update({ terminalConfirm: { close: false } });
					}}
				>
					two
				</button>
			);
		}
		render(
			<SettingsProvider>
				<TwoWrites />
			</SettingsProvider>,
		);
		fireEvent.click(screen.getByTestId("two"));
		// The FIRST write resolves while the second is still in flight. Its
		// merged result predates the second patch (close:true is stale) and
		// must not be adopted.
		resolveFirst({
			...DEFAULT_PERSISTED_SETTINGS,
			terminalConfirm: { restart: false, close: true },
		});
		await waitFor(() => {
			const el = screen.getByTestId("two");
			expect(el.dataset.restart).toBe("false");
			expect(el.dataset.close).toBe("false");
		});
		// The second (latest-issued) write settles with the fully-merged truth.
		resolveSecond({
			...DEFAULT_PERSISTED_SETTINGS,
			terminalConfirm: { restart: false, close: false },
		});
		await waitFor(() => {
			const el = screen.getByTestId("two");
			expect(el.dataset.restart).toBe("false");
			expect(el.dataset.close).toBe("false");
		});
	});

	it("the newest resolve is NOT adopted while an older write is still pending (counter-zero rule)", async () => {
		let resolveFirst!: (v: unknown) => void;
		const write = vi
			.fn()
			.mockImplementationOnce(() => new Promise((res) => (resolveFirst = res)))
			.mockImplementationOnce(() =>
				Promise.resolve({
					...DEFAULT_PERSISTED_SETTINGS,
					// Side-channel marker: if this newest resolve were adopted while
					// the first write is still pending, the font size would flip.
					terminalFontSize: 14,
					terminalConfirm: { restart: false, close: false },
				}),
			);
		setupBridge({ write });

		function FontProbe() {
			const { settings, update } = useSettings();
			return (
				<button
					type="button"
					data-testid="font"
					data-size={String(settings.terminalFontSize)}
					onClick={() => {
						void update({ terminalConfirm: { restart: false } });
						void update({ terminalConfirm: { close: false } });
					}}
				>
					font
				</button>
			);
		}
		render(
			<SettingsProvider>
				<FontProbe />
			</SettingsProvider>,
		);
		fireEvent.click(screen.getByTestId("font"));
		await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
		// Newest write resolved, older still pending → counter nonzero → the
		// merged result (fontSize 14) must NOT be adopted.
		await act(async () => {});
		expect(screen.getByTestId("font").dataset.size).toBe("13");
		// Older write settles last → counter zero but not latest-issued → still
		// not adopted; the optimistic terminalConfirm values stand.
		resolveFirst({
			...DEFAULT_PERSISTED_SETTINGS,
			terminalConfirm: { restart: false, close: true },
		});
		await act(async () => {});
		expect(screen.getByTestId("font").dataset.size).toBe("13");
	});

	it("a stale onSettingsChanged echo during a pending write is ignored", async () => {
		let resolveWrite!: (v: unknown) => void;
		const { onSettingsChanged } = setupBridge({
			write: () => new Promise((res) => (resolveWrite = res)),
		});
		render(
			<SettingsProvider>
				<Probe />
			</SettingsProvider>,
		);
		fireEvent.click(screen.getByTestId("probe")); // optimistic close:false, write pending
		await waitFor(() =>
			expect(screen.getByTestId("probe").dataset.close).toBe("false"),
		);
		// Deliver a stale external echo (close still true) WHILE the write is
		// pending — the provider must ignore it (spec §5.3 echo guard).
		const echoCb = onSettingsChanged.mock.calls[0][0] as (s: unknown) => void;
		act(() => echoCb(DEFAULT_PERSISTED_SETTINGS));
		expect(screen.getByTestId("probe").dataset.close).toBe("false");
		resolveWrite({
			...DEFAULT_PERSISTED_SETTINGS,
			terminalConfirm: { restart: true, close: false },
		});
		await waitFor(() =>
			expect(screen.getByTestId("probe").dataset.close).toBe("false"),
		);
	});
});
