import { getDb } from '../db/connection.js'
import type { Account } from '../types.js'
import { encrypt, decrypt } from '../lib/crypto.js'

type AccountRow = {
  id: number | bigint
  label: string
  email: string
  imap_host: string
  imap_port: number | bigint
  imap_secure: number | bigint
  password_enc: string
  enabled: number | bigint
  status: string
  status_msg: string | null
  created_at: string
  updated_at: string
}

function rowToAccount(row: Record<string, unknown>): Account {
  const r = row as AccountRow
  return {
    id: Number(r.id),
    label: String(r.label),
    email: String(r.email),
    imap_host: String(r.imap_host),
    imap_port: Number(r.imap_port),
    imap_secure: Number(r.imap_secure) === 1,
    password_enc: String(r.password_enc),
    enabled: Number(r.enabled) === 1,
    status: String(r.status) as Account['status'],
    status_msg: r.status_msg ? String(r.status_msg) : undefined,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  }
}

export const accountRepo = {
  async findAll(): Promise<Account[]> {
    const db = getDb()
    const res = await db.execute('SELECT * FROM accounts ORDER BY created_at DESC')
    return res.rows.map(rowToAccount)
  },

  async findById(id: number): Promise<Account | undefined> {
    const db = getDb()
    const res = await db.execute({ sql: 'SELECT * FROM accounts WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToAccount(res.rows[0]) : undefined
  },

  async create(data: {
    label: string
    email: string
    imap_host: string
    imap_port: number
    imap_secure: boolean
    password: string
  }): Promise<Account> {
    const db = getDb()
    const password_enc = encrypt(data.password)
    const result = await db.execute({
      sql: `INSERT INTO accounts (label, email, imap_host, imap_port, imap_secure, password_enc)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [data.label, data.email, data.imap_host, data.imap_port, data.imap_secure ? 1 : 0, password_enc],
    })
    return (await this.findById(Number(result.lastInsertRowid)))!
  },

  async update(
    id: number,
    data: Partial<{
      label: string
      email: string
      imap_host: string
      imap_port: number
      imap_secure: boolean
      password: string
      enabled: boolean
    }>
  ): Promise<Account | undefined> {
    const db = getDb()
    const fields: string[] = []
    const values: any[] = []

    if (data.label !== undefined) { fields.push('label = ?'); values.push(data.label) }
    if (data.email !== undefined) { fields.push('email = ?'); values.push(data.email) }
    if (data.imap_host !== undefined) { fields.push('imap_host = ?'); values.push(data.imap_host) }
    if (data.imap_port !== undefined) { fields.push('imap_port = ?'); values.push(data.imap_port) }
    if (data.imap_secure !== undefined) { fields.push('imap_secure = ?'); values.push(data.imap_secure ? 1 : 0) }
    if (data.password !== undefined) { fields.push('password_enc = ?'); values.push(encrypt(data.password)) }
    if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0) }

    if (fields.length === 0) return this.findById(id)

    fields.push("updated_at = datetime('now')")
    values.push(id)

    await db.execute({ sql: `UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`, args: values })
    return this.findById(id)
  },

  async updateStatus(id: number, status: Account['status'], msg?: string): Promise<void> {
    const db = getDb()
    await db.execute({
      sql: `UPDATE accounts SET status = ?, status_msg = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [status, msg ?? null, id],
    })
  },

  async delete(id: number): Promise<boolean> {
    const db = getDb()
    const result = await db.execute({ sql: 'DELETE FROM accounts WHERE id = ?', args: [id] })
    return (result.rowsAffected ?? 0) > 0
  },

  getPassword(account: Account): string {
    return decrypt(account.password_enc)
  },
}
