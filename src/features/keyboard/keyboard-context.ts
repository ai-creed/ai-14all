import { createContext, useContext } from "react";
import type { ShortcutRegistry } from "./shortcut-registry";

export const KeyboardContext = createContext<ShortcutRegistry | null>(null);

export function useKeyboardRegistry(): ShortcutRegistry | null {
  return useContext(KeyboardContext);
}
