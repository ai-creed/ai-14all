import { useContext, useEffect, useMemo } from "react";
import type { Command } from "../logic/command";
import { CommandRegistryContext } from "../logic/command-registry-context";

function useRegistry() {
	const ctx = useContext(CommandRegistryContext);
	if (!ctx) {
		throw new Error(
			"command-palette hooks must be used inside <CommandRegistryProvider>",
		);
	}
	return ctx;
}

/**
 * Register `commands` for the lifetime of the calling component. Mirrors
 * useKeyboardShortcut's deps discipline: pass the same deps you would pass to the
 * matching shortcut so the captured run/isAvailable closures stay current. The
 * effect re-registers on deps change and unregisters on unmount.
 */
export function useRegisterCommands(
	commands: Command[],
	deps: ReadonlyArray<unknown>,
): void {
	const { register, unregister } = useRegistry();
	useEffect(() => {
		register(commands);
		const ids = commands.map((c) => c.id);
		return () => unregister(ids);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);
}

/** Aggregated, deduped, group→title-sorted snapshot of registered commands. */
export function useCommands(): Command[] {
	const { getCommands, version } = useRegistry();
	// eslint-disable-next-line react-hooks/exhaustive-deps
	return useMemo(() => getCommands(), [getCommands, version]);
}
