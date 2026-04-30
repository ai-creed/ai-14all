import {
	appendFileSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ShellEventRecord } from "../../shared/models/shell-event-record.js";

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_TEXT_CHARS = 4096;
const TERMINAL_OUTPUT_SAMPLE_EVERY = 50;

export type ShellEventLogMode = "off" | "sampled" | "full";

export type ShellEventLogInput = Omit<
	ShellEventRecord,
	"at" | "runId" | "seq" | "eventId"
> & {
	eventId?: string;
};

export type ShellEventLogService = ReturnType<
	typeof createShellEventLogService
>;

export function createShellEventLogService(input: {
	userDataPath: string;
	isPackaged: boolean;
	appVersion: string;
	mode?: ShellEventLogMode;
	now?: () => Date;
	randomId?: () => string;
}) {
	const now = input.now ?? (() => new Date());
	const enabled = !input.isPackaged || input.appVersion.includes("-beta.");
	// Default mode: off when packaged release; sampled for dev / beta builds.
	// Override via constructor input or AI14ALL_DEBUG=full for verbose diagnostics.
	const mode: ShellEventLogMode = input.mode ?? (enabled ? "sampled" : "off");
	const runId = (input.randomId ?? randomUUID)();
	const dirPath = join(input.userDataPath, "diagnostics", "shell-events");
	const logPath = enabled
		? join(
				dirPath,
				`${now().toISOString().replaceAll(":", "-")}-run_${runId}.jsonl`,
			)
		: null;
	let seq = 0;
	let disabled = !enabled;
	let prunedFileCount = 0;
	let outputCounter = 0;

	if (enabled) {
		mkdirSync(dirPath, { recursive: true });
		for (const entry of readdirSync(dirPath)) {
			const path = join(dirPath, entry);
			try {
				if (now().getTime() - statSync(path).mtimeMs > THREE_DAYS_MS) {
					rmSync(path, { force: true });
					prunedFileCount += 1;
				}
			} catch {
				// Best-effort: skip entries we cannot stat
			}
		}
	}

	function truncateData(data: Record<string, unknown>) {
		const text = typeof data.text === "string" ? data.text : null;
		const hex = typeof data.hex === "string" ? data.hex : null;
		if (!text || text.length <= MAX_TEXT_CHARS) return data;
		return {
			...data,
			text: text.slice(0, MAX_TEXT_CHARS),
			hex: hex ? hex.slice(0, MAX_TEXT_CHARS * 2) : hex,
			truncated: true,
			byteLength: data.byteLength ?? Buffer.byteLength(text, "utf8"),
		};
	}

	const service = {
		isEnabled: () => enabled && !disabled,
		getLogPath: () => logPath,
		log(event: ShellEventLogInput) {
			if (!logPath || disabled || mode === "off") return;

			// Sample high-volume terminal-output events when in sampled mode.
			// Always log the first event in a burst, then 1 of every N.
			if (event.event === "terminal-output" && mode === "sampled") {
				outputCounter += 1;
				if (
					outputCounter !== 1 &&
					outputCounter % TERMINAL_OUTPUT_SAMPLE_EVERY !== 0
				) {
					return;
				}
			}

			const currentSeq = ++seq;
			const record: ShellEventRecord = {
				at: now().toISOString(),
				runId,
				seq: currentSeq,
				eventId: event.eventId ?? `${runId}_${currentSeq}`,
				...event,
				data: truncateData(event.data),
			};
			try {
				appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf8");
			} catch {
				disabled = true;
			}
		},
	};

	// Auto-emit app-log-pruned as the first record
	if (enabled) {
		service.log({
			source: "main",
			event: "app-log-pruned",
			windowId: null,
			data: { prunedFileCount },
		});
	}

	return service;
}
