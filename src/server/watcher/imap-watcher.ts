import { ImapFlow } from 'imapflow'
import type { Account, ParsedEmail, Filter, AccountMailStats } from '../types.js'
import { findMatchingFilter } from '../lib/filter-engine.js'
import { accountRepo } from '../repositories/account.repo.js'
import { logRepo } from '../repositories/log.repo.js'

const RECONNECT_DELAY_MS = 5_000
const MAX_RECONNECT_DELAY_MS = 60_000
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000 // 5-minute safety net sweep

/** Extract a plain-text body from raw IMAP message text */
export function extractBody(raw: string): string {
  return raw.replace(/<[^>]+>/g, ' ').trim()
}

/** Parse a raw "From" header value into name, email, domain */
export function parseFrom(from: string): { name: string; email: string; domain: string } {
  const match = from.match(/^(?:"?(.+?)"?\s+)?<?([^\s<>]+@[^\s<>]+)>?$/)
  if (match) {
    const email = (match[2] ?? '').toLowerCase().trim()
    const domain = email.split('@')[1] ?? ''
    return { name: (match[1] ?? email).trim(), email, domain }
  }
  return { name: from, email: from.toLowerCase(), domain: '' }
}

/**
 * Dynamically discover the trash folder path via RFC 6154 specialUse attribute
 * or localized name fallbacks (English, French, etc.)
 */
export async function findTrashFolder(client: ImapFlow): Promise<string | null> {
  try {
    const list = await client.list()
    for (const mb of list) {
      if (mb.specialUse === '\\Trash' || (mb.flags && mb.flags.has('\\Trash'))) {
        return mb.path
      }
    }
    const commonTrashNames = [
      '[gmail]/trash',
      '[gmail]/corbeille',
      'trash',
      'corbeille',
      'deleted messages',
      'deleted items',
      'elements supprimes',
      'éléments supprimés',
      'gelöschte elemente',
      'papelera',
    ]
    for (const mb of list) {
      const p = mb.path.toLowerCase()
      const n = mb.name.toLowerCase()
      if (commonTrashNames.includes(p) || commonTrashNames.includes(n)) {
        return mb.path
      }
    }
  } catch {
    // ignore
  }
  return null
}

type Logger = { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void }

type FolderWatcherState = {
  client: ImapFlow | null
  running: boolean
  processing: boolean
  pendingRescan: boolean
  reconnectDelay: number
  timer: ReturnType<typeof setTimeout> | null
  reconcileTimer: ReturnType<typeof setInterval> | null
  trashFolderName: string | null
}

export type FolderStats = {
  total: number
  scanned: number
  deleted: number
  skipped: number
  last_scan_at: string | null
}

/**
 * Watches a single folder for a single account.
 * Uses UID-based tracking, queued rescan loop, and dynamic trash detection.
 */
export class FolderWatcher {
  private state: FolderWatcherState = {
    client: null,
    running: false,
    processing: false,
    pendingRescan: false,
    reconnectDelay: RECONNECT_DELAY_MS,
    timer: null,
    reconcileTimer: null,
    trashFolderName: null,
  }

  highestSeenUid = 0
  reconnectAt: number | null = null

  readonly stats: FolderStats = {
    total: 0,
    scanned: 0,
    deleted: 0,
    skipped: 0,
    last_scan_at: null,
  }

  constructor(
    private readonly account: Account,
    readonly folder: string,
    private getFilters: () => Filter[],
    private logger: Logger
  ) {}

  start(): void {
    if (this.state.running) return
    this.state.running = true
    this.connect()
  }

  stop(): void {
    this.state.running = false
    this.reconnectAt = null
    if (this.state.timer) {
      clearTimeout(this.state.timer)
      this.state.timer = null
    }
    if (this.state.reconcileTimer) {
      clearInterval(this.state.reconcileTimer)
      this.state.reconcileTimer = null
    }
    if (this.state.client) {
      void this.state.client.logout().catch(() => {})
      this.state.client = null
    }
  }

