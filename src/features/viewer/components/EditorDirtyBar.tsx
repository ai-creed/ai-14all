import { useCallback } from "react";
import {
	type Platform,
	shortcutHint,
	detectPlatform,
} from "../../../app/shortcut-registry";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export type EditorDirtyBarProps = {
	currentLength: number;
	pristineLength: number;
	onSave: () => void;
	onDiscard: () => void;
	/** Defaults to the detected platform; injected in tests. */
	platform?: Platform;
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
	platform = detectPlatform(),
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
			className="shell-editor-dirty-bar"
			data-testid="editor-dirty-bar"
			role="region"
			aria-label="Unsaved changes"
		>
			<span className="shell-editor-dirty-bar__label">
				<span aria-hidden="true">
					<Icon name="dot" />
				</span>{" "}
				Unsaved changes
			</span>
			<span className="shell-editor-dirty-bar__hint">
				<kbd>{shortcutHint("⌘S", "Ctrl+S", platform)}</kbd>
			</span>
			<Button type="button" variant="default" size="sm" onClick={onSave}>
				Save
			</Button>
			<Button
				type="button"
				variant="secondary"
				size="sm"
				onClick={handleDiscard}
			>
				Discard
			</Button>
		</div>
	);
}

export const __DISCARD_CONFIRM_THRESHOLD = DISCARD_CONFIRM_THRESHOLD;
