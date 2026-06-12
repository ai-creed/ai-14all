import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	makeWhisperFixtureDb,
	type WhisperFixture,
} from "../../unit/plugins/helpers/make-whisper-fixture-db";

export type WhisperStubEnv = {
	userDataDir: string;
	stateRoot: string;
	stubLogPath: string;
	env: Record<string, string>;
	writeFixture: (fx: WhisperFixture) => void;
};

export function setUpWhisperStub(options: {
	enabled: boolean;
}): WhisperStubEnv {
	const userDataDir = realpathSync(mkdtempSync(join(tmpdir(), "ofa-plug-ud-")));
	const stateRoot = realpathSync(
		mkdtempSync(join(tmpdir(), "ofa-plug-state-")),
	);
	mkdirSync(join(stateRoot, "sockets"), { recursive: true });
	const stubBinary = resolve("tests/stubs/whisper-stub/whisper");
	const stubLogPath = join(stateRoot, "stub-invocations.jsonl");
	writeFileSync(
		join(userDataDir, "config.toml"),
		`[plugins.whisper]\nenabled = ${options.enabled}\ninstall_path = "${stubBinary}"\n`,
		"utf8",
	);
	return {
		userDataDir,
		stateRoot,
		stubLogPath,
		env: {
			AI14ALL_E2E: "1",
			AI14ALL_USER_DATA_PATH: userDataDir,
			AI14ALL_WHISPER_STATE_ROOT: stateRoot,
			WHISPER_STUB_LOG: stubLogPath,
			WHISPER_STUB_STATE_ROOT: stateRoot,
		},
		writeFixture: (fx) => makeWhisperFixtureDb(join(stateRoot, "state.db"), fx),
	};
}

export type StubEventSocket = {
	/** Resolves once the app's driver has connected and received the hello. */
	waitForClient: () => Promise<void>;
	emit: (name: string, payload: unknown) => void;
	close: () => Promise<void>;
};

/** Plays the daemon end of the provisional event-socket protocol. */
export function startStubEventSocket(
	stateRoot: string,
	collabId: string,
): Promise<StubEventSocket> {
	const clients = new Set<Socket>();
	let resolveClient: (() => void) | undefined;
	const firstClient = new Promise<void>((r) => {
		resolveClient = r;
	});
	const server = createServer((socket) => {
		clients.add(socket);
		socket.on("close", () => clients.delete(socket));
		socket.write(
			`${JSON.stringify({ type: "hello", engineVersion: "0.6.0-stub", protocolVersion: "1" })}\n`,
		);
		resolveClient?.();
	});
	const socketPath = join(stateRoot, "sockets", `events-${collabId}.sock`);
	return new Promise((resolve) =>
		server.listen(socketPath, () =>
			resolve({
				waitForClient: () => firstClient,
				emit(name, payload) {
					const frame = `${JSON.stringify({ type: "event", name, payload, ts: new Date().toISOString() })}\n`;
					for (const client of clients) client.write(frame);
				},
				close: () =>
					new Promise((r) => {
						for (const client of clients) client.destroy();
						server.close(() => r());
					}),
			}),
		),
	);
}
