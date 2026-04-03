import { describe, expect, it, vi } from "vitest";
import {
	ensureNodePtySpawnHelperExecutable,
	getNodePtySpawnHelperPath,
} from "../../../scripts/ensure-node-pty-spawn-helper.mjs";

describe("ensure-node-pty-spawn-helper", () => {
	it("returns null for non-macOS platforms", () => {
		expect(
			getNodePtySpawnHelperPath({
				platform: "linux",
				arch: "arm64",
				resolvePackageJson: () => "/tmp/node-pty/package.json",
			}),
		).toBeNull();
	});

	it("builds the darwin helper path from node-pty package.json", () => {
		expect(
			getNodePtySpawnHelperPath({
				platform: "darwin",
				arch: "arm64",
				resolvePackageJson: () => "/tmp/node_modules/node-pty/package.json",
			}),
		).toBe("/tmp/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper");
	});

	it("chmods the helper to 755 when it exists", () => {
		const chmodSync = vi.fn();

		const changed = ensureNodePtySpawnHelperExecutable({
			platform: "darwin",
			arch: "arm64",
			resolvePackageJson: () => "/tmp/node-pty/package.json",
			existsSync: () => true,
			chmodSync,
		});

		expect(changed).toBe(true);
		expect(chmodSync).toHaveBeenCalledWith(
			"/tmp/node-pty/prebuilds/darwin-arm64/spawn-helper",
			0o755,
		);
	});

	it("skips chmod when the helper is missing", () => {
		const chmodSync = vi.fn();

		const changed = ensureNodePtySpawnHelperExecutable({
			platform: "darwin",
			arch: "arm64",
			resolvePackageJson: () => "/tmp/node-pty/package.json",
			existsSync: () => false,
			chmodSync,
		});

		expect(changed).toBe(false);
		expect(chmodSync).not.toHaveBeenCalled();
	});
});
