export type FileView = {
	path: string;
	content: string;
	language: string;
};

export type FileReadFailure =
	| { kind: "too-large"; size: number }
	| { kind: "binary" }
	| { kind: "not-found" }
	| { kind: "read-failed" }
	| { kind: "path-escape" }
	| { kind: "permission-denied" };

export type FileReadResult =
	| { ok: true; view: FileView }
	| { ok: false; path: string; reason: FileReadFailure };
