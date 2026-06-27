import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { CommandRegistryProvider } from "../../../../src/features/command-palette/components/CommandRegistryProvider";
import {
	useRegisterCommands,
	useCommands,
} from "../../../../src/features/command-palette/hooks/use-command-registry";
import type { Command } from "../../../../src/features/command-palette/logic/command";

const cmd = (
	over: Partial<Command> & { id: string; title: string },
): Command => ({
	group: "Test",
	run: () => {},
	...over,
});

/** Records the latest command snapshot the reader sees. */
function Reader({ sink }: { sink: (c: Command[]) => void }) {
	sink(useCommands());
	return null;
}
function Registrar({ commands }: { commands: Command[] }) {
	useRegisterCommands(commands, []);
	return null;
}

describe("command registry", () => {
	it("aggregates registered commands sorted by group then title", () => {
		let latest: Command[] = [];
		render(
			<CommandRegistryProvider>
				<Registrar
					commands={[
						cmd({ id: "b", title: "Beta", group: "Z" }),
						cmd({ id: "a", title: "Alpha", group: "A" }),
						cmd({ id: "c", title: "Gamma", group: "A" }),
					]}
				/>
				<Reader sink={(c) => (latest = c)} />
			</CommandRegistryProvider>,
		);
		expect(latest.map((c) => c.id)).toEqual(["a", "c", "b"]);
	});

	it("dedupes by id with last registration winning", () => {
		let latest: Command[] = [];
		render(
			<CommandRegistryProvider>
				<Registrar commands={[cmd({ id: "x", title: "First" })]} />
				<Registrar commands={[cmd({ id: "x", title: "Second" })]} />
				<Reader sink={(c) => (latest = c)} />
			</CommandRegistryProvider>,
		);
		expect(latest).toHaveLength(1);
		expect(latest[0].title).toBe("Second");
	});

	it("removes commands when their registrar unmounts", () => {
		let latest: Command[] = [];
		const { rerender } = render(
			<CommandRegistryProvider>
				<Registrar commands={[cmd({ id: "keep", title: "Keep" })]} />
				<Registrar commands={[cmd({ id: "drop", title: "Drop" })]} />
				<Reader sink={(c) => (latest = c)} />
			</CommandRegistryProvider>,
		);
		expect(latest.map((c) => c.id).sort()).toEqual(["drop", "keep"]);

		rerender(
			<CommandRegistryProvider>
				<Registrar commands={[cmd({ id: "keep", title: "Keep" })]} />
				<Reader sink={(c) => (latest = c)} />
			</CommandRegistryProvider>,
		);
		expect(latest.map((c) => c.id)).toEqual(["keep"]);
	});

	it("warns on a duplicate id in dev", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		render(
			<CommandRegistryProvider>
				<Registrar
					commands={[
						cmd({ id: "dup", title: "One" }),
						cmd({ id: "dup", title: "Two" }),
					]}
				/>
				<Reader sink={() => {}} />
			</CommandRegistryProvider>,
		);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('duplicate command id "dup"'),
		);
		warn.mockRestore();
	});

	it("re-registers with fresh closures when deps change", () => {
		// Guards against a stale-closure regression in useRegisterCommands: when
		// the caller's deps change, the captured run/isAvailable must refresh.
		let latest: Command[] = [];
		function VarRegistrar({ flag }: { flag: boolean }) {
			useRegisterCommands(
				[
					{
						id: "x",
						title: "X",
						group: "G",
						run: () => {},
						isAvailable: () => flag,
					},
				],
				[flag],
			);
			return null;
		}
		const { rerender } = render(
			<CommandRegistryProvider>
				<VarRegistrar flag={false} />
				<Reader sink={(c) => (latest = c)} />
			</CommandRegistryProvider>,
		);
		expect(latest[0]?.isAvailable?.()).toBe(false);

		rerender(
			<CommandRegistryProvider>
				<VarRegistrar flag={true} />
				<Reader sink={(c) => (latest = c)} />
			</CommandRegistryProvider>,
		);
		expect(latest[0]?.isAvailable?.()).toBe(true);
	});
});
