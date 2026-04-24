import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdateBanner } from "../../../src/features/updater/UpdateBanner";

const INFO = {
	version: "0.1.1",
	url: "https://downloads.ai-creed.dev/ai-14all/0.1.1/ai-14all-0.1.1-arm64.dmg",
	releaseDate: "2026-05-01T12:00:00.000Z",
};

describe("UpdateBanner", () => {
	it("renders nothing when no update is available", () => {
		render(<UpdateBanner info={null} onDismiss={() => {}} onDownload={() => {}} />);
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("renders the version and a download control when info is present", () => {
		render(<UpdateBanner info={INFO} onDismiss={() => {}} onDownload={() => {}} />);
		expect(screen.getByRole("status")).toBeInTheDocument();
		expect(screen.getByText(/0\.1\.1/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /download/i })).toBeInTheDocument();
	});

	it("calls onDownload with the info url when the user clicks Download", async () => {
		const onDownload = vi.fn();
		render(<UpdateBanner info={INFO} onDismiss={() => {}} onDownload={onDownload} />);
		await userEvent.click(screen.getByRole("button", { name: /download/i }));
		expect(onDownload).toHaveBeenCalledWith(INFO.url);
	});

	it("calls onDismiss when the user clicks the close control", async () => {
		const onDismiss = vi.fn();
		render(<UpdateBanner info={INFO} onDismiss={onDismiss} onDownload={() => {}} />);
		await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
		expect(onDismiss).toHaveBeenCalled();
	});
});
