import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChangesList } from "../../../src/features/git/ChangesList";

describe("ChangesList", () => {
	it("renders changed files with status badges", () => {
		render(
			<ChangesList
				changes={[
					{ path: "src/index.ts", status: "M" },
					{ path: "src/new-file.ts", status: "??" },
				]}
				selectedPath="src/new-file.ts"
				onSelect={vi.fn()}
			/>,
		);

		expect(
			screen.getByRole("button", { name: /src\/index\.ts/i }),
		).toBeInTheDocument();
		expect(screen.getByText("??")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /src\/new-file\.ts/i }),
		).toHaveAttribute("data-selected", "true");
	});

	it("calls onSelect when a file is clicked", () => {
		const onSelect = vi.fn();
		render(
			<ChangesList
				changes={[{ path: "src/index.ts", status: "M" }]}
				selectedPath={null}
				onSelect={onSelect}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /src\/index\.ts/i }));
		expect(onSelect).toHaveBeenCalledWith("src/index.ts");
	});

	it("shows error message when gitSummaryError is true", () => {
		render(
			<ChangesList
				changes={[]}
				selectedPath={null}
				onSelect={() => {}}
				gitSummaryError
			/>,
		);
		expect(screen.getByText("Unable to load Git data.")).toBeInTheDocument();
		expect(screen.queryByText("No changed files.")).not.toBeInTheDocument();
	});
});
