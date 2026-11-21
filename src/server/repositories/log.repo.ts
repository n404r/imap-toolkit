import { getDb } from '../db/connection.js'
import type { DeletionLog } from '../types.js'

function rowToLog(row: Record<string, unknown>): DeletionLog {
  return {
    id: Number(row['id']),
    account_id: Number(row['account_id']),
    filter_id: row['filter_id'] != null ? Number(row['filter_id']) : undefined,
    filter_name: row['filter_name'] != null ? String(row['filter_name']) : undefined,
    from_addr: row['from_addr'] != null ? String(row['from_addr']) : undefined,
    subject: row['subject'] != null ? String(row['subject']) : undefined,
    message_id: row['message_id'] != null ? String(row['message_id']) : undefined,
    deleted_at: String(row['deleted_at']),
  }
}

export const logRepo = {
  async create(data: {
    account_id: number
    filter_id?: number
    filter_name?: string
    from_addr?: string
    subject?: string
    message_id?: string
  }): Promise<DeletionLog> {
    const db = getDb()
    const result = await db.execute({
      sql: `INSERT INTO deletion_logs (account_id, filter_id, filter_name, from_addr, subject, message_id)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        data.account_id,
        data.filter_id ?? null,
        data.filter_name ?? null,
        data.from_addr ?? null,
        data.subject ?? null,
        data.message_id ?? null,
      ],
    })
    return (await this.findById(Number(result.lastInsertRowid)))!
  },

  async findById(id: number): Promise<DeletionLog | undefined> {
    const db = getDb()
    const res = await db.execute({ sql: 'SELECT * FROM deletion_logs WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToLog(res.rows[0] as Record<string, unknown>) : undefined
  },

  async findAll(opts: {
    account_id?: number
    search?: string
    limit?: number
    offset?: number
  }): Promise<{ logs: DeletionLog[]; total: number }> {
    const db = getDb()
    const wheres: string[] = []
    const params: any[] = []

    if (opts.account_id !== undefined) {
      wheres.push('account_id = ?')
      params.push(opts.account_id)
    }
    if (opts.search) {
      const like = `%${opts.search}%`
      wheres.push('(from_addr LIKE ? OR subject LIKE ? OR filter_name LIKE ?)')
      params.push(like, like, like)
    }

    const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : ''
    const limit = opts.limit ?? 50
    const offset = opts.offset ?? 0

    const countRes = await db.execute({
      sql: `SELECT COUNT(*) as count FROM deletion_logs ${where}`,
      args: params,
    })
    const total = Number(countRes.rows[0]?.['count'] ?? 0)

    const rowsRes = await db.execute({
      sql: `SELECT * FROM deletion_logs ${where} ORDER BY deleted_at DESC LIMIT ? OFFSET ?`,
      args: [...params, limit, offset],
    })

    return { logs: rowsRes.rows.map((r) => rowToLog(r as Record<string, unknown>)), total }
  },

  async stats(): Promise<{ today: number; this_week: number; total: number }> {
    const db = getDb()
    const [todayRes, weekRes, totalRes] = await Promise.all([
      db.execute(`SELECT COUNT(*) as count FROM deletion_logs WHERE date(deleted_at) = date('now')`),
      db.execute(`SELECT COUNT(*) as count FROM deletion_logs WHERE deleted_at >= datetime('now', '-7 days')`),
      db.execute(`SELECT COUNT(*) as count FROM deletion_logs`),
    ])
    return {
      today: Number(todayRes.rows[0]?.['count'] ?? 0),
      this_week: Number(weekRes.rows[0]?.['count'] ?? 0),
      total: Number(totalRes.rows[0]?.['count'] ?? 0),
    }
  },
}
