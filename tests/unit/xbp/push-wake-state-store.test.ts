import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PushWakeStateStore } from "../../../services/xbp/push-wake-state-store";
import type { PushWakeSeenState } from "../../../services/xbp/push-wake-detector";

const sample: PushWakeSeenState = {
	workflows: { "wf-1": "running" },
	pingedWorkflows: ["wf-0"],
	pingedChains: ["ch-1"],
};

describe("PushWakeStateStore", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pw-state-"));
	});

	it("returns null when nothing was persisted (fresh baseline)", () => {
		expect(new PushWakeStateStore({ dir }).load()).toBeNull();
	});

	it("round-trips across instances (restart persistence)", () => {
		new PushWakeStateStore({ dir }).save(sample);
		expect(new PushWakeStateStore({ dir }).load()).toEqual(sample);
	});

	it("corrupt file → null (baseline, never re-ping) instead of throwing", () => {
		writeFileSync(join(dir, "push-wake-state.json"), "{not json");
		expect(new PushWakeStateStore({ dir }).load()).toBeNull();
	});

	it("shape-invalid file → null", () => {
		writeFileSync(
			join(dir, "push-wake-state.json"),
			JSON.stringify({ workflows: "nope" }),
		);
		expect(new PushWakeStateStore({ dir }).load()).toBeNull();
	});

	it("save into a not-yet-existing dir creates it and never throws", () => {
		const store = new PushWakeStateStore({ dir: join(dir, "nested", "xbp") });
		expect(() => store.save(sample)).not.toThrow();
		expect(store.load()).toEqual(sample);
	});
});
