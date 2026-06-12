import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginConfigStore } from "../../../services/plugins/plugin-config";

let dir: string;

function makeStore(initial?: string) {
	dir = mkdtempSync(join(tmpdir(), "ofa-plugin-config-"));
	const configPath = join(dir, "config.toml");
	if (initial !== undefined) writeFileSync(configPath, initial, "utf8");
	return { store: createPluginConfigStore({ configPath }), configPath };
}

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("createPluginConfigStore", () => {
	it("returns defaults when the file is missing", () => {
		const { store } = makeStore();
		expect(store.get("whisper")).toEqual({ enabled: false, installPath: null });
	});

	it("reads enabled + install_path from TOML", () => {
		const { store } = makeStore(
			'[plugins.whisper]\nenabled = true\ninstall_path = "/tmp/wt"\n',
		);
		expect(store.get("whisper")).toEqual({
			enabled: true,
			installPath: "/tmp/wt",
		});
	});

	it("treats malformed TOML as defaults without throwing", () => {
		const { store } = makeStore("[plugins.whisper\nenabled = ???");
		expect(store.get("whisper")).toEqual({ enabled: false, installPath: null });
		expect(store.lastError).not.toBeNull();
	});

	it("setEnabled rewrites only the enabled line, preserving comments", () => {
		const initial =
			"# my notes\n[plugins.whisper]\nenabled = false\n# dev override:\n# install_path = \"~/Dev/ai-whisper\"\n";
		const { store, configPath } = makeStore(initial);
		store.setEnabled("whisper", true);
		const text = readFileSync(configPath, "utf8");
		expect(text).toContain("# my notes");
		expect(text).toContain('# install_path = "~/Dev/ai-whisper"');
		expect(text).toContain("enabled = true");
		expect(store.get("whisper").enabled).toBe(true);
	});

	it("setEnabled appends a section when none exists", () => {
		const { store, configPath } = makeStore("");
		store.setEnabled("whisper", true);
		expect(readFileSync(configPath, "utf8")).toContain("[plugins.whisper]");
		expect(store.get("whisper").enabled).toBe(true);
	});

	it("creates the file on first setEnabled when missing", () => {
		const { store, configPath } = makeStore();
		store.setEnabled("cortex", true);
		expect(readFileSync(configPath, "utf8")).toContain("[plugins.cortex]");
	});

	it("expands a leading ~ in install_path", () => {
		const { store } = makeStore(
			'[plugins.whisper]\nenabled = true\ninstall_path = "~/Dev/ai-whisper"\n',
		);
		expect(store.get("whisper").installPath).toBe(
			join(process.env.HOME ?? "", "Dev/ai-whisper"),
		);
	});
});
