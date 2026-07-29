import type Database from "better-sqlite3";
import { utcDay } from "./store/time.js";

export const OBSERVATION_RETENTION_DAYS = 365;

export function pruneRetention(
	db: Database.Database,
	nowMs: number,
	retentionDays = OBSERVATION_RETENTION_DAYS,
): void {
	const todayStart = Date.parse(`${utcDay(nowMs)}T00:00:00.000Z`);
	const cutoffMs = todayStart - retentionDays * 86_400_000; // UTC-day-aligned cutoff
	const cutoffDay = utcDay(cutoffMs);
	const tx = db.transaction(() => {
		db.prepare("DELETE FROM observations WHERE event_ts < ?").run(cutoffMs);
		db.prepare("DELETE FROM coverage WHERE day < ?").run(cutoffDay);
	});
	tx();
}
