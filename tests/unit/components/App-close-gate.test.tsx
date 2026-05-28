import { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/lib/desktop-client", () => {
	const onRequestClose = vi.fn();
	const confirmClose = vi.fn();
	const setEditorDirty = vi.fn();
	return {
		app: { onRequestClose, confirmClose, setEditorDirty },
	};
});

import { app } from "../../../src/lib/desktop-client";
import {
	__resetInlineEditorRegistry,
	listInlineEditors,
	registerInlineEditor,
} from "../../../src/features/viewer/inline-editor-registry";

const onRequestCloseMock = app.onRequestClose as unknown as ReturnType<
	typeof vi.fn
>;
const confirmCloseMock = app.confirmClose as unknown as ReturnType<
	typeof vi.fn
>;

let registeredHandler: (() => void) | null = null;

function CloseGateOnly() {
	useEffect(() => {
		return app.onRequestClose(() => {
			void (async () => {
				const editors = listInlineEditors();
				for (const e of editors) {
					const r = await e.requestSwitch();
					if (r === "cancel") {
						app.confirmClose({ proceed: false });
						return;
					}
				}
				app.confirmClose({ proceed: true });
			})();
		});
	}, []);
	return null;
}

beforeEach(() => {
	vi.clearAllMocks();
	__resetInlineEditorRegistry();
	registeredHandler = null;
	onRequestCloseMock.mockImplementation((h: () => void) => {
		registeredHandler = h;
		return () => {
			registeredHandler = null;
		};
	});
});

afterEach(() => {
	__resetInlineEditorRegistry();
});

describe("App close-gate listener", () => {
	it("subscribes to app:requestClose on mount", () => {
		render(<CloseGateOnly />);
		expect(onRequestCloseMock).toHaveBeenCalledTimes(1);
		expect(registeredHandler).toBeTypeOf("function");
	});

	it("when no editor is dirty: proceeds with proceed=true", async () => {
		render(<CloseGateOnly />);
		registeredHandler!();
		await waitFor(() => {
			expect(confirmCloseMock).toHaveBeenCalledWith({ proceed: true });
		});
	});

	it("when an editor returns proceed: confirmClose({ proceed: true })", async () => {
		render(<CloseGateOnly />);
		registerInlineEditor(
			{ workspaceId: "ws", worktreeId: "wt", relativePath: "a.md" },
			{ requestSwitch: async () => "proceed" },
		);
		registeredHandler!();
		await waitFor(() => {
			expect(confirmCloseMock).toHaveBeenCalledWith({ proceed: true });
		});
	});

	it("when any editor returns cancel: confirmClose({ proceed: false })", async () => {
		render(<CloseGateOnly />);
		registerInlineEditor(
			{ workspaceId: "ws", worktreeId: "wt", relativePath: "a.md" },
			{ requestSwitch: async () => "cancel" },
		);
		registeredHandler!();
		await waitFor(() => {
			expect(confirmCloseMock).toHaveBeenCalledWith({ proceed: false });
		});
	});
});
