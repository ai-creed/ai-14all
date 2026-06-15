import { describe, expect, it, vi } from "vitest";
import {
	classifyNavigation,
	installNavigationGuard,
	type GuardableWebContents,
} from "../../../electron/main/services/navigation-guard";

const APP_DEV = "http://localhost:5173/";
const APP_PROD =
	"file:///Applications/ai-14all.app/Contents/Resources/app/out/renderer/index.html";

describe("classifyNavigation", () => {
	it("classifies cross-origin http/https/mailto as external", () => {
		expect(
			classifyNavigation("https://github.com/ai-creed/ai-cortex", APP_DEV),
		).toBe("external");
		expect(classifyNavigation("http://example.com/", APP_PROD)).toBe(
			"external",
		);
		expect(classifyNavigation("mailto:dev@example.com", APP_PROD)).toBe(
			"external",
		);
	});

	it("classifies the app's own document as internal (reload / query / hash)", () => {
		expect(classifyNavigation(APP_DEV, APP_DEV)).toBe("internal");
		expect(classifyNavigation("http://localhost:5173/?reload=1", APP_DEV)).toBe(
			"internal",
		);
		expect(
			classifyNavigation("http://localhost:5173/#/settings", APP_DEV),
		).toBe("internal");
		expect(classifyNavigation(APP_PROD, APP_PROD)).toBe("internal");
	});

	it("blocks non-web schemes and same-origin different documents", () => {
		expect(classifyNavigation("file:///etc/passwd", APP_PROD)).toBe("block");
		expect(classifyNavigation("javascript:alert(1)", APP_DEV)).toBe("block");
		expect(classifyNavigation("about:blank", APP_DEV)).toBe("block");
		// A prod relative link resolves to a sibling file: same origin, but a
		// different document than the app shell -> must not navigate the renderer.
		expect(
			classifyNavigation(
				"file:///Applications/ai-14all.app/Contents/Resources/app/out/renderer/docs.html",
				APP_PROD,
			),
		).toBe("block");
	});

	it("blocks an unparseable URL instead of throwing", () => {
		expect(classifyNavigation("::::not a url", APP_DEV)).toBe("block");
	});
});

function makeFakeWebContents(appUrl: string): {
	wc: GuardableWebContents;
	emitWillNavigate: (url: string) => {
		preventDefault: ReturnType<typeof vi.fn>;
	};
	openWindow: (url: string) => { action: "deny" };
} {
	let willNavigate:
		| ((event: { preventDefault(): void }, url: string) => void)
		| null = null;
	let windowOpenHandler: ((d: { url: string }) => { action: "deny" }) | null =
		null;
	const wc: GuardableWebContents = {
		on(_event, listener) {
			willNavigate = listener;
			return wc;
		},
		setWindowOpenHandler(handler) {
			windowOpenHandler = handler;
		},
		getURL() {
			return appUrl;
		},
	};
	return {
		wc,
		emitWillNavigate(url) {
			const event = { preventDefault: vi.fn() };
			willNavigate?.(event, url);
			return event;
		},
		openWindow(url) {
			if (!windowOpenHandler) throw new Error("no window-open handler set");
			return windowOpenHandler({ url });
		},
	};
}

describe("installNavigationGuard", () => {
	it("opens external links in the browser and cancels the in-app navigation", () => {
		const f = makeFakeWebContents(APP_DEV);
		const openExternal = vi.fn();
		installNavigationGuard(f.wc, { openExternal });
		const event = f.emitWillNavigate("https://github.com/ai-creed/ai-whisper");
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(openExternal).toHaveBeenCalledWith(
			"https://github.com/ai-creed/ai-whisper",
		);
	});

	it("lets the app navigate its own document (no preventDefault, no open)", () => {
		const f = makeFakeWebContents(APP_DEV);
		const openExternal = vi.fn();
		installNavigationGuard(f.wc, { openExternal });
		const event = f.emitWillNavigate("http://localhost:5173/?reload=1");
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(openExternal).not.toHaveBeenCalled();
	});

	it("cancels a file navigation without opening it externally", () => {
		const f = makeFakeWebContents(APP_PROD);
		const openExternal = vi.fn();
		installNavigationGuard(f.wc, { openExternal });
		const event = f.emitWillNavigate("file:///etc/passwd");
		expect(event.preventDefault).toHaveBeenCalledOnce();
		expect(openExternal).not.toHaveBeenCalled();
	});

	it("denies window.open and sends external targets to the browser", () => {
		const f = makeFakeWebContents(APP_DEV);
		const openExternal = vi.fn();
		installNavigationGuard(f.wc, { openExternal });
		expect(f.openWindow("https://example.com/")).toEqual({ action: "deny" });
		expect(openExternal).toHaveBeenCalledWith("https://example.com/");
	});

	it("denies window.open for non-web schemes without opening them", () => {
		const f = makeFakeWebContents(APP_DEV);
		const openExternal = vi.fn();
		installNavigationGuard(f.wc, { openExternal });
		expect(f.openWindow("file:///etc/passwd")).toEqual({ action: "deny" });
		expect(openExternal).not.toHaveBeenCalled();
	});
});
