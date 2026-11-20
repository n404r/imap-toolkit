import { useEffect, useState } from 'react'
import { api, type Filter, type FilterCondition } from '../api-client'

type Field = FilterCondition['field']
type MatchType = FilterCondition['match_type']

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
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [draft, setDraft] = useState<DraftFilter>(emptyDraft())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => api.getFilters().then(setFilters)
  useEffect(() => { load() }, [])

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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Filters</h2>
        <button className="btn-primary" onClick={openCreate}>+ New filter</button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="card space-y-5">
          <h3 className="text-sm font-medium">{editId ? 'Edit filter' : 'New filter'}</h3>
          <form onSubmit={handleSave} className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted block mb-1">Filter name</label>
                <input className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required placeholder="e.g. Block newsletters" />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Condition logic</label>
                <select className="input" value={draft.logic} onChange={(e) => setDraft({ ...draft, logic: e.target.value as 'AND' | 'OR' })}>
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
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-muted block mb-1">Field</label>
                      <select className="input" value={c.field} onChange={(e) => updateCondition(i, { field: e.target.value as Field })}>
                        {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-muted block mb-1">Match type</label>
                      <select className="input" value={c.match_type} onChange={(e) => updateCondition(i, { match_type: e.target.value as MatchType })}>
                        {MATCH_TYPES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
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
                    <button type="button" className="text-xs text-muted hover:text-danger transition-colors" onClick={() => removeCondition(i)}>
                      ✕ Remove condition
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className="btn-ghost text-xs" onClick={addCondition}>+ Add condition</button>
            </div>

            {error && <p className="text-danger text-sm">{error}</p>}
            <div className="flex gap-2">
              <button className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save filter'}</button>
              <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Filter list */}
      {filters.length === 0 ? (
        <div className="card text-center text-muted text-sm py-10">
          No filters yet. Create one to start blocking emails.
        </div>
      ) : (
        <div className="space-y-3">
          {filters.map((f) => (
            <div key={f.id} className="card">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{f.name}</span>
                    <span className={`badge ${f.enabled ? 'badge-green' : 'badge-gray'}`}>
                      {f.enabled ? 'active' : 'disabled'}
                    </span>
                    <span className="badge-accent">{f.logic}</span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {f.conditions.map((c, i) => (
                      <div key={i} className="text-xs text-muted">
                        <span className="text-gray-400">{FIELDS.find(x => x.value === c.field)?.label}</span>
                        {' '}
                        <span className="text-accent">{c.match_type.replace('_', ' ')}</span>
                        {' '}
                        <span className="text-gray-300">{c.values.slice(0, 3).join(', ')}{c.values.length > 3 ? ` +${c.values.length - 3} more` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button className="btn-ghost text-xs" onClick={() => toggleEnabled(f)}>
                    {f.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button className="btn-ghost text-xs" onClick={() => openEdit(f)}>Edit</button>
                  <button className="btn-danger text-xs" onClick={() => handleDelete(f)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
