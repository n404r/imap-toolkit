// ─── Shared domain types ────────────────────────────────────────────────────

export type MatchType =
  | 'equals'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'regex'

export type FilterField =
  | 'from_email'
  | 'from_domain'
  | 'from_name'
  | 'subject'
  | 'body'
  | 'header'

export type FilterLogic = 'AND' | 'OR'

export interface FilterCondition {
  id: number
  filter_id: number
  /** Which part of the email to test */
  field: FilterField
  /** How to compare */
  match_type: MatchType
  /** JSON array of values – any value matching triggers this condition */
  values: string[]
}

export interface Filter {
  id: number
  name: string
  enabled: boolean
  /** AND = all conditions must match; OR = any condition matches */
  logic: FilterLogic
  conditions: FilterCondition[]
  created_at: string
  updated_at: string
}

export interface Account {
  id: number
  label: string
  email: string
  imap_host: string
  imap_port: number
  imap_secure: boolean
  /** AES-256-GCM encrypted password, base64 */
  password_enc: string
  enabled: boolean
  status: 'connected' | 'connecting' | 'disconnected' | 'error'
  status_msg?: string
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

/** Minimal parsed email fields handed to the filter engine */
export interface ParsedEmail {
  from_email: string
  from_domain: string
  from_name: string
  subject: string
  /** Raw text body (plain text part or stripped HTML) */
  body: string
  /** All headers as key → value[] map */
  headers: Record<string, string[]>
}

/** Live per-account mailbox statistics */
export interface AccountMailStats {
  account_id: number
  /** Current total messages in INBOX */
  inbox_total: number
  /** Total messages evaluated since watcher started */
  scanned: number
  /** Total messages successfully deleted */
  deleted: number
  /** Messages scanned but not matched or failed to delete */
  not_deleted: number
  /** ISO timestamp of last scan, or null if never scanned */
  last_scan_at: string | null
}
