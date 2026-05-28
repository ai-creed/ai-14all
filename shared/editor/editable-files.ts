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

// Dotenv variants like `.env.local`, `.env.production`, `.env.test` would
// otherwise be treated as having extension `.local` / `.production` / etc.
// Match the family explicitly so every `.env*` flavour is editable.
function isDotenvFamily(basename: string): boolean {
	return basename === ".env" || basename.startsWith(".env.");
}

export function isEditable(basename: string): boolean {
	if (!basename) return false;
	if (BASENAMES.has(basename)) return true;
	if (isDotenvFamily(basename)) return true;
	const dot = basename.lastIndexOf(".");
	if (dot < 0) return false;
	const ext = basename.slice(dot).toLowerCase();
	return EXTENSIONS.has(ext);
}
