import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the virtualizer so all rows render deterministically in jsdom (which has
// no layout). Mirrors tests/unit/components/WorktreeTree.test.tsx.
vi.mock("@tanstack/react-virtual", () => ({
	useVirtualizer: (options: { count: number }) => ({
		getTotalSize: () => options.count * 44,
		getVirtualItems: () =>
			Array.from({ length: options.count }, (_, i) => ({
				index: i,
				start: i * 44,
				size: 44,
				key: String(i),
			})),
		measureElement: () => 0,
		scrollToIndex: () => {},
	}),
}));

import { SymbolResults } from "../../../src/features/code-nav/palette/SymbolResults";
import type { DefinitionRowPayload } from "../../../shared/contracts/commands";

const row = (over: Partial<DefinitionRowPayload>): DefinitionRowPayload => ({
	id: 1,
	qualified_name: "parseConfig",
	bare_name: "parseConfig",
	file: "src/foo.ts",
	line: 12,
	exported: 1,
	is_default: 0,
	is_declaration_only: 0,
	col: 5,
	end_line: 12,
	end_col: 8,
	...over,
});

const baseStatus = {
	available: true as const,
	ready: true,
	reason: null,
	dirtyAtIndex: false,
	sourceFingerprint: null,
	sourceIndexedAt: null,
};

describe("SymbolResults", () => {
	it("shows the unavailable banner and no list when not indexed", () => {
		render(
			<SymbolResults
				status={{ ...baseStatus, available: false, reason: "no-cortex" }}
				results={[]}
				loading={false}
				error={null}
				cursor={0}
				query="parse"
				refreshing={false}
				onPick={() => {}}
				onRefresh={() => {}}
			/>,
		);
		expect(
			screen.getByTestId("code-nav-unavailable-banner"),
		).toHaveTextContent(/install ai-cortex/i);
		expect(screen.queryByRole("option")).toBeNull();
	});

	it("renders a stale-index banner whose Refresh button calls onRefresh", async () => {
		const onRefresh = vi.fn();
		render(
			<SymbolResults
				status={{ ...baseStatus, dirtyAtIndex: true }}
				results={[]}
				loading={false}
				error={null}
				cursor={0}
				query=""
				refreshing={false}
				onPick={() => {}}
				onRefresh={onRefresh}
			/>,
		);
		const banner = screen.getByTestId("stale-index-banner");
		expect(banner).toBeTruthy();
		await userEvent.click(
			screen.getByRole("button", { name: /refresh index/i }),
		);
		expect(onRefresh).toHaveBeenCalledTimes(1);
	});

	it("disables the Refresh button while refreshing", () => {
		render(
			<SymbolResults
				status={{ ...baseStatus, dirtyAtIndex: true }}
				results={[]}
				loading={false}
				error={null}
				cursor={0}
				query=""
				refreshing={true}
				onPick={() => {}}
				onRefresh={() => {}}
			/>,
		);
		expect(
			screen.getByRole("button", { name: /refreshing/i }),
		).toBeDisabled();
	});

	it("shows the empty-QUERY prompt (distinct from no-match) when query is blank", () => {
		render(
			<SymbolResults
				status={baseStatus}
				results={[]}
				loading={false}
				error={null}
				cursor={0}
				query=""
				refreshing={false}
				onPick={() => {}}
				onRefresh={() => {}}
			/>,
		);
		expect(screen.getByText(/search symbols by name/i)).toBeTruthy();
		expect(screen.queryByTestId("symbol-results-empty")).toBeNull();
	});

	it("shows an empty state when a query yields no matches", () => {
		render(
			<SymbolResults
				status={baseStatus}
				results={[]}
				loading={false}
				error={null}
				cursor={0}
				query="zzz"
				refreshing={false}
				onPick={() => {}}
				onRefresh={() => {}}
			/>,
		);
		expect(screen.getByTestId("symbol-results-empty")).toHaveTextContent(
			/no symbols match/i,
		);
	});

	it("renders rows and calls onPick with the row index on click", async () => {
		const onPick = vi.fn();
		render(
			<SymbolResults
				status={baseStatus}
				results={[row({}), row({ id: 2, qualified_name: "Cli.parseArgs" })]}
				loading={false}
				error={null}
				cursor={0}
				query="parse"
				refreshing={false}
				onPick={onPick}
				onRefresh={() => {}}
			/>,
		);
		const options = screen.getAllByRole("option");
		expect(options.length).toBe(2);
		await userEvent.click(options[1]!);
		expect(onPick).toHaveBeenCalledWith(1);
	});

	it("marks the cursor row as selected", () => {
		render(
			<SymbolResults
				status={baseStatus}
				results={[row({}), row({ id: 2 })]}
				loading={false}
				error={null}
				cursor={1}
				query="parse"
				refreshing={false}
				onPick={() => {}}
				onRefresh={() => {}}
			/>,
		);
		const options = screen.getAllByRole("option");
		expect(options[1]!.getAttribute("aria-selected")).toBe("true");
	});
});
