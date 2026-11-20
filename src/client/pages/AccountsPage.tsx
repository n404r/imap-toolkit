import { useEffect, useState } from 'react'
import { api, type Account, type CreateAccountPayload } from '../api'

const EMPTY_FORM: CreateAccountPayload = {
  label: '',
  email: '',
  imap_host: '',
  imap_port: 993,
  imap_secure: true,
  password: '',
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
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<CreateAccountPayload>(EMPTY_FORM)
  const [editId, setEditId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => api.getAccounts().then(setAccounts)
  useEffect(() => { load() }, [])

  function openCreate() {
    setEditId(null)
    setForm(EMPTY_FORM)
    setError('')
    setShowForm(true)
  }

  function openEdit(a: Account) {
    setEditId(a.id)
    setForm({ label: a.label, email: a.email, imap_host: a.imap_host, imap_port: a.imap_port, imap_secure: a.imap_secure, password: '' })
    setError('')
    setShowForm(true)
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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Accounts</h2>
        <button className="btn-primary" onClick={openCreate}>+ Add account</button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="card space-y-4">
          <h3 className="text-sm font-medium">{editId ? 'Edit account' : 'New account'}</h3>
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted block mb-1">Label</label>
                <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required placeholder="e.g. Work Gmail" />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Email</label>
                <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required placeholder="user@example.com" />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">IMAP Host</label>
                <input className="input" value={form.imap_host} onChange={(e) => setForm({ ...form, imap_host: e.target.value })} required placeholder="imap.gmail.com" />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Port</label>
                <input className="input" type="number" value={form.imap_port} onChange={(e) => setForm({ ...form, imap_port: Number(e.target.value) })} required />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Password {editId ? '(leave blank to keep current)' : ''}</label>
              <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!editId} placeholder="IMAP password or app password" />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={form.imap_secure} onChange={(e) => setForm({ ...form, imap_secure: e.target.checked })} className="accent-accent" />
              Use SSL/TLS
            </label>
            {error && <p className="text-danger text-sm">{error}</p>}
            <div className="flex gap-2">
              <button className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      {accounts.length === 0 ? (
        <div className="card text-center text-muted text-sm py-10">
          No accounts yet. Add one to get started.
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr className="text-muted text-xs">
                <th className="text-left p-3 font-normal">Label</th>
                <th className="text-left p-3 font-normal">Email</th>
                <th className="text-left p-3 font-normal">Host</th>
                <th className="text-left p-3 font-normal">Status</th>
                <th className="p-3 font-normal"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {accounts.map((a) => (
                <tr key={a.id} className="hover:bg-surface/50">
                  <td className="p-3 text-gray-200">{a.label}</td>
                  <td className="p-3 text-muted">{a.email}</td>
                  <td className="p-3 text-muted">{a.imap_host}:{a.imap_port}</td>
                  <td className="p-3">
                    <StatusBadge status={a.status} />
                    {!a.enabled && <span className="ml-2 badge-gray">disabled</span>}
                  </td>
                  <td className="p-3 flex gap-2 justify-end">
                    <button className="btn-ghost text-xs" onClick={() => toggleEnabled(a)}>
                      {a.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button className="btn-ghost text-xs" onClick={() => openEdit(a)}>Edit</button>
                    <button className="btn-danger text-xs" onClick={() => handleDelete(a)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
