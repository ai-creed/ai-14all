import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "smol-toml";

export type PluginConfigEntry = {
	enabled: boolean;
	installPath: string | null;
	behavior?: { focusRaisesWindow: boolean };
};

export type PluginConfigStore = {
	get(id: string): PluginConfigEntry;
	setEnabled(id: string, enabled: boolean): void;
	reload(): void;
	/** Parse error from the last load, if any (config falls back to defaults). */
	lastError: string | null;
	onChange(cb: () => void): () => void;
	dispose(): void;
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
	// One-shot flag: when setEnabled writes the file itself, suppress the
	// chokidar echo that would trigger a redundant load()+notify().
	let suppressNextWatchEvent = false;

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
			const section = raw as {
				enabled?: unknown;
				install_path?: unknown;
				behavior?: unknown;
			};
			const behaviorRaw = section.behavior;
			const behavior =
				typeof behaviorRaw === "object" &&
				behaviorRaw !== null &&
				typeof (behaviorRaw as { focus_raises_window?: unknown })
					.focus_raises_window === "boolean"
					? {
							focusRaisesWindow: (
								behaviorRaw as { focus_raises_window: boolean }
							).focus_raises_window,
						}
					: undefined;
			entries.set(id, {
				enabled: section.enabled === true,
				installPath:
					typeof section.install_path === "string"
						? expandTilde(section.install_path)
						: null,
				...(behavior ? { behavior } : {}),
			});
		}
	}

	function notify(): void {
		for (const cb of listeners) cb();
	}

	load();
	const stopWatchFn = options.watch?.(options.configPath, () => {
		// Suppress the echo from our own writeFileSync in setEnabled. Known
		// v1 limitation: an external edit racing into the self-write window
		// consumes the flag and is dropped (the later self-echo reloads, so
		// state still converges on the next event).
		if (suppressNextWatchEvent) {
			suppressNextWatchEvent = false;
			return;
		}
		load();
		notify();
	});

	return {
		get(id) {
			return entries.get(id) ?? DEFAULT_ENTRY;
		},
		setEnabled(id, enabled) {
			// Targeted line edit so hand-written comments survive GUI writes.
			let text = existsSync(options.configPath)
				? readFileSync(options.configPath, "utf8")
				: "";

			// Fix 1: Anchor the header match to line boundaries to avoid matching
			// headers that appear inside comments (e.g. "# see [plugins.whisper] docs").
			const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const headerRe = new RegExp(
				`^[ \\t]*\\[plugins\\.${escapedId}\\][ \\t]*$`,
				"m",
			);
			const headerMatch = headerRe.exec(text);

			if (headerMatch !== null) {
				// Standard [plugins.id] section found — do surgical text edit.
				const sectionStart = headerMatch.index + headerMatch[0].length;
				const nextHeader = text.indexOf("\n[", sectionStart);
				const sectionEnd = nextHeader === -1 ? text.length : nextHeader;
				const section = text.slice(sectionStart, sectionEnd);
				const enabledLine = /^([ \t]*)enabled[ \t]*=.*$/m;
				const replaced = enabledLine.test(section)
					? section.replace(enabledLine, `$1enabled = ${enabled}`)
					: `\nenabled = ${enabled}${section}`;
				text = text.slice(0, sectionStart) + replaced + text.slice(sectionEnd);
			} else if (entries.has(id)) {
				// Fix 2: Plugin id exists but via an inline-table form like:
				//   [plugins]
				//   whisper = { enabled = false }
				// Appending a new [plugins.whisper] section would cause smol-toml to
				// throw "trying to redefine an already defined table" on the next load,
				// silently dropping ALL config to defaults.
				// Trade-off: comments are lost in this rare path — correctness over
				// comment preservation.
				let parsed: unknown;
				try {
					parsed = parse(text);
				} catch {
					// File is already broken; fall through to append (best effort).
					parsed = null;
				}
				if (
					parsed !== null &&
					typeof parsed === "object" &&
					(parsed as Record<string, unknown>).plugins !== undefined
				) {
					const p = parsed as {
						plugins: Record<string, Record<string, unknown>>;
					};
					if (typeof p.plugins[id] === "object" && p.plugins[id] !== null) {
						p.plugins[id].enabled = enabled;
					} else {
						p.plugins[id] = { enabled };
					}
					text = stringify(p as Parameters<typeof stringify>[0]);
					suppressNextWatchEvent = true;
					writeFileSync(options.configPath, text, "utf8");
					load();
					notify();
					return;
				}
				// parse returned null or no plugins table — fall through to append.
				const header = `[plugins.${id}]`;
				const section = `${header}\nenabled = ${enabled}\n`;
				text =
					text.length === 0 || text.endsWith("\n")
						? `${text}${text.length > 0 ? "\n" : ""}${section}`
						: `${text}\n\n${section}`;
			} else {
				// Plugin not present at all — append a fresh section.
				const header = `[plugins.${id}]`;
				const section = `${header}\nenabled = ${enabled}\n`;
				text =
					text.length === 0 || text.endsWith("\n")
						? `${text}${text.length > 0 ? "\n" : ""}${section}`
						: `${text}\n\n${section}`;
			}

			// Fix 3: Suppress the watcher echo for our own write.
			suppressNextWatchEvent = true;
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
		// Fix 4: dispose stops the watcher and clears listeners.
		dispose() {
			stopWatchFn?.();
			listeners.clear();
		},
	};
}
