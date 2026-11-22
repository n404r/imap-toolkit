import { useEffect, useState } from 'react'
import { api, type Filter, type FilterCondition, type PurgeJob } from '../api-client'
import { CardSkeleton } from '../components/Skeleton'

type Field = FilterCondition['field']
type MatchType = FilterCondition['match_type']

function isSenderOnly(f: Filter): boolean {
  return f.conditions.length > 0 && f.conditions.every(
    (c) => c.field === 'from_email' || c.field === 'from_domain'
  )
}

const FIELDS: { value: Field; label: string }[] = [
  { value: 'from_email',  label: 'Sender email' },
  { value: 'from_domain', label: 'Sender domain' },
  { value: 'from_name',   label: 'Sender name' },
  { value: 'subject',     label: 'Subject' },
  { value: 'body',        label: 'Body' },
  { value: 'header',      label: 'Header' },
]

const MATCH_TYPES: { value: MatchType; label: string }[] = [
  { value: 'equals',      label: 'Equals' },
  { value: 'contains',    label: 'Contains' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'ends_with',   label: 'Ends with' },
  { value: 'regex',       label: 'Regex' },
]

type DraftCondition = {
  field: Field
  match_type: MatchType
  valuesText: string // one per line
}

type DraftFilter = {
  name: string
  logic: 'AND' | 'OR'
  conditions: DraftCondition[]
}

function emptyDraft(): DraftFilter {
  return {
    name: '',
    logic: 'AND',
    conditions: [{ field: 'from_email', match_type: 'contains', valuesText: '' }],
  }
}

function draftFromFilter(f: Filter): DraftFilter {
  return {
    name: f.name,
    logic: f.logic,
    conditions: f.conditions.map((c) => ({
      field: c.field,
      match_type: c.match_type,
      valuesText: c.values.join('\n'),
    })),
  }
}

