// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewCommentSidebar } from "../../../src/features/review/ReviewCommentSidebar";

const baseProps = {
	filePath: "src/foo.ts",
	comments: [],
	addingForFile: null,
	onScrollTo: () => {},
	onToggleAddressed: () => {},
	onDelete: () => {},
	onSubmitNew: () => {},
	onCancelNew: () => {},
};

describe("ReviewCommentSidebar — install CTA", () => {
	it("renders CTA when installCtaVisible=true", () => {
		render(
			<ReviewCommentSidebar
				{...baseProps}
				installCtaVisible
				onOpenInstall={() => {}}
			/>,
		);
		expect(screen.getByTestId("agent-install-cta")).toBeTruthy();
	});

	it("hides CTA when installCtaVisible=false", () => {
		render(
			<ReviewCommentSidebar
				{...baseProps}
				installCtaVisible={false}
				onOpenInstall={() => {}}
			/>,
		);
		expect(screen.queryByTestId("agent-install-cta")).toBeNull();
	});

	it("CTA click calls onOpenInstall", async () => {
		const onOpenInstall = vi.fn();
		render(
			<ReviewCommentSidebar
				{...baseProps}
				installCtaVisible
				onOpenInstall={onOpenInstall}
			/>,
		);
		await userEvent.click(screen.getByRole("button", { name: /Install/i }));
		expect(onOpenInstall).toHaveBeenCalledTimes(1);
	});

	it("works without CTA props (backward-compatible default)", () => {
		render(<ReviewCommentSidebar {...baseProps} />);
		expect(screen.queryByTestId("agent-install-cta")).toBeNull();
	});
});
