import { useEffect, useState } from 'react'
import { api, type AccountSummary } from '../api'

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

  useEffect(() => {
    api.dashboard().then((d) => {
      setStats(d.stats)
      setAccounts(d.accounts)
    })
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
      <h2 className="text-lg font-semibold">Dashboard</h2>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Deleted today', value: stats?.today },
          { label: 'This week', value: stats?.this_week },
          { label: 'All time', value: stats?.total },
        ].map((s) => (
          <div key={s.label} className="card text-center">
            <div className="text-3xl font-semibold text-accent">
              {s.value ?? '…'}
            </div>
            <div className="text-muted text-xs mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Account status */}
      <div className="card">
        <h3 className="text-sm font-medium mb-3 text-muted uppercase tracking-wider">
          Account status
        </h3>
        {accounts.length === 0 ? (
          <p className="text-muted text-sm">No accounts configured.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted text-xs border-b border-border">
                <th className="text-left pb-2 font-normal">Label</th>
                <th className="text-left pb-2 font-normal">Email</th>
                <th className="text-left pb-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-4 text-gray-200">{a.label}</td>
                  <td className="py-2 pr-4 text-muted">{a.email}</td>
                  <td className="py-2">
                    <StatusBadge status={a.status} />
                    {a.status_msg && (
                      <span className="ml-2 text-muted text-xs">{a.status_msg}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
