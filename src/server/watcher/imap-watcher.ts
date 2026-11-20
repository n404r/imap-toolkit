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
  // Very simple extractor: return raw text, strip HTML tags if present
  return raw.replace(/<[^>]+>/g, ' ').trim()
}

/** Parse a raw "From" header value into name, email, domain */
function parseFrom(from: string): { name: string; email: string; domain: string } {
  // "Display Name <addr@domain.com>" or just "addr@domain.com"
  const match = from.match(/^(?:"?(.+?)"?\s+)?<?([^\s<>]+@[^\s<>]+)>?$/)
  if (match) {
    const email = (match[2] ?? '').toLowerCase().trim()
    const domain = email.split('@')[1] ?? ''
    return { name: (match[1] ?? email).trim(), email, domain }
  }
  return { name: from, email: from.toLowerCase(), domain: '' }
}

type WatcherState = {
  client: ImapFlow | null
  running: boolean
  reconnectDelay: number
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * Manages a single IMAP IDLE connection for one account.
 * Calls onDelete(accountId, matchedFilter, parsedEmail) whenever a matching email arrives.
 */
export class ImapWatcher {
  private state: WatcherState = {
    client: null,
    running: false,
    reconnectDelay: RECONNECT_DELAY_MS,
    timer: null,
  }

  constructor(
    private readonly account: Account,
    private getFilters: () => Filter[],
    private logger: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void }
  ) {}

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
    accountRepo.updateStatus(this.account.id, 'connecting')

    client.on('error', (err: Error) => {
      this.logger.error(`[IMAP ${this.account.email}] error:`, err.message)
    })

    this.runSession(client).catch((err: unknown) => {
      this.logger.error(
        `[IMAP ${this.account.email}] session ended:`,
        err instanceof Error ? err.message : err
      )
      this.scheduleReconnect()
    })
  }

  private async runSession(client: ImapFlow): Promise<void> {
    await client.connect()
    this.state.reconnectDelay = RECONNECT_DELAY_MS
    accountRepo.updateStatus(this.account.id, 'connected')
    this.logger.info(`[IMAP ${this.account.email}] connected`)

    // Lock INBOX and start IDLE
    const lock = await client.getMailboxLock('INBOX')
    try {
      // Listen for new messages via IDLE
      client.on('exists', async () => {
        await this.processNewMessages(client)
      })

      // Keep IDLE alive indefinitely
      await new Promise<void>((_, reject) => {
        client.on('error', reject)
        client.on('close', () => reject(new Error('connection closed')))
      })
    } finally {
      lock.release()
    }
  }

  private async processNewMessages(client: ImapFlow): Promise<void> {
    const filters = this.getFilters().filter((f) => f.enabled)
    if (filters.length === 0) return

    // Fetch unseen messages
    for await (const msg of client.fetch('1:*', {
      envelope: true,
      bodyStructure: true,
      source: true,
    })) {
      try {
        const envelope = msg.envelope
        const rawFrom = envelope.from?.[0]
        const fromStr = rawFrom
          ? `${rawFrom.name ?? ''} <${rawFrom.mailbox}@${rawFrom.host}>`
          : ''

        const { name: from_name, email: from_email, domain: from_domain } =
          parseFrom(fromStr)

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

        const matched = findMatchingFilter(parsed, filters)
        if (!matched) continue

        this.logger.info(
          `[IMAP ${this.account.email}] deleting msg uid=${msg.uid} matched filter "${matched.name}"`
        )

        // Mark as deleted + expunge
        await client.messageDelete(msg.uid, { uid: true })

        // If Gmail — also delete from [Gmail]/Trash
        if (this.account.imap_host.endsWith('gmail.com')) {
          try {
            const trashLock = await client.getMailboxLock('[Gmail]/Trash')
            try {
              await client.messageDelete('1:*', { uid: false })
            } finally {
              trashLock.release()
            }
          } catch {
            // Trash mailbox may not exist or be inaccessible — ignore
          }
        }

        // Write log entry
        void logRepo.create({
          account_id: this.account.id,
          filter_id: matched.id,
          filter_name: matched.name,
          from_addr: from_email,
          subject: envelope.subject ?? undefined,
          message_id: envelope.messageId ?? undefined,
        })
      } catch (msgErr) {
        this.logger.error(
          `[IMAP ${this.account.email}] error processing message:`,
          msgErr
        )
      }
    }
  }

  private scheduleReconnect(): void {
    if (!this.state.running) return
    accountRepo.updateStatus(
      this.account.id,
      'error',
      `Reconnecting in ${Math.round(this.state.reconnectDelay / 1000)}s…`
    )
    this.state.timer = setTimeout(() => {
      if (this.state.running) this.connect()
    }, this.state.reconnectDelay)

    // Exponential back-off
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
}
