import { useEffect, useRef, useState } from "react";
import { keyboard } from "../../lib/desktop-client";
import {
  detectPlatform,
  buildShortcutRegistry,
  type ShortcutRegistry,
} from "./shortcut-registry";
import { getDefaultBindings } from "./default-keybindings";
import { KeybindingsFileSchema } from "./keybindings-schema";

export type ShortcutActionMap = Record<string, () => void>;

function buildDefaultRegistry(): ShortcutRegistry {
  const platform = detectPlatform();
  return buildShortcutRegistry(getDefaultBindings(platform), platform);
}

export function useKeyboardShortcuts(actions: ShortcutActionMap): ShortcutRegistry {
  const [registry, setRegistry] = useState<ShortcutRegistry>(buildDefaultRegistry);

  // Keep actions ref up-to-date each render so the stable listener sees fresh handlers
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // Load user config once on mount and rebuild registry
  useEffect(() => {
    const platform = detectPlatform();
    keyboard.loadKeybindings().then((raw) => {
      let bindings = getDefaultBindings(platform);
      if (raw !== null) {
        try {
          const parsed: unknown = JSON.parse(raw);
          const result = KeybindingsFileSchema.safeParse(parsed);
          if (result.success && result.data.bindings.length > 0) {
            bindings = result.data.bindings;
          } else {
            console.warn("[keyboard] keybindings.json invalid or empty — using defaults");
          }
        } catch {
          console.warn("[keyboard] keybindings.json failed to parse — using defaults");
        }
      }
      setRegistry(buildShortcutRegistry(bindings, platform));
    }).catch(() => {
      // IPC unavailable (e.g. tests without full Electron) — keep defaults
    });
  }, []);

  // Mount document-level keydown listener; re-registers when registry changes
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const action = registry.resolve(event);
      if (!action) return;
      const fn = actionsRef.current[action];
      if (!fn) return;
      event.preventDefault();
      fn();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [registry]);

  return registry;
}
