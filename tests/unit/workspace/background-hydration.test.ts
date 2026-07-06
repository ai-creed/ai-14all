import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { pickNextHydration } from "../../../src/features/workspace/logic/background-hydration";
import { useBackgroundHydration } from "../../../src/app/hooks/use-background-hydration";
import type { AppWorkspacesState } from "../../../src/features/workspace/logic/app-workspaces-state";

function ws(
	id: string,
	opts: { state?: boolean; loadError?: string | null } = {},
) {
	return {
		workspaceId: id,
		repository: { id, name: id, rootPath: `/repos/${id}`, repoId: id },
		worktrees: [],
		workspaceState: opts.state ? ({} as never) : null,
		persistedSnapshot: null,
		hydrationState: opts.state
			? ("inactiveLive" as const)
			: ("dormant" as const),
		loadError: opts.loadError ?? null,
	};
}

function make(
	order: string[],
	active: string,
	entries: ReturnType<typeof ws>[],
): AppWorkspacesState {
	return {
		activeWorkspaceId: active,
		workspaceOrder: order,
		workspacesById: Object.fromEntries(entries.map((e) => [e.workspaceId, e])),
	};
}

describe("pickNextHydration", () => {
	it("returns the first dormant non-active workspace in order", () => {
		const s = make(["a", "b", "c"], "a", [
			ws("a", { state: true }),
			ws("b"),
			ws("c"),
		]);
		expect(pickNextHydration(s)).toBe("b");
	});
	it("skips hydrated and errored workspaces", () => {
		const s = make(["a", "b", "c"], "a", [
			ws("a", { state: true }),
			ws("b", { state: true }),
			ws("c", { loadError: "ENOENT" }),
		]);
		expect(pickNextHydration(s)).toBe(null);
	});
	it("never returns the active workspace even if dormant-shaped", () => {
		const s = make(["a"], "a", [ws("a")]);
		expect(pickNextHydration(s)).toBe(null);
	});
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

describe("useBackgroundHydration (queue re-plan)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	// State where `a` is active+live and `b`, `c` are dormant → first pick is `b`.
	const initial = () =>
		make(["a", "b", "c"], "a", [ws("a", { state: true }), ws("b"), ws("c")]);

	it("re-plans and hydrates the next dormant workspace after a no-dispatch bail", async () => {
		const dB = deferred<boolean>();
		const dC = deferred<boolean>();
		const hydrateWorkspace = vi.fn((id: string) =>
			id === "b" ? dB.promise : dC.promise,
		);

		const { rerender } = renderHook(
			(props: { appWorkspaces: AppWorkspacesState }) =>
				useBackgroundHydration({
					enabled: true,
					startupMode: "ready",
					appWorkspaces: props.appWorkspaces,
					hydrateWorkspace,
				}),
			{ initialProps: { appWorkspaces: initial() } },
		);

		expect(hydrateWorkspace).toHaveBeenCalledTimes(1);
		expect(hydrateWorkspace).toHaveBeenLastCalledWith("b");

		// Mid-flight, a user click (activateWorkspace) makes `b` live+active. The
		// effect that observes this new state bails on the `running` guard, so it
		// does NOT start a new hydration itself — this is the exact window where a
		// later no-dispatch resolution would otherwise strand the queue.
		const bTakenOver = make(["a", "b", "c"], "b", [
			ws("a", { state: true }),
			ws("b", { state: true }),
			ws("c"),
		]);
		rerender({ appWorkspaces: bTakenOver });
		expect(hydrateWorkspace).toHaveBeenCalledTimes(1);

		// `b`'s hydration resolves true WITHOUT the hydration having dispatched any
		// state change of its own (the liveness bail). On the buggy code nothing
		// re-fires the effect and `c` is never hydrated; the re-plan tick fixes it.
		await act(async () => {
			dB.resolve(true);
		});
		await waitFor(() => expect(hydrateWorkspace).toHaveBeenCalledTimes(2));
		expect(hydrateWorkspace).toHaveBeenLastCalledWith("c");

		dC.resolve(true);
	});

	it("continues the queue to the next workspace after a hydration reports an error", async () => {
		const dB = deferred<boolean>();
		const dC = deferred<boolean>();
		const hydrateWorkspace = vi.fn((id: string) =>
			id === "b" ? dB.promise : dC.promise,
		);

		const { rerender } = renderHook(
			(props: { appWorkspaces: AppWorkspacesState }) =>
				useBackgroundHydration({
					enabled: true,
					startupMode: "ready",
					appWorkspaces: props.appWorkspaces,
					hydrateWorkspace,
				}),
			{ initialProps: { appWorkspaces: initial() } },
		);

		expect(hydrateWorkspace).toHaveBeenLastCalledWith("b");

		// `b`'s hydration fails; its failure is recorded as a loadError (state now
		// marks `b` errored, applied while the hydration is still in flight).
		const bErrored = make(["a", "b", "c"], "a", [
			ws("a", { state: true }),
			ws("b", { loadError: "ENOENT" }),
			ws("c"),
		]);
		rerender({ appWorkspaces: bErrored });

		await act(async () => {
			dB.resolve(false);
		});
		await waitFor(() => expect(hydrateWorkspace).toHaveBeenCalledTimes(2));
		expect(hydrateWorkspace).toHaveBeenLastCalledWith("c");

		dC.resolve(true);
	});

	it("aborts the queue on unmount without re-planning or warning", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const dB = deferred<boolean>();
		const hydrateWorkspace = vi.fn(() => dB.promise);

		const { unmount } = renderHook(() =>
			useBackgroundHydration({
				enabled: true,
				startupMode: "ready",
				appWorkspaces: initial(),
				hydrateWorkspace,
			}),
		);

		expect(hydrateWorkspace).toHaveBeenCalledTimes(1);
		expect(hydrateWorkspace).toHaveBeenLastCalledWith("b");

		// App teardown while `b`'s hydration is still in flight.
		unmount();

		// Resolving after unmount must not schedule a re-plan (no setState on an
		// unmounted hook) and must not attempt another hydration.
		await act(async () => {
			dB.resolve(true);
			await dB.promise;
		});

		expect(hydrateWorkspace).toHaveBeenCalledTimes(1);
		const warned = consoleError.mock.calls.some((args) =>
			args.some(
				(a) =>
					typeof a === "string" &&
					(a.includes("unmounted") || a.includes("act(")),
			),
		);
		expect(warned).toBe(false);
	});
});
