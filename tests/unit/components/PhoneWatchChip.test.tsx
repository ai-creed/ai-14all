import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PhoneWatchChip } from "../../../src/features/terminals/components/PhoneWatchChip";

describe("PhoneWatchChip", () => {
	it("shows the watching label with the agent identity", () => {
		render(
			<PhoneWatchChip
				label="claude"
				provider="claude"
				since={Date.now() - 65_000}
			/>,
		);
		expect(screen.getByText(/phone watching/i)).toBeInTheDocument();
		expect(screen.getByText(/claude/)).toBeInTheDocument();
		expect(screen.getByText(/1:0[0-9]/)).toBeInTheDocument(); // elapsed mm:ss
	});
});
