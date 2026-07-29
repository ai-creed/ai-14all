export function utcDay(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

export function utcDaysInRange(fromMs: number, toMs: number): string[] {
	const days: string[] = [];
	const DAY = 86_400_000;
	let d = Date.UTC(
		...(new Date(fromMs).toISOString().slice(0, 10).split("-").map(Number) as [
			number,
			number,
			number,
		]),
	);
	// Normalize start-of-day for fromMs:
	d = Date.parse(`${utcDay(fromMs)}T00:00:00.000Z`);
	const end = toMs; // half-open
	for (; d < end; d += DAY) days.push(utcDay(d));
	return days.length ? days : [utcDay(fromMs)];
}
