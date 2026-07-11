import { useEffect, useState } from "react";
import { files } from "../../../lib/desktop-client";
import type {
	FileReadResult,
	FileReadFailure,
} from "../../../../shared/models/file-view";
import { MarkdownBody } from "./MarkdownBody";

type Props = { workspaceId: string; worktreeId: string; relativePath: string };

export function MarkdownPreview({
	workspaceId,
	worktreeId,
	relativePath,
}: Props) {
	const [result, setResult] = useState<FileReadResult | null>(null);

	useEffect(() => {
		let cancelled = false;
		setResult(null);
		files.read(workspaceId, worktreeId, relativePath).then((r) => {
			if (!cancelled) setResult(r);
		});
		return () => {
			cancelled = true;
		};
	}, [workspaceId, worktreeId, relativePath]);

	if (result === null)
		return <p className="shell-empty-state">Loading {relativePath}…</p>;
	if (!result.ok)
		return <p className="shell-error">{readFailureLabel(result.reason)}</p>;
	return (
		<div className="shell-md-preview">
			<div className="shell-md-preview__body">
				<MarkdownBody content={result.view.content} />
			</div>
		</div>
	);
}

function readFailureLabel(reason: FileReadFailure): string {
	switch (reason.kind) {
		case "too-large":
			return "File too large to preview.";
		case "binary":
			return "Binary file — preview not available.";
		case "not-found":
			return "File not found.";
		case "permission-denied":
			return "Permission denied.";
		case "path-escape":
		case "read-failed":
			return "Couldn't load file contents.";
	}
}
