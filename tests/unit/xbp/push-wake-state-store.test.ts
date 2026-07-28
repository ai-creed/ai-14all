import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, renameSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	PushWakeStateStore,
	type PushWakeWatcherStateV2,
} from "../../../services/xbp/push-wake-state-store";
import type { PushWakeSeenState } from "../../../services/xbp/push-wake-detector";

const legacy: PushWakeSeenState = {
	workflows: { "wf-1": "running" },
	pingedWorkflows: ["wf-0"],
	pingedChains: ["ch-1"],
};
const v2: PushWakeWatcherStateV2 = {
	version: 2,
	whisper: legacy,
	attention: { sessions: { "wt-1": "waiting" } },
	lastPingAt: 1234,
};

describe("PushWakeStateStore v2", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pw-state-"));
	});

	it("returns null when nothing was persisted", () => {
		expect(new PushWakeStateStore({ dir }).load()).toBeNull();
	});

	it("round-trips v2 across instances, including null namespaces", () => {
		const withNulls: PushWakeWatcherStateV2 = {
			version: 2,
			whisper: null,
			attention: null,
			lastPingAt: null,
		};
		expect(new PushWakeStateStore({ dir }).save(v2)).toBe(true);
		expect(new PushWakeStateStore({ dir }).load()).toEqual(v2);
		expect(new PushWakeStateStore({ dir }).save(withNulls)).toBe(true);
		expect(new PushWakeStateStore({ dir }).load()).toEqual(withNulls);
	});

	it("null attention namespace is durably distinct from established-empty", () => {
		new PushWakeStateStore({ dir }).save({ ...v2, attention: null });
		expect(new PushWakeStateStore({ dir }).load()?.attention).toBeNull();
		new PushWakeStateStore({ dir }).save({ ...v2, attention: { sessions: {} } });
		expect(new PushWakeStateStore({ dir }).load()?.attention).toEqual({
			sessions: {},
		});
	});

	it("migrates a legacy v1 file to established-empty attention", () => {
		writeFileSync(join(dir, "push-wake-state.json"), JSON.stringify(legacy));
		expect(new PushWakeStateStore({ dir }).load()).toEqual({
			version: 2,
			whisper: legacy,
			attention: { sessions: {} },
			lastPingAt: null,
		});
	});

	it("corrupt or shape-invalid file loads as null", () => {
		writeFileSync(join(dir, "push-wake-state.json"), "{not json");
		expect(new PushWakeStateStore({ dir }).load()).toBeNull();
		writeFileSync(
			join(dir, "push-wake-state.json"),
			JSON.stringify({ version: 2, whisper: "nope", attention: null, lastPingAt: null }),
		);
		expect(new PushWakeStateStore({ dir }).load()).toBeNull();
	});

	it("save writes tmp then renames (atomic order) and returns true", () => {
		const calls: string[] = [];
		const store = new PushWakeStateStore({
			dir,
			fsImpl: {
				mkdirSync,
				readFileSync,
				writeFileSync: (p, d) => {
					calls.push(`write:${String(p)}`);
					writeFileSync(p as string, d as string);
				},
				renameSync: (a, b) => {
					calls.push(`rename:${String(a)}`);
					renameSync(a as string, b as string);
				},
			},
		});
		expect(store.save(v2)).toBe(true);
		expect(calls[0]).toBe(`write:${join(dir, "push-wake-state.json.tmp")}`);
		expect(calls[1]).toBe(`rename:${join(dir, "push-wake-state.json.tmp")}`);
	});

	it("failure before rename preserves the prior valid state (not truncated, not null)", () => {
		const good = new PushWakeStateStore({ dir });
		good.save(v2);
		const failingWrite = new PushWakeStateStore({
			dir,
			fsImpl: {
				mkdirSync,
				readFileSync,
				writeFileSync: () => {
					throw new Error("disk full");
				},
				renameSync,
			},
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(failingWrite.save({ ...v2, lastPingAt: 9999 })).toBe(false);
		const failingRename = new PushWakeStateStore({
			dir,
			fsImpl: {
				mkdirSync,
				readFileSync,
				writeFileSync,
				renameSync: () => {
					throw new Error("rename failed");
				},
			},
		});
		expect(failingRename.save({ ...v2, lastPingAt: 9999 })).toBe(false);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
		expect(new PushWakeStateStore({ dir }).load()).toEqual(v2);
	});

	it("save into a not-yet-existing dir creates it", () => {
		const store = new PushWakeStateStore({ dir: join(dir, "nested", "xbp") });
		expect(store.save(v2)).toBe(true);
		expect(store.load()).toEqual(v2);
	});
});
