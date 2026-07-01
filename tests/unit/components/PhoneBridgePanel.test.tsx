// tests/unit/components/PhoneBridgePanel.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PhoneBridgePanel } from "../../../src/components/settings/PhoneBridgePanel";

type Status = {
	enabled: boolean;
	listening: boolean;
	addr: string | null;
	port: number | null;
	paired: boolean;
	sas: string | null;
};

const base: Status = {
	enabled: true,
	listening: true,
	addr: "10.0.0.5",
	port: 51820,
	paired: false,
	sas: null,
};

function mountBridge(status: Status) {
	(window as unknown as { ai14all: unknown }).ai14all = {
		phoneBridge: {
			status: vi.fn().mockResolvedValue(status),
			setEnabled: vi.fn().mockResolvedValue(status),
			startPairing: vi.fn().mockResolvedValue({
				offer: JSON.stringify({
					token: "t",
					signPubHex: "aa",
					boxPubHex: "bb",
					connect: { url: "ws://10.0.0.5:51820" },
					expiresAt: 9,
				}),
			}),
			confirmSas: vi.fn().mockResolvedValue(true),
			onStatusChanged: vi.fn().mockReturnValue(() => {}),
		},
	};
}

describe("PhoneBridgePanel", () => {
	it("shows the listening address once status resolves", async () => {
		mountBridge(base);
		render(<PhoneBridgePanel />);
		await waitFor(() =>
			expect(screen.getByText(/10\.0\.0\.5:51820/)).toBeInTheDocument(),
		);
	});

	it("renders the pairing QR after clicking Pair a phone", async () => {
		mountBridge(base);
		render(<PhoneBridgePanel />);
		await userEvent.click(
			await screen.findByRole("button", { name: /pair a phone/i }),
		);
		await waitFor(() =>
			expect(window.ai14all.phoneBridge.startPairing).toHaveBeenCalled(),
		);
		expect(await screen.findByTestId("pairing-qr")).toBeInTheDocument();
	});

	it("displays the six-digit SAS with Confirm/Reject when the host reports a SAS", async () => {
		mountBridge({ ...base, sas: "048213" });
		render(<PhoneBridgePanel />);
		// The exact digits the host computed must be on screen — not a blind Confirm button.
		expect(await screen.findByText("048213")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /confirm/i }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
	});

	it("confirming the displayed SAS calls confirmSas(true)", async () => {
		mountBridge({ ...base, sas: "048213" });
		render(<PhoneBridgePanel />);
		await userEvent.click(
			await screen.findByRole("button", { name: /confirm/i }),
		);
		expect(window.ai14all.phoneBridge.confirmSas).toHaveBeenCalledWith(true);
	});

	it("disables Pair a phone once a phone is paired (one phone; revocation deferred)", async () => {
		// enabled: true so the ONLY thing that can disable the button is paired.
		mountBridge({ ...base, paired: true });
		render(<PhoneBridgePanel />);
		// Wait until the host status (enabled + paired) has been applied.
		await waitFor(() =>
			expect(screen.getByText(/10\.0\.0\.5:51820/)).toBeInTheDocument(),
		);
		expect(
			screen.getByRole("button", { name: /pair a phone/i }),
		).toBeDisabled();
	});

	it("lists the paired device once paired", async () => {
		mountBridge({ ...base, paired: true });
		render(<PhoneBridgePanel />);
		await waitFor(() =>
			expect(screen.getByText(/paired/i)).toBeInTheDocument(),
		);
	});
});
