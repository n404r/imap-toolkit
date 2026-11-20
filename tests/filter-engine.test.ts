import { describe, it, expect } from 'vitest'
import { evaluateCondition, evaluateFilter, findMatchingFilter } from '../src/server/lib/filter-engine.js'
import type { Filter, FilterCondition, ParsedEmail } from '../src/server/types.js'

const email: ParsedEmail = {
  from_email: 'promo@marketing.example.com',
  from_domain: 'marketing.example.com',
  from_name: 'Example Marketing',
  subject: 'Big Sale! 50% off everything',
  body: 'Click here to unsubscribe from future emails.',
  headers: {
    'list-unsubscribe': ['<mailto:unsub@example.com>'],
    'x-mailer': ['MailChimp'],
  },
}

function makeCondition(
  overrides: Partial<FilterCondition> & Pick<FilterCondition, 'field' | 'match_type' | 'values'>
): FilterCondition {
  return { id: 1, filter_id: 1, ...overrides }
}

function makeFilter(
  overrides: Partial<Filter> & { conditions: FilterCondition[] }
): Filter {
  return {
    id: 1,
    name: 'Test',
    enabled: true,
    logic: 'AND',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

// ─── evaluateCondition ────────────────────────────────────────────────────────

describe('evaluateCondition – from_email', () => {
  it('equals match', () => {
    expect(
      evaluateCondition(email, makeCondition({ field: 'from_email', match_type: 'equals', values: ['promo@marketing.example.com'] }))
    ).toBe(true)
  })
  it('equals miss', () => {
    expect(
      evaluateCondition(email, makeCondition({ field: 'from_email', match_type: 'equals', values: ['other@example.com'] }))
    ).toBe(false)
  })
  it('contains match', () => {
    expect(
      evaluateCondition(email, makeCondition({ field: 'from_email', match_type: 'contains', values: ['marketing'] }))
    ).toBe(true)
  })
  it('starts_with match', () => {
    expect(
      evaluateCondition(email, makeCondition({ field: 'from_email', match_type: 'starts_with', values: ['promo@'] }))
    ).toBe(true)
  })
  it('ends_with match', () => {
    expect(
      evaluateCondition(email, makeCondition({ field: 'from_email', match_type: 'ends_with', values: ['.com'] }))
    ).toBe(true)
  })
  it('regex match', () => {
    expect(
      evaluateCondition(email, makeCondition({ field: 'from_email', match_type: 'regex', values: ['promo@.*\\.com'] }))
    ).toBe(true)
  })
  it('regex miss', () => {
    expect(
      evaluateCondition(email, makeCondition({ field: 'from_email', match_type: 'regex', values: ['^admin@'] }))
    ).toBe(false)
  })
  it('invalid regex does not throw, returns false', () => {
    expect(
      evaluateCondition(email, makeCondition({ field: 'from_email', match_type: 'regex', values: ['[invalid'] }))
    ).toBe(false)
  })
})

describe('evaluateCondition – multi-value OR semantics', () => {
  it('any matching value triggers condition', () => {
    expect(
      evaluateCondition(
        email,
        makeCondition({ field: 'from_domain', match_type: 'equals', values: ['other.com', 'marketing.example.com', 'yet.com'] })
      )
    ).toBe(true)
  })
  it('none matching returns false', () => {
    expect(
      evaluateCondition(
        email,
        makeCondition({ field: 'from_domain', match_type: 'equals', values: ['a.com', 'b.com'] })
      )
    ).toBe(false)
  })
})

describe('evaluateCondition – subject', () => {
  it('contains "Sale"', () => {
    expect(
      evaluateCondition(email, makeCondition({ field: 'subject', match_type: 'contains', values: ['sale'] }))
    ).toBe(true)
  })
})

describe('evaluateCondition – body', () => {
  it('contains "unsubscribe"', () => {
    expect(
      evaluateCondition(email, makeCondition({ field: 'body', match_type: 'contains', values: ['unsubscribe'] }))
    ).toBe(true)
  })
})

describe('evaluateCondition – header', () => {
  it('list-unsubscribe header contains mailto', () => {
    expect(
      evaluateCondition(
        email,
        makeCondition({ field: 'header', match_type: 'contains', values: ['list-unsubscribe', 'mailto'] })
      )
    ).toBe(true)
  })
  it('missing header returns false', () => {
    expect(
      evaluateCondition(
        email,
        makeCondition({ field: 'header', match_type: 'contains', values: ['x-nonexistent', 'value'] })
      )
    ).toBe(false)
  })
  it('missing match values returns false', () => {
    expect(
      evaluateCondition(
        email,
        makeCondition({ field: 'header', match_type: 'contains', values: ['list-unsubscribe'] })
      )
    ).toBe(false)
  })
})

// ─── evaluateFilter ───────────────────────────────────────────────────────────

describe('evaluateFilter – AND logic', () => {
  const c1 = makeCondition({ field: 'from_domain', match_type: 'contains', values: ['marketing'] })
  const c2 = makeCondition({ field: 'subject', match_type: 'contains', values: ['sale'] })
  const c3 = makeCondition({ field: 'subject', match_type: 'contains', values: ['NOMATCH'] })

  it('all match → true', () => {
    expect(evaluateFilter(email, makeFilter({ conditions: [c1, c2], logic: 'AND' }))).toBe(true)
  })
  it('one miss → false', () => {
    expect(evaluateFilter(email, makeFilter({ conditions: [c1, c3], logic: 'AND' }))).toBe(false)
  })
  it('disabled filter → false', () => {
    expect(evaluateFilter(email, makeFilter({ conditions: [c1, c2], logic: 'AND', enabled: false }))).toBe(false)
  })
  it('no conditions → false', () => {
    expect(evaluateFilter(email, makeFilter({ conditions: [], logic: 'AND' }))).toBe(false)
  })
})

describe('evaluateFilter – OR logic', () => {
  const c1 = makeCondition({ field: 'subject', match_type: 'contains', values: ['NOMATCH'] })
  const c2 = makeCondition({ field: 'subject', match_type: 'contains', values: ['sale'] })

  it('one match → true', () => {
    expect(evaluateFilter(email, makeFilter({ conditions: [c1, c2], logic: 'OR' }))).toBe(true)
  })
  it('none match → false', () => {
    expect(
      evaluateFilter(
        email,
        makeFilter({ conditions: [c1], logic: 'OR' })
      )
    ).toBe(false)
  })
})

// ─── findMatchingFilter ───────────────────────────────────────────────────────

describe('findMatchingFilter', () => {
  const spamFilter: Filter = makeFilter({
    id: 10,
    name: 'Spam',
    conditions: [makeCondition({ field: 'body', match_type: 'contains', values: ['unsubscribe'] })],
  })
  const promoFilter: Filter = makeFilter({
    id: 11,
    name: 'Promo',
    conditions: [makeCondition({ field: 'subject', match_type: 'contains', values: ['sale'] })],
  })
  const noMatchFilter: Filter = makeFilter({
    id: 12,
    name: 'NoMatch',
    conditions: [makeCondition({ field: 'from_email', match_type: 'equals', values: ['nobody@nowhere.com'] })],
  })

  it('returns first matching filter', () => {
    expect(findMatchingFilter(email, [spamFilter, promoFilter])).toBe(spamFilter)
  })
  it('returns undefined when nothing matches', () => {
    expect(findMatchingFilter(email, [noMatchFilter])).toBeUndefined()
  })
  it('returns undefined for empty list', () => {
    expect(findMatchingFilter(email, [])).toBeUndefined()
  })
})
