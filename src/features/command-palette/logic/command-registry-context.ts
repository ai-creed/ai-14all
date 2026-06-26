import { createContext } from "react";
import type { Command } from "./command";

export interface CommandRegistryValue {
	/** Add or replace commands, keyed by id (last registration wins). */
	register: (commands: Command[]) => void;
	/** Remove commands by id. */
	unregister: (ids: string[]) => void;
	/** Snapshot of all registered commands, deduped and sorted by group→title. */
	getCommands: () => Command[];
	/** Bumps on every register/unregister so consumers re-render. */
	version: number;
}

export const CommandRegistryContext = createContext<CommandRegistryValue | null>(
	null,
);
