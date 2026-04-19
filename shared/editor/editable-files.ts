const BASENAMES = new Set<string>([
	".gitignore",
	".gitattributes",
	".editorconfig",
	".prettierrc",
	".prettierignore",
	".eslintignore",
	".npmrc",
	".nvmrc",
	".dockerignore",
	"Dockerfile",
	"Makefile",
	"LICENSE",
	"README",
]);

const EXTENSIONS = new Set<string>([
	".md",
	".txt",
	".json",
	".yml",
	".yaml",
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".css",
	".scss",
	".html",
	".sh",
	".py",
	".toml",
	".env",
	".ini",
	".conf",
	".xml",
	".lock",
]);

export function isEditable(basename: string): boolean {
	if (!basename) return false;
	if (BASENAMES.has(basename)) return true;
	const dot = basename.lastIndexOf(".");
	if (dot < 0) return false;
	const ext = basename.slice(dot).toLowerCase();
	return EXTENSIONS.has(ext);
}
