import { useCallback, useMemo, useRef, useState } from "react";
import type { Command } from "../logic/command";
import {
	CommandRegistryContext,
	type CommandRegistryValue,
} from "../logic/command-registry-context";

/**
 * Holds the live command map. Mount ABOVE <App/> (see src/main.tsx) so App-body
 * hooks can register into it. Registration is idempotent, so React StrictMode's
 * double-invoked effects are safe.
 */
export function CommandRegistryProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const mapRef = useRef<Map<string, Command>>(new Map());
	const [version, setVersion] = useState(0);

	const register = useCallback((commands: Command[]) => {
		for (const c of commands) {
			if (import.meta.env.DEV && mapRef.current.has(c.id)) {
				console.warn(
					`[command-palette] duplicate command id "${c.id}" — last registration wins`,
				);
			}
			mapRef.current.set(c.id, c);
		}
		setVersion((v) => v + 1);
	}, []);

	const unregister = useCallback((ids: string[]) => {
		for (const id of ids) mapRef.current.delete(id);
		setVersion((v) => v + 1);
	}, []);

	const getCommands = useCallback(
		() =>
			[...mapRef.current.values()].sort(
				(a, b) =>
					a.group.localeCompare(b.group) || a.title.localeCompare(b.title),
			),
		[],
	);

	const value = useMemo<CommandRegistryValue>(
		() => ({ register, unregister, getCommands, version }),
		[register, unregister, getCommands, version],
	);

	return (
		<CommandRegistryContext.Provider value={value}>
			{children}
		</CommandRegistryContext.Provider>
	);
}
