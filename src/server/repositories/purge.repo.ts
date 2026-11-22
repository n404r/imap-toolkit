import { getDb } from '../db/connection.js'
import type { PurgeJob } from '../types.js'

function rowToPurgeJob(row: Record<string, unknown>): PurgeJob {
  return {
    id: Number(row['id']),
    filter_id: Number(row['filter_id']),
    account_id: Number(row['account_id']),
    folder: String(row['folder']),
    status: String(row['status']) as PurgeJob['status'],
    total_msgs: Number(row['total_msgs']),
    scanned_msgs: Number(row['scanned_msgs']),
    deleted_msgs: Number(row['deleted_msgs']),
    error_msg: row['error_msg'] ? String(row['error_msg']) : undefined,
    created_at: String(row['created_at']),
    updated_at: String(row['updated_at']),
  }
}

export const purgeRepo = {
  async create(data: {
    filter_id: number
    account_id: number
    folder: string
    total_msgs?: number
  }): Promise<PurgeJob> {
    const db = getDb()
    const res = await db.execute({
      sql: `INSERT INTO purge_jobs (filter_id, account_id, folder, total_msgs, scanned_msgs, deleted_msgs, status)
            VALUES (?, ?, ?, ?, 0, 0, 'running')`,
      args: [data.filter_id, data.account_id, data.folder, data.total_msgs ?? 0],
    })
    const id = Number(res.lastInsertRowid)
    return (await this.findById(id))!
  },

  async findById(id: number): Promise<PurgeJob | undefined> {
    const db = getDb()
    const res = await db.execute({ sql: 'SELECT * FROM purge_jobs WHERE id = ?', args: [id] })
    return res.rows[0] ? rowToPurgeJob(res.rows[0]) : undefined
  },

  async findByFilter(filter_id: number): Promise<PurgeJob[]> {
    const db = getDb()
    const res = await db.execute({
      sql: 'SELECT * FROM purge_jobs WHERE filter_id = ? ORDER BY created_at DESC LIMIT 10',
      args: [filter_id],
    })
    return res.rows.map(rowToPurgeJob)
  },

  async updateProgress(
    id: number,
    data: {
      scanned_msgs?: number
      deleted_msgs?: number
      total_msgs?: number
      status?: PurgeJob['status']
      error_msg?: string
    }
  ): Promise<void> {
    const db = getDb()
    const fields: string[] = ["updated_at = datetime('now')"]
    const args: any[] = []

    if (data.scanned_msgs !== undefined) {
      fields.push('scanned_msgs = ?')
      args.push(data.scanned_msgs)
    }
    if (data.deleted_msgs !== undefined) {
      fields.push('deleted_msgs = ?')
      args.push(data.deleted_msgs)
    }
    if (data.total_msgs !== undefined) {
      fields.push('total_msgs = ?')
      args.push(data.total_msgs)
    }
    if (data.status !== undefined) {
      fields.push('status = ?')
      args.push(data.status)
    }
    if (data.error_msg !== undefined) {
      fields.push('error_msg = ?')
      args.push(data.error_msg)
    }

    args.push(id)
    await db.execute({
      sql: `UPDATE purge_jobs SET ${fields.join(', ')} WHERE id = ?`,
      args,
    })
  },
}
