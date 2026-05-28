import { useEffect, useRef, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type {
	GitCommitDetail,
	GitCommitFileDiff,
} from "../../../../shared/models/git-commit-review.js";
import { git } from "../../../lib/desktop-client";
import type { ResolvedTheme } from "../../../lib/use-theme";

type Props = {
	workspaceId: string;
	worktreeId: string;
	detail: GitCommitDetail;
	focusedPath: string | null;
	resolvedTheme: ResolvedTheme;
	onEditorMount?: (
		filePath: string,
		editor: import("monaco-editor").editor.IStandaloneDiffEditor,
	) => void;
	onEditorUnmount?: (filePath: string) => void;
	onRequestFocus?: (filePath: string) => void;
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

function initialHeightForFile(
	originalContent: string,
	modifiedContent: string,
): number {
	const lines = Math.max(
		lineCount(originalContent),
		lineCount(modifiedContent),
	);
	return Math.max(lines * 20 + 32, 160);
}

type DiffEditorSlotProps = {
	file: GitCommitFileDiff;
	singleFile: boolean;
	resolvedTheme: ResolvedTheme;
	onEditorMount?: (
		filePath: string,
		editor: import("monaco-editor").editor.IStandaloneDiffEditor,
	) => void;
	onEditorUnmount?: (filePath: string) => void;
};

function DiffEditorSlot({
	file,
	singleFile,
	resolvedTheme,
	onEditorMount,
	onEditorUnmount,
}: DiffEditorSlotProps) {
	const editorRef = useRef<
		import("monaco-editor").editor.IStandaloneDiffEditor | null
	>(null);
	// Stash the callback in a ref so its identity does not drive the unmount
	// effect's deps. Parents typically pass an inline arrow, so a naive dep on
	// `onEditorUnmount` would re-fire the cleanup on every parent render —
	// detaching the Monaco model from a still-mounted editor and blanking the
	// diff. The ref keeps the latest value without triggering re-runs.
	const onEditorUnmountRef = useRef(onEditorUnmount);
	const sizeDisposablesRef = useRef<Array<{ dispose(): void }>>([]);
	const [height, setHeight] = useState<number>(() =>
		initialHeightForFile(file.originalContent, file.modifiedContent),
	);
	useEffect(() => {
		onEditorUnmountRef.current = onEditorUnmount;
	});

	useEffect(() => {
		return () => {
			for (const d of sizeDisposablesRef.current) d.dispose();
			sizeDisposablesRef.current = [];
			// Null out models before @monaco-editor/react disposes the editor so
			// DiffEditorWidget can reset cleanly — avoids "TextModel disposed before
			// DiffEditorWidget model got reset" invariant error.
			editorRef.current?.setModel(null);
			onEditorUnmountRef.current?.(file.path);
		};
		// file.path is captured at mount; the parent uses key={file.path} so a
		// path change remounts the slot. Empty deps keeps cleanup on real unmount.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return (
		<DiffEditor
			height={singleFile ? "100%" : `${height}px`}
			language={languageFromPath(file.path)}
			theme={resolvedTheme === "light" ? "vs" : "vs-dark"}
			original={file.originalContent}
			modified={file.modifiedContent}
			options={{
				readOnly: true,
				fontSize: 12,
				renderSideBySide: true,
				minimap: { enabled: false },
				scrollBeyondLastLine: false,
				glyphMargin: true,
				scrollbar: {
					vertical: "hidden",
					horizontal: "auto",
					alwaysConsumeMouseWheel: false,
				},
			}}
			onMount={(editor) => {
				editorRef.current = editor;
				const modified = editor.getModifiedEditor();
				const original = editor.getOriginalEditor();
				const update = () => {
					const h = Math.max(
						modified.getContentHeight(),
						original.getContentHeight(),
					);
					// Monaco returns 0 before first layout; ignore so the
					// initial estimate stays in place until a real measurement
					// arrives via onDidContentSizeChange.
					if (h > 0) setHeight(h);
				};
				update();
				sizeDisposablesRef.current.push(
					modified.onDidContentSizeChange(update),
					original.onDidContentSizeChange(update),
				);
				onEditorMount?.(file.path, editor);
			}}
		/>
	);
}

// Per-file diff cache state. Keyed by `${sha}|${path}` so a different commit's
// fetch can't accidentally hit stale data when the user navigates around.
type DiffCacheState =
	| { kind: "idle" }
	| { kind: "loading" }
	| { kind: "ready"; diff: GitCommitFileDiff }
	| { kind: "error"; message: string };

export function CommitDiffStack({
	workspaceId,
	worktreeId,
	detail,
	focusedPath,
	resolvedTheme,
	onEditorMount,
	onEditorUnmount,
}: Props) {
	const singleFile = detail.files.length === 1;
	// Expanded set is opt-in (collapsed by default). The single-file case and
	// the focused path are auto-expanded on mount and on focus change.
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
		const next = new Set<string>();
		if (singleFile) next.add(detail.files[0]!.path);
		if (focusedPath) next.add(focusedPath);
		return next;
	});
	const [diffByPath, setDiffByPath] = useState<Record<string, DiffCacheState>>(
		{},
	);
	const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
	// Tracks which cache keys we've already kicked an IPC for. Synchronous —
	// avoids relying on a setState updater running before we read its side
	// effect (React 18 may defer the updater, which led to double-fired
	// "loading" writes with no follow-up IPC call).
	const inFlightRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		if (focusedPath) {
			setExpandedPaths((prev) => {
				if (prev.has(focusedPath)) return prev;
				const next = new Set(prev);
				next.add(focusedPath);
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

	// Kick a lazy fetch for each expanded path that hasn't been fetched yet.
	// Cache key includes the commit sha so revisiting the same path on a
	// different commit re-fetches. The "have we already started?" check lives
	// inside a functional `setDiffByPath` so it stays correct even when the
	// effect re-runs without depending on `diffByPath` in the deps array.
	// Deliberately no per-effect-run cancellation: under StrictMode (and any
	// re-render that changes `expandedPaths`) the cleanup would cancel the
	// in-flight promise we just launched, while the re-run would skip launching
	// a fresh one because the cache is already at "loading" — leaving the
	// section stuck on "Loading diff…" forever. Setting state after unmount is
	// a benign React 18 warning that we accept here.
	useEffect(() => {
		for (const path of expandedPaths) {
			const key = `${detail.sha}|${path}`;
			const fileEntry = detail.files.find((f) => f.path === path);
			if (!fileEntry) continue;
			if (inFlightRef.current.has(key)) continue;
			inFlightRef.current.add(key);
			setDiffByPath((prev) =>
				prev[key] ? prev : { ...prev, [key]: { kind: "loading" } },
			);
			void git
				.readCommitFileDiff(workspaceId, worktreeId, detail.sha, fileEntry)
				.then((diff) => {
					setDiffByPath((prev) => ({
						...prev,
						[key]: { kind: "ready", diff },
					}));
				})
				.catch((err: unknown) => {
					setDiffByPath((prev) => ({
						...prev,
						[key]: {
							kind: "error",
							message:
								err instanceof Error ? err.message : "Couldn't load diff.",
						},
					}));
				});
		}
	}, [expandedPaths, detail.sha, detail.files, workspaceId, worktreeId]);

	return (
		<div
			className="shell-commit-diff-stack"
			data-single-file={String(singleFile)}
			data-readonly-editor="true"
		>
			<div className="shell-viewer__header">
				<div className="shell-viewer__title">{detail.subject}</div>
				<div className="shell-viewer__meta">{detail.shortSha}</div>
			</div>
			<div className="shell-commit-diff-stack__body">
				{detail.files.map((file) => {
					const expanded = expandedPaths.has(file.path);
					const cacheKey = `${detail.sha}|${file.path}`;
					const cache = diffByPath[cacheKey] ?? { kind: "idle" };
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
									setExpandedPaths((prev) => {
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
							{expanded && cache.kind === "loading" && (
								<p className="shell-empty-state">Loading diff…</p>
							)}
							{expanded && cache.kind === "error" && (
								<p className="shell-error">{cache.message}</p>
							)}
							{expanded && cache.kind === "ready" && (
								<DiffEditorSlot
									file={cache.diff}
									singleFile={singleFile}
									resolvedTheme={resolvedTheme}
									onEditorMount={onEditorMount}
									onEditorUnmount={onEditorUnmount}
								/>
							)}
						</section>
					);
				})}
			</div>
		</div>
	);
}
