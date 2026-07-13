import { isImagePath } from "../../../../shared/files/image-files";

export type ViewerMode = "markdown" | "image" | "source";

export function resolveViewerMode(relativePath: string): ViewerMode {
	if (relativePath.toLowerCase().endsWith(".md")) return "markdown";
	if (isImagePath(relativePath)) return "image";
	return "source";
}
