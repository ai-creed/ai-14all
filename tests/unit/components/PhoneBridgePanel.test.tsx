// tests/unit/components/PhoneBridgePanel.test.tsx
// Spec: docs/superpowers/specs/2026-07-15-phone-bridge-dialog-redesign-design.md §4, §6
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhoneBridgePanel } from "../../../src/components/settings/PhoneBridgePanel";
import { SettingsProvider } from "../../../src/app/hooks/use-settings";
import { DEFAULT_PERSISTED_SETTINGS } from "../../../shared/models/persisted-settings";
import type { PhoneBridgeStatus as Status } from "../../../shared/contracts/commands";

const base: Status = {
	enabled: true,
	listening: true,
	addr: "10.0.0.5",
	port: 51820,
	paired: false,
	sas: null,
	pairing: "idle",
	offer: null,
	offerExpiresAt: null,
	pairedAt: null,
	grantedPermissions: null,
	lastError: null,
	relay: "off",
};

// Mirrors NEW_PAIRING_GRANTS (services/xbp/xbp-grants.ts). The first entry is
// `sessionReportCapability.permission`, whose value is "control:read", NOT
// "session:report" (@ai-creed/command-contract capabilities/session-report).
const FULL_GRANTS = [
	"control:read",
	"control:act",
	"control:notify",
	"control:inspect",
	"control:pty-write",
];

function mountBridge(
	status: Status,
	overrides: Record<string, unknown> = {},
	settingsOverrides: Record<string, unknown> = {},
) {
	const api = {
		status: vi.fn().mockResolvedValue(status),
		setEnabled: vi.fn().mockResolvedValue(status),
		startPairing: vi.fn().mockResolvedValue({ offer: "{}" }),
		confirmSas: vi.fn().mockResolvedValue(true),
		cancelPairing: vi.fn().mockResolvedValue(status),
		forget: vi.fn().mockResolvedValue({ ...base }),
		onStatusChanged: vi.fn().mockReturnValue(() => {}),
		...overrides,
	};
	// Union of both consumers: the pty-input switch reads through the real
	// SettingsProvider (settings.initial + write + events.onSettingsChanged),
	// while the relay field reads settings.read() and writes settings.write
	// directly — one write mock serves both paths.
	const settings = {
		initial: DEFAULT_PERSISTED_SETTINGS,
		read: vi.fn().mockResolvedValue({
			settings: DEFAULT_PERSISTED_SETTINGS,
			firstRun: false,
		}),
		write: vi.fn().mockImplementation(async (patch) => ({
			...DEFAULT_PERSISTED_SETTINGS,
			...patch,
			phoneBridge: {
				...DEFAULT_PERSISTED_SETTINGS.phoneBridge,
				...(patch.phoneBridge ?? {}),
			},
		})),
		...settingsOverrides,
	};
	(window as unknown as { ai14all: unknown }).ai14all = {
		phoneBridge: api,
		settings,
		events: { onSettingsChanged: vi.fn().mockReturnValue(() => {}) },
	};
	return { ...api, settings };
}

/** Renders the panel wrapped in its real SettingsProvider — the panel now
 * reads/writes the phone-bridge PTY-input disarm switch through
 * useSettings(), which throws outside a provider. */
function renderPanel() {
	return render(
		<SettingsProvider>
			<PhoneBridgePanel />
		</SettingsProvider>,
	);
}

function settingsWriteSpy() {
	return (
		window as unknown as {
			ai14all: { settings: { write: ReturnType<typeof vi.fn> } };
		}
	).ai14all.settings.write;
}

afterEach(() => {
	(window as unknown as { ai14all?: unknown }).ai14all = undefined;
});

