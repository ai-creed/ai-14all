import { describe, expect, it, vi } from "vitest";
import { Arch } from "builder-util";
import afterPack, {
	ensurePackagedNodePtySpawnHelperExecutable,
	getPackagedNodePtySpawnHelperPath,
	resolvePackagedArch,
} from "../../../scripts/electron-builder-after-pack.mjs";

describe("electron-builder-after-pack", () => {
	it("maps electron-builder arch enums to packaged helper arch names", () => {
		expect(resolvePackagedArch(Arch.arm64)).toBe("arm64");
		expect(resolvePackagedArch(Arch.x64)).toBe("x64");
	});

	it("builds the unpacked spawn-helper path inside a packaged app", () => {
		expect(
			getPackagedNodePtySpawnHelperPath({
				appOutDir: "/tmp/release/mac-arm64",
				productFilename: "ai-14all",
				arch: "arm64",
			}),
		).toBe(
			"/tmp/release/mac-arm64/ai-14all.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
		);
	});

	it("chmods the packaged helper to 755 when it exists", () => {
		const chmodSync = vi.fn();
		const changed = ensurePackagedNodePtySpawnHelperExecutable({
			appOutDir: "/tmp/release/mac-arm64",
			productFilename: "ai-14all",
			arch: "arm64",
			existsSync: () => true,
			chmodSync,
		});

		expect(changed).toBe(true);
		expect(chmodSync).toHaveBeenCalledWith(
			"/tmp/release/mac-arm64/ai-14all.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper",
			0o755,
		);
	});

	it("returns false and skips chmod when the helper does not exist", () => {
		const chmodSync = vi.fn();
		const changed = ensurePackagedNodePtySpawnHelperExecutable({
			appOutDir: "/tmp/release/mac-arm64",
			productFilename: "ai-14all",
			arch: "arm64",
			existsSync: () => false,
			chmodSync,
		});
		expect(changed).toBe(false);
		expect(chmodSync).not.toHaveBeenCalled();
	});
});

describe("afterPack", () => {
	it("throws when the node-pty spawn-helper is not found", async () => {
		const context = {
			appOutDir: "/nonexistent/path",
			packager: { appInfo: { productFilename: "ai-14all" } },
			arch: Arch.arm64,
		};
		await expect(afterPack(context)).rejects.toThrow(
			"node-pty spawn-helper not found",
		);
	});
});
