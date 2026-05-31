import { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
	open: boolean;
	note: string;
	onNoteChange: (note: string) => void;
	onClose: () => void;
};

export function NoteSheet({ open, note, onNoteChange, onClose }: Props) {
	const [mode, setMode] = useState<"edit" | "preview">("edit");

	return (
		<Sheet
			open={open}
			onOpenChange={(v) => {
				if (!v) onClose();
			}}
		>
			<SheetContent
				side="right"
				className="w-[clamp(280px,28vw,420px)] flex flex-col"
				aria-describedby={undefined}
			>
				<SheetHeader className="flex flex-row items-center justify-between space-y-0 pr-6">
					<SheetTitle>Session note</SheetTitle>
					<div role="group" aria-label="Session note mode" className="flex gap-1">
						<Button
							type="button"
							variant={mode === "edit" ? "secondary" : "ghost"}
							size="sm"
							onClick={() => setMode("edit")}
						>
							Edit
						</Button>
						<Button
							type="button"
							variant={mode === "preview" ? "secondary" : "ghost"}
							size="sm"
							onClick={() => setMode("preview")}
						>
							Preview
						</Button>
					</div>
				</SheetHeader>

				{mode === "edit" ? (
					<Textarea
						aria-label="Session note"
						className="flex-1 resize-none"
						value={note}
						onChange={(e) => onNoteChange(e.target.value)}
						placeholder="Write a note for this session…"
						autoFocus
					/>
				) : (
					<div
						className="flex-1 overflow-y-auto rounded-md border border-input p-4"
						role="region"
						aria-label="Session note preview"
					>
						<div className="prose prose-sm dark:prose-invert max-w-none">
							<ReactMarkdown
								remarkPlugins={[remarkGfm]}
								rehypePlugins={[rehypeHighlight]}
							>
								{note}
							</ReactMarkdown>
						</div>
					</div>
				)}
			</SheetContent>
		</Sheet>
	);
}