export default function FiltersPage() {
  const [filters, setFilters] = useState<Filter[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [draft, setDraft] = useState<DraftFilter>(emptyDraft())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Quick Block Sender Modal
  const [showQuickBlock, setShowQuickBlock] = useState(false)
  const [qbValue, setQbValue] = useState('')
  const [qbType, setQbType] = useState<'from_email' | 'from_domain'>('from_email')
  const [qbPurge, setQbPurge] = useState(true)
  const [qbSaving, setQbSaving] = useState(false)
  const [qbError, setQbError] = useState('')
  const [qbMessage, setQbMessage] = useState('')

  // Purge progress tracking per filter
  const [purgingId, setPurgingId] = useState<number | null>(null)
  const [purgeResults, setPurgeResults] = useState<Record<number, string>>({})
  const [purgeJobs, setPurgeJobs] = useState<Record<number, PurgeJob[]>>({})

  const load = () => {
    setLoading(true)
    api.getFilters()
      .then(setFilters)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  // Poll background purge jobs if any are active
  useEffect(() => {
    const active = Object.values(purgeJobs).flat().some((j) => j.status === 'running')
    if (!active) return
    const timer = setInterval(() => {
      for (const filter of filters) {
        api.getFilterPurgeJobs(filter.id).then((jobs) => {
          if (jobs.length > 0) {
            setPurgeJobs((prev) => ({ ...prev, [filter.id]: jobs }))
          }
        }).catch(() => {})
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [purgeJobs, filters])

  async function handleQuickBlock(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = qbValue.trim().toLowerCase()
    if (!trimmed) return
    setQbSaving(true)
    setQbError('')
    setQbMessage('')

    try {
      const val = qbType === 'from_domain' ? trimmed.replace(/^@/, '') : trimmed
      const filterName = qbType === 'from_email' ? `Block ${val}` : `Block domain @${val}`
      const filter = await api.createFilter({
        name: filterName,
        logic: 'OR',
        conditions: [{
          field: qbType,
          match_type: 'equals',
          values: [val],
        }],
      })

      if (qbPurge) {
        setQbMessage('Filter created. Purging existing matches…')
        const purgeRes = await api.purgeFilter(filter.id, { max_days: 90 })
        let msg = `Blocked ${val}! Purged ${purgeRes.deleted ?? 0} existing emails (${purgeRes.scanned ?? 0} scanned).`
        if (purgeRes.errors && purgeRes.errors.length > 0) {
          msg += ` (⚠ ${purgeRes.errors.join('; ')})`
        }
        setQbMessage(msg)
      } else {
        setQbMessage(`Blocked ${val} successfully.`)
      }

      setQbValue('')
      load()
      setTimeout(() => {
        setShowQuickBlock(false)
        setQbMessage('')
      }, 2000)
    } catch (err: any) {
      setQbError(err.message ?? 'Failed to block sender')
    } finally {
      setQbSaving(false)
    }
  }

  async function handlePurge(f: Filter) {
    const isSender = isSenderOnly(f)
    const promptMsg = isSender
      ? `Purge all past emails matching "${f.name}" from the last 90 days?`
      : `Scan and purge past emails in the background for "${f.name}" (last 90 days)? This processes in batches of 500.`

    if (!confirm(promptMsg)) return

    setPurgingId(f.id)
    setPurgeResults((prev) => ({ ...prev, [f.id]: 'Starting purge…' }))

    try {
      const res = await api.purgeFilter(f.id, { max_days: 90 })
      if (res.mode === 'instant') {
        let msg = `✔ Purged ${res.deleted ?? 0} emails (${res.scanned ?? 0} scanned)`
        if (res.errors && res.errors.length > 0) {
          msg += ` (⚠ Warning: ${res.errors.join('; ')})`
        }
        setPurgeResults((prev) => ({
          ...prev,
          [f.id]: msg,
        }))
      } else {
        let msg = '⚡ Background scan running…'
        if (res.errors && res.errors.length > 0) {
          msg += ` (⚠ ${res.errors.join('; ')})`
        }
        setPurgeResults((prev) => ({
          ...prev,
          [f.id]: msg,
        }))
        const jobs = await api.getFilterPurgeJobs(f.id)
        setPurgeJobs((prev) => ({ ...prev, [f.id]: jobs }))
      }
    } catch (err: any) {
      setPurgeResults((prev) => ({
        ...prev,
        [f.id]: `❌ Error: ${err.message ?? 'Purge failed'}`,
      }))
    } finally {
      setPurgingId(null)
    }
  }

  function openCreate() {
    setEditId(null)
    setDraft(emptyDraft())
    setError('')
    setShowForm(true)
  }

  function openEdit(f: Filter) {
    setEditId(f.id)
    setDraft(draftFromFilter(f))
    setError('')
    setShowForm(true)
  }

  function updateCondition(i: number, patch: Partial<DraftCondition>) {
    setDraft((d) => {
      const conditions = [...d.conditions]
      conditions[i] = { ...conditions[i], ...patch }
      return { ...d, conditions }
    })
  }

  function addCondition() {
    setDraft((d) => ({
      ...d,
      conditions: [...d.conditions, { field: 'from_email', match_type: 'contains', valuesText: '' }],
    }))
  }

  function removeCondition(i: number) {
    setDraft((d) => ({ ...d, conditions: d.conditions.filter((_, j) => j !== i) }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: draft.name,
        logic: draft.logic,
        conditions: draft.conditions.map((c) => ({
          field: c.field,
          match_type: c.match_type,
          values: c.valuesText.split('\n').map((v) => v.trim()).filter(Boolean),
        })),
      }
      if (editId !== null) {
        await api.updateFilter(editId, payload)
      } else {
        await api.createFilter(payload)
      }
      setShowForm(false)
      load()
    } catch (err: any) {
      setError(err.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(f: Filter) {
    await api.updateFilter(f.id, { enabled: !f.enabled })
    load()
  }

  async function handleDelete(f: Filter) {
    if (!confirm(`Delete filter "${f.name}"?`)) return
    await api.deleteFilter(f.id)
    load()
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Filters</h2>
          <p className="text-muted text-xs mt-0.5">Define conditions for automated email deletions</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-primary"
            onClick={() => {
              setShowQuickBlock(true)
              setShowForm(false)
              setQbError('')
              setQbMessage('')
            }}
          >
            + Block Sender
          </button>
          <button className="btn-ghost" onClick={openCreate}>
            + Custom Filter
          </button>
        </div>
      </div>

      {/* Quick Block Sender Modal */}
      {showQuickBlock && (
        <div className="card space-y-4 border-accent/40 bg-card">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-100 flex items-center gap-1.5">
              <span>🛡️</span> Quick Block Sender
            </h3>
            <button
              className="text-muted hover:text-gray-200 text-xs px-1"
              onClick={() => setShowQuickBlock(false)}
            >
              ✕
            </button>
          </div>
          <p className="text-xs text-muted">
            Instantly block any email address or full domain so it is permanently deleted as soon as it arrives.
          </p>
          <form onSubmit={handleQuickBlock} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted block mb-1">Block Target</label>
                <select
                  className="input"
                  value={qbType}
                  onChange={(e) => setQbType(e.target.value as any)}
                >
                  <option value="from_email">Specific Email Address</option>
                  <option value="from_domain">Entire Domain (@example.com)</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-muted block mb-1">
                  {qbType === 'from_email' ? 'Sender Email to Block' : 'Sender Domain (@ will be removed)'}
                </label>
                <input
                  className="input"
                  value={qbValue}
                  onChange={(e) => setQbValue(e.target.value)}
                  placeholder={
                    qbType === 'from_email'
                      ? 'klm_royal_dutch_airlines@infos-klm.com'
                      : 'infos-klm.com'
                  }
                  required
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={qbPurge}
                onChange={(e) => setQbPurge(e.target.checked)}
                className="accent-accent"
              />
              <span>Also purge existing emails from this sender (last 90 days)</span>
            </label>

            {qbError && <p className="text-danger text-xs">{qbError}</p>}
            {qbMessage && <p className="text-green-400 text-xs font-medium">{qbMessage}</p>}

            <div className="flex gap-2 pt-1">
              <button className="btn-primary text-xs" disabled={qbSaving}>
                {qbSaving ? 'Blocking…' : 'Block Sender'}
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setShowQuickBlock(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter Form */}
      {showForm && (
        <div className="card space-y-5">
          <h3 className="text-sm font-medium">{editId ? 'Edit filter' : 'New filter'}</h3>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted block mb-1">Filter name</label>
                <input
                  className="input"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  required
                  placeholder="e.g. Block newsletters"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Condition logic</label>
                <select
                  className="input"
                  value={draft.logic}
                  onChange={(e) => setDraft({ ...draft, logic: e.target.value as 'AND' | 'OR' })}
                >
                  <option value="AND">AND – all conditions must match</option>
                  <option value="OR">OR – any condition matches</option>
                </select>
              </div>
            </div>

            {/* Conditions */}
            <div className="space-y-3">
              <div className="text-xs text-muted uppercase tracking-wider">Conditions</div>
              {draft.conditions.map((c, i) => (
                <div key={i} className="bg-background border border-border rounded p-3 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-muted block mb-1">Field</label>
                      <select
                        className="input"
                        value={c.field}
                        onChange={(e) => updateCondition(i, { field: e.target.value as Field })}
                      >
                        {FIELDS.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-muted block mb-1">Match type</label>
                      <select
                        className="input"
                        value={c.match_type}
                        onChange={(e) => updateCondition(i, { match_type: e.target.value as MatchType })}
                      >
                        {MATCH_TYPES.map((m) => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {c.field === 'header' && (
                    <p className="text-xs text-warning">First line = header name (e.g. x-mailer), remaining lines = match values</p>
                  )}
                  <div>
                    <label className="text-xs text-muted block mb-1">Values (one per line)</label>
                    <textarea
                      className="input min-h-[72px] resize-y font-mono text-xs"
                      value={c.valuesText}
                      onChange={(e) => updateCondition(i, { valuesText: e.target.value })}
                      placeholder="value1&#10;value2&#10;value3"
                    />
                  </div>
                  {draft.conditions.length > 1 && (
                    <button
                      type="button"
                      className="text-xs text-muted hover:text-danger transition-colors"
                      onClick={() => removeCondition(i)}
                    >
                      ✕ Remove condition
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className="btn-ghost text-xs" onClick={addCondition}>
                + Add condition
              </button>
            </div>

            {error && <p className="text-danger text-sm">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save filter'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter Cards List */}
      {loading ? (
        <div className="space-y-3">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : filters.length === 0 ? (
        <div className="card text-center text-muted text-sm py-12">
          No filters yet. Click <span className="text-accent">+ New filter</span> above to start blocking emails automatically.
        </div>
      ) : (
        <div className="space-y-3">
          {filters.map((f) => (
            <div key={f.id} className="card transition-colors hover:border-border/80">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm text-gray-100">{f.name}</span>
                    <span className={`badge ${f.enabled ? 'badge-green' : 'badge-gray'}`}>
                      {f.enabled ? 'active' : 'disabled'}
                    </span>
                    <span className="badge-accent">{f.logic}</span>
                  </div>
                  <div className="mt-2.5 space-y-1.5">
                    {f.conditions.map((c, i) => (
                      <div
                        key={i}
                        className="text-xs text-muted bg-background/60 py-1 px-2 rounded inline-flex flex-wrap items-center gap-1.5 mr-2 mb-1"
                      >
                        <span className="text-gray-300 font-medium">
                          {FIELDS.find((x) => x.value === c.field)?.label}
                        </span>
                        <span className="text-accent text-[11px] font-mono">
                          {c.match_type.replace('_', ' ')}
                        </span>
                        <span className="text-gray-200">
                          {c.values.slice(0, 3).join(', ')}
                          {c.values.length > 3 ? ` +${c.values.length - 3} more` : ''}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Purge results banner */}
                  {purgeResults[f.id] && (
                    <div className="mt-2.5 text-xs bg-background/80 py-1.5 px-2.5 rounded border border-border/70 text-gray-300">
                      {purgeResults[f.id]}
                    </div>
                  )}

                  {/* Background purge jobs status */}
                  {purgeJobs[f.id] && purgeJobs[f.id].length > 0 && (
                    <div className="mt-2 space-y-1">
                      {purgeJobs[f.id].map((job) => (
                        <div
                          key={job.id}
                          className="text-[11px] bg-background/60 py-1 px-2 rounded border border-border/40 flex items-center justify-between text-muted"
                        >
                          <span className="font-mono text-gray-300">{job.folder}</span>
                          <span>
                            {job.status === 'running' ? '⟳ ' : '✔ '}
                            {job.scanned_msgs.toLocaleString()} / {job.total_msgs.toLocaleString()} scanned ({job.deleted_msgs} deleted)
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex gap-1.5 flex-shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border">
                  <button
                    className="btn-ghost text-xs px-2.5 py-1 text-accent hover:text-accent-hover"
                    disabled={purgingId === f.id}
                    onClick={() => handlePurge(f)}
                    title={isSenderOnly(f) ? 'Instant purge from past 90 days' : 'Scan past 90 days in background'}
                  >
                    {purgingId === f.id ? 'Purging…' : isSenderOnly(f) ? '⚡ Purge now' : '⟳ Scan history'}
                  </button>
                  <button
                    className="btn-ghost text-xs px-2.5 py-1"
                    onClick={() => toggleEnabled(f)}
                  >
                    {f.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    className="btn-ghost text-xs px-2.5 py-1"
                    onClick={() => openEdit(f)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn-danger text-xs px-2.5 py-1"
                    onClick={() => handleDelete(f)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
