import { useState, type ReactNode } from 'react'
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  async function handleLogout() {
    await api.logout().catch(() => {})
    onLogout()
  }

  function handleNavigate(p: Page) {
    onNavigate(p)
    setMobileMenuOpen(false)
  }

  return (
    <div className="flex h-screen overflow-hidden flex-col md:flex-row bg-background">
      {/* Mobile Top Header */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 bg-surface border-b border-border z-30 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-accent font-semibold tracking-tight text-base">📬 NeMo IMAP</span>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-1.5 rounded hover:bg-border text-gray-300 focus:outline-none"
          aria-label="Toggle Navigation"
        >
          {mobileMenuOpen ? '✕' : '☰'}
        </button>
      </header>

      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Drawer Menu */}
      <aside
        className={`md:hidden fixed top-0 right-0 bottom-0 w-64 bg-surface border-l border-border z-50 flex flex-col transform transition-transform duration-200 ease-in-out ${
          mobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-border flex items-center justify-between">
          <span className="text-accent font-semibold tracking-tight">📬 NeMo IMAP</span>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="p-1 text-gray-400 hover:text-gray-100"
          >
            ✕
          </button>
        </div>
        <nav className="flex-1 py-3 space-y-1 px-3">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => handleNavigate(n.id)}
              className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded text-sm transition-colors ${
                page === n.id
                  ? 'bg-accent/15 text-accent font-medium'
                  : 'text-gray-300 hover:bg-border hover:text-gray-100'
              }`}
            >
              <span className="text-lg w-5 text-center">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <button
            onClick={handleLogout}
            className="w-full text-left text-xs text-danger/80 hover:text-danger px-3 py-2 rounded hover:bg-border transition-colors"
          >
            ↩ Logout
          </button>
        </div>
      </aside>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-52 flex-shrink-0 bg-surface border-r border-border flex-col">
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

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto bg-background p-4 sm:p-6 pb-20 md:pb-6">
        {children}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface/95 backdrop-blur border-t border-border flex items-center justify-around py-2 px-1 z-20">
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => handleNavigate(n.id)}
            className={`flex flex-col items-center justify-center flex-1 py-1 text-xs transition-colors ${
              page === n.id ? 'text-accent font-semibold' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <span className="text-base leading-none mb-1">{n.icon}</span>
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