  manualReconnect(): void {
    if (this.state.timer) {
      clearTimeout(this.state.timer)
      this.state.timer = null
    }
    this.state.reconnectDelay = RECONNECT_DELAY_MS
    this.reconnectAt = null
    if (this.state.client) {
      void this.state.client.logout().catch(() => {})
      this.state.client = null
    }
    this.connect()
  }

  private connect(): void {
    if (!this.state.running) return

    this.reconnectAt = null
    void accountRepo.updateStatus(this.account.id, 'connecting', `Connecting to ${this.folder}…`)

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
    this.state.pendingRescan = false

    let lastError: string | null = null

    client.on('error', (err: Error) => {
      lastError = err.message
      this.logger.error(`[IMAP ${this.account.email}:${this.folder}] error: ${err.message}`)
      void accountRepo.updateStatus(this.account.id, 'error', `${this.folder}: ${err.message}`)
    })

    this.runSession(client).catch((err: unknown) => {
      const errMsg = err instanceof Error ? err.message : (err ? String(err) : '')
      this.logger.error(`[IMAP ${this.account.email}:${this.folder}] session ended: ${errMsg}`)
      this.scheduleReconnect(errMsg || lastError || undefined)
    })
  }

  private async runSession(client: ImapFlow): Promise<void> {
    await client.connect()
    this.state.reconnectDelay = RECONNECT_DELAY_MS
    this.reconnectAt = null
    void accountRepo.updateStatus(this.account.id, 'connected')
    this.logger.info(`[IMAP ${this.account.email}:${this.folder}] connected`)

    // Discover trash folder path for permanent deletion
    this.state.trashFolderName = await findTrashFolder(client)
    if (this.state.trashFolderName) {
      this.logger.info(`[IMAP ${this.account.email}:${this.folder}] detected trash folder: ${this.state.trashFolderName}`)
    }

    // Lock target mailbox and maintain lock continuously for the IDLE session
    const lock = await client.getMailboxLock(this.folder)
    try {
      const mb = typeof client.mailbox === 'object' && client.mailbox ? client.mailbox : null
      this.stats.total = typeof mb?.exists === 'number' ? mb.exists : 0

      if (typeof mb?.uidNext === 'number' && mb.uidNext > 1) {
        this.highestSeenUid = mb.uidNext - 1
      } else {
        const searchRes = await client.search({ all: true }, { uid: true })
        if (Array.isArray(searchRes) && searchRes.length > 0) {
          this.highestSeenUid = Math.max(...searchRes)
        } else {
          this.highestSeenUid = 0
        }
      }
      this.logger.info(
        `[IMAP ${this.account.email}:${this.folder}] baseline established: total=${this.stats.total}, highestSeenUid=${this.highestSeenUid}`
      )

      // Setup 5-minute periodic reconciliation sweep
      if (this.state.reconcileTimer) clearInterval(this.state.reconcileTimer)
      this.state.reconcileTimer = setInterval(() => {
        if (this.state.running) {
          this.logger.info(`[IMAP ${this.account.email}:${this.folder}] periodic reconciliation sweep`)
          void this.triggerScan()
        }
      }, RECONCILE_INTERVAL_MS)

      // Enter IDLE loop and handle exists notifications while lock is held
      await new Promise<void>((_, reject) => {
        client.on('error', reject)
        client.on('close', () => reject(new Error('connection closed')))

        client.on('exists', (data: { count: number }) => {
          if (typeof data.count === 'number') {
            this.stats.total = data.count
          }
          if (this.state.processing) {
            this.state.pendingRescan = true
            return
          }
          void this.triggerScan()
        })
      })
    } finally {
      lock.release()
    }
  }

  /**
   * Triggers a scan loop. If concurrent events fire while processing,
   * pendingRescan remains true, causing the loop to run again immediately.
   */
  async triggerScan(): Promise<void> {
    if (!this.state.running || this.state.processing || !this.state.client) return
    this.state.processing = true

    try {
      while (this.state.running && this.state.client) {
        this.state.pendingRescan = false
        await this.processNewMessages()
        if (!this.state.pendingRescan) break
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`[IMAP ${this.account.email}:${this.folder}] triggerScan error: ${msg}`)
    } finally {
      this.state.processing = false
    }
  }

