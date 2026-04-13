const ANSI_ESCAPE_RE = /\u001B(?:\][^\u0007\u001B]*(?:\u0007|\u001B\\)|[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const PREVIEW_MAX_LENGTH = 47;
const BUFFER_MAX_LENGTH = 240;

export type OutputPreviewUpdate = {
	nextBuffer: string;
	preview: string | undefined;
};

function truncatePreview(value: string): string {
	if (value.length <= PREVIEW_MAX_LENGTH) return value;
	return `${value.slice(0, PREVIEW_MAX_LENGTH - 3)}...`;
}

function normalizeVisibleLine(line: string): string | null {
	const normalized = line
		.replace(ANSI_ESCAPE_RE, "")
		.replace(/\s+/g, " ")
		.trim();
	if (!normalized) return null;
	if (!/[A-Za-z0-9]/.test(normalized)) return null;
	return truncatePreview(normalized);
}

export function consumeOutputPreview(
	buffer: string,
	chunk: string,
): OutputPreviewUpdate {
	const combined = `${buffer}${chunk}`;
	const segments = combined.split(/\r\n|[\n\r]/);
	const nextBuffer = (segments.pop() ?? "").slice(-BUFFER_MAX_LENGTH);
	const preview = segments
		.map(normalizeVisibleLine)
		.filter((line): line is string => line !== null)
		.at(-1);

	return {
		nextBuffer,
		preview,
	};
}
