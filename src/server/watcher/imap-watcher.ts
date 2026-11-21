import { ImapFlow } from 'imapflow'
import type { Account, ParsedEmail } from '../types.js'
import type { Filter } from '../types.js'
import { findMatchingFilter } from '../lib/filter-engine.js'
import { accountRepo } from '../repositories/account.repo.js'
import { logRepo } from '../repositories/log.repo.js'

const RECONNECT_DELAY_MS = 5_000
const MAX_RECONNECT_DELAY_MS = 60_000

/** Extract a plain-text body from raw IMAP message text */
function extractBody(raw: string): string {
  return raw.replace(/<[^>]+>/g, ' ').trim()
}

/** Parse a raw "From" header value into name, email, domain */
function parseFrom(from: string): { name: string; email: string; domain: string } {
  const match = from.match(/^(?:"?(.+?)"?\s+)?<?([^\s<>]+@[^\s<>]+)>?$/)
  if (match) {
    const email = (match[2] ?? '').toLowerCase().trim()
    const domain = email.split('@')[1] ?? ''
    return { name: (match[1] ?? email).trim(), email, domain }
  }
  return { name: from, email: from.toLowerCase(), domain: '' }
}

export type AccountMailStats = {
  account_id: number
  inbox_total: number      // last known total messages in INBOX
  scanned: number          // messages evaluated since watcher started
  deleted: number          // messages successfully deleted
  not_deleted: number      // messages scanned but not matched / delete failed
  last_scan_at: string | null
}

