import { useEffect, useState } from 'react'
import { api, type AccountSummary, type AccountMailStats } from '../api-client'
import { Skeleton, CardSkeleton } from '../components/Skeleton'

type Stats = { today: number; this_week: number; total: number }

function StatusBadge({ status }: { status: AccountSummary['status'] }) {
  const map: Record<string, string> = {
    connected: 'badge-green',
    connecting: 'badge-yellow',
    error: 'badge-red',
    disconnected: 'badge-gray',
  }
  return <span className={map[status] ?? 'badge-gray'}>{status}</span>
}

function StatCell({ value, label, color }: { value: number; label: string; color?: string }) {
  return (
    <div className="text-center px-2 sm:px-3">
      <div className={`text-xl sm:text-2xl font-bold ${color ?? 'text-accent'}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-muted text-[10px] sm:text-xs mt-0.5 font-medium leading-tight">{label}</div>
    </div>
  )
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [mailStats, setMailStats] = useState<AccountMailStats[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = () => {
    return Promise.all([
      api.dashboard().then((d) => {
        setStats(d.stats)
        setAccounts(d.accounts)
      }),
      api.getAccountStats().then(setMailStats).catch(() => {}),
    ])
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
    const id = setInterval(() => { void refresh() }, 10_000)
    return () => clearInterval(id)
  }, [])

  const mailStatsMap = new Map(mailStats.map((s) => [s.account_id, s]))

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold">Dashboard</h2>
        <p className="text-muted text-xs mt-0.5">Live mailbox watcher overview and activity stats</p>
      </div>

      {/* Deletion counters (all-time DB stats) */}
      <div className="card p-5">
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-4">
          Deletions Overview
        </h3>
        {loading ? (
          <div className="grid grid-cols-3 divide-x divide-border">
            {[1, 2, 3].map((i) => (
              <div key={i} className="px-3 text-center space-y-2">
                <Skeleton className="h-8 w-16 mx-auto" />
                <Skeleton className="h-3 w-20 mx-auto" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 divide-x divide-border">
            <div className="text-center px-2 sm:px-4">
              <div className="text-2xl sm:text-3xl font-bold text-accent">{stats?.today ?? 0}</div>
              <div className="text-muted text-[11px] sm:text-xs mt-1 font-medium">Deleted today</div>
            </div>
            <div className="text-center px-2 sm:px-4">
              <div className="text-2xl sm:text-3xl font-bold text-accent">{stats?.this_week ?? 0}</div>
              <div className="text-muted text-[11px] sm:text-xs mt-1 font-medium">This week</div>
            </div>
            <div className="text-center px-2 sm:px-4">
              <div className="text-2xl sm:text-3xl font-bold text-accent">{stats?.total ?? 0}</div>
              <div className="text-muted text-[11px] sm:text-xs mt-1 font-medium">All time</div>
            </div>
          </div>
        )}
      </div>

      {/* Account Status + Live Mailbox Stats */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
            Active Inboxes ({accounts.length})
          </h3>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-3">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : accounts.length === 0 ? (
          <div className="card text-center text-muted text-sm py-10">
            No accounts configured yet. Go to <span className="text-accent font-medium">Accounts</span> to add one.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {accounts.map((a) => {
              const ms = mailStatsMap.get(a.id)
              return (
                <div key={a.id} className="card p-4 space-y-3 hover:border-border/80 transition-colors">
                  {/* Header row */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-semibold text-sm text-gray-100 truncate block">{a.label}</span>
                      <span className="text-xs text-muted font-mono truncate block" title={a.email}>{a.email}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <StatusBadge status={a.status} />
                      {!a.enabled && <span className="badge-gray text-xs">disabled</span>}
                    </div>
                  </div>

                  {/* Live mailbox stats grid */}
                  {ms ? (
                    <div className="rounded bg-background border border-border/60 py-3">
                      <div className="grid grid-cols-4 divide-x divide-border/60">
                        <StatCell value={ms.inbox_total} label="Inbox total" color="text-gray-300" />
                        <StatCell value={ms.scanned} label="Scanned" color="text-blue-400" />
                        <StatCell value={ms.deleted} label="Deleted" color="text-red-400" />
                        <StatCell value={ms.skipped} label="Skipped" color="text-yellow-400" />
                      </div>
                      {ms.last_scan_at && (
                        <div className="text-center text-muted text-[10px] mt-2 px-3">
                          Last scan: {new Date(ms.last_scan_at).toLocaleString()}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded bg-background border border-border/60 py-3 text-center text-muted text-xs">
                      {a.status === 'connected' ? 'Waiting for first scan…' : 'Watcher not running'}
                    </div>
                  )}

                  {/* Status / error banner */}
                  {a.status === 'error' && (
                    <div className="rounded bg-red-950/50 border border-red-800/60 px-3 py-2 text-xs text-red-300 flex items-start gap-2">
                      <span className="flex-shrink-0 mt-0.5">⚠</span>
                      <span>{a.status_msg ?? 'IMAP connection error'}</span>
                    </div>
                  )}
                  {a.status === 'connecting' && (
                    <div className="rounded bg-yellow-950/40 border border-yellow-800/50 px-3 py-2 text-xs text-yellow-300">
                      ⟳ Connecting…
                    </div>
                  )}
                  {a.status === 'disconnected' && a.enabled && (
                    <div className="rounded bg-gray-800/60 border border-border px-3 py-2 text-xs text-muted">
                      Disconnected — will reconnect automatically
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
