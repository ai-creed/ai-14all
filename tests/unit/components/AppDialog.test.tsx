import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppDialog } from "../../../src/components/AppDialog";

describe("AppDialog", () => {
	it("renders title, description, body, and footer slots", () => {
		render(
			<AppDialog open onOpenChange={() => {}}>
				<AppDialog.Title>My title</AppDialog.Title>
				<AppDialog.Description>My description</AppDialog.Description>
				<AppDialog.Body>Body content</AppDialog.Body>
				<AppDialog.Footer>
					<button type="button">Cancel</button>
				</AppDialog.Footer>
			</AppDialog>,
		);
		expect(screen.getByText("My title")).toBeInTheDocument();
		expect(screen.getByText("My description")).toBeInTheDocument();
		expect(screen.getByText("Body content")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
	});

	it("applies the wide modifier when size='wide'", () => {
		const { container } = render(
			<AppDialog open onOpenChange={() => {}} size="wide">
				<AppDialog.Title>t</AppDialog.Title>
				<AppDialog.Body>b</AppDialog.Body>
				<AppDialog.Footer>f</AppDialog.Footer>
			</AppDialog>,
		);
		const content = container.ownerDocument.querySelector(".shell-app-dialog");
		expect(content?.classList.contains("shell-app-dialog--wide")).toBe(true);
	});

	it("does not render description in DOM when no Description child supplied", () => {
		render(
			<AppDialog open onOpenChange={() => {}}>
				<AppDialog.Title>t</AppDialog.Title>
				<AppDialog.Body>b</AppDialog.Body>
				<AppDialog.Footer>f</AppDialog.Footer>
			</AppDialog>,
		);
		expect(
			screen.queryByText("", { selector: ".shell-app-dialog__description" }),
		).not.toBeInTheDocument();
	});

	it("forwards aria-describedby={undefined} when description absent", () => {
		const { container } = render(
			<AppDialog open onOpenChange={() => {}}>
				<AppDialog.Title>t</AppDialog.Title>
				<AppDialog.Body>b</AppDialog.Body>
				<AppDialog.Footer>f</AppDialog.Footer>
			</AppDialog>,
		);
		const content = container.ownerDocument.querySelector(".shell-app-dialog");
		// Radix omits aria-describedby attribute entirely when undefined is passed.
		expect(content?.hasAttribute("aria-describedby")).toBe(false);
	});

	it("calls onOpenChange(false) when user presses Escape", () => {
		const onOpenChange = vi.fn();
		render(
			<AppDialog open onOpenChange={onOpenChange}>
				<AppDialog.Title>t</AppDialog.Title>
				<AppDialog.Body>b</AppDialog.Body>
				<AppDialog.Footer>f</AppDialog.Footer>
			</AppDialog>,
		);
		fireEvent.keyDown(document.activeElement ?? document.body, {
			key: "Escape",
		});
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
