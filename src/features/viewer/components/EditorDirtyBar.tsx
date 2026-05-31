import { useCallback } from "react";
import { Button } from "@/components/ui/button";

export type EditorDirtyBarProps = {
	currentLength: number;
	pristineLength: number;
	onSave: () => void;
	onDiscard: () => void;
};

const DISCARD_CONFIRM_THRESHOLD = 50;

// Sticky bar shown at the bottom of the InlineEditor only when the buffer
// is dirty. Save / Discard + ⌘S hint. The Discard handler prompts for
// confirmation when the buffer differs from the pristine content by more
// than DISCARD_CONFIRM_THRESHOLD characters, to avoid losing real edits
// to a stray click.
export function EditorDirtyBar({
	currentLength,
	pristineLength,
	onSave,
	onDiscard,
}: EditorDirtyBarProps) {
	const handleDiscard = useCallback(() => {
		const delta = Math.abs(currentLength - pristineLength);
		if (delta > DISCARD_CONFIRM_THRESHOLD) {
			if (!window.confirm("Discard unsaved changes?")) return;
		}
		onDiscard();
	}, [currentLength, pristineLength, onDiscard]);

	return (
		<div
			className="flex items-center gap-2 px-4 py-2 border-t border-border bg-muted/50"
			data-testid="editor-dirty-bar"
			role="region"
			aria-label="Unsaved changes"
		>
			<span className="text-sm font-medium">
				<span aria-hidden="true">●</span> Unsaved changes
			</span>
			<span className="text-xs text-muted-foreground">
				<kbd>⌘S</kbd>
			</span>
			<Button
				type="button"
				size="sm"
				onClick={onSave}
			>
				Save
			</Button>
			<Button type="button" variant="outline" size="sm" onClick={handleDiscard}>
				Discard
			</Button>
		</div>
	);
}

export const __DISCARD_CONFIRM_THRESHOLD = DISCARD_CONFIRM_THRESHOLD;
