import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useNoteBridgeReceiver } from "../../../../src/features/workspace/hooks/use-note-bridge-receiver";

function makeApi() {
	return {
		onRequest: vi.fn(() => () => {}),
		sendReply: vi.fn(),
		sendReady: vi.fn(),
		sendGoodbye: vi.fn(),
	};
}

const noopWorkspaces = { forEach: () => {} };
const noopDispatch = () => {};

describe("useNoteBridgeReceiver", () => {
	it("does not install while startupMode is loading", () => {
		const api = makeApi();
		renderHook(() =>
			useNoteBridgeReceiver({
				startupMode: "loading",
				workspaces: noopWorkspaces,
				dispatchTo: noopDispatch,
				api,
			}),
		);
		expect(api.onRequest).not.toHaveBeenCalled();
		expect(api.sendReady).not.toHaveBeenCalled();
	});

	it("installs and sends ready exactly once when startupMode is ready", () => {
		const api = makeApi();
		const { rerender } = renderHook(
			(props: { mode: "loading" | "prompt" | "ready" }) =>
				useNoteBridgeReceiver({
					startupMode: props.mode,
					workspaces: noopWorkspaces,
					dispatchTo: noopDispatch,
					api,
				}),
			{ initialProps: { mode: "loading" } },
		);
		expect(api.sendReady).not.toHaveBeenCalled();
		rerender({ mode: "ready" });
		expect(api.onRequest).toHaveBeenCalledTimes(1);
		expect(api.sendReady).toHaveBeenCalledTimes(1);
	});

	it("sends goodbye on cleanup when ready", () => {
		const api = makeApi();
		const { unmount, rerender } = renderHook(
			(props: { mode: "loading" | "prompt" | "ready" }) =>
				useNoteBridgeReceiver({
					startupMode: props.mode,
					workspaces: noopWorkspaces,
					dispatchTo: noopDispatch,
					api,
				}),
			{ initialProps: { mode: "loading" } },
		);
		rerender({ mode: "ready" });
		unmount();
		expect(api.sendGoodbye).toHaveBeenCalledTimes(1);
	});
});