  /**
   * Fetches only messages with UID > highestSeenUid, checks against enabled filters,
   * and deletes any matching messages.
   * Lock is already held continuously on this.folder.
   */
  private async processNewMessages(): Promise<void> {
    const client = this.state.client
    if (!client) return

    const filters = this.getFilters().filter((f) => f.enabled)
    this.stats.last_scan_at = new Date().toISOString()

    // Query for any messages with UID strictly greater than highestSeenUid
    const searchRes = await client.search(
      { uid: `${this.highestSeenUid + 1}:*` },
      { uid: true }
    )

    const newUids = (Array.isArray(searchRes) ? searchRes : [])
      .filter((uid) => uid > this.highestSeenUid)
      .sort((a, b) => a - b)

    if (newUids.length === 0) return

    this.logger.info(
      `[IMAP ${this.account.email}:${this.folder}] processing ${newUids.length} new message(s) [UIDs: ${newUids[0]}..${newUids[newUids.length - 1]}]`
    )

    // If no filters enabled, just advance highestSeenUid and mark skipped
    if (filters.length === 0) {
      this.stats.scanned += newUids.length
      this.stats.skipped += newUids.length
      this.highestSeenUid = Math.max(this.highestSeenUid, ...newUids)
      return
    }

    // Process in chunks of 50 UIDs
    const CHUNK_SIZE = 50
    let deletedAny = false

    for (let i = 0; i < newUids.length; i += CHUNK_SIZE) {
      const chunk = newUids.slice(i, i + CHUNK_SIZE)
      const toDelete: Array<{
        uid: number
        from_email: string
        subject: string
        messageId: string | undefined
        filter: Filter
      }> = []

      for await (const msg of client.fetch(chunk.join(','), {
        envelope: true,
        source: true,
      }, { uid: true })) {
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
            this.stats.skipped++
          }
        } catch (msgErr: unknown) {
          const msg = msgErr instanceof Error ? msgErr.message : String(msgErr)
          this.logger.error(`[IMAP ${this.account.email}:${this.folder}] error reading message: ${msg}`)
        }
      }

      // Delete matches
      for (const item of toDelete) {
        try {
          this.logger.info(
            `[IMAP ${this.account.email}:${this.folder}] deleting uid=${item.uid} matched filter "${item.filter.name}"`
          )
          await client.messageDelete(String(item.uid), { uid: true })
          this.stats.deleted++
          this.stats.total = Math.max(0, this.stats.total - 1)
          deletedAny = true

          void logRepo.create({
            account_id: this.account.id,
            filter_id: item.filter.id,
            filter_name: item.filter.name,
            from_addr: item.from_email,
            subject: item.subject,
            message_id: item.messageId,
          }).catch((logErr) => {
            this.logger.error(`[IMAP ${this.account.email}:${this.folder}] log write failed:`, logErr)
          })
        } catch (delErr: unknown) {
          const msg = delErr instanceof Error ? delErr.message : String(delErr)
          this.logger.error(
            `[IMAP ${this.account.email}:${this.folder}] delete failed uid=${item.uid}: ${msg}`
          )
          this.stats.skipped++
        }
      }

