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
				grantedPermissions: ["control:act"],
			},
			{ forget },
		);
		renderPanel();
		expect(await screen.findByTestId("view-paired")).toBeInTheDocument();
		expect(screen.getByText(/paired 3 days ago/i)).toBeInTheDocument();
		expect(screen.getByText(/can act/i)).toBeInTheDocument();
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
			grantedPermissions: ["control:act"],
		});
		renderPanel();
		await screen.findByTestId("view-paired");
		const sw = await screen.findByRole("switch", {
			name: "Allow phone terminal input",
		});
		expect(sw).toBeChecked();
	});

	it("toggling the switch writes { phoneBridge: { ptyInputEnabled: false } }", async () => {
		mountBridge({
			...base,
			paired: true,
			pairedAt: Date.now() - 3 * 86_400_000,
			grantedPermissions: ["control:act"],
		});
		renderPanel();
		await screen.findByTestId("view-paired");
		const sw = await screen.findByRole("switch", {
			name: "Allow phone terminal input",
		});
		await userEvent.click(sw);
		expect(settingsWriteSpy()).toHaveBeenCalledWith(
			expect.objectContaining({
				phoneBridge: expect.objectContaining({ ptyInputEnabled: false }),
			}),
		);
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
		["off", "Relay: off"],
		["retrying", "Relay: retrying"],
		["registered", "Relay: registered"],
	] as const)(
		"status line maps relay %s to %s",
		async (relay, expectedText) => {
			mountBridge({ ...base, relay });
			renderPanel();
			expect(await screen.findByText(expectedText)).toBeInTheDocument();
		},
	);

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

	it("off: no relay field or status line renders", async () => {
		mountBridge({ ...base, enabled: false, listening: false });
		renderPanel();
		expect(await screen.findByTestId("view-off")).toBeInTheDocument();
		expect(screen.queryByLabelText(/relay/i)).toBeNull();
		expect(screen.queryByText(/relay:/i)).toBeNull();
	});
});
