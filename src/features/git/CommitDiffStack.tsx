import { useEffect, useRef, useState } from "react";
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

function lineCount(content: string): number {
	const normalized = content.endsWith("\n") ? content.slice(0, -1) : content;
	if (!normalized) return 1;
	return normalized.split("\n").length;
}

function editorHeightForFile(
	originalContent: string,
	modifiedContent: string,
): string {
	const lines = Math.max(lineCount(originalContent), lineCount(modifiedContent));
	return `${Math.max(lines * 20 + 32, 160)}px`;
}

export function CommitDiffStack({ detail, focusedPath }: Props) {
	const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
	const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
	const singleFile = detail.files.length === 1;

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

	useEffect(() => {
		if (!focusedPath) return;
		const section = sectionRefs.current[focusedPath];
		if (!section || typeof section.scrollIntoView !== "function") return;
		section.scrollIntoView({ block: "nearest" });
	}, [detail.sha, focusedPath]);

	return (
		<div
			className="shell-commit-diff-stack"
			data-single-file={String(singleFile)}
		>
			<div className="shell-viewer__header">
				<div className="shell-viewer__title">{detail.subject}</div>
				<div className="shell-viewer__meta">{detail.shortSha}</div>
			</div>
			<div className="shell-commit-diff-stack__body">
				{detail.files.map((file) => {
					const collapsed = collapsedPaths.has(file.path);
					return (
						<section
							key={file.path}
							ref={(node) => {
								sectionRefs.current[file.path] = node;
							}}
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
									height={
										singleFile
											? "100%"
											: editorHeightForFile(
													file.originalContent,
													file.modifiedContent,
												)
									}
									language={languageFromPath(file.path)}
									theme="vs-dark"
									original={file.originalContent}
									modified={file.modifiedContent}
									options={{
										readOnly: true,
										fontSize: 12,
										renderSideBySide: true,
										minimap: { enabled: false },
										scrollBeyondLastLine: false,
										scrollbar: {
											vertical: "hidden",
											horizontal: "auto",
											alwaysConsumeMouseWheel: false,
										},
									}}
								/>
							)}
						</section>
					);
				})}
			</div>
		</div>
	);
}
