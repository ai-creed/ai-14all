import { createRef } from "react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

// requestSwitch behavior is driven per-test; the mocked InlineEditor forwards
// this handle up through the same ref path the real editor uses.
const requestSwitchMock = vi.fn<() => Promise<"proceed" | "cancel">>();

vi.mock("../../../src/features/viewer/components/InlineEditor", () => ({
	InlineEditor: React.forwardRef<unknown, { relativePath: string }>(
		function MockInlineEditor(props, ref) {
			React.useImperativeHandle(ref, () => ({
				requestSwitch: requestSwitchMock,
			}));
			return (
				<div data-testid="inline-editor" data-path={props.relativePath}>
					inline-editor
				</div>
			);
		},
	),
}));

vi.mock("../../../src/features/viewer/components/MarkdownPreview", () => ({
	MarkdownPreview: (props: { relativePath: string }) => (
		<div data-testid="markdown-preview" data-path={props.relativePath}>
			markdown-preview
		</div>
	),
}));

vi.mock("../../../src/features/viewer/components/ImagePreview", () => ({
	ImagePreview: (props: { relativePath: string }) => (
		<div data-testid="image-preview" data-path={props.relativePath}>
			image-preview
		</div>
	),
}));

import { FileViewer } from "../../../src/features/viewer/components/FileViewer";
import type { InlineEditorHandle } from "../../../src/features/viewer/components/InlineEditor";

const base = {
	workspaceId: "ws-1",
	worktreeId: "wt-1",
	resolvedTheme: "dark" as const,
};

beforeEach(() => {
	vi.clearAllMocks();
	requestSwitchMock.mockResolvedValue("proceed");
});

describe("FileViewer — markdown mode", () => {
	it("mounts MarkdownPreview by default with the toggle reflecting Preview active", () => {
		render(<FileViewer {...base} relativePath="README.md" />);
		expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
		expect(screen.queryByTestId("inline-editor")).toBeNull();
		const preview = screen.getByRole("button", { name: "Preview" });
		const source = screen.getByRole("button", { name: "Source" });
		expect(preview).toHaveAttribute("aria-pressed", "true");
		expect(source).toHaveAttribute("aria-pressed", "false");
	});

	it("toggling to Source mounts the InlineEditor and flips aria-pressed", () => {
		render(<FileViewer {...base} relativePath="README.md" />);
		fireEvent.click(screen.getByRole("button", { name: "Source" }));
		expect(screen.getByTestId("inline-editor")).toBeInTheDocument();
		expect(screen.queryByTestId("markdown-preview")).toBeNull();
		expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		expect(screen.getByRole("button", { name: "Source" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	it("requestSwitch 'cancel' keeps the editor mounted (dirty guard)", async () => {
		requestSwitchMock.mockResolvedValue("cancel");
		render(<FileViewer {...base} relativePath="README.md" />);
		fireEvent.click(screen.getByRole("button", { name: "Source" }));
		expect(screen.getByTestId("inline-editor")).toBeInTheDocument();

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Preview" }));
		});

		expect(requestSwitchMock).toHaveBeenCalledTimes(1);
		// Cancelled → still showing source.
		expect(screen.getByTestId("inline-editor")).toBeInTheDocument();
		expect(screen.queryByTestId("markdown-preview")).toBeNull();
	});

	it("requestSwitch 'proceed' switches back to preview", async () => {
		requestSwitchMock.mockResolvedValue("proceed");
		render(<FileViewer {...base} relativePath="README.md" />);
		fireEvent.click(screen.getByRole("button", { name: "Source" }));
		expect(screen.getByTestId("inline-editor")).toBeInTheDocument();

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Preview" }));
		});

		await waitFor(() =>
			expect(screen.getByTestId("markdown-preview")).toBeInTheDocument(),
		);
		expect(screen.queryByTestId("inline-editor")).toBeNull();
	});

	it("changing the path resets Source back to Preview", () => {
		const { rerender } = render(<FileViewer {...base} relativePath="a.md" />);
		fireEvent.click(screen.getByRole("button", { name: "Source" }));
		expect(screen.getByTestId("inline-editor")).toBeInTheDocument();

		rerender(<FileViewer {...base} relativePath="b.md" />);
		expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
		expect(screen.getByTestId("markdown-preview")).toHaveAttribute(
			"data-path",
			"b.md",
		);
		expect(screen.queryByTestId("inline-editor")).toBeNull();
	});

	it("renders exactly one Preview-named button in Source mode (D15 regression)", () => {
		render(<FileViewer {...base} relativePath="README.md" />);
		fireEvent.click(screen.getByRole("button", { name: "Source" }));
		expect(screen.getAllByRole("button", { name: /preview/i })).toHaveLength(1);
	});
});

describe("FileViewer — image mode", () => {
	it("renders ImagePreview with no toggle buttons", () => {
		render(<FileViewer {...base} relativePath="assets/logo.png" />);
		expect(screen.getByTestId("image-preview")).toBeInTheDocument();
		expect(screen.getByTestId("image-preview")).toHaveAttribute(
			"data-path",
			"assets/logo.png",
		);
		expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
		expect(screen.queryByTestId("inline-editor")).toBeNull();
	});
});

describe("FileViewer — source (non-md, non-image) mode", () => {
	it("passes through to InlineEditor with the path and ref, no toggle", async () => {
		const ref = createRef<InlineEditorHandle>();
		render(<FileViewer {...base} relativePath="src/a.ts" ref={ref} />);
		const editor = screen.getByTestId("inline-editor");
		expect(editor).toHaveAttribute("data-path", "src/a.ts");
		expect(screen.queryByRole("button", { name: "Preview" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
		// Ref resolves to the inner editor handle in source mode.
		await waitFor(() =>
			expect(typeof ref.current?.requestSwitch).toBe("function"),
		);
	});
});