      this.highestSeenUid = Math.max(this.highestSeenUid, ...chunk)
    }

    // If any messages were deleted and trash folder exists, purge trash quietly on separate connection
    if (deletedAny && this.state.trashFolderName && this.state.trashFolderName !== this.folder) {
      void this.purgeTrashQuietly(this.state.trashFolderName)
    }
  }

  private async purgeTrashQuietly(trashPath: string): Promise<void> {
    const password = accountRepo.getPassword(this.account)
    const client = new ImapFlow({
      host: this.account.imap_host,
      port: this.account.imap_port,
      secure: this.account.imap_secure,
      auth: { user: this.account.email, pass: password },
      logger: false,
    })
    try {
      await client.connect()
      const lock = await client.getMailboxLock(trashPath)
      try {
        const trashUids = await client.search({ all: true }, { uid: true })
        if (Array.isArray(trashUids) && trashUids.length > 0) {
          await client.messageDelete(trashUids.join(','), { uid: true })
          this.logger.info(
            `[IMAP ${this.account.email}] purged ${trashUids.length} messages from trash (${trashPath})`
          )
        }
      } finally {
        lock.release()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`[IMAP ${this.account.email}] trash purge error: ${msg}`)
    } finally {
      await client.logout().catch(() => {})
    }
  }

  private scheduleReconnect(reason?: string): void {
    if (!this.state.running) return
    const delayMs = this.state.reconnectDelay
    this.reconnectAt = Date.now() + delayMs
    const cleanReason = reason ? `${this.folder}: ${reason}` : `${this.folder}: Connection closed`

    void accountRepo.updateStatus(this.account.id, 'error', cleanReason)

    this.state.timer = setTimeout(() => {
      if (this.state.running) this.connect()
    }, delayMs)

    this.state.reconnectDelay = Math.min(this.state.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS)
  }

  get isConnected(): boolean {
    return Boolean(this.state.running && this.state.client)
  }

  async purgeSenderFilter(
    filter: Filter,
    maxDays: number = 90
  ): Promise<{ deleted: number; scanned: number }> {
    const client = this.state.client
    if (!client || !this.state.running) {
      throw new Error(`Watcher for ${this.folder} is not currently connected`)
    }

    const maxDaysMs = maxDays * 24 * 60 * 60 * 1000
    const sinceDate = new Date(Date.now() - maxDaysMs)

    const senderValues: string[] = []
    for (const cond of filter.conditions) {
      if (cond.field === 'from_email' || cond.field === 'from_domain') {
        senderValues.push(...cond.values)
      }
    }

    let totalDeleted = 0
    let totalScanned = 0
    const matchedUids = new Set<number>()

    for (const val of senderValues) {
      const uids = await client.search(
        { from: val, since: sinceDate },
        { uid: true }
      )
      if (Array.isArray(uids)) {
        for (const uid of uids) matchedUids.add(uid)
      }
    }

    const uidList = Array.from(matchedUids)
    totalScanned += uidList.length

    if (uidList.length > 0) {
      for (let i = 0; i < uidList.length; i += 100) {
        const chunk = uidList.slice(i, i + 100)
        await client.messageDelete(chunk.join(','), { uid: true })
        totalDeleted += chunk.length
        this.stats.deleted += chunk.length
        this.stats.total = Math.max(0, this.stats.total - chunk.length)

        for (const uid of chunk) {
          void logRepo.create({
            account_id: this.account.id,
            filter_id: filter.id,
            filter_name: filter.name,
            from_addr: `(purged: ${senderValues.slice(0, 2).join(',')})`,
            subject: `Historical cleanup [UID ${uid}]`,
            message_id: undefined,
          }).catch(() => {})
        }
      }

      if (this.state.trashFolderName && this.state.trashFolderName !== this.folder) {
        void this.purgeTrashQuietly(this.state.trashFolderName)
      }
    }

    return { deleted: totalDeleted, scanned: totalScanned }
  }
}

// ─── ImapWatcher (Account-Level Coordinator) ─────────────────────────────────

/**
 * Coordinates all folder watchers for one account.
 * Maintains one FolderWatcher instance per watched folder.
 */
export class ImapWatcher {
  private folderWatchers = new Map<string, FolderWatcher>()

  constructor(
    private readonly account: Account,
    private getFilters: () => Filter[],
    private logger: Logger
  ) {}

  start(): void {
    const folders = this.getWatchedFolders()
    for (const folder of folders) {
      if (!this.folderWatchers.has(folder)) {
        const fw = new FolderWatcher(this.account, folder, this.getFilters, this.logger)
        this.folderWatchers.set(folder, fw)
        fw.start()
      }
    }
    void accountRepo.updateStatus(this.account.id, 'connected')
  }