type WatcherState = {
  client: ImapFlow | null
  running: boolean
  processing: boolean       // guard against concurrent exists events
  reconnectDelay: number
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * Manages a single IMAP IDLE connection for one account.
 * Properly breaks IDLE to fetch+delete, then re-enters IDLE.
 */
export class ImapWatcher {
  private state: WatcherState = {
    client: null,
    running: false,
    processing: false,
    reconnectDelay: RECONNECT_DELAY_MS,
    timer: null,
  }

  // Per-watcher in-memory stats
  readonly stats: AccountMailStats

  constructor(
    private readonly account: Account,
    private getFilters: () => Filter[],
    private logger: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void }
  ) {
    this.stats = {
      account_id: account.id,
      inbox_total: 0,
      scanned: 0,
      deleted: 0,
      not_deleted: 0,
      last_scan_at: null,
    }
  }

  start(): void {
    if (this.state.running) return
    this.state.running = true
    this.connect()
  }

  stop(): void {
    this.state.running = false
    if (this.state.timer) {
      clearTimeout(this.state.timer)
      this.state.timer = null
    }
    if (this.state.client) {
      void this.state.client.logout().catch(() => {})
      this.state.client = null
    }
    void accountRepo.updateStatus(this.account.id, 'disconnected')
  }

  private connect(): void {
    if (!this.state.running) return

    const password = accountRepo.getPassword(this.account)
    const client = new ImapFlow({
      host: this.account.imap_host,
      port: this.account.imap_port,
      secure: this.account.imap_secure,
      auth: { user: this.account.email, pass: password },
      logger: false,
    })

    this.state.client = client
    this.state.processing = false
    void accountRepo.updateStatus(this.account.id, 'connecting', 'Connecting to IMAP server…')

    let lastError: string | null = null

    client.on('error', (err: Error) => {
      lastError = err.message
      this.logger.error(`[IMAP ${this.account.email}] error:`, err.message)
      void accountRepo.updateStatus(this.account.id, 'error', err.message)
    })

    this.runSession(client).catch((err: unknown) => {
      const errMsg = err instanceof Error ? err.message : (err ? String(err) : '')
      this.logger.error(
        `[IMAP ${this.account.email}] session ended:`,
        errMsg
      )
      this.scheduleReconnect(errMsg || lastError || undefined)
    })
  }

  private async runSession(client: ImapFlow): Promise<void> {
    await client.connect()
    this.state.reconnectDelay = RECONNECT_DELAY_MS
    accountRepo.updateStatus(this.account.id, 'connected')
    this.logger.info(`[IMAP ${this.account.email}] connected`)

    // Get current inbox size on connect — this is our baseline.
    // We ONLY process messages that arrive AFTER this point (seq > knownCount).
    let lock = await client.getMailboxLock('INBOX')
    let knownCount: number
    try {
      const status = await client.status('INBOX', { messages: true })
      knownCount = status.messages ?? 0
      this.stats.inbox_total = knownCount
      this.logger.info(`[IMAP ${this.account.email}] inbox baseline: ${knownCount} messages`)
    } finally {
      lock.release()
    }

    // Enter IDLE — only react to truly new messages (count > knownCount)
    await new Promise<void>((_, reject) => {
      client.on('error', reject)
      client.on('close', () => reject(new Error('connection closed')))
      client.on('exists', async (data: { count: number }) => {
        const newCount = data.count ?? knownCount
        this.stats.inbox_total = newCount

        // No new messages — maybe a delete notification, ignore
        if (newCount <= knownCount) return

        // Guard: skip if already processing a previous batch
        if (this.state.processing) {
          knownCount = newCount
          return
        }
        this.state.processing = true

        const firstNewSeq = knownCount + 1
        knownCount = newCount  // advance baseline before async work

        try {
          await this.processNewMessages(client, firstNewSeq, newCount)
        } catch (err) {
          this.logger.error(`[IMAP ${this.account.email}] processNewMessages error:`, err)
        } finally {
          this.state.processing = false
        }
      })
    })
  }

  /**
   * Fetch only messages in sequence range [fromSeq, toSeq], evaluate filters,
   * delete matches. Never touches old messages.
   */
  private async processNewMessages(client: ImapFlow, fromSeq: number, toSeq: number): Promise<void> {
    const filters = this.getFilters().filter((f) => f.enabled)
    this.stats.last_scan_at = new Date().toISOString()

    const seqRange = `${fromSeq}:${toSeq}`
    this.logger.info(`[IMAP ${this.account.email}] processing new messages seq ${seqRange}`)

    let lock: Awaited<ReturnType<typeof client.getMailboxLock>> | null = null
    try {
      lock = await client.getMailboxLock('INBOX')

      if (filters.length === 0) {
        lock.release()
        lock = null
        return
      }

      // Fetch only the new messages by sequence range (not all-mailbox)
      const toDelete: Array<{ uid: number; from_email: string; subject: string; messageId: string | undefined; filter: Filter }> = []

      for await (const msg of client.fetch(seqRange, {
        envelope: true,
        source: true,
      })) {
        try {
          const envelope = msg.envelope
          if (!envelope) continue

          const rawFrom = envelope.from?.[0]
          const fromStr = rawFrom
            ? rawFrom.address
              ? `${rawFrom.name ?? ''} <${rawFrom.address}>`
              : rawFrom.name ?? ''
            : ''

          const { name: from_name, email: from_email, domain: from_domain } = parseFrom(fromStr)

          const rawBody = msg.source
            ? Buffer.isBuffer(msg.source)
              ? msg.source.toString('utf8')
              : String(msg.source)
            : ''

          const parsed: ParsedEmail = {
            from_email,
            from_domain,
            from_name,
            subject: envelope.subject ?? '',
            body: extractBody(rawBody),
            headers: {},
          }

          this.stats.scanned++
          const matched = findMatchingFilter(parsed, filters)

          if (matched) {
            toDelete.push({
              uid: msg.uid,
              from_email,
              subject: envelope.subject ?? '',
              messageId: envelope.messageId ?? undefined,
              filter: matched,
            })
          } else {
            this.stats.not_deleted++
          }
        } catch (msgErr) {
          this.logger.error(
            `[IMAP ${this.account.email}] error reading message:`,
            msgErr
          )
        }
      }

      // Delete matched messages
      for (const item of toDelete) {
        try {
          this.logger.info(
            `[IMAP ${this.account.email}] deleting uid=${item.uid} matched filter "${item.filter.name}"`
          )
          await client.messageDelete(String(item.uid), { uid: true })
          this.stats.deleted++
          this.stats.inbox_total = Math.max(0, this.stats.inbox_total - 1)

          logRepo.create({
            account_id: this.account.id,
            filter_id: item.filter.id,
            filter_name: item.filter.name,
            from_addr: item.from_email,
            subject: item.subject,
            message_id: item.messageId,
          }).catch((logErr) => {
            this.logger.error(`[IMAP ${this.account.email}] log write failed:`, logErr)
          })

          // Gmail: also purge Trash
          if (this.account.imap_host.endsWith('gmail.com')) {
            lock!.release()
            lock = null
            try {
              const trashLock = await client.getMailboxLock('[Gmail]/Trash')
              try {
                const trashUids = await client.search({ all: true }, { uid: true })
                if (Array.isArray(trashUids) && trashUids.length > 0) {
                  await client.messageDelete(trashUids.join(','), { uid: true })
                }
              } finally {
                trashLock.release()
              }
            } catch {
              // Trash may not exist
            }
            lock = await client.getMailboxLock('INBOX')
          }
        } catch (delErr) {
          this.logger.error(
            `[IMAP ${this.account.email}] delete failed uid=${item.uid}:`,
            delErr
          )
          this.stats.not_deleted++
        }
      }
    } finally {
      if (lock) {
        try { lock.release() } catch { /* ignore */ }
      }
    }
  }

  private scheduleReconnect(reason?: string): void {
    if (!this.state.running) return
    const delaySec = Math.round(this.state.reconnectDelay / 1000)
    const statusMsg = reason
      ? `${reason} (reconnecting in ${delaySec}s…)`
      : `Reconnecting in ${delaySec}s…`

    accountRepo.updateStatus(
      this.account.id,
      'error',
      statusMsg
    )
    this.state.timer = setTimeout(() => {
      if (this.state.running) this.connect()
    }, this.state.reconnectDelay)

    this.state.reconnectDelay = Math.min(
      this.state.reconnectDelay * 2,
      MAX_RECONNECT_DELAY_MS
    )
  }
}

