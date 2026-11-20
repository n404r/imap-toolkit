import { useEffect, useState, useCallback } from 'react'
import { api, type DeletionLog } from '../api'

export default function LogsPage() {
  const [logs, setLogs] = useState<DeletionLog[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const limit = 50

  const load = useCallback(() => {
    api
      .getLogs({ search: search || undefined, limit, offset: page * limit })
      .then((r) => { setLogs(r.logs); setTotal(r.total) })
  }, [search, page])

  useEffect(() => { load() }, [load])

  function fmt(dt: string) {
    return new Date(dt).toLocaleString()
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Deletion Logs</h2>
        <div className="flex items-center gap-2">
          <input
            className="input w-56"
            placeholder="Search sender, subject, filter…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
          />
          <span className="text-muted text-xs whitespace-nowrap">{total} total</span>
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="card text-center text-muted text-sm py-10">
          {search ? 'No matching logs.' : 'No emails deleted yet.'}
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr className="text-muted text-xs">
                <th className="text-left p-3 font-normal">Time</th>
                <th className="text-left p-3 font-normal">From</th>
                <th className="text-left p-3 font-normal">Subject</th>
                <th className="text-left p-3 font-normal">Filter</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-surface/50">
                  <td className="p-3 text-muted text-xs whitespace-nowrap">{fmt(l.deleted_at)}</td>
                  <td className="p-3 text-gray-300 text-xs max-w-[180px] truncate" title={l.from_addr}>{l.from_addr ?? '—'}</td>
                  <td className="p-3 text-gray-400 text-xs max-w-[240px] truncate" title={l.subject}>{l.subject ?? '—'}</td>
                  <td className="p-3">
                    {l.filter_name ? (
                      <span className="badge-accent text-xs">{l.filter_name}</span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Pagination */}
          {total > limit && (
            <div className="border-t border-border p-3 flex items-center justify-between text-xs text-muted">
              <span>Page {page + 1} of {Math.ceil(total / limit)}</span>
              <div className="flex gap-2">
                <button className="btn-ghost text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
                <button className="btn-ghost text-xs" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>Next →</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
