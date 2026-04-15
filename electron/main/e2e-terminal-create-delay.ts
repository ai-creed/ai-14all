import { existsSync, readFileSync, writeFileSync } from "node:fs";

type TerminalCreateDelayState = {
	nextCreateDelayMs?: number;
};

export async function consumeE2eTerminalCreateDelay(): Promise<void> {
	if (!process.env.AI14ALL_E2E || !process.env.AI14ALL_E2E_TERMINAL_DELAY_PATH) return;
	const controlPath = process.env.AI14ALL_E2E_TERMINAL_DELAY_PATH;
	if (!existsSync(controlPath)) return;

	const state = JSON.parse(readFileSync(controlPath, "utf8")) as TerminalCreateDelayState;
	const delayMs = Math.max(0, state.nextCreateDelayMs ?? 0);
	if (delayMs <= 0) return;

	state.nextCreateDelayMs = 0;
	writeFileSync(controlPath, JSON.stringify(state));
	await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
