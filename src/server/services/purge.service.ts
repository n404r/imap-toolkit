import { ImapFlow } from 'imapflow'
import type { Account, Filter } from '../types.js'
import { accountRepo } from '../repositories/account.repo.js'
import { logRepo } from '../repositories/log.repo.js'
import { purgeRepo } from '../repositories/purge.repo.js'
import { evaluateFilter } from '../lib/filter-engine.js'
import { findTrashFolder, extractBody, parseFrom, type WatcherManager } from '../watcher/imap-watcher.js'

/** Checks if a filter uses ONLY from_email and/or from_domain conditions */
export function isSenderOnlyFilter(filter: Filter): boolean {
  if (filter.conditions.length === 0) return false
  return filter.conditions.every(
    (c) => c.field === 'from_email' || c.field === 'from_domain'
  )
}

/**
 * Instant retroactive purge using native IMAP UID SEARCH FROM.
 * Fast and safe for large mailboxes.
 * Reuses existing watcher connection if available to avoid provider concurrent connection limits.
 */
export async function runInstantPurge(
  account: Account,
  filter: Filter,
  options: { maxDays?: number; manager?: WatcherManager } = {}
): Promise<{ deleted: number; scanned: number }> {
  const watcher = options.manager?.getWatcher(account.id)
  if (watcher && watcher.isConnected) {
    return watcher.purgeSenderFilter(filter, options.maxDays ?? 90)
  }
  return runInstantPurgeStandalone(account, filter, options)
}

export async function runInstantPurgeStandalone(
  account: Account,
  filter: Filter,
  options: { maxDays?: number } = {}
): Promise<{ deleted: number; scanned: number }> {
  const maxDays = options.maxDays ?? 90
  const sinceDate = new Date(Date.now() - maxDays * 24 * 60 * 60 * 1000)

  const password = accountRepo.getPassword(account)
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: account.imap_secure,
    auth: { user: account.email, pass: password },
    logger: false,
  })

  await client.connect()
  let totalDeleted = 0
  let totalScanned = 0

  try {
    const trashFolder = await findTrashFolder(client)
    const folders = account.watched_folders.length > 0 ? account.watched_folders : ['INBOX']

    // Collect all sender values to search
    const senderValues: string[] = []
    for (const cond of filter.conditions) {
      if (cond.field === 'from_email' || cond.field === 'from_domain') {
        senderValues.push(...cond.values)
      }
    }

    for (const folder of folders) {
      let lock: Awaited<ReturnType<typeof client.getMailboxLock>> | null = null
      try {
        lock = await client.getMailboxLock(folder)
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
          // Bulk delete in chunks of 100
          for (let i = 0; i < uidList.length; i += 100) {
            const chunk = uidList.slice(i, i + 100)
            await client.messageDelete(chunk.join(','), { uid: true })
            totalDeleted += chunk.length

            for (const uid of chunk) {
              void logRepo.create({
                account_id: account.id,
                filter_id: filter.id,
                filter_name: filter.name,
                from_addr: `(purged: ${senderValues.slice(0, 2).join(',')})`,
                subject: `Historical cleanup [UID ${uid}]`,
                message_id: undefined,
              }).catch(() => {})
            }
          }
        }

        // Purge trash if any deletions
        if (totalDeleted > 0 && trashFolder && trashFolder !== folder) {
          lock.release()
          lock = null
          try {
            const trashLock = await client.getMailboxLock(trashFolder)
            try {
              const trashUids = await client.search({ all: true }, { uid: true })
              if (Array.isArray(trashUids) && trashUids.length > 0) {
                await client.messageDelete(trashUids.join(','), { uid: true })
              }
            } finally {
              trashLock.release()
            }
          } catch {
            // ignore
          }
        }
      } finally {
        if (lock) {
          try { lock.release() } catch {}
        }
      }
    }
  } finally {
    await client.logout().catch(() => {})
  }

  return { deleted: totalDeleted, scanned: totalScanned }
}

