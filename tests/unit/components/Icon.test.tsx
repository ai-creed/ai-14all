import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Icon, ICON_GLYPHS } from "../../../src/components/ui/icon";

describe("Icon registry", () => {
	it("includes git-branch and palette glyphs with fallbacks", () => {
		expect(ICON_GLYPHS["git-branch"]?.fallback).toBeTruthy();
		expect(ICON_GLYPHS["palette"]?.fallback).toBeTruthy();
	});

	it("renders a hidden text fallback for new icons", () => {
		const { container } = render(<Icon name="git-branch" />);
		expect(container.textContent).toContain(ICON_GLYPHS["git-branch"].fallback);
	});
});
