import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RestorePrompt } from "../../../src/features/repository/RestorePrompt";

describe("RestorePrompt", () => {
	it("submits restore with remembered choice", async () => {
		const user = userEvent.setup();
		const onDecide = vi.fn();

		render(<RestorePrompt repositoryPath="/repo" onDecide={onDecide} />);

		await user.click(screen.getByLabelText("Remember my choice"));
		await user.click(
			screen.getByRole("button", { name: "Restore previous workspace" }),
		);

		expect(onDecide).toHaveBeenCalledWith({
			shouldRestore: true,
			rememberChoice: true,
		});
	});

	it("submits start-clean without remembering by default", async () => {
		const user = userEvent.setup();
		const onDecide = vi.fn();

		render(<RestorePrompt repositoryPath="/repo" onDecide={onDecide} />);

		await user.click(screen.getByRole("button", { name: "Start clean" }));

		expect(onDecide).toHaveBeenCalledWith({
			shouldRestore: false,
			rememberChoice: false,
		});
	});
});
