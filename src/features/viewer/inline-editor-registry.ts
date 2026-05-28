// Renderer-side registry of mounted InlineEditor instances keyed by the same
// `${workspaceId}|${worktreeId}|${relativePath}` key that main's close-gate
// uses. Each entry exposes `requestSwitch()` which the App uses to drive its
// Save/Discard/Cancel flow during the app-close gate.

export type InlineEditorEntry = {
	requestSwitch: () => Promise<"proceed" | "cancel">;
};

const entries = new Map<string, InlineEditorEntry>();

function keyOf(args: {
	workspaceId: string;
	worktreeId: string;
	relativePath: string;
}): string {
	return `${args.workspaceId}|${args.worktreeId}|${args.relativePath}`;
}

export function registerInlineEditor(
	args: {
		workspaceId: string;
		worktreeId: string;
		relativePath: string;
	},
	entry: InlineEditorEntry,
): () => void {
	const k = keyOf(args);
	entries.set(k, entry);
	return () => {
		if (entries.get(k) === entry) entries.delete(k);
	};
}

export function listInlineEditors(): InlineEditorEntry[] {
	return [...entries.values()];
}

// Sync check used by callers that want to keep their React event-handler
// state dispatches in the synchronous batch when no editor is mounted. Only
// when this returns true do callers need to await `runInlineEditorDirtyGate`.
export function hasInlineEditorsRegistered(): boolean {
	return entries.size > 0;
}

// Shared dirty-switch gate. Iterates every mounted InlineEditor and awaits its
// requestSwitch(); short-circuits to "cancel" the first time any editor asks
// to abort. Returns "proceed" when every editor cleared (or none is mounted).
export async function runInlineEditorDirtyGate(): Promise<
	"proceed" | "cancel"
> {
	for (const editor of entries.values()) {
		const result = await editor.requestSwitch();
		if (result === "cancel") return "cancel";
	}
	return "proceed";
}

// Test seam: clear all registered editors.
export function __resetInlineEditorRegistry(): void {
	entries.clear();
}
