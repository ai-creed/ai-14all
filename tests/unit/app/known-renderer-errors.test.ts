import { afterEach, describe, expect, it, vi } from "vitest";
import {
	installKnownRendererErrorHandler,
	isKnownXtermViewportDimensionsError,
} from "../../../src/app/logic/known-renderer-errors";

describe("known renderer errors", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("matches the xterm viewport dimensions error", () => {
		const error = new TypeError(
			"Cannot read properties of undefined (reading 'dimensions')",
		);
		error.stack =
			"TypeError: Cannot read properties of undefined (reading 'dimensions')\n" +
			"    at get dimensions (xterm.js?v=8131f78d:1776:41)\n" +
			"    at t2.Viewport._innerRefresh (xterm.js?v=8131f78d:821:60)";

		expect(isKnownXtermViewportDimensionsError(error)).toBe(true);
	});

	it("does not match unrelated dimensions errors", () => {
		const error = new TypeError(
			"Cannot read properties of undefined (reading 'dimensions')",
		);
		error.stack =
			"TypeError: Cannot read properties of undefined (reading 'dimensions')\n" +
			"    at get dimensions (src/features/viewer/viewer.ts:10:1)";

		expect(isKnownXtermViewportDimensionsError(error)).toBe(false);
	});

	it("prevents the known xterm error and logs it in dev mode", () => {
		const warn = vi.fn();
		const restore = installKnownRendererErrorHandler({
			dev: true,
			logger: { warn },
		});
		const error = new TypeError(
			"Cannot read properties of undefined (reading 'dimensions')",
		);
		error.stack =
			"TypeError: Cannot read properties of undefined (reading 'dimensions')\n" +
			"    at get dimensions (xterm.js?v=8131f78d:1776:41)\n" +
			"    at t2.Viewport._innerRefresh (xterm.js?v=8131f78d:821:60)";

		const event = new ErrorEvent("error", {
			cancelable: true,
			error,
			message: error.message,
		});
		const dispatched = window.dispatchEvent(event);

		restore();
		expect(dispatched).toBe(false);
		expect(event.defaultPrevented).toBe(true);
		expect(warn).toHaveBeenCalledWith(
			"[xterm] Suppressed known viewport dimensions error",
			error,
		);
	});

	it("does not prevent unrelated errors", () => {
		const warn = vi.fn();
		const restore = installKnownRendererErrorHandler({
			dev: true,
			logger: { warn },
		});
		const error = new Error("different startup failure");

		const event = new ErrorEvent("error", {
			cancelable: true,
			error,
			message: error.message,
		});
		const dispatched = window.dispatchEvent(event);

		restore();
		expect(dispatched).toBe(true);
		expect(event.defaultPrevented).toBe(false);
		expect(warn).not.toHaveBeenCalled();
	});
});
