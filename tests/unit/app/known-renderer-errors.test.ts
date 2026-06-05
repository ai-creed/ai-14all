import { afterEach, describe, expect, it, vi } from "vitest";
import {
	installKnownRendererErrorHandler,
	isKnownMonacoCancellation,
	isKnownMonacoPeekModelError,
	isKnownXtermViewportDimensionsError,
} from "../../../src/app/logic/known-renderer-errors";

function monacoCancellationError(): Error {
	// Monaco's CancellationError: name and message are both "Canceled".
	return Object.assign(new Error("Canceled"), { name: "Canceled" });
}

function monacoPeekModelError(): Error {
	const error = new Error("Model not found");
	error.stack =
		"Error: Model not found\n" +
		"    at StandaloneTextModelService2.createModelReference (chunk-NUX3MOT7.js:185196:29)\n" +
		"    at FileReferences.resolve (chunk-NUX3MOT7.js:115373:52)\n" +
		"    at ReferencesTree.doGetChildren (chunk-NUX3MOT7.js:113941:38)";
	return error;
}

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

	it("matches the Monaco peek 'Model not found' error", () => {
		expect(isKnownMonacoPeekModelError(monacoPeekModelError())).toBe(true);
	});

	it("does not match an unrelated 'Model not found' error", () => {
		const error = new Error("Model not found");
		error.stack = "Error: Model not found\n    at someOtherThing (app.ts:1:1)";
		expect(isKnownMonacoPeekModelError(error)).toBe(false);
	});

	it("prevents the Monaco peek error from the error event and logs in dev", () => {
		const warn = vi.fn();
		const restore = installKnownRendererErrorHandler({
			dev: true,
			logger: { warn },
		});
		const error = monacoPeekModelError();
		const event = new ErrorEvent("error", {
			cancelable: true,
			error,
			message: error.message,
		});
		const dispatched = window.dispatchEvent(event);
		restore();
		expect(dispatched).toBe(false);
		expect(event.defaultPrevented).toBe(true);
		expect(warn).toHaveBeenCalled();
	});

	it("prevents the Monaco peek error from an unhandledrejection event", () => {
		const restore = installKnownRendererErrorHandler({ dev: false });
		const error = monacoPeekModelError();
		const event = new PromiseRejectionEvent("unhandledrejection", {
			cancelable: true,
			promise: Promise.reject(error).catch(() => undefined) as Promise<never>,
			reason: error,
		});
		const dispatched = window.dispatchEvent(event);
		restore();
		expect(dispatched).toBe(false);
		expect(event.defaultPrevented).toBe(true);
	});

	it("matches Monaco's CancellationError (name + message 'Canceled')", () => {
		expect(isKnownMonacoCancellation(monacoCancellationError())).toBe(true);
	});

	it("does not match a real error that merely says 'Canceled'", () => {
		// name stays "Error" — only Monaco's CancellationError sets name to
		// "Canceled", so a genuine bug with that message still surfaces.
		expect(isKnownMonacoCancellation(new Error("Canceled"))).toBe(false);
	});

	it("does not match unrelated rejections", () => {
		expect(isKnownMonacoCancellation(new Error("Model not found"))).toBe(false);
		expect(isKnownMonacoCancellation("Canceled")).toBe(false);
		expect(isKnownMonacoCancellation(null)).toBe(false);
	});

	it("prevents the benign Monaco cancellation from an unhandledrejection event", () => {
		const warn = vi.fn();
		const restore = installKnownRendererErrorHandler({
			dev: true,
			logger: { warn },
		});
		const error = monacoCancellationError();
		const event = new PromiseRejectionEvent("unhandledrejection", {
			cancelable: true,
			promise: Promise.reject(error).catch(() => undefined) as Promise<never>,
			reason: error,
		});
		const dispatched = window.dispatchEvent(event);
		restore();
		expect(dispatched).toBe(false);
		expect(event.defaultPrevented).toBe(true);
		expect(warn).toHaveBeenCalled();
	});
});
