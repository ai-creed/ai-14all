const STABLE_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export function isStableVersion(value: string): boolean {
	return STABLE_PATTERN.test(value);
}

export function compareStableVersions(a: string, b: string): number {
	const parsedA = parse(a);
	const parsedB = parse(b);
	if (parsedA[0] !== parsedB[0]) return parsedA[0] - parsedB[0];
	if (parsedA[1] !== parsedB[1]) return parsedA[1] - parsedB[1];
	return parsedA[2] - parsedB[2];
}

function parse(value: string): [number, number, number] {
	const match = STABLE_PATTERN.exec(value);
	if (!match) {
		throw new Error(`not a stable version: ${value}`);
	}
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}
