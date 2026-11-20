import { getDb } from '../db/connection.js'
import type { Filter, FilterCondition, FilterLogic } from '../types.js'

function rowToCondition(row: Record<string, unknown>): FilterCondition {
  return {
    id: Number(row['id']),
    filter_id: Number(row['filter_id']),
    field: String(row['field']) as FilterCondition['field'],
    match_type: String(row['match_type']) as FilterCondition['match_type'],
    values: JSON.parse(String(row['condition_values'])) as string[],
  }
}

async function attachConditions(
  filterRows: Record<string, unknown>[]
): Promise<Filter[]> {
  if (filterRows.length === 0) return []
  const db = getDb()
  const ids = filterRows.map((f) => Number(f['id']))
  const placeholders = ids.map(() => '?').join(',')
  const condRes = await db.execute({
    sql: `SELECT * FROM filter_conditions WHERE filter_id IN (${placeholders}) ORDER BY id`,
    args: ids,
  })

  const condMap = new Map<number, FilterCondition[]>()
  for (const row of condRes.rows) {
    const fid = Number(row['filter_id'])
    const list = condMap.get(fid) ?? []
    list.push(rowToCondition(row))
    condMap.set(fid, list)
  }

  return filterRows.map((f) => ({
    id: Number(f['id']),
    name: String(f['name']),
    enabled: Number(f['enabled']) === 1,
    logic: String(f['logic']) as FilterLogic,
    conditions: condMap.get(Number(f['id'])) ?? [],
    created_at: String(f['created_at']),
    updated_at: String(f['updated_at']),
  }))
}

export const filterRepo = {
  async findAll(): Promise<Filter[]> {
    const db = getDb()
    const res = await db.execute('SELECT * FROM filters ORDER BY created_at DESC')
    return attachConditions(res.rows as Record<string, unknown>[])
  },

  async findById(id: number): Promise<Filter | undefined> {
    const db = getDb()
    const res = await db.execute({ sql: 'SELECT * FROM filters WHERE id = ?', args: [id] })
    if (!res.rows[0]) return undefined
    const filters = await attachConditions([res.rows[0] as Record<string, unknown>])
    return filters[0]
  },

  async findEnabled(): Promise<Filter[]> {
    const db = getDb()
    const res = await db.execute('SELECT * FROM filters WHERE enabled = 1 ORDER BY id')
    return attachConditions(res.rows as Record<string, unknown>[])
  },

  async create(data: {
    name: string
    logic: FilterLogic
    conditions: Array<{
      field: FilterCondition['field']
      match_type: FilterCondition['match_type']
      values: string[]
    }>
  }): Promise<Filter> {
    const db = getDb()
    const r = await db.execute({ sql: 'INSERT INTO filters (name, logic) VALUES (?, ?)', args: [data.name, data.logic] })
    const filterId = Number(r.lastInsertRowid)
    for (const c of data.conditions) {
      await db.execute({
        sql: 'INSERT INTO filter_conditions (filter_id, field, match_type, condition_values) VALUES (?, ?, ?, ?)',
        args: [filterId, c.field, c.match_type, JSON.stringify(c.values)],
      })
    }
    return (await this.findById(filterId))!
  },

  async update(
    id: number,
    data: Partial<{ name: string; enabled: boolean; logic: FilterLogic }> & {
      conditions?: Array<{
        field: FilterCondition['field']
        match_type: FilterCondition['match_type']
        values: string[]
      }>
    }
  ): Promise<Filter | undefined> {
    const db = getDb()
    const fields: string[] = []
    const values: unknown[] = []

    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
    if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0) }
    if (data.logic !== undefined) { fields.push('logic = ?'); values.push(data.logic) }

    if (fields.length > 0) {
      fields.push("updated_at = datetime('now')")
      values.push(id)
      await db.execute({ sql: `UPDATE filters SET ${fields.join(', ')} WHERE id = ?`, args: values })
    }
    if (data.conditions !== undefined) {
      await db.execute({ sql: 'DELETE FROM filter_conditions WHERE filter_id = ?', args: [id] })
      for (const c of data.conditions) {
        await db.execute({
          sql: 'INSERT INTO filter_conditions (filter_id, field, match_type, condition_values) VALUES (?, ?, ?, ?)',
          args: [id, c.field, c.match_type, JSON.stringify(c.values)],
        })
      }
    }
    return this.findById(id)
  },

  async delete(id: number): Promise<boolean> {
    const db = getDb()
    const result = await db.execute({ sql: 'DELETE FROM filters WHERE id = ?', args: [id] })
    return (result.rowsAffected ?? 0) > 0
  },
}
