export interface CortexFunction {
	qualifiedName: string;
	file: string;
	line: number;
	exported?: boolean;
	isDefaultExport?: boolean;
	isDeclarationOnly?: boolean;
}

export interface CortexCall {
	from: string;
	to: string;
	kind: "call" | "new" | "method";
}

export interface CortexImport {
	from: string;
	to: string;
}

export interface CortexFile {
	path: string;
	kind: "file" | "dir";
	contentHash?: string;
}

export interface CortexIndex {
	schemaVersion: number;
	fingerprint: string;
	worktreePath: string;
	repoKey: string;
	worktreeKey: string;
	indexedAt: string;
	dirtyAtIndex?: boolean;
	functions: CortexFunction[];
	calls: CortexCall[];
	imports: CortexImport[];
	files: CortexFile[];
}
