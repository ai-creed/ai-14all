import type { Platform } from "./shortcut-registry";

export type ActionGroup = {
  label: string;
  actions: string[];
};

export const ACTION_LABELS: Record<string, string> = {
  "worktree.selectNext":    "Next worktree",
  "worktree.selectPrev":    "Previous worktree",
  "worktree.add":           "Add worktree",
  "workspace.selectNext":   "Next workspace",
  "workspace.selectPrev":   "Previous workspace",
  "terminal.new":           "New terminal",
  "terminal.close":         "Close terminal",
  "terminal.selectNext":    "Next terminal",
  "terminal.selectPrev":    "Previous terminal",
  "terminal.toggleSplit":   "Toggle split mode",
  "layout.toggleTopBand":   "Collapse / expand top band",
  "layout.toggleSidebar":   "Toggle sidebar",
  "review.files":           "Files",
  "review.changes":         "Changes",
  "review.commits":         "Commits",
  "ui.openWorkspacePicker": "Open workspace picker",
  "ui.showShortcuts":       "Show shortcuts",
};

export const ACTION_GROUPS: ActionGroup[] = [
  { label: "Worktree",  actions: ["worktree.selectNext", "worktree.selectPrev", "worktree.add"] },
  { label: "Workspace", actions: ["workspace.selectNext", "workspace.selectPrev"] },
  { label: "Terminal",  actions: ["terminal.new", "terminal.close", "terminal.selectNext", "terminal.selectPrev", "terminal.toggleSplit"] },
  { label: "Layout",    actions: ["layout.toggleTopBand", "layout.toggleSidebar"] },
  { label: "Review",    actions: ["review.files", "review.changes", "review.commits"] },
  { label: "App",       actions: ["ui.openWorkspacePicker", "ui.showShortcuts"] },
];

const MACOS_DEFAULTS: Array<{ action: string; key: string }> = [
  { action: "worktree.selectNext",    key: "cmd+]" },
  { action: "worktree.selectPrev",    key: "cmd+[" },
  { action: "worktree.add",           key: "cmd+n" },
  { action: "workspace.selectNext",   key: "cmd+shift+]" },
  { action: "workspace.selectPrev",   key: "cmd+shift+[" },
  { action: "terminal.new",           key: "cmd+t" },
  { action: "terminal.close",         key: "cmd+shift+w" },
  { action: "terminal.selectNext",    key: "cmd+shift+k" },
  { action: "terminal.selectPrev",    key: "cmd+shift+j" },
  { action: "terminal.toggleSplit",   key: "cmd+d" },
  { action: "layout.toggleTopBand",   key: "cmd+b" },
  { action: "layout.toggleSidebar",   key: "cmd+shift+b" },
  { action: "review.files",           key: "cmd+1" },
  { action: "review.changes",         key: "cmd+2" },
  { action: "review.commits",         key: "cmd+3" },
  { action: "ui.openWorkspacePicker", key: "cmd+o" },
  { action: "ui.showShortcuts",       key: "cmd+shift+p" },
];

export function getDefaultBindings(platform: Platform): Array<{ action: string; key: string }> {
  switch (platform) {
    case "macos": return MACOS_DEFAULTS;
    default:      return MACOS_DEFAULTS;
  }
}
