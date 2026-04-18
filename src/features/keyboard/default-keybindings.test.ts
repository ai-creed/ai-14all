import { describe, it, expect } from "vitest";
import { getDefaultBindings } from "./default-keybindings";

describe("getDefaultBindings", () => {
  it("has no duplicate key combos for macos", () => {
    const bindings = getDefaultBindings("macos");
    const keys = bindings.map((b) => b.key.toLowerCase());
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("contains all 17 expected actions for macos", () => {
    const bindings = getDefaultBindings("macos");
    const actions = bindings.map((b) => b.action);
    expect(actions).toContain("worktree.selectNext");
    expect(actions).toContain("terminal.new");
    expect(actions).toContain("ui.showShortcuts");
    expect(actions).toContain("worktree.add");
    expect(actions).toContain("layout.toggleSidebar");
    expect(bindings).toHaveLength(17);
  });
});
