import type { ReactNode } from 'react'
import type { Page } from '../App'
import { api } from '../api-client'

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '▤' },
  { id: 'accounts',  label: 'Accounts',  icon: '◎' },
  { id: 'filters',   label: 'Filters',   icon: '⊟' },
  { id: 'logs',      label: 'Logs',      icon: '≡' },
]

interface Props {
  page: Page
  onNavigate: (p: Page) => void
  onLogout: () => void
  children: ReactNode
}

export default function Layout({ page, onNavigate, onLogout, children }: Props) {
  async function handleLogout() {
    await api.logout().catch(() => {})
    onLogout()
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0 bg-surface border-r border-border flex flex-col">
        {/* Logo */}
        <div className="px-5 py-4 border-b border-border">
          <span className="text-accent font-semibold tracking-tight">📬 NeMo IMAP</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 space-y-0.5 px-2">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => onNavigate(n.id)}
              className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                page === n.id
                  ? 'bg-accent/15 text-accent font-medium'
                  : 'text-gray-400 hover:bg-border hover:text-gray-100'
              }`}
            >
              <span className="text-base w-4 text-center">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>

        {/* Logout */}
        <div className="p-3 border-t border-border">
          <button
            onClick={handleLogout}
            className="w-full text-left text-xs text-muted hover:text-gray-300 px-3 py-2 rounded hover:bg-border transition-colors"
          >
            ↩ Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-background p-6">
        {children}
      </main>
    </div>
  )
}
