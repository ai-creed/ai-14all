import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

// Mock the IPC client
vi.mock("../../lib/desktop-client", () => ({
  keyboard: {
    loadKeybindings: vi.fn(),
  },
}));

import { keyboard } from "../../lib/desktop-client";

const validConfig = JSON.stringify({
  version: 1,
  bindings: [{ action: "test.custom", key: "cmd+p" }],
});

beforeEach(() => {
  vi.mocked(keyboard.loadKeybindings).mockResolvedValue(null);
  // Ensure userAgent resolves to macos in jsdom
  Object.defineProperty(navigator, "userAgent", {
    value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    configurable: true,
  });
});

describe("useKeyboardShortcuts", () => {
  it("uses defaults when IPC returns null", async () => {
    vi.mocked(keyboard.loadKeybindings).mockResolvedValue(null);
    const handler = vi.fn();
    const { result } = renderHook(() =>
      useKeyboardShortcuts({ "worktree.selectNext": handler }),
    );
    // Wait for async IPC call
    await act(async () => {});
    const list = result.current.list();
    expect(list.some((s) => s.action === "worktree.selectNext")).toBe(true);
  });

  it("uses user config when IPC returns valid JSON", async () => {
    vi.mocked(keyboard.loadKeybindings).mockResolvedValue(validConfig);
    const handler = vi.fn();
    const { result } = renderHook(() =>
      useKeyboardShortcuts({ "test.custom": handler }),
    );
    await act(async () => {});
    const list = result.current.list();
    expect(list.some((s) => s.action === "test.custom")).toBe(true);
    // Default bindings should NOT be present since user config replaces them
    expect(list.some((s) => s.action === "worktree.selectNext")).toBe(false);
  });

  it("falls back to defaults when JSON is invalid", async () => {
    vi.mocked(keyboard.loadKeybindings).mockResolvedValue("not valid json{{{");
    const { result } = renderHook(() => useKeyboardShortcuts({}));
    await act(async () => {});
    const list = result.current.list();
    expect(list.some((s) => s.action === "worktree.selectNext")).toBe(true);
  });

  it("falls back to defaults when bindings array is empty", async () => {
    vi.mocked(keyboard.loadKeybindings).mockResolvedValue(
      JSON.stringify({ version: 1, bindings: [] }),
    );
    const { result } = renderHook(() => useKeyboardShortcuts({}));
    await act(async () => {});
    const list = result.current.list();
    expect(list.some((s) => s.action === "worktree.selectNext")).toBe(true);
  });

  it("calls the correct action handler on matching keydown", async () => {
    vi.mocked(keyboard.loadKeybindings).mockResolvedValue(null);
    const handler = vi.fn();
    renderHook(() =>
      useKeyboardShortcuts({ "worktree.selectNext": handler }),
    );
    await act(async () => {});
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { metaKey: true, key: "]", bubbles: true }),
      );
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("ignores keydown events for unregistered actions", async () => {
    vi.mocked(keyboard.loadKeybindings).mockResolvedValue(null);
    const handler = vi.fn();
    renderHook(() => useKeyboardShortcuts({ "worktree.selectNext": handler }));
    await act(async () => {});
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { metaKey: true, key: "z", bubbles: true }),
      );
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not throw when action ID has no handler registered", async () => {
    vi.mocked(keyboard.loadKeybindings).mockResolvedValue(null);
    // No handlers provided — pressing a matching key should not throw
    renderHook(() => useKeyboardShortcuts({}));
    await act(async () => {});
    expect(() => {
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { metaKey: true, key: "]", bubbles: true }),
        );
      });
    }).not.toThrow();
  });
});
