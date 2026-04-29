import { useEffect } from "react";
import { isEditable } from "../../../shared/editor/editable-files";

type Options = {
	/** When non-null, the editor modal is open and owns Cmd+E. */
	editorOpen: boolean;
	selectedFilePath: string | null;
	onOpen: (relativePath: string) => void;
};

/**
 * Cmd+E / Ctrl+E shortcut to open the currently selected file in the editor
 * modal. Suppressed while the modal is already open. Uses raw key handling
 * because this shortcut isn't registry-driven.
 */
export function useEditFileShortcut(options: Options): void {
	const { editorOpen, selectedFilePath, onOpen } = options;
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.key !== "e") return;
			if (editorOpen) return;
			if (!selectedFilePath) return;
			const basename = selectedFilePath.split("/").pop() ?? "";
			if (!isEditable(basename)) return;
			e.preventDefault();
			onOpen(selectedFilePath);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [editorOpen, selectedFilePath, onOpen]);
}
