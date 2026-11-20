import { getDb } from './connection.js'

const MIGRATIONS: { id: number; statements: string[] }[] = [
  {
    id: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS accounts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        label       TEXT    NOT NULL,
        email       TEXT    NOT NULL UNIQUE,
        imap_host   TEXT    NOT NULL,
        imap_port   INTEGER NOT NULL DEFAULT 993,
        imap_secure INTEGER NOT NULL DEFAULT 1,
        password_enc TEXT   NOT NULL,
        enabled     INTEGER NOT NULL DEFAULT 1,
        status      TEXT    NOT NULL DEFAULT 'disconnected',
        status_msg  TEXT,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS filters (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        enabled     INTEGER NOT NULL DEFAULT 1,
        logic       TEXT    NOT NULL DEFAULT 'AND',
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS filter_conditions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        filter_id   INTEGER NOT NULL REFERENCES filters(id) ON DELETE CASCADE,
        field       TEXT    NOT NULL,
        match_type  TEXT    NOT NULL,
        condition_values TEXT NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS deletion_logs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        filter_id   INTEGER REFERENCES filters(id) ON DELETE SET NULL,
        filter_name TEXT,
        from_addr   TEXT,
        subject     TEXT,
        message_id  TEXT,
        deleted_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS admin_settings (
        id            INTEGER PRIMARY KEY DEFAULT 1,
        password_hash TEXT    NOT NULL,
        password_salt TEXT    NOT NULL,
        updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        applied_at TEXT    NOT NULL DEFAULT (datetime('now'))
      )`,
    ],
  },
]

export async function runMigrations(): Promise<void> {
  const db = getDb()

  // Enable WAL and foreign keys
  await db.execute('PRAGMA journal_mode=WAL')
  await db.execute('PRAGMA foreign_keys=ON')

  // Ensure migrations table exists
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const result = await db.execute('SELECT version FROM schema_migrations ORDER BY version')
  const applied = new Set(result.rows.map((r) => Number(r.version)))

  for (const migration of MIGRATIONS) {
    if (!applied.has(migration.id)) {
      for (const sql of migration.statements) {
        await db.execute(sql)
      }
      await db.execute({
        sql: 'INSERT INTO schema_migrations (version) VALUES (?)',
        args: [migration.id],
      })
      console.log(`✅ Migration ${migration.id} applied`)
    }
  }
}
