// Mirror of schema.sql, inlined so the schema works under both Electron's
// runtime bundler and vitest's jsdom env without filesystem reads.
// Keep this string in sync with electron/code-nav/ingest/schema.sql.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS functions (
  id INTEGER PRIMARY KEY,
  qualified_name TEXT NOT NULL,
  bare_name TEXT NOT NULL,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  exported INTEGER NOT NULL,
  is_default INTEGER NOT NULL,
  is_declaration_only INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_functions_bare_name ON functions(bare_name);
CREATE INDEX IF NOT EXISTS idx_functions_qualified_name ON functions(qualified_name);
CREATE INDEX IF NOT EXISTS idx_functions_file ON functions(file);

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY,
  from_id INTEGER NOT NULL,
  to_id INTEGER,
  to_bare_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  FOREIGN KEY (from_id) REFERENCES functions(id),
  FOREIGN KEY (to_id)   REFERENCES functions(id)
);
CREATE INDEX IF NOT EXISTS idx_calls_from_id       ON calls(from_id);
CREATE INDEX IF NOT EXISTS idx_calls_to_id         ON calls(to_id);
CREATE INDEX IF NOT EXISTS idx_calls_to_bare_name  ON calls(to_bare_name);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY,
  from_file TEXT NOT NULL,
  to_file TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_imports_from_file ON imports(from_file);
CREATE INDEX IF NOT EXISTS idx_imports_to_file   ON imports(to_file);

CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  content_hash TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS functions_fts USING fts5(
  qualified_name, bare_name, file,
  content='functions', content_rowid='id',
  tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS functions_ai AFTER INSERT ON functions BEGIN
  INSERT INTO functions_fts(rowid, qualified_name, bare_name, file)
    VALUES (new.id, new.qualified_name, new.bare_name, new.file);
END;
CREATE TRIGGER IF NOT EXISTS functions_ad AFTER DELETE ON functions BEGIN
  INSERT INTO functions_fts(functions_fts, rowid, qualified_name, bare_name, file)
    VALUES ('delete', old.id, old.qualified_name, old.bare_name, old.file);
END;
`;
