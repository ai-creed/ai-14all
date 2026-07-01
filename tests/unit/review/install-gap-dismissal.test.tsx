import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Provider } from "../../../src/features/review/hooks/use-agent-install-status";
import {
	bannerVisible,
	hasInstallGap,
	installGapSignature,
	reconcileDismissed,
	useInstallGapDismissal,
} from "../../../src/features/review/logic/use-install-gap-dismissal";

function provider(overrides: Partial<Provider>): Provider {
	return {
		id: "codex",
		displayName: "Codex",
		cliAvailable: true,
		configRootDetected: true,
		installed: false,
		cliPath: null,
		cliSource: "path",
		...overrides,
	};
}

const none: Provider[] = [
	provider({ id: "claude-code", displayName: "Claude Code", cliAvailable: false }),
];
const allInstalled: Provider[] = [
	provider({ id: "codex", installed: true }),
	provider({ id: "claude-code", displayName: "Claude Code", installed: true }),
];
const oneGap: Provider[] = [
	provider({ id: "codex", cliAvailable: true, installed: false }),
	provider({ id: "claude-code", displayName: "Claude Code", cliAvailable: false }),
];
const twoGaps: Provider[] = [
	provider({ id: "codex", cliAvailable: true, installed: false }),
	provider({ id: "claude-code", displayName: "Claude Code", cliAvailable: true, installed: false }),
];

describe("install-gap pure helpers", () => {
	it("hasInstallGap: only cliAvailable && !installed counts", () => {
		expect(hasInstallGap(none)).toBe(false);
		expect(hasInstallGap(allInstalled)).toBe(false);
		expect(hasInstallGap(oneGap)).toBe(true);
		expect(hasInstallGap(twoGaps)).toBe(true);
	});

	it("installGapSignature: sorted comma-join; empty when complete", () => {
		expect(installGapSignature(none)).toBe("");
		expect(installGapSignature(allInstalled)).toBe("");
		expect(installGapSignature(oneGap)).toBe("codex");
		expect(installGapSignature(twoGaps)).toBe("claude-code,codex");
	});

	it("bannerVisible: non-empty and differs from dismissed", () => {
		expect(bannerVisible("", "")).toBe(false);
		expect(bannerVisible("codex", "codex")).toBe(false);
		expect(bannerVisible("codex", "")).toBe(true);
		expect(bannerVisible("claude-code,codex", "codex")).toBe(true);
	});

	it("reconcileDismissed: clears the stored dismissal only when complete", () => {
		expect(reconcileDismissed("", "codex")).toBe("");
		expect(reconcileDismissed("codex", "codex")).toBe("codex");
		expect(reconcileDismissed("claude-code,codex", "codex")).toBe("codex");
	});
});

describe("useInstallGapDismissal", () => {
	beforeEach(() => localStorage.clear());

	it("hides after dismiss, and stores the signature", () => {
		const { result, rerender } = renderHook(
			({ sig }) => useInstallGapDismissal(sig),
			{ initialProps: { sig: "codex" } },
		);
		expect(result.current.visible).toBe(true);
		act(() => result.current.dismiss());
		rerender({ sig: "codex" });
		expect(result.current.visible).toBe(false);
		expect(localStorage.getItem("ai14all.dismissedInstallGap")).toBe("codex");
	});

	it("re-shows when the gap changes to a new signature", () => {
		const { result, rerender } = renderHook(
			({ sig }) => useInstallGapDismissal(sig),
			{ initialProps: { sig: "codex" } },
		);
		act(() => result.current.dismiss());
		rerender({ sig: "codex" });
		expect(result.current.visible).toBe(false);
		rerender({ sig: "claude-code,codex" });
		expect(result.current.visible).toBe(true);
	});

	it("clear-on-complete: dismiss → complete → same gap reopens → visible again", () => {
		const { result, rerender } = renderHook(
			({ sig }) => useInstallGapDismissal(sig),
			{ initialProps: { sig: "codex" } },
		);
		act(() => result.current.dismiss());
		rerender({ sig: "codex" });
		expect(result.current.visible).toBe(false);
		// Install completes → signature empties → stored dismissal is cleared.
		rerender({ sig: "" });
		expect(localStorage.getItem("ai14all.dismissedInstallGap")).toBe("");
		// The same gap returns; it is no longer equal to the (cleared) dismissal.
		rerender({ sig: "codex" });
		expect(result.current.visible).toBe(true);
	});

	it("degrades to in-memory state when localStorage.setItem throws", () => {
		const spy = vi
			.spyOn(Storage.prototype, "setItem")
			.mockImplementation(() => {
				throw new Error("private mode");
			});
		const { result, rerender } = renderHook(
			({ sig }) => useInstallGapDismissal(sig),
			{ initialProps: { sig: "codex" } },
		);
		act(() => result.current.dismiss());
		rerender({ sig: "codex" });
		expect(result.current.visible).toBe(false); // in-memory dismissal held
		spy.mockRestore();
	});
});
