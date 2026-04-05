import type { Ai14AllDesktopApi } from "../../shared/contracts/commands";

declare global {
	interface Window {
		ai14all: Ai14AllDesktopApi;
	}
}

export {};
