import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginConfigStore } from "../../../services/plugins/plugin-config";

let dir: string;

function storeFrom(toml: string) {
	dir = mkdtempSync(join(tmpdir(), "plugin-config-"));
	const configPath = join(dir, "config.toml");
	writeFileSync(configPath, toml, "utf8");
	return createPluginConfigStore({ configPath });
}

describe("plugin-config acting_enabled", () => {
	it("parses acting_enabled = true under behavior", () => {
		const store = storeFrom(
			"[plugins.samantha]\nenabled = true\n[plugins.samantha.behavior]\nacting_enabled = true\n",
		);
		expect(store.get("samantha").behavior?.actingEnabled).toBe(true);
	});

	it("defaults acting_enabled to false when behavior has only focus_raises_window", () => {
		const store = storeFrom(
			"[plugins.samantha]\nenabled = true\n[plugins.samantha.behavior]\nfocus_raises_window = true\n",
		);
		expect(store.get("samantha").behavior?.actingEnabled).toBe(false);
		expect(store.get("samantha").behavior?.focusRaisesWindow).toBe(true);
	});

	it("defaults acting_enabled to false when no behavior section exists", () => {
		const store = storeFrom("[plugins.samantha]\nenabled = true\n");
		expect(store.get("samantha").behavior?.actingEnabled ?? false).toBe(false);
	});
});

function makeStore(
	initial?: string,
	watch?: (path: string, onEvent: () => void) => () => void,
) {
	dir = mkdtempSync(join(tmpdir(), "ofa-plugin-config-"));
	const configPath = join(dir, "config.toml");
	if (initial !== undefined) writeFileSync(configPath, initial, "utf8");
	return { store: createPluginConfigStore({ configPath, watch }), configPath };
}

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

describe("plugin-config samantha behavior", () => {
	it("parses focus_raises_window = false into behavior.focusRaisesWindow", () => {
		const { store } = makeStore(
			"[plugins.samantha]\nenabled = true\n\n[plugins.samantha.behavior]\nfocus_raises_window = false\n",
		);
		expect(store.get("samantha").behavior).toEqual({
			focusRaisesWindow: false,
			actingEnabled: false,
		});
	});

	it("parses focus_raises_window = true into behavior.focusRaisesWindow", () => {
		const { store } = makeStore(
			"[plugins.samantha]\nenabled = true\n\n[plugins.samantha.behavior]\nfocus_raises_window = true\n",
		);
		expect(store.get("samantha").behavior).toEqual({
			focusRaisesWindow: true,
			actingEnabled: false,
		});
	});

	it("leaves behavior undefined when the sub-table is absent", () => {
		const { store } = makeStore("[plugins.samantha]\nenabled = true\n");
		expect(store.get("samantha").behavior).toBeUndefined();
	});
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
			'# my notes\n[plugins.whisper]\nenabled = false\n# dev override:\n# install_path = "~/Dev/ai-whisper"\n';
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

	it("does not edit a header that only appears inside a comment", () => {
		const initial =
			"# see [plugins.whisper] docs\n[plugins.whisper]\nenabled = false\n";
		const { store, configPath } = makeStore(initial);
		store.setEnabled("whisper", true);
		const text = readFileSync(configPath, "utf8");
		// Comment line must be byte-identical.
		expect(text.split("\n")[0]).toBe("# see [plugins.whisper] docs");
		expect(text).toContain("enabled = true");
		expect(store.get("whisper").enabled).toBe(true);
		expect(store.lastError).toBeNull();
	});

	it("rewrites inline-table form via TOML round-trip instead of corrupting", () => {
		const initial = "[plugins]\nwhisper = { enabled = false }\n";
		const { store } = makeStore(initial);
		store.setEnabled("whisper", true);
		expect(store.get("whisper").enabled).toBe(true);
		expect(store.lastError).toBeNull();
	});

	it("notifies exactly once per setEnabled when a watcher echoes the write", () => {
		let capturedOnEvent: (() => void) | undefined;
		const fakeWatch = (_path: string, onEvent: () => void) => {
			capturedOnEvent = onEvent;
			return () => {};
		};
		const { store } = makeStore(
			"[plugins.whisper]\nenabled = false\n",
			fakeWatch,
		);
		let count = 0;
		store.onChange(() => {
			count++;
		});

		store.setEnabled("whisper", true);
		// Simulate the chokidar echo — should be suppressed.
		capturedOnEvent!();
		expect(count).toBe(1);

		// Simulate an external edit — should fire normally.
		capturedOnEvent!();
		expect(count).toBe(2);
	});

	it("dispose stops the watcher and clears listeners", () => {
		const stopFn = vi.fn();
		const fakeWatch = (_path: string, _onEvent: () => void) => stopFn;
		const { store } = makeStore(
			"[plugins.whisper]\nenabled = false\n",
			fakeWatch,
		);

		let notified = false;
		store.onChange(() => {
			notified = true;
		});

		store.dispose();
		expect(stopFn).toHaveBeenCalledOnce();

		// After dispose, listeners are cleared — setEnabled should not notify.
		store.setEnabled("whisper", true);
		expect(notified).toBe(false);
	});
});