// ─── WatcherManager ───────────────────────────────────────────────────────────

type Logger = { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void }

/**
 * Manages all ImapWatcher instances.
 * Call startAll() on boot, then addWatcher/removeWatcher as accounts change.
 */
export class WatcherManager {
  private watchers = new Map<number, ImapWatcher>()

  constructor(private getFilters: () => Filter[], private logger: Logger) {}

  startAll(accounts: Account[]): void {
    for (const account of accounts) {
      if (account.enabled) this.addWatcher(account)
    }
  }

  addWatcher(account: Account): void {
    if (this.watchers.has(account.id)) return
    const w = new ImapWatcher(account, this.getFilters, this.logger)
    this.watchers.set(account.id, w)
    w.start()
  }

  removeWatcher(accountId: number): void {
    const w = this.watchers.get(accountId)
    if (w) {
      w.stop()
      this.watchers.delete(accountId)
    }
  }

  restartWatcher(account: Account): void {
    this.removeWatcher(account.id)
    if (account.enabled) this.addWatcher(account)
  }

  stopAll(): void {
    for (const w of this.watchers.values()) w.stop()
    this.watchers.clear()
  }

  /** Return live mailbox stats for all running watchers */
  getAllStats(): import('../types.js').AccountMailStats[] {
    return Array.from(this.watchers.values()).map((w) => ({ ...w.stats }))
  }

  /** Return live mailbox stats for a single account, or undefined */
  getStats(accountId: number): import('../types.js').AccountMailStats | undefined {
    const w = this.watchers.get(accountId)
    return w ? { ...w.stats } : undefined
  }
}
