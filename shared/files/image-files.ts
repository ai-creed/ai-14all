export const IMAGE_MIME_BY_EXT: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".svg": "image/svg+xml",
	".bmp": "image/bmp",
	".ico": "image/x-icon",
};

export function isImagePath(path: string): boolean {
	const dot = path.lastIndexOf(".");
	if (dot < 0) return false;
	return path.slice(dot).toLowerCase() in IMAGE_MIME_BY_EXT;
}
