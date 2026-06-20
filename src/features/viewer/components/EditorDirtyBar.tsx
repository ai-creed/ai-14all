import { useCallback } from "react";
import {
	type Platform,
	shortcutHint,
	detectPlatform,
} from "../../../app/shortcut-registry";

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
				<span aria-hidden="true">●</span> Unsaved changes
			</span>
			<span className="shell-editor-dirty-bar__hint">
				<kbd>{shortcutHint("⌘S", "Ctrl+S", platform)}</kbd>
			</span>
			<button
				type="button"
				className="shell-btn shell-btn--primary"
				onClick={onSave}
			>
				Save
			</button>
			<button type="button" className="shell-btn" onClick={handleDiscard}>
				Discard
			</button>
		</div>
	);
}

export const __DISCARD_CONFIRM_THRESHOLD = DISCARD_CONFIRM_THRESHOLD;
