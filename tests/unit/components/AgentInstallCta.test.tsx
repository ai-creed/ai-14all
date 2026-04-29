// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentInstallCta } from "../../../src/features/review/components/AgentInstallCta";

describe("AgentInstallCta", () => {
	it("renders the install copy and a button", () => {
		render(<AgentInstallCta onOpenInstall={() => {}} />);
		expect(screen.getByText(/Install fix-review skill/i)).toBeTruthy();
		expect(screen.getByRole("button", { name: /Install/i })).toBeTruthy();
	});

	it("fires onOpenInstall when clicked", async () => {
		const onOpenInstall = vi.fn();
		render(<AgentInstallCta onOpenInstall={onOpenInstall} />);
		await userEvent.click(screen.getByRole("button", { name: /Install/i }));
		expect(onOpenInstall).toHaveBeenCalledTimes(1);
	});
});
