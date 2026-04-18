import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  detectPlatform,
  parseBinding,
  buildShortcutRegistry,
} from "./shortcut-registry";

describe("detectPlatform", () => {
  let originalUserAgent: string;
  beforeEach(() => {
    originalUserAgent = navigator.userAgent;
  });
  afterEach(() => {
    Object.defineProperty(navigator, "userAgent", {
      value: originalUserAgent,
      configurable: true,
    });
  });

  it("returns macos when userAgent contains Mac", () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      configurable: true,
    });
    expect(detectPlatform()).toBe("macos");
  });

  it("returns windows when userAgent contains Win", () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      configurable: true,
    });
    expect(detectPlatform()).toBe("windows");
  });

  it("returns linux as fallback", () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (X11; Linux x86_64)",
      configurable: true,
    });
    expect(detectPlatform()).toBe("linux");
  });
});

describe("parseBinding", () => {
  it("parses cmd+] on macos to metaKey=true", () => {
    const result = parseBinding("cmd+]", "macos");
    expect(result).toEqual({ metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, key: "]" });
  });

  it("parses cmd+] on linux to ctrlKey=true", () => {
    const result = parseBinding("cmd+]", "linux");
    expect(result).toEqual({ metaKey: false, ctrlKey: true, shiftKey: false, altKey: false, key: "]" });
  });

  it("parses cmd+shift+] correctly", () => {
    const result = parseBinding("cmd+shift+]", "macos");
    expect(result).toEqual({ metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, key: "]" });
  });

  it("parses key names case-insensitively", () => {
    const result = parseBinding("CMD+SHIFT+T", "macos");
    expect(result).toEqual({ metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, key: "t" });
  });

  it("returns null for an empty string", () => {
    expect(parseBinding("", "macos")).toBeNull();
  });
});

describe("buildShortcutRegistry", () => {
  const bindings = [
    { action: "test.alpha", key: "cmd+]" },
    { action: "test.beta",  key: "cmd+shift+]" },
  ];

  it("matchesAny returns true for a registered key", () => {
    const registry = buildShortcutRegistry(bindings, "macos");
    const event = new KeyboardEvent("keydown", { metaKey: true, key: "]" });
    expect(registry.matchesAny(event)).toBe(true);
  });

  it("matchesAny returns false for an unregistered key", () => {
    const registry = buildShortcutRegistry(bindings, "macos");
    const event = new KeyboardEvent("keydown", { metaKey: true, key: "p" });
    expect(registry.matchesAny(event)).toBe(false);
  });

  it("resolve returns the correct action", () => {
    const registry = buildShortcutRegistry(bindings, "macos");
    const event = new KeyboardEvent("keydown", { metaKey: true, shiftKey: true, key: "]" });
    expect(registry.resolve(event)).toBe("test.beta");
  });

  it("resolve returns null for an unmatched event", () => {
    const registry = buildShortcutRegistry(bindings, "macos");
    const event = new KeyboardEvent("keydown", { metaKey: true, key: "z" });
    expect(registry.resolve(event)).toBeNull();
  });

  it("last binding wins for a duplicate key combo", () => {
    const dupes = [
      { action: "test.first",  key: "cmd+]" },
      { action: "test.second", key: "cmd+]" },
    ];
    const registry = buildShortcutRegistry(dupes, "macos");
    const event = new KeyboardEvent("keydown", { metaKey: true, key: "]" });
    expect(registry.resolve(event)).toBe("test.second");
  });

  it("list returns all registered shortcuts", () => {
    const registry = buildShortcutRegistry(bindings, "macos");
    const list = registry.list();
    expect(list.map((s) => s.action)).toEqual(["test.alpha", "test.beta"]);
  });

  it("list includes a displayKey formatted for macos", () => {
    const registry = buildShortcutRegistry([{ action: "test.alpha", key: "cmd+shift+]" }], "macos");
    const [shortcut] = registry.list();
    expect(shortcut?.displayKey).toContain("⌘");
    expect(shortcut?.displayKey).toContain("⇧");
  });

  it("skips entries with invalid key strings", () => {
    const registry = buildShortcutRegistry([{ action: "test.bad", key: "" }], "macos");
    expect(registry.list()).toHaveLength(0);
  });
});