/**
 * Background paginated purge for content-based filters (subject, body, header)
 * Runs asynchronously in batches of 500 messages, updating purgeRepo progress.
 */
export async function runBackgroundPurgeJob(
  jobId: number,
  account: Account,
  filter: Filter,
  options: { maxDays?: number } = {}
): Promise<void> {
  const maxDays = options.maxDays ?? 90
  const sinceDate = new Date(Date.now() - maxDays * 24 * 60 * 60 * 1000)

  const password = accountRepo.getPassword(account)
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: account.imap_secure,
    auth: { user: account.email, pass: password },
    logger: false,
  })

  try {
    await client.connect()
    const trashFolder = await findTrashFolder(client)
    const folders = account.watched_folders.length > 0 ? account.watched_folders : ['INBOX']

    let grandTotal = 0
    let grandScanned = 0
    let grandDeleted = 0

    // First, count total messages across folders since date
    for (const folder of folders) {
      let lock = await client.getMailboxLock(folder)
      try {
        const uids = await client.search({ since: sinceDate }, { uid: true })
        grandTotal += Array.isArray(uids) ? uids.length : 0
      } finally {
        lock.release()
      }
    }

    await purgeRepo.updateProgress(jobId, { total_msgs: grandTotal })

    for (const folder of folders) {
      let lock: Awaited<ReturnType<typeof client.getMailboxLock>> | null = null
      try {
        lock = await client.getMailboxLock(folder)
        const allUids = await client.search({ since: sinceDate }, { uid: true })
        const uidList = (Array.isArray(allUids) ? allUids : []).sort((a, b) => a - b)

        const BATCH_SIZE = 500
        for (let i = 0; i < uidList.length; i += BATCH_SIZE) {
          const batch = uidList.slice(i, i + BATCH_SIZE)
          const toDeleteUids: number[] = []

          for await (const msg of client.fetch(batch.join(','), {
            envelope: true,
            source: true,
          }, { uid: true })) {
            try {
              grandScanned++
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

              const parsed = {
                from_email,
                from_domain,
                from_name,
                subject: envelope.subject ?? '',
                body: extractBody(rawBody),
                headers: {},
              }

              if (evaluateFilter(parsed, filter)) {
                toDeleteUids.push(msg.uid)
              }
            } catch {
              // skip unreadable
            }
          }

          if (toDeleteUids.length > 0) {
            await client.messageDelete(toDeleteUids.join(','), { uid: true })
            grandDeleted += toDeleteUids.length

            for (const uid of toDeleteUids) {
              void logRepo.create({
                account_id: account.id,
                filter_id: filter.id,
                filter_name: filter.name,
                from_addr: '(background purge)',
                subject: `Historical cleanup [UID ${uid}]`,
                message_id: undefined,
              }).catch(() => {})
            }
          }

          await purgeRepo.updateProgress(jobId, {
            scanned_msgs: grandScanned,
            deleted_msgs: grandDeleted,
          })
        }

        // Purge trash
        if (grandDeleted > 0 && trashFolder && trashFolder !== folder) {
          lock.release()
          lock = null
          try {
            const trashLock = await client.getMailboxLock(trashFolder)
            try {
              const trashUids = await client.search({ all: true }, { uid: true })
              if (Array.isArray(trashUids) && trashUids.length > 0) {
                await client.messageDelete(trashUids.join(','), { uid: true })
              }
            } finally {
              trashLock.release()
            }
          } catch {}
        }
      } finally {
        if (lock) {
          try { lock.release() } catch {}
        }
      }
    }

    await purgeRepo.updateProgress(jobId, {
      status: 'completed',
      scanned_msgs: grandScanned,
      deleted_msgs: grandDeleted,
    })
  } catch (err: any) {
    await purgeRepo.updateProgress(jobId, {
      status: 'failed',
      error_msg: err?.message || String(err),
    })
  } finally {
    await client.logout().catch(() => {})
  }
}
