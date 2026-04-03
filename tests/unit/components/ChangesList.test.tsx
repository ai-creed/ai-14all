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

		expect(screen.getByText("src/index.ts")).toBeInTheDocument();
		expect(screen.getByText("??")).toBeInTheDocument();
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

		fireEvent.click(screen.getByText("src/index.ts"));
		expect(onSelect).toHaveBeenCalledWith("src/index.ts");
	});
});
