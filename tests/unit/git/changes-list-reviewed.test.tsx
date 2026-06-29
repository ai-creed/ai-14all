import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChangesList } from "../../../src/features/git/components/ChangesList";

const NOOP = () => {};

describe("ChangesList reviewed marker", () => {
	it("renders a reviewed mark only on reviewed paths", () => {
		render(
			<ChangesList
				workspaceId="w"
				worktreeId="wt1"
				changes={[
					{ path: "a.ts", status: "M" },
					{ path: "b.ts", status: "M" },
				]}
				selectedPath={null}
				onSelect={NOOP}
				onDiscardChange={NOOP}
				reviewedPaths={["a.ts"]}
			/>,
		);
		expect(screen.getByTestId("reviewed-mark-a.ts")).toBeInTheDocument();
		expect(screen.queryByTestId("reviewed-mark-b.ts")).toBeNull();
	});
});
