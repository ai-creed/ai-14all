import { useEffect } from "react";
import {
	installNoteBridgeReceiver,
	type InstallReceiverDeps,
} from "../logic/note-bridge-receiver";

export type StartupMode = "loading" | "prompt" | "ready";

export type UseNoteBridgeReceiverArgs = InstallReceiverDeps & {
	startupMode: StartupMode;
};

export function useNoteBridgeReceiver(args: UseNoteBridgeReceiverArgs): void {
	const { startupMode, workspaces, dispatchTo, api, now } = args;
	useEffect(() => {
		if (startupMode !== "ready") return;
		const rawOff = installNoteBridgeReceiver({
			workspaces,
			dispatchTo,
			api,
			now,
		});
		let called = false;
		const off = () => {
			if (called) return;
			called = true;
			rawOff();
		};
		const handleBeforeUnload = () => off();
		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => {
			window.removeEventListener("beforeunload", handleBeforeUnload);
			off();
		};
		// `workspaces`, `dispatchTo`, `api`, `now` are stable refs from App.tsx;
		// only `startupMode` should re-run this effect.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [startupMode]);
}
