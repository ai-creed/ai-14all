import { useCallback, useEffect, useState } from "react";
import type { Provider } from "../hooks/use-agent-install-status";

const STORAGE_KEY = "ai14all.dismissedInstallGap";

/** A provider is a gap when its CLI is present but the integration isn't wired. */
export function hasInstallGap(providers: Provider[]): boolean {
	return providers.some((p) => p.cliAvailable && !p.installed);
}

/**
 * Reduce the current gap to a stable string: the sorted list of gap-provider
 * ids joined with ",". The empty string means "complete".
 */
export function installGapSignature(providers: Provider[]): string {
	return providers
		.filter((p) => p.cliAvailable && !p.installed)
		.map((p) => p.id)
		.sort()
		.join(",");
}

/** The banner shows when there is a gap that differs from the dismissed one. */
export function bannerVisible(
	currentSignature: string,
	dismissedSignature: string,
): boolean {
	return currentSignature !== "" && currentSignature !== dismissedSignature;
}

/**
 * Clear-on-complete: once the install is complete (empty signature) the stored
 * dismissal is reset, so a gap that returns after being resolved re-nudges.
 * Otherwise the stored dismissal is left untouched.
 */
export function reconcileDismissed(
	currentSignature: string,
	dismissedSignature: string,
): string {
	return currentSignature === "" ? "" : dismissedSignature;
}

function read(): string {
	try {
		return localStorage.getItem(STORAGE_KEY) ?? "";
	} catch {
		return "";
	}
}

function write(signature: string): void {
	try {
		localStorage.setItem(STORAGE_KEY, signature);
	} catch {
		/* storage unavailable (e.g. private mode) — keep in-memory state */
	}
}

/**
 * Tracks the dismissed install-gap signature and derives banner visibility for
 * the current signature. Mirrors the localStorage degrade pattern of
 * use-collapsed-workspaces.
 */
export function useInstallGapDismissal(currentSignature: string): {
	visible: boolean;
	dismiss: () => void;
} {
	const [dismissedSignature, setDismissedSignature] = useState<string>(read);

	// Clear-on-complete: when the gap empties, drop the stored dismissal so a
	// later re-occurrence of the same gap surfaces the banner again.
	useEffect(() => {
		const next = reconcileDismissed(currentSignature, dismissedSignature);
		if (next !== dismissedSignature) {
			setDismissedSignature(next);
			write(next);
		}
	}, [currentSignature, dismissedSignature]);

	const dismiss = useCallback(() => {
		setDismissedSignature(currentSignature);
		write(currentSignature);
	}, [currentSignature]);

	return {
		visible: bannerVisible(currentSignature, dismissedSignature),
		dismiss,
	};
}
