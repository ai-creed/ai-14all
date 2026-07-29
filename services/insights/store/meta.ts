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

/** Upsert a meta value (overwrites on conflict). Contrast `setMetaOnce`, which
 * no-ops when the key already exists. */
export function setMeta(
	db: Database.Database,
	key: string,
	value: string,
): void {
	db.prepare(
		"INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
	).run(key, value);
}
