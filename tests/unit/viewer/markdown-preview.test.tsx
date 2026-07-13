import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/desktop-client", () => ({
	files: {
		read: vi.fn(),
	},
}));

import { MarkdownPreview } from "../../../src/features/viewer/components/MarkdownPreview";
import { files } from "../../../src/lib/desktop-client";

const readMock = files.read as unknown as ReturnType<typeof vi.fn>;

const base = {
	workspaceId: "ws-1",
	worktreeId: "wt-1",
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("MarkdownPreview — loading", () => {
	it("shows a loading placeholder while the read is in flight", () => {
		readMock.mockReturnValue(new Promise(() => {}));
		render(<MarkdownPreview {...base} relativePath="README.md" />);
		expect(screen.getByText("Loading README.md…")).toBeInTheDocument();
	});
});

describe("MarkdownPreview — success", () => {
	it("renders a GFM table", async () => {
		readMock.mockResolvedValueOnce({
			ok: true,
			view: {
				path: "README.md",
				content: "| A | B |\n|---|---|\n| 1 | 2 |\n",
				language: "markdown",
			},
		});
		render(<MarkdownPreview {...base} relativePath="README.md" />);
		expect(await screen.findByRole("table")).toBeInTheDocument();
		expect(screen.getByText("A")).toBeInTheDocument();
		expect(screen.getByText("B")).toBeInTheDocument();
	});

	it("renders a fenced code block with a language class", async () => {
		readMock.mockResolvedValueOnce({
			ok: true,
			view: {
				path: "README.md",
				content: "```ts\nconst x = 1;\n```\n",
				language: "markdown",
			},
		});
		render(<MarkdownPreview {...base} relativePath="README.md" />);
		await waitFor(() => {
			expect(document.querySelector("code.language-ts")).not.toBeNull();
		});
	});
});

describe("MarkdownPreview — failure states", () => {
	it("path-escape renders a generic load-failure message", async () => {
		readMock.mockResolvedValueOnce({
			ok: false,
			path: "../outside.md",
			reason: { kind: "path-escape" },
		});
		render(<MarkdownPreview {...base} relativePath="../outside.md" />);
		await screen.findByText("Couldn't load file contents.");
	});

	it("too-large renders a size-agnostic placeholder", async () => {
		readMock.mockResolvedValueOnce({
			ok: false,
			path: "huge.md",
			reason: { kind: "too-large", size: 2 * 1024 * 1024 },
		});
		render(<MarkdownPreview {...base} relativePath="huge.md" />);
		await screen.findByText("File too large to preview.");
	});

	it("permission-denied renders a permission-denied message", async () => {
		readMock.mockResolvedValueOnce({
			ok: false,
			path: "secret.md",
			reason: { kind: "permission-denied" },
		});
		render(<MarkdownPreview {...base} relativePath="secret.md" />);
		await screen.findByText("Permission denied.");
	});
});
