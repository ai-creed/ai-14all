import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

type Props = {
	open: boolean;
	note: string;
	onNoteChange: (note: string) => void;
	onClose: () => void;
};

export function NoteSheet({ open, note, onNoteChange, onClose }: Props) {
	const [mode, setMode] = useState<"edit" | "preview">("edit");

	return (
		<Dialog.Root
			open={open}
			onOpenChange={(v) => {
				if (!v) onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="shell-note-sheet__overlay" />
				<Dialog.Content
					className="shell-note-sheet"
					aria-describedby={undefined}
				>
					<div className="shell-note-sheet__header">
						<Dialog.Title className="shell-note-sheet__title">
							Session note
						</Dialog.Title>
						<div className="shell-note-sheet__actions">
							<div
								className="shell-note-sheet__mode"
								role="group"
								aria-label="Session note mode"
							>
								<button
									type="button"
									className="shell-note-sheet__mode-button"
									data-active={mode === "edit"}
									onClick={() => setMode("edit")}
								>
									Edit
								</button>
								<button
									type="button"
									className="shell-note-sheet__mode-button"
									data-active={mode === "preview"}
									onClick={() => setMode("preview")}
								>
									Preview
								</button>
							</div>
							<Dialog.Close asChild>
								<button
									type="button"
									className="shell-note-sheet__close"
									aria-label="Close note sheet"
								>
									✕
								</button>
							</Dialog.Close>
						</div>
					</div>
					{mode === "edit" ? (
						<textarea
							aria-label="Session note"
							className="shell-input shell-note-sheet__textarea"
							value={note}
							onChange={(e) => onNoteChange(e.target.value)}
							placeholder="Write a note for this session…"
							autoFocus
						/>
					) : (
						<div
							className="shell-note-sheet__preview"
							role="region"
							aria-label="Session note preview"
						>
							<div className="shell-md-modal__body shell-note-sheet__preview-body">
								<ReactMarkdown
									remarkPlugins={[remarkGfm]}
									rehypePlugins={[rehypeHighlight]}
								>
									{note}
								</ReactMarkdown>
							</div>
						</div>
					)}
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
