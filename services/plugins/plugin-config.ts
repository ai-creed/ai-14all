import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";

export type PluginConfigEntry = {
	enabled: boolean;
	installPath: string | null;
};

export type PluginConfigStore = {
	get(id: string): PluginConfigEntry;
	setEnabled(id: string, enabled: boolean): void;
	reload(): void;
	/** Parse error from the last load, if any (config falls back to defaults). */
	lastError: string | null;
	onChange(cb: () => void): () => void;
};

const DEFAULT_ENTRY: PluginConfigEntry = { enabled: false, installPath: null };

function expandTilde(p: string): string {
	if (p === "~") return homedir();
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	return p;
}

export function createPluginConfigStore(options: {
	configPath: string;
	watch?: (path: string, onEvent: () => void) => () => void;
}): PluginConfigStore {
	let entries = new Map<string, PluginConfigEntry>();
	let lastError: string | null = null;
	const listeners = new Set<() => void>();

	function load(): void {
		entries = new Map();
		lastError = null;
		if (!existsSync(options.configPath)) return;
		let parsed: unknown;
		try {
			parsed = parse(readFileSync(options.configPath, "utf8"));
		} catch (e) {
			lastError = e instanceof Error ? e.message : String(e);
			return;
		}
		const plugins = (parsed as { plugins?: Record<string, unknown> }).plugins;
		if (typeof plugins !== "object" || plugins === null) return;
		for (const [id, raw] of Object.entries(plugins)) {
			if (typeof raw !== "object" || raw === null) continue;
			const section = raw as { enabled?: unknown; install_path?: unknown };
			entries.set(id, {
				enabled: section.enabled === true,
				installPath:
					typeof section.install_path === "string"
						? expandTilde(section.install_path)
						: null,
			});
		}
	}

	function notify(): void {
		for (const cb of listeners) cb();
	}

	load();
	const stopWatch = options.watch?.(options.configPath, () => {
		load();
		notify();
	});
	void stopWatch;

	return {
		get(id) {
			return entries.get(id) ?? DEFAULT_ENTRY;
		},
		setEnabled(id, enabled) {
			// Targeted line edit so hand-written comments survive GUI writes.
			let text = existsSync(options.configPath)
				? readFileSync(options.configPath, "utf8")
				: "";
			const header = `[plugins.${id}]`;
			const headerIdx = text.indexOf(header);
			if (headerIdx === -1) {
				const section = `${header}\nenabled = ${enabled}\n`;
				text =
					text.length === 0 || text.endsWith("\n")
						? `${text}${text.length > 0 ? "\n" : ""}${section}`
						: `${text}\n\n${section}`;
			} else {
				const sectionStart = headerIdx + header.length;
				const nextHeader = text.indexOf("\n[", sectionStart);
				const sectionEnd = nextHeader === -1 ? text.length : nextHeader;
				const section = text.slice(sectionStart, sectionEnd);
				const enabledLine = /^([ \t]*)enabled[ \t]*=.*$/m;
				const replaced = enabledLine.test(section)
					? section.replace(enabledLine, `$1enabled = ${enabled}`)
					: `\nenabled = ${enabled}${section}`;
				text = text.slice(0, sectionStart) + replaced + text.slice(sectionEnd);
			}
			writeFileSync(options.configPath, text, "utf8");
			load();
			notify();
		},
		reload() {
			load();
			notify();
		},
		get lastError() {
			return lastError;
		},
		onChange(cb) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
	};
}
