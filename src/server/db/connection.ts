import { createClient, type Client } from '@libsql/client'
import path from 'path'
import fs from 'fs'
import { env } from '../env.js'

let _db: Client | null = null

/** Singleton libsql client instance (local SQLite file). */
export function getDb(): Client {
  if (!_db) {
    const dbPath = path.resolve(env.DB_PATH)
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    _db = createClient({ url: `file:${dbPath}` })
  }
  return _db
}