  stop(): void {
    for (const fw of this.folderWatchers.values()) {
      fw.stop()
    }
    this.folderWatchers.clear()
    void accountRepo.updateStatus(this.account.id, 'disconnected')
  }

  manualReconnect(): void {
    for (const fw of this.folderWatchers.values()) {
      fw.manualReconnect()
    }
  }

  get reconnectAt(): number | null {
    let earliest: number | null = null
    for (const fw of this.folderWatchers.values()) {
      if (fw.reconnectAt) {
        if (earliest === null || fw.reconnectAt < earliest) {
          earliest = fw.reconnectAt
        }
      }
    }
    return earliest
  }

  updateFolders(newFolders: string[]): void {
    const current = new Set(this.folderWatchers.keys())
    const targets = new Set(newFolders.length > 0 ? newFolders : ['INBOX'])

    for (const f of current) {
      if (!targets.has(f)) {
        this.folderWatchers.get(f)?.stop()
        this.folderWatchers.delete(f)
      }
    }

    for (const f of targets) {
      if (!this.folderWatchers.has(f)) {
        const fw = new FolderWatcher(this.account, f, this.getFilters, this.logger)
        this.folderWatchers.set(f, fw)
        fw.start()
      }
    }
  }

  private getWatchedFolders(): string[] {
    const f = this.account.watched_folders
    return Array.isArray(f) && f.length > 0 ? f : ['INBOX']
  }

  get stats(): AccountMailStats {
    let inbox_total = 0
    let scanned = 0
    let deleted = 0
    let skipped = 0
    let latestScan: string | null = null

    for (const fw of this.folderWatchers.values()) {
      if (fw.folder.toUpperCase() === 'INBOX') {
        inbox_total = fw.stats.total
      } else if (inbox_total === 0) {
        inbox_total += fw.stats.total
      }
      scanned += fw.stats.scanned
      deleted += fw.stats.deleted
      skipped += fw.stats.skipped
      if (fw.stats.last_scan_at) {
        if (!latestScan || fw.stats.last_scan_at > latestScan) {
          latestScan = fw.stats.last_scan_at
        }
      }
    }

    return {
      account_id: this.account.id,
      inbox_total,
      scanned,
      deleted,
      skipped,
      last_scan_at: latestScan,
      reconnect_at: this.reconnectAt,
    }
  }

  get isConnected(): boolean {
    for (const fw of this.folderWatchers.values()) {
      if (fw.isConnected) return true
    }
    return false
  }

  async purgeSenderFilter(
    filter: Filter,
    maxDays: number = 90
  ): Promise<{ deleted: number; scanned: number }> {
    let deleted = 0
    let scanned = 0
    for (const fw of this.folderWatchers.values()) {
      if (fw.isConnected) {
        const res = await fw.purgeSenderFilter(filter, maxDays)
        deleted += res.deleted
        scanned += res.scanned
      }
    }
    return { deleted, scanned }
  }
}

// ─── WatcherManager ───────────────────────────────────────────────────────────

export class WatcherManager {
  private watchers = new Map<number, ImapWatcher>()

  constructor(private getFilters: () => Filter[], private logger: Logger) {}

  getWatcher(accountId: number): ImapWatcher | undefined {
    return this.watchers.get(accountId)
  }

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

  reconnectWatcher(accountId: number): void {
    const w = this.watchers.get(accountId)
    if (w) w.manualReconnect()
  }

  stopAll(): void {
    for (const w of this.watchers.values()) w.stop()
    this.watchers.clear()
  }

  getAllStats(): AccountMailStats[] {
    return Array.from(this.watchers.values()).map((w) => w.stats)
  }

  getStats(accountId: number): AccountMailStats | undefined {
    const w = this.watchers.get(accountId)
    return w ? w.stats : undefined
  }
}
