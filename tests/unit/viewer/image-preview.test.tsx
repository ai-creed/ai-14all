import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/desktop-client", () => ({
	files: {
		readImage: vi.fn(),
	},
}));

import { ImagePreview } from "../../../src/features/viewer/components/ImagePreview";
import { files } from "../../../src/lib/desktop-client";

const readImageMock = files.readImage as unknown as ReturnType<typeof vi.fn>;

const base = {
	workspaceId: "ws-1",
	worktreeId: "wt-1",
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("ImagePreview — success", () => {
	it("renders an img with a data: URI and a caption with filename and byte size", async () => {
		readImageMock.mockResolvedValueOnce({
			ok: true,
			base64: "aGVsbG8h",
			mime: "image/png",
			byteLength: 8,
		});
		render(<ImagePreview {...base} relativePath="assets/pic.png" />);
		const img = (await screen.findByRole("img")) as HTMLImageElement;
		expect(img.src.startsWith("data:image/png;base64,")).toBe(true);
		expect(screen.getByText(/pic\.png/)).toBeInTheDocument();
		expect(screen.getByText(/8 B/)).toBeInTheDocument();
	});
});

describe("ImagePreview — failure states", () => {
	it("too-large renders a size-aware placeholder", async () => {
		readImageMock.mockResolvedValueOnce({
			ok: false,
			reason: { kind: "too-large", size: 2 * 1024 * 1024 },
		});
		render(<ImagePreview {...base} relativePath="huge.png" />);
		await screen.findByText(/Too large to preview/);
	});

	it("path-escape renders a generic load-failure message", async () => {
		readImageMock.mockResolvedValueOnce({
			ok: false,
			reason: { kind: "path-escape" },
		});
		render(<ImagePreview {...base} relativePath="../outside.png" />);
		await screen.findByText("Couldn't load file contents.");
	});

	it("read-failed renders a generic load-failure message", async () => {
		readImageMock.mockResolvedValueOnce({
			ok: false,
			reason: { kind: "read-failed" },
		});
		render(<ImagePreview {...base} relativePath="broken.png" />);
		await screen.findByText("Couldn't load file contents.");
	});

	it("img onError renders a decode-failure message", async () => {
		readImageMock.mockResolvedValueOnce({
			ok: true,
			base64: "aGVsbG8h",
			mime: "image/png",
			byteLength: 8,
		});
		render(<ImagePreview {...base} relativePath="pic.png" />);
		const img = await screen.findByRole("img");
		fireEvent.error(img);
		await screen.findByText("Cannot decode image.");
	});
});
