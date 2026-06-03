import { useState } from "react";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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
		<Dialog
			open={open}
			onOpenChange={(v) => {
				if (!v) onClose();
			}}
		>
			<DialogContent className="shell-note-sheet" aria-describedby={undefined}>
				<div className="shell-note-sheet__header">
					<DialogTitle className="shell-note-sheet__title">
						Session note
					</DialogTitle>
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
						<DialogClose asChild>
							<button
								type="button"
								className="shell-note-sheet__close"
								aria-label="Close note sheet"
							>
								✕
							</button>
						</DialogClose>
					</div>
				</div>
				{mode === "edit" ? (
					<Textarea
						aria-label="Session note"
						className="shell-note-sheet__textarea"
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
			</DialogContent>
		</Dialog>
	);
}
