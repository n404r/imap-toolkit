import { useState, useEffect } from 'react'
import { api } from './api-client'
import LoginPage from './pages/LoginPage'
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import AccountsPage from './pages/AccountsPage'
import FiltersPage from './pages/FiltersPage'
import LogsPage from './pages/LogsPage'

export type Page = 'dashboard' | 'accounts' | 'filters' | 'logs'

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [page, setPage] = useState<Page>('dashboard')

  useEffect(() => {
    api.me()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false))
  }, [])

  if (authed === null) {
    return (
      <div className="flex items-center justify-center h-screen text-muted text-sm">
        Loading…
      </div>
    )
  }

  if (!authed) {
    return <LoginPage onSuccess={() => setAuthed(true)} />
  }

  return (
    <Layout page={page} onNavigate={setPage} onLogout={() => setAuthed(false)}>
      {page === 'dashboard' && <DashboardPage />}
      {page === 'accounts' && <AccountsPage />}
      {page === 'filters' && <FiltersPage />}
      {page === 'logs' && <LogsPage />}
    </Layout>
  )
}
