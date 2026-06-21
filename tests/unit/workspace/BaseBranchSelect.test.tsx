import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BaseBranchSelect } from "../../../src/features/workspace/components/BaseBranchSelect";

const BRANCHES = ["origin/master", "origin/devel", "origin/feature/x"];

describe("BaseBranchSelect", () => {
	it("renders every branch as an option and marks the value selected", () => {
		render(
			<BaseBranchSelect
				branches={BRANCHES}
				value="origin/devel"
				onChange={vi.fn()}
			/>,
		);
		for (const branch of BRANCHES) {
			expect(screen.getByRole("option", { name: branch })).toBeInTheDocument();
		}
		expect(
			screen.getByRole("option", { name: "origin/devel" }),
		).toHaveAttribute("aria-selected", "true");
	});

	it("filters options by the search query", async () => {
		const user = userEvent.setup();
		render(
			<BaseBranchSelect branches={BRANCHES} value={null} onChange={vi.fn()} />,
		);
		await user.type(screen.getByRole("combobox"), "dev");
		expect(
			screen.getByRole("option", { name: "origin/devel" }),
		).toBeInTheDocument();
		expect(screen.queryByRole("option", { name: "origin/master" })).toBeNull();
	});

	it("calls onChange with the clicked branch", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(
			<BaseBranchSelect branches={BRANCHES} value={null} onChange={onChange} />,
		);
		await user.click(screen.getByRole("option", { name: "origin/devel" }));
		expect(onChange).toHaveBeenCalledWith("origin/devel");
	});

	it("selects the top filtered match on Enter", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(
			<BaseBranchSelect branches={BRANCHES} value={null} onChange={onChange} />,
		);
		const input = screen.getByRole("combobox");
		await user.type(screen.getByRole("combobox"), "feat");
		await user.type(input, "{Enter}");
		expect(onChange).toHaveBeenCalledWith("origin/feature/x");
	});

	it("shows an empty message when nothing matches", async () => {
		const user = userEvent.setup();
		render(
			<BaseBranchSelect branches={BRANCHES} value={null} onChange={vi.fn()} />,
		);
		await user.type(screen.getByRole("combobox"), "zzz");
		expect(screen.getByText(/no matching branches/i)).toBeInTheDocument();
	});
});
