import { useState, useEffect } from "react";
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogClose,
} from "@/components/ui/dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { files } from "../../../lib/desktop-client";

interface Props {
	workspaceId: string;
	worktreeId: string;
	relativePath: string;
	contentOverride?: string | null;
	open: boolean;
	onClose: () => void;
}

export function MarkdownPreviewModal({
	workspaceId,
	worktreeId,
	relativePath,
	contentOverride = null,
	open,
	onClose,
}: Props) {
	const [content, setContent] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [reloadToken, setReloadToken] = useState(0);

	useEffect(() => {
		if (!open) return;
		if (contentOverride !== null) {
			setError(null);
			setLoading(false);
			setContent(contentOverride);
			return;
		}
		setLoading(true);
		setError(null);
		setContent(null);
		files
			.read(workspaceId, worktreeId, relativePath)
			.then((result) => {
				if (result.ok) {
					setContent(result.view.content);
				} else {
					setError(
						result.reason.kind === "too-large"
							? "File too large to preview."
							: result.reason.kind === "binary"
								? "Binary file — preview not available."
								: "Couldn't load file contents.",
					);
				}
				setLoading(false);
			})
			.catch(() => {
				setError("Couldn't load file contents.");
				setLoading(false);
			});
	}, [
		open,
		workspaceId,
		worktreeId,
		relativePath,
		reloadToken,
		contentOverride,
	]);

	return (
		<Dialog
			open={open}
			onOpenChange={(isOpen) => {
				if (!isOpen) onClose();
			}}
		>
			<DialogContent
				className="w-[min(80vw,1200px)] max-w-none max-h-[80vh] flex flex-col overflow-hidden p-0"
				aria-describedby={undefined}
			>
				<div className="flex justify-between items-center px-4 py-3 border-b border-border shrink-0">
					<DialogTitle className="text-sm text-foreground font-mono m-0">
						{relativePath}
					</DialogTitle>
					<DialogClose
						className="bg-transparent border-none text-muted-foreground cursor-pointer p-1 leading-none rounded-sm hover:text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
						aria-label="Close"
					>
						✕
					</DialogClose>
				</div>
				{loading && (
					<p className="text-secondary-foreground px-6 py-4">Loading {relativePath}…</p>
				)}
				{error && (
					<>
						<p className="text-destructive px-6 py-4">{error}</p>
						<button
							className="mt-2 px-3 py-1 bg-transparent border border-border rounded-sm text-muted-foreground cursor-pointer text-sm hover:border-border hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
							type="button"
							onClick={() => setReloadToken((x) => x + 1)}
						>
							Retry
						</button>
					</>
				)}
				{content !== null && (
					<div className="flex-1 overflow-y-auto min-h-0">
						<div className="prose prose-sm px-6 py-4 max-w-none">
							<ReactMarkdown
								remarkPlugins={[remarkGfm]}
								rehypePlugins={[rehypeHighlight]}
							>
								{content}
							</ReactMarkdown>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
