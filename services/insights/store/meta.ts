import type Database from "better-sqlite3";

export function getMeta(db: Database.Database, key: string): string | null {
	const row = db.prepare("SELECT value FROM meta WHERE key=?").get(key) as
		| { value: string }
		| undefined;
	return row?.value ?? null;
}

export function setMetaOnce(
	db: Database.Database,
	key: string,
	value: string,
): boolean {
	const info = db
		.prepare(
			"INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING",
		)
		.run(key, value);
	return info.changes > 0;
}
