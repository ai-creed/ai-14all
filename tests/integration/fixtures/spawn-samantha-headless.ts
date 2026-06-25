import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { dirname } from "node:path";

export type HarnessEvent = { peerId: string; signal: string; summary: string };
export type SamanthaChild = {
	port: number;
	tokenPath: string;
	// Drive a tool through the child's REAL merged tool-bridge (auto-approve confirm).
	callTool: (
		name: string,
		args?: Record<string, unknown>,
	) => Promise<{
		isError: boolean;
		content: Array<{ type: string; text: string }>;
	}>;
	events: HarnessEvent[]; // observe events the child forwarded
	stop: () => Promise<void>;
};

// The ai-samantha headless entry is committed as a TypeScript module
// (electron/main/connector-headless-entry.mts). Its connector stack imports only
// node built-ins + `ws` (every src/core import is type-only and erased), so it
// runs under plain node WITH the tsx loader — no electron-vite build step, no
// Electron. We therefore spawn `node --import tsx <entry>` for a .ts/.mts entry,
// or plain `node <entry>` for an already-built .js. `cwd` is the entry's repo so
// the tsx loader and `ws` resolve from ai-samantha's node_modules.
function spawnArgs(entry: string): { args: string[]; cwd: string } {
	const cwd = dirname(entry);
	if (
		entry.endsWith(".ts") ||
		entry.endsWith(".mts") ||
		entry.endsWith(".cts")
	) {
		return { args: ["--import", "tsx", entry], cwd };
	}
	return { args: [entry], cwd };
}

// Spawns the ai-samantha headless test host and speaks its line-based
// stdin/stdout RPC. SAMANTHA_HEADLESS_ENTRY is the absolute path to the entry
// (resolved in Task 14 Step 1). The child prints `READY <port>`, forwards
// `EVENT <json>`, and answers `{"id",...}` lines with `RESULT <json>`.
export async function spawnSamanthaHeadless(opts: {
	tokenPath: string;
}): Promise<SamanthaChild> {
	const entry = process.env.SAMANTHA_HEADLESS_ENTRY;
	if (!entry)
		throw new Error(
			"SAMANTHA_HEADLESS_ENTRY must point at the ai-samantha headless entry (electron/main/connector-headless-entry.mts)",
		);
	const { args, cwd } = spawnArgs(entry);
	const child: ChildProcess = spawn(process.execPath, args, {
		cwd,
		env: {
			...process.env,
			AI_SAMANTHA_CONNECTOR_PORT: "0", // ephemeral loopback port
			SAMANTHA_CONNECTOR_TOKEN_PATH: opts.tokenPath,
		},
		stdio: ["pipe", "pipe", "inherit"], // stdin pipe for the RPC; stderr inherited for diagnostics
	});

	const events: HarnessEvent[] = [];
	const pending = new Map<number, (result: unknown) => void>();
	let nextId = 1;
	let buf = "";
	let onReady: ((port: number) => void) | null = null;
	let protocolFault: ((err: Error) => void) | null = null;

	child.stdout?.on("data", (d: Buffer) => {
		buf += d.toString();
		let nl: number;
		while ((nl = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			if (!line) continue;
			if (line.startsWith("READY ")) onReady?.(Number(line.slice(6)));
			else if (line.startsWith("EVENT "))
				events.push(JSON.parse(line.slice(6)));
			else if (line.startsWith("RESULT ")) {
				const parsed = JSON.parse(line.slice(7)) as {
					id: number;
					result?: unknown;
					error?: unknown;
				};
				// A malformed stdin line makes the host emit id:-1 / an error field —
				// a protocol fault, not a normal correlated response. Surface it on the
				// in-flight calls so a test fails loudly rather than hanging.
				if (parsed.id === -1 || parsed.error !== undefined) {
					const err = new Error(
						`samantha headless RPC fault: ${String(parsed.error ?? "unknown")}`,
					);
					protocolFault?.(err);
					continue;
				}
				pending.get(parsed.id)?.(parsed.result);
				pending.delete(parsed.id);
			}
		}
	});

	const port = await new Promise<number>((resolve, reject) => {
		onReady = resolve;
		child.on("exit", (code) =>
			reject(new Error(`samantha headless exited early (${code})`)),
		);
		setTimeout(
			() => reject(new Error("samantha headless did not become READY in 10s")),
			10000,
		);
	});

	return {
		port,
		tokenPath: opts.tokenPath,
		events,
		callTool: (name, args) =>
			new Promise((resolve, reject) => {
				const id = nextId++;
				pending.set(id, resolve as (r: unknown) => void);
				const failAll = (err: Error) => {
					if (pending.delete(id)) reject(err);
				};
				protocolFault = failAll;
				child.stdin?.write(
					`${JSON.stringify({ id, name, args: args ?? {} })}\n`,
				);
				setTimeout(
					() => failAll(new Error(`callTool(${name}) timed out`)),
					10000,
				);
			}) as Promise<{
				isError: boolean;
				content: Array<{ type: string; text: string }>;
			}>,
		stop: async () => {
			if (child.exitCode === null) {
				child.kill("SIGTERM");
				await once(child, "exit");
			}
		},
	};
}
