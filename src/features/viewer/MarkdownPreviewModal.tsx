import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { files } from "../../lib/desktop-client";

interface Props {
	worktreePath: string;
	relativePath: string;
	contentOverride?: string | null;
	open: boolean;
	onClose: () => void;
}

export function MarkdownPreviewModal({
	worktreePath,
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
			.read(worktreePath, relativePath)
			.then((view) => {
				setContent(view.content);
				setLoading(false);
			})
			.catch(() => {
				setError("Couldn't load file contents.");
				setLoading(false);
			});
	}, [open, worktreePath, relativePath, reloadToken, contentOverride]);

	return (
		<Dialog.Root
			open={open}
			onOpenChange={(isOpen) => {
				if (!isOpen) onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Overlay className="shell-md-overlay" />
				<Dialog.Content className="shell-md-modal" aria-describedby={undefined}>
					<div className="shell-md-modal__header">
						<Dialog.Title className="shell-md-modal__title">
							{relativePath}
						</Dialog.Title>
						<Dialog.Close className="shell-md-modal__close" aria-label="Close">
							✕
						</Dialog.Close>
					</div>
					{loading && (
						<p className="shell-empty-state">Loading {relativePath}…</p>
					)}
					{error && (
						<>
							<p className="shell-error">{error}</p>
							<button
								className="shell-md-modal__retry"
								type="button"
								onClick={() => setReloadToken((x) => x + 1)}
							>
								Retry
							</button>
						</>
					)}
					{content !== null && (
						<div className="shell-md-modal__scroll">
							<div className="shell-md-modal__body">
								<ReactMarkdown
									remarkPlugins={[remarkGfm]}
									rehypePlugins={[rehypeHighlight]}
								>
									{content}
								</ReactMarkdown>
							</div>
						</div>
					)}
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
