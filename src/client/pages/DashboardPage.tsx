import { useEffect, useState } from 'react'
import { api, type AccountSummary } from '../api-client'
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

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.dashboard()
      .then((d) => {
        setStats(d.stats)
        setAccounts(d.accounts)
      })
      .finally(() => setLoading(false))

    const id = setInterval(() => {
      api.dashboard().then((d) => {
        setStats(d.stats)
        setAccounts(d.accounts)
      })
    }, 10_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold">Dashboard</h2>
        <p className="text-muted text-xs mt-0.5">Live mailbox watcher overview and activity stats</p>
      </div>

      {/* Unified Stats Overview: 3 numbers inside ONE single first card */}
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
              <div className="text-2xl sm:text-3xl font-bold text-accent">
                {stats?.today ?? 0}
              </div>
              <div className="text-muted text-[11px] sm:text-xs mt-1 font-medium">Deleted today</div>
            </div>
            <div className="text-center px-2 sm:px-4">
              <div className="text-2xl sm:text-3xl font-bold text-accent">
                {stats?.this_week ?? 0}
              </div>
              <div className="text-muted text-[11px] sm:text-xs mt-1 font-medium">This week</div>
            </div>
            <div className="text-center px-2 sm:px-4">
              <div className="text-2xl sm:text-3xl font-bold text-accent">
                {stats?.total ?? 0}
              </div>
              <div className="text-muted text-[11px] sm:text-xs mt-1 font-medium">All time</div>
            </div>
          </div>
        )}
      </div>

      {/* Account Status as Card Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
            Active Inboxes ({accounts.length})
          </h3>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : accounts.length === 0 ? (
          <div className="card text-center text-muted text-sm py-10">
            No accounts configured yet. Go to <span className="text-accent font-medium">Accounts</span> to add one.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {accounts.map((a) => (
              <div key={a.id} className="card p-3.5 space-y-2 hover:border-border/80 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm text-gray-100 truncate">{a.label}</span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <StatusBadge status={a.status} />
                    {!a.enabled && <span className="badge-gray text-xs">disabled</span>}
                  </div>
                </div>
                <div className="text-xs text-muted font-mono truncate" title={a.email}>
                  {a.email}
                </div>
                {a.status_msg && (
                  <div className="text-danger text-[11px] truncate pt-1" title={a.status_msg}>
                    ⚠ {a.status_msg}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
