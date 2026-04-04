import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionHeader } from "../../../src/features/workspace/SessionHeader";

describe("SessionHeader", () => {
	it("renders title, branch name, and changed file count", () => {
		render(
			<SessionHeader
				title="My Session"
				branchName="feature-x"
				changedFileCount={3}
				isDirty={false}
			/>,
		);

		expect(screen.getByRole("banner")).toBeInTheDocument();
		expect(screen.getByText("My Session")).toBeInTheDocument();
		expect(screen.getByText("feature-x")).toBeInTheDocument();
		expect(screen.getByText("3")).toBeInTheDocument();
		expect(screen.getByText("Changes:")).toBeInTheDocument();
	});

	it("renders branch, dirty state, and changed file count", () => {
		render(
			<SessionHeader
				title="Feature Session"
				branchName="feature-a"
				changedFileCount={2}
				isDirty
			/>,
		);

		expect(screen.getByText("Feature Session")).toBeInTheDocument();
		expect(screen.getByText("feature-a")).toBeInTheDocument();
		expect(screen.getByText("Dirty")).toBeInTheDocument();
		expect(screen.getByText("2")).toBeInTheDocument();
	});
});
