import type Database from "better-sqlite3";

export type Completeness = "complete" | "partial" | "unknown";

export function markCoverage(
	db: Database.Database,
	{
		source,
		provider = "n/a",
		day,
		complete,
	}: { source: string; provider?: string; day: string; complete: boolean },
): void {
	db.prepare(
		`INSERT INTO coverage(source,provider,day,complete) VALUES(?,?,?,?)
     ON CONFLICT(source,provider,day) DO UPDATE SET complete=excluded.complete`,
	).run(source, provider, day, complete ? 1 : 0);
}

export function getCompleteness(
	db: Database.Database,
	source: string,
	days: string[],
): Completeness {
	if (days.length === 0) return "unknown";
	const rows = db
		.prepare(
			`SELECT day, complete FROM coverage WHERE source=? AND provider='n/a' AND day IN (${days.map(() => "?").join(",")})`,
		)
		.all(source, ...days) as { day: string; complete: number }[];
	const complete = new Set(
		rows.filter((r) => r.complete === 1).map((r) => r.day),
	);
	const have = days.filter((d) => complete.has(d)).length;
	if (have === 0) return "unknown";
	return have === days.length ? "complete" : "partial";
}