describe("PhoneBridgePanel state machine", () => {
	it("shows the loading view until status resolves", () => {
		mountBridge(base, { status: vi.fn(() => new Promise(() => {})) });
		renderPanel();
		expect(screen.getByTestId("view-loading")).toBeInTheDocument();
	});

	it("renders no duplicate title heading (the dialog owns the title)", async () => {
		mountBridge(base);
		renderPanel();
		await screen.findByTestId("view-idle");
		expect(screen.queryByRole("heading")).toBeNull();
	});

	it("off: explainer only, no pair button", async () => {
		mountBridge({ ...base, enabled: false, listening: false });
		renderPanel();
		expect(await screen.findByTestId("view-off")).toBeInTheDocument();
		expect(screen.getByText(/bridge off/i)).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /pair a phone/i })).toBeNull();
	});

	it("idle: shows the address strip and starts pairing on click without rendering a QR", async () => {
		const api = mountBridge(base);
		renderPanel();
		expect(await screen.findByText(/10\.0\.0\.5:51820/)).toBeInTheDocument();
		await userEvent.click(
			screen.getByRole("button", { name: /pair a phone/i }),
		);
		expect(api.startPairing).toHaveBeenCalledTimes(1);
		// QR derives from status.offer, never from the startPairing return value.
		expect(screen.queryByTestId("pairing-qr")).toBeNull();
	});

	it("scan: recovers the QR step purely from status (reopen-mid-pairing)", async () => {
		const api = mountBridge({
			...base,
			pairing: "awaiting-scan",
			offer: JSON.stringify({ token: "t", connect: { urls: ["ws://x"] } }),
			offerExpiresAt: Date.now() + 120_000,
		});
		renderPanel();
		expect(await screen.findByTestId("pairing-qr")).toBeInTheDocument();
		expect(screen.getByText(/expires in/i)).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
		expect(api.cancelPairing).toHaveBeenCalledTimes(1);
	});

	it("sas: shows the grouped digits; Confirm and Reject call confirmSas", async () => {
		const api = mountBridge({
			...base,
			sas: "048213",
			pairing: "awaiting-sas",
		});
		renderPanel();
		expect(await screen.findByText("048 213")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
		expect(api.confirmSas).toHaveBeenCalledWith(true);
		await userEvent.click(screen.getByRole("button", { name: /reject/i }));
		expect(api.confirmSas).toHaveBeenCalledWith(false);
	});

	it("paired: device card shows humanized pairedAt + permissions, unpair confirms in-card", async () => {
		// forget stays pending so the ref-latch assertion below is deterministic:
		// a resolving mock could release the latch between the two dblClick events.
		const forget = vi.fn(() => new Promise<never>(() => {}));
		const api = mountBridge(
			{
				...base,
				paired: true,
				pairedAt: Date.now() - 3 * 86_400_000,
				grantedPermissions: FULL_GRANTS,
			},
			{ forget },
		);
		renderPanel();
		expect(await screen.findByTestId("view-paired")).toBeInTheDocument();
		expect(screen.getByText(/paired 3 days ago/i)).toBeInTheDocument();
		expect(screen.getByText("Act on workflows")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: /^unpair$/i }));
		expect(screen.getByTestId("unpair-confirm")).toBeInTheDocument();
		await userEvent.dblClick(
			screen.getByRole("button", { name: /confirm unpair/i }),
		);
		// Ref latch: a same-tick double click must invoke forget exactly once.
		expect(api.forget).toHaveBeenCalledTimes(1);
	});

	it("paired view renders the terminal-input disarm switch ON by default", async () => {
		mountBridge({
			...base,
			paired: true,
			pairedAt: Date.now() - 3 * 86_400_000,
			grantedPermissions: FULL_GRANTS,
		});
		renderPanel();
		await screen.findByTestId("view-paired");
		const sw = await screen.findByRole("switch", {
			name: /Type into terminals/,
		});
		expect(sw).toBeChecked();
	});

	it("fault: enabled-but-not-listening features lastError detail", async () => {
		mountBridge({
			...base,
			listening: false,
			lastError: "listen EADDRINUSE: address already in use",
		});
		renderPanel();
		expect(await screen.findByTestId("view-fault")).toBeInTheDocument();
		expect(screen.getByText(/EADDRINUSE/)).toBeInTheDocument();
	});

	it("surfaces a rejected action as an inline error", async () => {
		mountBridge(
			{ ...base, sas: "048213", pairing: "awaiting-sas" },
			{ confirmSas: vi.fn().mockRejectedValue(new Error("boom")) },
		);
		renderPanel();
		await userEvent.click(
			await screen.findByRole("button", { name: /^confirm$/i }),
		);
		expect(await screen.findByTestId("action-error")).toHaveTextContent("boom");
	});

	it("a stale inline error clears when a status change arrives", async () => {
		let push: ((s: Status) => void) | undefined;
		mountBridge(
			{ ...base, sas: "048213", pairing: "awaiting-sas" },
			{
				confirmSas: vi.fn().mockRejectedValue(new Error("boom")),
				onStatusChanged: vi.fn((h: (s: Status) => void) => {
					push = h;
					return () => {};
				}),
			},
		);
		renderPanel();
		await userEvent.click(
			await screen.findByRole("button", { name: /^confirm$/i }),
		);
		expect(await screen.findByTestId("action-error")).toBeInTheDocument();
		act(() => push!({ ...base }));
		await waitFor(() =>
			expect(screen.queryByTestId("action-error")).toBeNull(),
		);
	});

	it("renders the status-carried lastError as a danger line outside the fault view", async () => {
		mountBridge({ ...base, lastError: "startPairing failed: not listening" });
		renderPanel();
		expect(await screen.findByTestId("last-error")).toHaveTextContent(
			/startPairing failed/,
		);
	});

	it("paired: renders four capability rows in order", async () => {
		mountBridge({
			...base,
			paired: true,
			pairedAt: Date.now(),
			grantedPermissions: FULL_GRANTS,
		});
		renderPanel();
		await screen.findByTestId("view-paired");
		for (const label of [
			"Read session reports",
			"Act on workflows",
			"Send notifications to this phone",
			"Type into terminals",
		]) {
			expect(screen.getByText(label)).toBeInTheDocument();
		}
		// Exactly two controls: notify + pty. The bridge-enable switch lives in
		// the strip, outside the ledger.
		expect(
			screen.getByTestId("view-paired").querySelectorAll('[role="switch"]'),
		).toHaveLength(2);
		// Pin the mark glyphs themselves — a swapped ternary on either branch
		// must fail here even though the label text, switch role and count all
		// stay unchanged. U+2713 (✓) for a granted static row, "[✓]" for an
		// armed switch (both settings default to true — persisted-settings.ts).
		expect(
			screen
				.getByText("Read session reports")
				.closest(".phone-bridge__cap")!
				.querySelector(".phone-bridge__cap-mark"),
		).toHaveTextContent("✓");
		expect(
			screen
				.getByRole("switch", { name: "Type into terminals" })
				.querySelector(".phone-bridge__cap-mark"),
		).toHaveTextContent("[✓]");
	});

	it("paired: a disarmed switch renders the [ ] mark", async () => {
		mountBridge(
			{
				...base,
				paired: true,
				pairedAt: Date.now(),
				grantedPermissions: FULL_GRANTS,
			},
			{},
			{
				initial: {
					...DEFAULT_PERSISTED_SETTINGS,
					phoneBridge: {
						...DEFAULT_PERSISTED_SETTINGS.phoneBridge,
						ptyInputEnabled: false,
					},
				},
			},
		);
		renderPanel();
		await screen.findByTestId("view-paired");
		const sw = screen.getByRole("switch", { name: "Type into terminals" });
		expect(sw).not.toBeChecked();
		expect(sw.querySelector(".phone-bridge__cap-mark")).toHaveTextContent(
			"[ ]",
		);
	});

	it("paired: a denied capability renders no control at all", async () => {
		mountBridge({
			...base,
			paired: true,
			pairedAt: Date.now(),
			// Legacy pre-2b.2 record: session reports only.
			grantedPermissions: null,
		});
		renderPanel();
		await screen.findByTestId("view-paired");
		expect(
			screen.getByTestId("view-paired").querySelectorAll('[role="switch"]'),
		).toHaveLength(0);
		expect(screen.getAllByText("not granted")).toHaveLength(3);
		// Pin U+00B7 (·) on the denied glyph itself, not just the adjacent
		// "not granted" text — a swapped granted/denied ternary must fail here.
		expect(
			screen
				.getByText("Act on workflows")
				.closest(".phone-bridge__cap")!
				.querySelector(".phone-bridge__cap-mark"),
		).toHaveTextContent("·");
		expect(
			screen.getByText(/Pair this phone again to grant the newer capabilities/),
		).toBeInTheDocument();
	});

	it("toggling notifications writes pushWakeEnabled, never ptyInputEnabled", async () => {
		mountBridge({
			...base,
			paired: true,
			pairedAt: Date.now(),
			grantedPermissions: FULL_GRANTS,
		});
		renderPanel();
		await screen.findByTestId("view-paired");
		await userEvent.click(
			screen.getByRole("switch", { name: /Send notifications to this phone/ }),
		);
		const patch = settingsWriteSpy().mock.calls[0][0];
		expect(patch.phoneBridge).toEqual({ pushWakeEnabled: false });
	});

	it("toggling terminal input writes ptyInputEnabled, never pushWakeEnabled", async () => {
		mountBridge({
			...base,
			paired: true,
			pairedAt: Date.now(),
			grantedPermissions: FULL_GRANTS,
		});
		renderPanel();
		await screen.findByTestId("view-paired");
		await userEvent.click(
			screen.getByRole("switch", { name: /Type into terminals/ }),
		);
		const patch = settingsWriteSpy().mock.calls[0][0];
		expect(patch.phoneBridge).toEqual({ ptyInputEnabled: false });
	});

	// Both flags default TRUE, so every other toggle test drives true -> false.
	// A regression that hardcodes `false` in place of `!cap.armed` passes all of
	// them; this is the case that fails.
	it("toggling a DISARMED row writes true, not a hardcoded false", async () => {
		mountBridge(
			{
				...base,
				paired: true,
				pairedAt: Date.now(),
				grantedPermissions: FULL_GRANTS,
			},
			{},
			{
				initial: {
					...DEFAULT_PERSISTED_SETTINGS,
					phoneBridge: {
						...DEFAULT_PERSISTED_SETTINGS.phoneBridge,
						pushWakeEnabled: false,
					},
				},
			},
		);
		renderPanel();
		await screen.findByTestId("view-paired");
		const sw = screen.getByRole("switch", {
			name: /Send notifications to this phone/,
		});
		expect(sw).not.toBeChecked();
		await userEvent.click(sw);
		const patch = settingsWriteSpy().mock.calls[0][0];
		expect(patch.phoneBridge).toEqual({ pushWakeEnabled: true });
	});

	// The only state where a live control row and a denied row coexist.
	it("paired: a mixed grant set renders controls and denials side by side", async () => {
		mountBridge({
			...base,
			paired: true,
			pairedAt: Date.now(),
			// notify granted (live control), act + pty not (denied facts).
			grantedPermissions: ["control:read", "control:notify"],
		});
		renderPanel();
		await screen.findByTestId("view-paired");

		// Exactly one control: notify. pty is denied, so it renders no switch.
		const switches = screen
			.getByTestId("view-paired")
			.querySelectorAll('[role="switch"]');
		expect(switches).toHaveLength(1);
		expect(
			screen.getByRole("switch", { name: /Send notifications to this phone/ }),
		).toBeChecked();

		// ...alongside two denied rows carrying the · mark and the suffix.
		expect(screen.getAllByText("not granted")).toHaveLength(2);
		for (const label of ["Act on workflows", "Type into terminals"]) {
			const row = screen.getByText(label).closest(".phone-bridge__cap")!;
			expect(row.querySelector(".phone-bridge__cap-mark")).toHaveTextContent(
				"·",
			);
			expect(row.querySelector('[role="switch"]')).toBeNull();
		}
		// And the granted fact row still reads as a fact, not a control.
		expect(
			screen
				.getByText("Read session reports")
				.closest(".phone-bridge__cap")!
				.querySelector(".phone-bridge__cap-mark"),
		).toHaveTextContent("✓");
	});

	// A rejected settings.write must NOT be silent: useSettings().update swallows
	// it (use-settings.tsx), and main keeps reading the OLD flag from its own
	// settings service, so a row rendering [ ] over a still-armed host is the
	// worst direction to be wrong in on this surface.
	it("a rejected kill-switch write surfaces the action-error line", async () => {
		mountBridge(
			{
				...base,
				paired: true,
				pairedAt: Date.now(),
				grantedPermissions: FULL_GRANTS,
			},
			{},
			{ write: vi.fn().mockRejectedValue(new Error("EPERM: settings.json")) },
		);
		renderPanel();
		await screen.findByTestId("view-paired");
		const sw = screen.getByRole("switch", { name: /Type into terminals/ });
		await userEvent.click(sw);

		expect(await screen.findByTestId("action-error")).toHaveTextContent(
			/Type into terminals/,
		);
		// ...and the row keeps claiming the capability is still armed, because it
		// is: nothing was persisted, so nothing changed on the host.
		expect(sw).toBeChecked();
		expect(sw.querySelector(".phone-bridge__cap-mark")).toHaveTextContent(
			"[✓]",
		);
	});

	// Spec D9: capability rows are deliberately NOT optimistic — they write via
	// settings.write and flip only once the value is persisted. Every other
	// toggle test asserts the PATCH, which useSettings().update() would also
	// produce (it calls the same settings.write underneath), so none of them can
	// tell the two paths apart. This one can: with the write still in flight,
	// the optimistic path has already flipped the row and this path has not.
	it("a capability row does not flip until the write resolves (D9, not optimistic)", async () => {
		let releaseWrite: ((merged: unknown) => void) | undefined;
		mountBridge(
			{
				...base,
				paired: true,
				pairedAt: Date.now(),
				grantedPermissions: FULL_GRANTS,
			},
			{},
			{
				write: vi.fn(
					() =>
						new Promise((resolve) => {
							releaseWrite = resolve;
						}),
				),
			},
		);
		renderPanel();
		await screen.findByTestId("view-paired");
		const sw = screen.getByRole("switch", { name: /Type into terminals/ });
		expect(sw).toBeChecked();

		await userEvent.click(sw);
		// The write was issued...
		expect(settingsWriteSpy()).toHaveBeenCalledTimes(1);
		// ...and the row still reports the OLD value, because that is still the
		// truth on the host. An optimistic update would read [ ] here.
		expect(sw).toBeChecked();
		expect(sw.querySelector(".phone-bridge__cap-mark")).toHaveTextContent(
			"[✓]",
		);
		expect(screen.queryByTestId("action-error")).toBeNull();

		releaseWrite?.(DEFAULT_PERSISTED_SETTINGS);
	});

	it("paired: the device header reads Phone, not Phone paired", async () => {
		mountBridge({
			...base,
			paired: true,
			pairedAt: Date.now(),
			grantedPermissions: FULL_GRANTS,
		});
		renderPanel();
		await screen.findByTestId("view-paired");
		expect(screen.getByText("Phone")).toBeInTheDocument();
		expect(screen.queryByText("Phone paired")).toBeNull();
	});
});

