/** Monaco language id for a file basename. Shared by the viewer and code-nav. */
export function languageForBasename(basename: string): string {
	const lower = basename.toLowerCase();
	if (lower.endsWith(".md")) return "markdown";
	if (lower.endsWith(".json")) return "json";
	if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
	if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
	if (
		lower.endsWith(".js") ||
		lower.endsWith(".jsx") ||
		lower.endsWith(".mjs") ||
		lower.endsWith(".cjs")
	)
		return "javascript";
	if (lower.endsWith(".css") || lower.endsWith(".scss")) return "css";
	if (lower.endsWith(".html")) return "html";
	if (lower.endsWith(".sh")) return "shell";
	if (lower.endsWith(".py")) return "python";
	if (lower.endsWith(".c") || lower.endsWith(".h")) return "c";
	if (
		lower.endsWith(".cpp") ||
		lower.endsWith(".cc") ||
		lower.endsWith(".cxx") ||
		lower.endsWith(".hpp")
	)
		return "cpp";
	if (
		lower.endsWith(".toml") ||
		lower.endsWith(".ini") ||
		lower.endsWith(".conf") ||
		lower.endsWith(".env")
	)
		return "ini";
	if (lower.endsWith(".xml")) return "xml";
	return "plaintext";
}
