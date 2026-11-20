import { useEffect, useState, useCallback } from 'react'
import { api, type DeletionLog } from '../api-client'
import { Skeleton } from '../components/Skeleton'

export default function LogsPage() {
  const [logs, setLogs] = useState<DeletionLog[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const limit = 50

  const load = useCallback(() => {
    setLoading(true)
    api
      .getLogs({ search: search || undefined, limit, offset: page * limit })
      .then((r) => {
        setLogs(r.logs)
        setTotal(r.total)
      })
      .finally(() => setLoading(false))
  }, [search, page])

  useEffect(() => { load() }, [load])

  function fmt(dt: string) {
    try {
      const d = new Date(dt)
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    } catch {
      return dt
    }
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Deletion Logs</h2>
          <p className="text-muted text-xs mt-0.5">Audit trail of every message permanently expunged</p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input
            className="input w-full sm:w-64"
            placeholder="Search sender, subject, filter…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
          />
          <span className="text-muted text-xs whitespace-nowrap bg-surface px-2.5 py-1.5 rounded border border-border">
            {total} total
          </span>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="card p-3.5 space-y-2">
              <div className="flex justify-between items-center">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="card text-center text-muted text-sm py-12">
          {search ? 'No logs matching your query.' : 'No emails deleted yet. Active filters will record deletions here.'}
        </div>
      ) : (
        <div className="space-y-2.5">
          {logs.map((l) => (
            <div
              key={l.id}
              className="card p-3.5 transition-colors hover:border-border/80 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                <span className="text-muted font-mono">{fmt(l.deleted_at)}</span>
                {l.filter_name ? (
                  <span className="badge-accent text-[11px] font-medium">
                    Filter: {l.filter_name}
                  </span>
                ) : (
                  <span className="badge-gray text-[11px]">Manual / Unnamed</span>
                )}
              </div>

              <div className="text-sm font-medium text-gray-200 truncate" title={l.subject}>
                {l.subject || <span className="text-muted italic">(No subject)</span>}
              </div>

              <div className="flex items-center gap-2 text-xs text-muted truncate">
                <span>From:</span>
                <span className="text-gray-300 font-mono truncate" title={l.from_addr}>
                  {l.from_addr ?? '—'}
                </span>
              </div>
            </div>
          ))}

          {/* Pagination */}
          {total > limit && (
            <div className="card p-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted">
              <span>Page {page + 1} of {Math.ceil(total / limit)}</span>
              <div className="flex gap-2">
                <button
                  className="btn-ghost text-xs px-3 py-1"
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                >
                  ← Prev
                </button>
                <button
                  className="btn-ghost text-xs px-3 py-1"
                  disabled={(page + 1) * limit >= total}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
