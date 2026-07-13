import { describe, expect, it } from "vitest";
import {
	isImagePath,
	IMAGE_MIME_BY_EXT,
} from "../../../shared/files/image-files";

describe("isImagePath", () => {
	it.each([
		["a.png", true],
		["b.JPG", true],
		["c.jpeg", true],
		["d.gif", true],
		["e.webp", true],
		["f.svg", true],
		["g.bmp", true],
		["h.ico", true],
		["i.md", false],
		["j", false],
		["k.png.txt", false],
	])("%s → %s", (p, expected) => expect(isImagePath(p)).toBe(expected));

	it("maps svg to image/svg+xml", () =>
		expect(IMAGE_MIME_BY_EXT[".svg"]).toBe("image/svg+xml"));
});
