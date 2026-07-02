import { afterEach, describe, expect, it } from "vitest";
import {
	anchorSelector,
	measureAnchor,
} from "../../../src/features/onboarding/logic/measure-anchor";

afterEach(() => {
	document.body.innerHTML = "";
});

describe("anchorSelector", () => {
	it("builds a data-tour attribute selector", () => {
		expect(anchorSelector("sidebar-tree")).toBe('[data-tour="sidebar-tree"]');
	});
});

describe("measureAnchor", () => {
	it("returns a rect for a mounted anchor", () => {
		const el = document.createElement("div");
		el.setAttribute("data-tour", "sidebar-tree");
		document.body.appendChild(el);
		expect(measureAnchor("sidebar-tree")).not.toBeNull();
	});
	it("returns null when the anchor is absent", () => {
		expect(measureAnchor("review-bar")).toBeNull();
	});
	it("returns the first match when duplicated (e.g. session rows)", () => {
		for (let i = 0; i < 3; i++) {
			const el = document.createElement("div");
			el.setAttribute("data-tour", "session-row");
			el.setAttribute("data-index", String(i));
			document.body.appendChild(el);
		}
		// A rect is returned (jsdom geometry is zeroed, but the element resolves).
		expect(measureAnchor("session-row")).not.toBeNull();
	});
});
