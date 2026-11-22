import { describe, it, expect, vi } from 'vitest'
import { parseFrom, findTrashFolder, extractBody } from '../src/server/watcher/imap-watcher.js'
import { isSenderOnlyFilter } from '../src/server/services/purge.service.js'
import type { Filter } from '../src/server/types.js'

describe('parseFrom helper', () => {
  it('parses formatted From header with name and email', () => {
    const res = parseFrom('KLM Royal Dutch Airlines <klm_royal_dutch_airlines@infos-klm.com>')
    expect(res.name).toBe('KLM Royal Dutch Airlines')
    expect(res.email).toBe('klm_royal_dutch_airlines@infos-klm.com')
    expect(res.domain).toBe('infos-klm.com')
  })

  it('parses bare email address', () => {
    const res = parseFrom('fse.cvaroquier@orange.fr')
    expect(res.name).toBe('fse.cvaroquier@orange.fr')
    expect(res.email).toBe('fse.cvaroquier@orange.fr')
    expect(res.domain).toBe('orange.fr')
  })

  it('handles quotes around sender name', () => {
    const res = parseFrom('"Support Team" <support@service.flyingblue.com>')
    expect(res.name).toBe('Support Team')
    expect(res.email).toBe('support@service.flyingblue.com')
    expect(res.domain).toBe('service.flyingblue.com')
  })
})

describe('extractBody helper', () => {
  it('strips html tags and trims whitespace', () => {
    const html = '<p>Your flight ticket to <b>Copenhagen</b> is confirmed.</p>'
    expect(extractBody(html)).toBe('Your flight ticket to  Copenhagen  is confirmed.')
  })
})

describe('findTrashFolder – RFC 6154 specialUse & localized names', () => {
  it('detects trash via specialUse attribute', async () => {
    const mockClient = {
      list: vi.fn().mockResolvedValue([
        { path: 'INBOX', name: 'INBOX', specialUse: '\\Inbox', flags: new Set(['\\Inbox']) },
        { path: 'TrashFolder', name: 'TrashFolder', specialUse: '\\Trash', flags: new Set(['\\Trash']) },
      ]),
    } as any

    const trash = await findTrashFolder(mockClient)
    expect(trash).toBe('TrashFolder')
  })

  it('detects French Gmail trash [Gmail]/Corbeille via localized fallback', async () => {
    const mockClient = {
      list: vi.fn().mockResolvedValue([
        { path: 'INBOX', name: 'INBOX', specialUse: '', flags: new Set() },
        { path: '[Gmail]/Corbeille', name: 'Corbeille', specialUse: '', flags: new Set() },
        { path: '[Gmail]/Envoyés', name: 'Envoyés', specialUse: '', flags: new Set() },
      ]),
    } as any

    const trash = await findTrashFolder(mockClient)
    expect(trash).toBe('[Gmail]/Corbeille')
  })

  it('detects Orange.fr / Apple Mail "Deleted Messages"', async () => {
    const mockClient = {
      list: vi.fn().mockResolvedValue([
        { path: 'INBOX', name: 'INBOX', specialUse: '', flags: new Set() },
        { path: 'Deleted Messages', name: 'Deleted Messages', specialUse: '', flags: new Set() },
      ]),
    } as any

    const trash = await findTrashFolder(mockClient)
    expect(trash).toBe('Deleted Messages')
  })
})

describe('isSenderOnlyFilter', () => {
  it('returns true when only from_email or from_domain conditions are present', () => {
    const filter: Filter = {
      id: 1,
      name: 'Block Spammers',
      enabled: true,
      logic: 'OR',
      conditions: [
        { id: 1, filter_id: 1, field: 'from_email', match_type: 'equals', values: ['bad@spam.com'] },
        { id: 2, filter_id: 1, field: 'from_domain', match_type: 'equals', values: ['infos-klm.com'] },
      ],
      created_at: '',
      updated_at: '',
    }
    expect(isSenderOnlyFilter(filter)).toBe(true)
  })

  it('returns false when content-based conditions (subject, body, header) are present', () => {
    const filter: Filter = {
      id: 2,
      name: 'Promo filter',
      enabled: true,
      logic: 'AND',
      conditions: [
        { id: 3, filter_id: 2, field: 'from_domain', match_type: 'equals', values: ['promo.com'] },
        { id: 4, filter_id: 2, field: 'subject', match_type: 'contains', values: ['sale'] },
      ],
      created_at: '',
      updated_at: '',
    }
    expect(isSenderOnlyFilter(filter)).toBe(false)
  })
})

describe('FolderWatcher rapid-fire concurrency & pendingRescan simulation', () => {
  it('guarantees that subsequent exists triggers during active scan are queued and processed', async () => {
    let pendingRescan = false
    let processing = false
    let highestSeenUid = 100
    const processedUids: number[] = []

    // Mock search returning new UIDs
    let incomingBatches = [
      [101, 102], // First burst
      [103, 104], // Second burst arriving while first is processing
    ]

    async function processBatch() {
      const uids = incomingBatches.shift() || []
      const newUids = uids.filter((u) => u > highestSeenUid)
      for (const u of newUids) {
        processedUids.push(u)
      }
      if (newUids.length > 0) {
        highestSeenUid = Math.max(highestSeenUid, ...newUids)
      }
    }

    async function triggerScan() {
      if (processing) return
      processing = true
      try {
        while (true) {
          pendingRescan = false
          await processBatch()
          if (!pendingRescan) break
        }
      } finally {
        processing = false
      }
    }

    function onExists() {
      if (processing) {
        pendingRescan = true
        return
      }
      void triggerScan()
    }

    // Email 101, 102 arrive -> triggers initial scan
    const scanPromise = triggerScan()

    // While scanning batch 1, rapid emails 103, 104 arrive -> triggers exists
    onExists()
    expect(pendingRescan).toBe(true)

    await scanPromise

    // Verify all 4 emails were processed, none dropped!
    expect(processedUids).toEqual([101, 102, 103, 104])
    expect(highestSeenUid).toBe(104)
  })
})
