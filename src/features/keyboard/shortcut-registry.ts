export type Platform = "macos" | "linux" | "windows";

export type NormalizedBinding = {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  key: string;
};

export type RegisteredShortcut = {
  action: string;
  rawKey: string;
  displayKey: string;
};

export type ShortcutRegistry = {
  matchesAny(event: KeyboardEvent): boolean;
  resolve(event: KeyboardEvent): string | null;
  list(): RegisteredShortcut[];
};

const PLATFORM_MODIFIER: Record<Platform, "metaKey" | "ctrlKey"> = {
  macos: "metaKey",
  linux: "ctrlKey",
  windows: "ctrlKey",
};

const DISPLAY_MODIFIER: Record<Platform, { cmd: string; shift: string; alt: string; ctrl: string }> = {
  macos:   { cmd: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃" },
  linux:   { cmd: "Ctrl", shift: "Shift", alt: "Alt", ctrl: "Ctrl" },
  windows: { cmd: "Ctrl", shift: "Shift", alt: "Alt", ctrl: "Ctrl" },
};

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return "macos";
  if (ua.includes("Win")) return "windows";
  return "linux";
}

export function parseBinding(raw: string, platform: Platform): NormalizedBinding | null {
  if (!raw) return null;
  const parts = raw.toLowerCase().split("+");
  const keyPart = parts[parts.length - 1];
  if (!keyPart) return null;
  const modifiers = new Set(parts.slice(0, -1));
  const platformModifier = PLATFORM_MODIFIER[platform];
  return {
    metaKey: platformModifier === "metaKey" && modifiers.has("cmd"),
    ctrlKey: platformModifier === "ctrlKey"
      ? modifiers.has("cmd") || modifiers.has("ctrl")
      : modifiers.has("ctrl"),
    shiftKey: modifiers.has("shift"),
    altKey: modifiers.has("alt"),
    key: keyPart,
  };
}

function makeKey(b: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; key: string }): string {
  return `${b.metaKey ? "1" : "0"}${b.ctrlKey ? "1" : "0"}${b.shiftKey ? "1" : "0"}${b.altKey ? "1" : "0"}:${b.key.toLowerCase()}`;
}

function formatDisplayKey(raw: string, platform: Platform): string {
  const parts = raw.toLowerCase().split("+");
  const keyPart = parts[parts.length - 1] ?? "";
  const modifiers = new Set(parts.slice(0, -1));
  const d = DISPLAY_MODIFIER[platform];
  const out: string[] = [];
  if (modifiers.has("cmd")) out.push(d.cmd);
  if (modifiers.has("ctrl")) out.push(d.ctrl);
  if (modifiers.has("shift")) out.push(d.shift);
  if (modifiers.has("alt")) out.push(d.alt);
  out.push(keyPart.toUpperCase());
  return out.join(" ");
}

export function buildShortcutRegistry(
  bindings: Array<{ action: string; key: string }>,
  platform: Platform,
): ShortcutRegistry {
  const keyToAction = new Map<string, string>();
  const shortcuts: RegisteredShortcut[] = [];

  for (const { action, key } of bindings) {
    const normalized = parseBinding(key, platform);
    if (!normalized) continue;
    const k = makeKey(normalized);
    keyToAction.set(k, action);
    const shortcut: RegisteredShortcut = {
      action,
      rawKey: key,
      displayKey: formatDisplayKey(key, platform),
    };
    const existingIdx = shortcuts.findIndex((s) => s.action === action);
    if (existingIdx >= 0) shortcuts[existingIdx] = shortcut;
    else shortcuts.push(shortcut);
  }

  return {
    matchesAny(event) {
      return keyToAction.has(makeKey(event));
    },
    resolve(event) {
      return keyToAction.get(makeKey(event)) ?? null;
    },
    list() {
      return [...shortcuts];
    },
  };
}
