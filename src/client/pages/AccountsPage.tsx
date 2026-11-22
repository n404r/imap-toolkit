import { useEffect, useState } from 'react'
import { api, type Account, type CreateAccountPayload } from '../api-client'
import { CardSkeleton } from '../components/Skeleton'
import { ReconnectTimer } from '../components/ReconnectTimer'

const EMPTY_FORM: CreateAccountPayload = {
  label: '',
  email: '',
  imap_host: '',
  imap_port: 993,
  imap_secure: true,
  password: '',
  watched_folders: ['INBOX'],
}

function StatusBadge({ status }: { status: Account['status'] }) {
  const map: Record<string, string> = {
    connected: 'badge-green',
    connecting: 'badge-yellow',
    error: 'badge-red',
    disconnected: 'badge-gray',
  }
  return <span className={map[status] ?? 'badge-gray'}>{status}</span>
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<CreateAccountPayload>(EMPTY_FORM)
  const [editId, setEditId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [serverFolders, setServerFolders] = useState<Array<{ path: string; name: string; specialUse: string | null; flags: string[] }>>([])
  const [fetchingFolders, setFetchingFolders] = useState(false)

  const load = () => {
    setLoading(true)
    api.getAccounts()
      .then(setAccounts)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const id = setInterval(() => {
      api.getAccounts().then(setAccounts).catch(() => {})
    }, 3000)
    return () => clearInterval(id)
  }, [])

  function openCreate() {
    setEditId(null)
    setForm(EMPTY_FORM)
    setServerFolders([])
    setError('')
    setShowForm(true)
  }

  function openEdit(a: Account) {
    setEditId(a.id)
    setForm({
      label: a.label,
      email: a.email,
      imap_host: a.imap_host,
      imap_port: a.imap_port,
      imap_secure: a.imap_secure,
      password: '',
      watched_folders: a.watched_folders && a.watched_folders.length > 0 ? a.watched_folders : ['INBOX'],
    })
    setServerFolders([])
    setError('')
    setShowForm(true)
  }

  async function handleFetchFolders() {
    setFetchingFolders(true)
    setError('')
    try {
      let folders: Array<{ path: string; name: string; specialUse: string | null; flags: string[] }>
      if (editId !== null) {
        folders = await api.getAccountFolders(editId)
      } else {
        if (!form.email || !form.password || !form.imap_host) {
          throw new Error('Please enter Email, Host, and Password first to detect folders.')
        }
        folders = await api.testAccountFolders(form)
      }
      setServerFolders(folders)

      // If only default INBOX selected, also default select Junk/Spam folders
      const current = form.watched_folders ?? ['INBOX']
      const autoSelect = new Set(current)
      for (const f of folders) {
        if (f.specialUse && (f.specialUse.includes('Junk') || f.specialUse.includes('Spam'))) {
          autoSelect.add(f.path)
        }
      }
      setForm({ ...form, watched_folders: Array.from(autoSelect) })
    } catch (err: any) {
      setError(err.message ?? 'Failed to retrieve folders from server')
    } finally {
      setFetchingFolders(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (editId !== null) {
        const patch: any = { ...form }
        if (!patch.password) delete patch.password
        await api.updateAccount(editId, patch)
      } else {
        await api.createAccount(form)
      }
      setShowForm(false)
      load()
    } catch (err: any) {
      setError(err.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(a: Account) {
    await api.updateAccount(a.id, { enabled: !a.enabled })
    load()
  }

  async function handleDelete(a: Account) {
    if (!confirm(`Delete account ${a.email}?`)) return
    await api.deleteAccount(a.id)
    load()
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Accounts</h2>
          <p className="text-muted text-xs mt-0.5">Manage connected IMAP inboxes and watch status</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>+ Add account</button>
      </div>

      {/* Account Form */}
      {showForm && (
        <div className="card space-y-4">
          <h3 className="text-sm font-medium">{editId ? 'Edit account' : 'New account'}</h3>
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted block mb-1">Label</label>
                <input
                  className="input"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  required
                  placeholder="e.g. Work Gmail"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Email</label>
                <input
                  className="input"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  placeholder="user@example.com"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">IMAP Host</label>
                <input
                  className="input"
                  value={form.imap_host}
                  onChange={(e) => setForm({ ...form, imap_host: e.target.value })}
                  required
                  placeholder="imap.gmail.com"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Port</label>
                <input
                  className="input"
                  type="number"
                  value={form.imap_port}
                  onChange={(e) => setForm({ ...form, imap_port: Number(e.target.value) })}
                  required
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">
                Password {editId ? '(leave blank to keep current)' : ''}
              </label>
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required={!editId}
                placeholder="IMAP password or app password"
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.imap_secure}
                onChange={(e) => setForm({ ...form, imap_secure: e.target.checked })}
                className="accent-accent"
              />
              Use SSL/TLS
            </label>

            {/* Folders selector */}
            <div className="pt-1">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-muted block font-medium">Monitored Folders</label>
                <button
                  type="button"
                  className="text-xs text-accent hover:underline flex items-center gap-1 font-medium"
                  disabled={fetchingFolders}
                  onClick={handleFetchFolders}
                >
                  {fetchingFolders ? 'Detecting…' : '↻ Detect from Server'}
                </button>
              </div>

              {serverFolders.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto p-2.5 bg-background border border-border rounded text-xs">
                  {serverFolders.map((f) => {
                    const checked = form.watched_folders?.includes(f.path) ?? false
                    return (
                      <label key={f.path} className="flex items-center gap-2 text-gray-200 cursor-pointer select-none hover:bg-white/5 p-1 rounded">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const cur = form.watched_folders ?? ['INBOX']
                            const next = e.target.checked
                              ? [...cur, f.path]
                              : cur.filter((x) => x !== f.path)
                            setForm({ ...form, watched_folders: next.length > 0 ? next : ['INBOX'] })
                          }}
                          className="accent-accent flex-shrink-0"
                        />
                        <span className="truncate font-mono text-[11px]" title={f.path}>{f.name}</span>
                        {f.specialUse && (
                          <span className="text-[10px] text-accent/80 font-sans ml-auto">
                            {f.specialUse.replace('\\', '')}
                          </span>
                        )}
                      </label>
                    )
                  })}
                </div>
              ) : (
                <div className="text-xs text-muted bg-background border border-border rounded p-2.5 space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span>Watching:</span>
                    {(form.watched_folders ?? ['INBOX']).map((folder) => (
                      <span key={folder} className="badge-gray text-[10px] font-mono px-1.5 py-0.5 rounded">
                        {folder}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted">
                    Click <strong>Detect from Server</strong> above to fetch and monitor specific folders (like Orange.fr alias folders or Spam).
                  </p>
                </div>
              )}
            </div>
            {error && <p className="text-danger text-sm">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Account Cards List */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : accounts.length === 0 ? (
        <div className="card text-center text-muted text-sm py-12">
          No accounts configured yet. Click <span className="text-accent">+ Add account</span> above to connect an inbox.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {accounts.map((a) => (
            <div
              key={a.id}
              className={`card flex flex-col justify-between transition-colors ${
                !a.enabled ? 'opacity-70 border-border/60' : 'hover:border-border/80'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-100 truncate text-sm">{a.label}</h3>
                    <p className="text-muted text-xs truncate mt-0.5" title={a.email}>{a.email}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <StatusBadge status={a.status} />
                    {!a.enabled && <span className="badge-gray text-xs">disabled</span>}
                  </div>
                </div>

                <div className="mt-3 py-2 px-2.5 bg-background rounded text-xs space-y-1 text-muted">
                  <div className="flex justify-between">
                    <span>Host:</span>
                    <span className="text-gray-300 font-mono">{a.imap_host}:{a.imap_port}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Security:</span>
                    <span className="text-gray-300">{a.imap_secure ? 'SSL/TLS' : 'Plain'}</span>
                  </div>
                  <div className="flex justify-between items-center pt-1 border-t border-border/40">
                    <span>Folders:</span>
                    <div className="flex flex-wrap gap-1 justify-end max-w-[70%]">
                      {(a.watched_folders && a.watched_folders.length > 0 ? a.watched_folders : ['INBOX']).map((f) => (
                        <span key={f} className="badge-gray text-[10px] font-mono px-1.5 py-0.2 rounded" title={f}>
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Status / error banner with live countdown */}
                {a.status === 'error' && (
                  <div className="mt-2.5 rounded bg-red-950/50 border border-red-800/60 p-2 text-xs text-red-300">
                    <ReconnectTimer
                      reconnectAt={a.reconnect_at}
                      statusMsg={a.status_msg}
                      onRetry={async () => {
                        await api.reconnectAccount(a.id)
                        load()
                      }}
                    />
                  </div>
                )}
                {a.status === 'connecting' && (
                  <div className="mt-2.5 rounded bg-yellow-950/40 border border-yellow-800/50 p-2 text-xs text-yellow-300 break-words flex items-start gap-1.5">
                    <span className="flex-shrink-0 mt-0.5">⟳</span>
                    <span>{a.status_msg ?? 'Connecting to IMAP server…'}</span>
                  </div>
                )}
                {a.status === 'disconnected' && a.enabled && (
                  <div className="mt-2.5 rounded bg-gray-800/60 border border-border p-2 text-xs text-muted">
                    Disconnected — will reconnect automatically
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 mt-3 border-t border-border">
                <button
                  className="btn-ghost text-xs px-2.5 py-1"
                  onClick={() => toggleEnabled(a)}
                >
                  {a.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  className="btn-ghost text-xs px-2.5 py-1"
                  onClick={() => openEdit(a)}
                >
                  Edit
                </button>
                <button
                  className="btn-danger text-xs px-2.5 py-1"
                  onClick={() => handleDelete(a)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
