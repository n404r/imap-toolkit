/** Thin API client wrapper – all requests go to /api */
const BASE = '/api'

async function req<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as any).error ?? res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  // Auth
  login: (password: string) => req<void>('POST', '/auth/login', { password }),
  logout: () => req<void>('POST', '/auth/logout'),
  me: () => req<{ role: string }>('GET', '/auth/me'),

  // Dashboard
  dashboard: () =>
    req<{
      stats: { today: number; this_week: number; total: number }
      accounts: AccountSummary[]
    }>('GET', '/dashboard'),

  // Accounts
  getAccounts: () => req<Account[]>('GET', '/accounts'),
  createAccount: (data: CreateAccountPayload) =>
    req<Account>('POST', '/accounts', data),
  updateAccount: (id: number, data: Partial<CreateAccountPayload & { enabled: boolean }>) =>
    req<Account>('PATCH', `/accounts/${id}`, data),
  deleteAccount: (id: number) => req<void>('DELETE', `/accounts/${id}`),
  reconnectAccount: (id: number) => req<{ ok: boolean }>('POST', `/accounts/${id}/reconnect`),
  getAccountFolders: (id: number) =>
    req<Array<{ path: string; name: string; specialUse: string | null; flags: string[] }>>(
      'GET',
      `/accounts/${id}/folders`
    ),
  testAccountFolders: (data: CreateAccountPayload) =>
    req<Array<{ path: string; name: string; specialUse: string | null; flags: string[] }>>(
      'POST',
      '/accounts/test-folders',
      data
    ),

  // Filters
  getFilters: () => req<Filter[]>('GET', '/filters'),
  createFilter: (data: CreateFilterPayload) =>
    req<Filter>('POST', '/filters', data),
  updateFilter: (id: number, data: Partial<CreateFilterPayload & { enabled: boolean }>) =>
    req<Filter>('PATCH', `/filters/${id}`, data),
  deleteFilter: (id: number) => req<void>('DELETE', `/filters/${id}`),
  purgeFilter: (id: number, options?: { account_id?: number; max_days?: number }) =>
    req<{
      mode: 'instant' | 'background'
      deleted?: number
      scanned?: number
      jobIds?: number[]
      status?: string
    }>('POST', `/filters/${id}/purge`, options),
  getFilterPurgeJobs: (id: number) =>
    req<PurgeJob[]>('GET', `/filters/${id}/purge-jobs`),

  // Logs
  getLogs: (params?: { account_id?: number; search?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (params?.account_id) qs.set('account_id', String(params.account_id))
    if (params?.search) qs.set('search', params.search)
    if (params?.limit) qs.set('limit', String(params.limit))
    if (params?.offset) qs.set('offset', String(params.offset))
    return req<{ logs: DeletionLog[]; total: number }>(
      'GET',
      `/logs?${qs.toString()}`
    )
  },

  // Live mailbox stats per account
  getAccountStats: () => req<AccountMailStats[]>('GET', '/stats/accounts'),
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Account {
  id: number
  label: string
  email: string
  imap_host: string
  imap_port: number
  imap_secure: boolean
  watched_folders: string[]
  enabled: boolean
  status: 'connected' | 'connecting' | 'disconnected' | 'error'
  status_msg?: string
  reconnect_at?: number | null
  created_at: string
  updated_at: string
}

export interface PurgeJob {
  id: number
  filter_id: number
  account_id: number
  folder: string
  status: 'running' | 'completed' | 'failed'
  total_msgs: number
  scanned_msgs: number
  deleted_msgs: number
  error_msg?: string
  created_at: string
  updated_at: string
}

export interface AccountSummary {
  id: number
  label: string
  email: string
  status: Account['status']
  status_msg?: string
  reconnect_at?: number | null
  enabled: boolean
}

export interface FilterCondition {
  id: number
  filter_id: number
  field: 'from_email' | 'from_domain' | 'from_name' | 'subject' | 'body' | 'header'
  match_type: 'equals' | 'contains' | 'starts_with' | 'ends_with' | 'regex'
  values: string[]
}

export interface Filter {
  id: number
  name: string
  enabled: boolean
  logic: 'AND' | 'OR'
  conditions: FilterCondition[]
  created_at: string
  updated_at: string
}

export interface DeletionLog {
  id: number
  account_id: number
  filter_id?: number
  filter_name?: string
  from_addr?: string
  subject?: string
  message_id?: string
  deleted_at: string
}

export interface AccountMailStats {
  account_id: number
  inbox_total: number
  scanned: number
  deleted: number
  skipped: number
  last_scan_at: string | null
  reconnect_at?: number | null
}

export interface CreateAccountPayload {
  label: string
  email: string
  imap_host: string
  imap_port: number
  imap_secure: boolean
  password: string
  watched_folders?: string[]
}

export interface CreateFilterPayload {
  name: string
  logic: 'AND' | 'OR'
  conditions: Array<{
    field: FilterCondition['field']
    match_type: FilterCondition['match_type']
    values: string[]
  }>
}
