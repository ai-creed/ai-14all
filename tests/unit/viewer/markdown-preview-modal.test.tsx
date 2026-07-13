import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/desktop-client", () => ({
	files: {
		read: vi.fn(),
	},
}));

import { MarkdownPreviewModal } from "../../../src/features/viewer/components/MarkdownPreviewModal";
import { files } from "../../../src/lib/desktop-client";

const readMock = files.read as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks();
});

describe("MarkdownPreviewModal — contentOverride", () => {
	it("renders content via MarkdownBody without reading from disk", async () => {
		render(
			<MarkdownPreviewModal
				workspaceId="ws-1"
				worktreeId="wt-1"
				relativePath="README.md"
				contentOverride="# Pinned"
				open={true}
				onClose={vi.fn()}
			/>,
		);

		expect(
			await screen.findByRole("heading", { name: "Pinned" }),
		).toBeInTheDocument();
		expect(readMock).not.toHaveBeenCalled();
	});
});
