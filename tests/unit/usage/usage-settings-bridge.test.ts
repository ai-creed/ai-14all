import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspacePersistenceService } from "../../../services/workspace/workspace-persistence-service.js";
import { createUsageSettingsBridge } from "../../../electron/main/services/usage-settings-bridge.js";

const statePath = (): string =>
	join(mkdtempSync(join(tmpdir(), "ws-state-")), "workspace-state.json");

describe("usage settings bridge (real async persistence)", () => {
	it("persists chipRange to disk so the next run seeds Month", async () => {
		const path = statePath();
		const run1 = await createUsageSettingsBridge(new WorkspacePersistenceService(path));
		expect(run1.settings.chipRange).toBe("week"); // default on first run (missing file)
		await run1.persist({ chipRange: "month" }); // awaitable async write
		// next run: a fresh service + bridge over the same file
		const run2 = await createUsageSettingsBridge(new WorkspacePersistenceService(path));
		expect(run2.settings.chipRange).toBe("month");
	});

	it("a chipRange write preserves other workspace-state fields", async () => {
		const path = statePath();
		const svc = new WorkspacePersistenceService(path);
		const seeded = await svc.readState();
		await svc.writeState({ ...seeded, activeWorkspaceId: "workspace:abc" });
		const bridge = await createUsageSettingsBridge(svc);
		await bridge.persist({ chipRange: "month" });
		const after = await svc.readState();
		expect(after.usageTelemetry?.chipRange).toBe("month");
		expect(after.activeWorkspaceId).toBe("workspace:abc"); // read-modify-write didn't clobber it
	});
});
