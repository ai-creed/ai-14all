// tests/unit/components/PhoneBridgePanel.test.tsx
// Spec: docs/superpowers/specs/2026-07-15-phone-bridge-dialog-redesign-design.md §4, §6
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhoneBridgePanel } from "../../../src/components/settings/PhoneBridgePanel";
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
};

function mountBridge(status: Status, overrides: Record<string, unknown> = {}) {
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
	(window as unknown as { ai14all: unknown }).ai14all = { phoneBridge: api };
	return api;
}

afterEach(() => {
	(window as unknown as { ai14all?: unknown }).ai14all = undefined;
});

describe("PhoneBridgePanel state machine", () => {
	it("shows the loading view until status resolves", () => {
		mountBridge(base, { status: vi.fn(() => new Promise(() => {})) });
		render(<PhoneBridgePanel />);
		expect(screen.getByTestId("view-loading")).toBeInTheDocument();
	});

	it("renders no duplicate title heading (the dialog owns the title)", async () => {
		mountBridge(base);
		render(<PhoneBridgePanel />);
		await screen.findByTestId("view-idle");
		expect(screen.queryByRole("heading")).toBeNull();
	});

	it("off: explainer only, no pair button", async () => {
		mountBridge({ ...base, enabled: false, listening: false });
		render(<PhoneBridgePanel />);
		expect(await screen.findByTestId("view-off")).toBeInTheDocument();
		expect(screen.getByText(/bridge off/i)).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /pair a phone/i })).toBeNull();
	});

	it("idle: shows the address strip and starts pairing on click without rendering a QR", async () => {
		const api = mountBridge(base);
		render(<PhoneBridgePanel />);
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
			offer: JSON.stringify({ token: "t", connect: { url: "ws://x" } }),
			offerExpiresAt: Date.now() + 120_000,
		});
		render(<PhoneBridgePanel />);
		expect(await screen.findByTestId("pairing-qr")).toBeInTheDocument();
		expect(screen.getByText(/expires in/i)).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
		expect(api.cancelPairing).toHaveBeenCalledTimes(1);
	});

	it("sas: shows the grouped digits; Confirm and Reject call confirmSas", async () => {
		const api = mountBridge({ ...base, sas: "048213", pairing: "awaiting-sas" });
		render(<PhoneBridgePanel />);
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
		render(<PhoneBridgePanel />);
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

	it("fault: enabled-but-not-listening features lastError detail", async () => {
		mountBridge({
			...base,
			listening: false,
			lastError: "listen EADDRINUSE: address already in use",
		});
		render(<PhoneBridgePanel />);
		expect(await screen.findByTestId("view-fault")).toBeInTheDocument();
		expect(screen.getByText(/EADDRINUSE/)).toBeInTheDocument();
	});

	it("surfaces a rejected action as an inline error", async () => {
		mountBridge(
			{ ...base, sas: "048213", pairing: "awaiting-sas" },
			{ confirmSas: vi.fn().mockRejectedValue(new Error("boom")) },
		);
		render(<PhoneBridgePanel />);
		await userEvent.click(await screen.findByRole("button", { name: /^confirm$/i }));
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
		render(<PhoneBridgePanel />);
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
		render(<PhoneBridgePanel />);
		expect(await screen.findByTestId("last-error")).toHaveTextContent(
			/startPairing failed/,
		);
	});
});
