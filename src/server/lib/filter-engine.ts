import type {
  Filter,
  FilterCondition,
  MatchType,
  ParsedEmail,
} from '../types.js'

// ─── Low-level matcher ───────────────────────────────────────────────────────

function matchSingle(value: string, candidate: string, type: MatchType): boolean {
  const v = value.toLowerCase()
  const c = candidate.toLowerCase()
  switch (type) {
    case 'equals':
      return c === v
    case 'contains':
      return c.includes(v)
    case 'starts_with':
      return c.startsWith(v)
    case 'ends_with':
      return c.endsWith(v)
    case 'regex': {
      try {
        return new RegExp(value, 'i').test(candidate)
      } catch {
        return false
      }
    }
    default:
      return false
  }
}

// ─── Condition evaluation ────────────────────────────────────────────────────

function getFieldValue(email: ParsedEmail, condition: FilterCondition): string | string[] {
  switch (condition.field) {
    case 'from_email':
      return email.from_email
    case 'from_domain':
      return email.from_domain
    case 'from_name':
      return email.from_name
    case 'subject':
      return email.subject
    case 'body':
      return email.body
    case 'header': {
      // For header field, values[0] is the header name, rest are match values.
      // We return all values of that header joined.
      const [headerName, ...matchValues] = condition.values
      if (!headerName) return ''
      const headerVals = email.headers[headerName.toLowerCase()] ?? []
      // override condition values to only the actual match values
      ;(condition as any).__headerMatchValues = matchValues
      return headerVals.join('\n')
    }
    default:
      return ''
  }
}

/**
 * Returns true if the condition matches the email.
 * A condition matches if ANY of its values matches the email field.
 */
export function evaluateCondition(
  email: ParsedEmail,
  condition: FilterCondition
): boolean {
  let fieldValue: string | string[]
  let matchValues: string[]

  if (condition.field === 'header') {
    // Special case: values = [headerName, matchVal1, matchVal2, ...]
    const [headerName, ...rest] = condition.values
    if (!headerName || rest.length === 0) return false
    const headerVals = email.headers[headerName.toLowerCase()] ?? []
    fieldValue = headerVals.join('\n')
    matchValues = rest
  } else {
    fieldValue = getFieldValue(email, condition) as string
    matchValues = condition.values
  }

  // Any value in the list triggers the condition
  return matchValues.some((v) =>
    matchSingle(v, fieldValue as string, condition.match_type)
  )
}

// ─── Filter evaluation ───────────────────────────────────────────────────────

/**
 * Returns true if the email matches the filter.
 * - Logic AND: every condition must match
 * - Logic OR: at least one condition must match
 */
export function evaluateFilter(email: ParsedEmail, filter: Filter): boolean {
  if (!filter.enabled) return false
  if (filter.conditions.length === 0) return false

  if (filter.logic === 'AND') {
    return filter.conditions.every((c) => evaluateCondition(email, c))
  }
  return filter.conditions.some((c) => evaluateCondition(email, c))
}

/**
 * Find the first filter that matches the email.
 * Returns the matching filter or undefined.
 */
export function findMatchingFilter(
  email: ParsedEmail,
  filters: Filter[]
): Filter | undefined {
  return filters.find((f) => evaluateFilter(email, f))
}
