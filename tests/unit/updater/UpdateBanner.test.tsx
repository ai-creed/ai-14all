import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdateBanner } from "../../../src/features/updater/UpdateBanner";

const INFO = {
	version: "1.3.0",
	url: "",
	releaseDate: "2026-05-27T12:00:00.000Z",
};

describe("UpdateBanner", () => {
	it("renders nothing when idle", () => {
		render(
			<UpdateBanner
				downloadingInfo={null}
				downloadedInfo={null}
				onRestart={() => {}}
				onLater={() => {}}
			/>,
		);
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("shows a downloading indicator while a version is downloading", () => {
		render(
			<UpdateBanner
				downloadingInfo={INFO}
				downloadedInfo={null}
				onRestart={() => {}}
				onLater={() => {}}
			/>,
		);
		expect(screen.getByRole("status")).toHaveTextContent(/downloading/i);
		expect(screen.getByRole("status")).toHaveTextContent(/1\.3\.0/);
		expect(screen.queryByRole("button", { name: /restart now/i })).toBeNull();
	});

	it("shows Restart now / Later once a version is downloaded", () => {
		render(
			<UpdateBanner
				downloadingInfo={null}
				downloadedInfo={INFO}
				onRestart={() => {}}
				onLater={() => {}}
			/>,
		);
		expect(screen.getByRole("status")).toHaveTextContent(/ready/i);
		expect(
			screen.getByRole("button", { name: /restart now/i }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /later/i })).toBeInTheDocument();
	});

	it("calls onRestart when Restart now is clicked", async () => {
		const onRestart = vi.fn();
		render(
			<UpdateBanner
				downloadingInfo={null}
				downloadedInfo={INFO}
				onRestart={onRestart}
				onLater={() => {}}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: /restart now/i }));
		expect(onRestart).toHaveBeenCalledTimes(1);
	});

	it("calls onLater when Later is clicked", async () => {
		const onLater = vi.fn();
		render(
			<UpdateBanner
				downloadingInfo={null}
				downloadedInfo={INFO}
				onRestart={() => {}}
				onLater={onLater}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: /later/i }));
		expect(onLater).toHaveBeenCalledTimes(1);
	});

	it("prefers the downloaded prompt over the downloading indicator", () => {
		render(
			<UpdateBanner
				downloadingInfo={{ ...INFO, version: "1.2.0" }}
				downloadedInfo={INFO}
				onRestart={() => {}}
				onLater={() => {}}
			/>,
		);
		expect(screen.getByRole("status")).toHaveTextContent(/ready/i);
		expect(screen.getByRole("status")).not.toHaveTextContent(/downloading/i);
	});
});
