import { useEffect, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type { GitCommitDetail } from "../../../shared/models/git-commit-review.js";

type Props = {
	detail: GitCommitDetail;
	focusedPath: string | null;
};

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	js: "javascript",
	jsx: "javascript",
	json: "json",
	css: "css",
	html: "html",
	md: "markdown",
	sh: "shell",
	bash: "shell",
	py: "python",
	rs: "rust",
	go: "go",
	yaml: "yaml",
	yml: "yaml",
	toml: "ini",
	sql: "sql",
};

function languageFromPath(path: string): string | undefined {
	const ext = path.split(".").pop()?.toLowerCase();
	return ext ? EXTENSION_TO_LANGUAGE[ext] : undefined;
}

export function CommitDiffStack({ detail, focusedPath }: Props) {
	const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());

	useEffect(() => {
		if (focusedPath) {
			setCollapsedPaths((prev) => {
				if (!prev.has(focusedPath)) return prev;
				const next = new Set(prev);
				next.delete(focusedPath);
				return next;
			});
		}
	}, [focusedPath]);

	return (
		<div className="shell-commit-diff-stack">
			<div className="shell-viewer__header">
				<div className="shell-viewer__title">{detail.subject}</div>
				<div className="shell-viewer__meta">{detail.shortSha}</div>
			</div>
			{detail.files.map((file) => {
				const collapsed = collapsedPaths.has(file.path);
				return (
					<section
						key={file.path}
						data-testid={`commit-diff-section-${file.path}`}
						data-focused={String(focusedPath === file.path)}
						className="shell-commit-diff-section"
					>
						<button
							type="button"
							className="shell-commit-diff-section__header"
							onClick={() =>
								setCollapsedPaths((prev) => {
									const next = new Set(prev);
									if (next.has(file.path)) next.delete(file.path);
									else next.add(file.path);
									return next;
								})
							}
						>
							<span>{file.path}</span>
							<strong>{file.status}</strong>
						</button>
						{!collapsed && (
							<DiffEditor
								height="260px"
								language={languageFromPath(file.path)}
								original={file.originalContent}
								modified={file.modifiedContent}
								options={{
									readOnly: true,
									renderSideBySide: true,
									minimap: { enabled: false },
								}}
							/>
						)}
					</section>
				);
			})}
		</div>
	);
}