describe("PhoneBridgePanel relay settings", () => {
	it("shows a labeled Relay input seeded from settings.read()'s relayBaseUrl", async () => {
		mountBridge(
			base,
			{},
			{
				read: vi.fn().mockResolvedValue({
					settings: {
						...DEFAULT_PERSISTED_SETTINGS,
						phoneBridge: {
							...DEFAULT_PERSISTED_SETTINGS.phoneBridge,
							relayBaseUrl: "wss://relay.example.com",
						},
					},
					firstRun: false,
				}),
			},
		);
		renderPanel();
		const input = await screen.findByLabelText(/relay/i);
		await waitFor(() => expect(input).toHaveValue("wss://relay.example.com"));
	});

	it.each([
		["off", "Off-network relay · off"],
		["retrying", "Off-network relay · retrying"],
		["registered", "Off-network relay · registered"],
	] as const)("summary maps relay %s to %s", async (relay, expectedText) => {
		mountBridge({ ...base, relay });
		renderPanel();
		expect(await screen.findByText(expectedText)).toBeInTheDocument();
	});

	it("commits the relay field on blur after a change, once", async () => {
		const write = vi.fn().mockResolvedValue({
			...DEFAULT_PERSISTED_SETTINGS,
			phoneBridge: {
				...DEFAULT_PERSISTED_SETTINGS.phoneBridge,
				relayBaseUrl: "wss://relay.example.com",
			},
		});
		mountBridge(base, {}, { write });
		renderPanel();
		const input = await screen.findByLabelText(/relay/i);
		await userEvent.type(input, "wss://relay.example.com");
		await userEvent.tab();
		await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
		expect(write).toHaveBeenCalledWith({
			phoneBridge: { relayBaseUrl: "wss://relay.example.com" },
		});
	});

	it("blurring without a change writes nothing", async () => {
		const write = vi.fn().mockResolvedValue(DEFAULT_PERSISTED_SETTINGS);
		mountBridge(base, {}, { write });
		renderPanel();
		const input = await screen.findByLabelText(/relay/i);
		await userEvent.click(input);
		await userEvent.tab();
		expect(write).not.toHaveBeenCalled();
	});

	it("surfaces a rejected relay write as the action-error line and keeps the field editable", async () => {
		const write = vi
			.fn()
			.mockRejectedValue(
				new Error("Relay URL must be a wss:// URL without query or fragment"),
			);
		mountBridge(base, {}, { write });
		renderPanel();
		const input = await screen.findByLabelText(/relay/i);
		await userEvent.type(input, "not-a-url");
		await userEvent.tab();
		expect(await screen.findByTestId("action-error")).toHaveTextContent(
			/wss:\/\//i,
		);
		expect(input).not.toBeDisabled();
		expect(input).toHaveValue("not-a-url");
	});

	it("off: no relay disclosure renders", async () => {
		mountBridge({ ...base, enabled: false, listening: false });
		renderPanel();
		expect(await screen.findByTestId("view-off")).toBeInTheDocument();
		expect(screen.queryByLabelText(/relay url/i)).toBeNull();
		expect(screen.queryByText(/Off-network relay/)).toBeNull();
	});

	function relayDetails(): HTMLDetailsElement {
		const summary = screen.getByText(/^Off-network relay ·/);
		return summary.closest("details") as HTMLDetailsElement;
	}

	function mountWithRelay(url: string, statusOverrides: Partial<Status> = {}) {
		return mountBridge(
			{ ...base, ...statusOverrides },
			{
				onStatusChanged: vi.fn((h: (s: Status) => void) => {
					pushStatus = h;
					return () => {};
				}),
			},
			{
				read: vi.fn().mockResolvedValue({
					settings: {
						...DEFAULT_PERSISTED_SETTINGS,
						phoneBridge: {
							...DEFAULT_PERSISTED_SETTINGS.phoneBridge,
							relayBaseUrl: url,
						},
					},
					firstRun: false,
				}),
			},
		);
	}
	let pushStatus: ((s: Status) => void) | undefined;

	// Seed-vs-user race: the disclosure renders as soon as STATUS resolves, which
	// can beat settings.read(). A latch that only fires inside the read handler
	// would overwrite a toggle made inside that window.
	it("a toggle made before settings.read() resolves is not clobbered by the seed", async () => {
		let resolveRead!: (value: unknown) => void;
		mountBridge(
			base,
			{},
			{
				read: vi.fn(
					() =>
						new Promise((resolve) => {
							resolveRead = resolve;
						}),
				),
			},
		);
		renderPanel();
		await screen.findByText(/^Off-network relay ·/);
		await userEvent.click(screen.getByText(/^Off-network relay ·/));
		await waitFor(() => expect(relayDetails().open).toBe(true));

		// The persisted URL is empty, so an unguarded seed would close it here.
		await act(async () => {
			resolveRead({ settings: DEFAULT_PERSISTED_SETTINGS, firstRun: false });
		});
		expect(relayDetails().open).toBe(true);
	});

	it("starts collapsed when no relay URL is persisted", async () => {
		mountWithRelay("");
		renderPanel();
		await screen.findByText(/^Off-network relay ·/);
		await waitFor(() => expect(relayDetails().open).toBe(false));
	});

	it("starts open when a relay URL is persisted", async () => {
		mountWithRelay("wss://relay.example.com");
		renderPanel();
		await screen.findByText(/^Off-network relay ·/);
		await waitFor(() => expect(relayDetails().open).toBe(true));
	});

	// Sanity check, not the D5a regression: React only writes the DOM `open`
	// property when the prop value CHANGES, so a derived prop would survive
	// this same-value re-render too. See "survives an unmount/remount" and
	// "survives edits that change the relay draft" below for the real kill.
	it("a status change does not reopen a disclosure the user closed", async () => {
		mountWithRelay("wss://relay.example.com");
		renderPanel();
		await screen.findByText(/^Off-network relay ·/);
		await waitFor(() => expect(relayDetails().open).toBe(true));

		const details = relayDetails();
		await userEvent.click(screen.getByText(/^Off-network relay ·/));
		await waitFor(() => expect(details.open).toBe(false));

		// An UNRELATED status change — the path that fires in production on
		// every relay transition.
		act(() => pushStatus!({ ...base, relay: "retrying" }));
		await waitFor(() =>
			expect(
				screen.getByText("Off-network relay · retrying"),
			).toBeInTheDocument(),
		);
		expect(relayDetails().open).toBe(false);
	});

	// Mirror of the case above, in the opposite direction. Same caveat: a derived
	// prop would survive this too, so this is a sanity check, not a D5a
	// regression — the latch's real coverage is the remount and draft-flip tests
	// below. (It does NOT catch a latch that re-seeds on every load: settings
	// .read() lives in a []-dep effect and resolves once per mount, so there is
	// no second load to re-seed from.)
	it("a status change does not close a disclosure the user opened", async () => {
		mountWithRelay("");
		renderPanel();
		await screen.findByText(/^Off-network relay ·/);
		await waitFor(() => expect(relayDetails().open).toBe(false));

		const details = relayDetails();
		await userEvent.click(screen.getByText(/^Off-network relay ·/));
		await waitFor(() => expect(details.open).toBe(true));

		act(() => pushStatus!({ ...base, relay: "retrying" }));
		await waitFor(() =>
			expect(
				screen.getByText("Off-network relay · retrying"),
			).toBeInTheDocument(),
		);
		expect(relayDetails().open).toBe(true);
	});

	it("the user's collapse survives an unmount/remount of the disclosure", async () => {
		mountWithRelay("wss://relay.example.com");
		renderPanel();
		await screen.findByText(/^Off-network relay ·/);
		await waitFor(() => expect(relayDetails().open).toBe(true));
		await userEvent.click(screen.getByText(/^Off-network relay ·/));
		await waitFor(() => expect(relayDetails().open).toBe(false));

		// Bridge toggled off then back on: the relay block unmounts and remounts.
		act(() => pushStatus!({ ...base, enabled: false, listening: false }));
		await screen.findByTestId("view-off");
		act(() => pushStatus!({ ...base, relay: "retrying" }));
		await screen.findByText("Off-network relay · retrying");
		expect(relayDetails().open).toBe(false);
	});

	it("the user's open survives edits that change the relay draft", async () => {
		mountWithRelay("");
		renderPanel();
		await screen.findByText(/^Off-network relay ·/);
		await waitFor(() => expect(relayDetails().open).toBe(false));
		await userEvent.click(screen.getByText(/^Off-network relay ·/));
		await waitFor(() => expect(relayDetails().open).toBe(true));

		const input = screen.getByLabelText(/relay url/i);
		await userEvent.type(input, "wss://a.example.com");
		expect(relayDetails().open).toBe(true);
		await userEvent.clear(input); // flips a derived prop true -> false
		expect(relayDetails().open).toBe(true);
	});
});
