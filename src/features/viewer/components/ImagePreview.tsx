import { useEffect, useState } from "react";
import { files } from "../../../lib/desktop-client";
import type { ImageReadResult } from "../../../../shared/models/image-view";

type Props = { workspaceId: string; worktreeId: string; relativePath: string };

export function ImagePreview({ workspaceId, worktreeId, relativePath }: Props) {
	const [result, setResult] = useState<ImageReadResult | null>(null);
	const [decodeFailed, setDecodeFailed] = useState(false);
	const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

	useEffect(() => {
		let cancelled = false;
		setResult(null);
		setDecodeFailed(false);
		setDims(null);
		files.readImage(workspaceId, worktreeId, relativePath).then((r) => {
			if (!cancelled) setResult(r);
		});
		return () => {
			cancelled = true;
		};
	}, [workspaceId, worktreeId, relativePath]);

	if (result === null)
		return <p className="shell-empty-state">Loading image…</p>;
	if (!result.ok)
		return <p className="shell-error">{imageFailureLabel(result.reason)}</p>;
	if (decodeFailed) return <p className="shell-error">Cannot decode image.</p>;

	const name = relativePath.split("/").pop() ?? relativePath;
	return (
		<div className="shell-image-preview">
			<img
				className="shell-image-preview__img"
				src={`data:${result.mime};base64,${result.base64}`}
				alt={name}
				onLoad={(e) =>
					setDims({
						w: e.currentTarget.naturalWidth,
						h: e.currentTarget.naturalHeight,
					})
				}
				onError={() => setDecodeFailed(true)}
			/>
			<p className="shell-image-preview__caption">
				{name}
				{dims ? ` · ${dims.w}×${dims.h} px` : ""} ·{" "}
				{formatBytes(result.byteLength)}
			</p>
		</div>
	);
}

function imageFailureLabel(
	reason: Extract<ImageReadResult, { ok: false }>["reason"],
): string {
	switch (reason.kind) {
		case "too-large":
			return `Too large to preview (${formatBytes(reason.size)}).`;
		case "not-found":
			return "File not found.";
		case "not-image":
			return "Not a previewable image.";
		case "permission-denied":
			return "Permission denied.";
		case "path-escape":
		case "read-failed":
			return "Couldn't load file contents.";
	}
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
