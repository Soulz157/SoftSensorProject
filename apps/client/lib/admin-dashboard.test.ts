import { describe, expect, it } from 'vitest'
import {
  activityVerb,
  adminSummarySegments,
  equipmentDetail,
  equipmentParts,
  needsAttention,
  ownerName,
  pageFromServer,
} from './admin-dashboard'

describe('ownerName', () => {
  it('joins first and last name', () => {
    expect(
      ownerName({ id: '1', firstName: 'Nok', lastName: 'S.', email: 'n@x.co' }),
    ).toBe('Nok S.')
  })

  it('falls back to the e-mail when no name is set', () => {
    expect(
      ownerName({ id: '1', firstName: null, lastName: ' ', email: 'n@x.co' }),
    ).toBe('n@x.co')
  })

  it('works with only one name part', () => {
    expect(
      ownerName({ id: '1', firstName: 'Nok', lastName: null, email: 'n@x.co' }),
    ).toBe('Nok')
  })
})

describe('equipmentDetail', () => {
  it('says what is wrong, alarms first', () => {
    expect(
      equipmentDetail({ alarmCount: 2, warningCount: 1, offlineCount: 3 }),
    ).toBe('2 in alarm · 1 warning · 3 offline')
  })

  it('pluralises warnings and omits zeros', () => {
    expect(equipmentDetail({ warningCount: 2 })).toBe('2 warnings')
    expect(equipmentDetail({ alarmCount: 0, offlineCount: 1 })).toBe(
      '1 offline',
    )
  })

  it('is null when nothing is wrong, or the counts are absent', () => {
    expect(equipmentDetail({})).toBeNull()
    expect(equipmentDetail({ alarmCount: 0, warningCount: 0 })).toBeNull()
  })
})

describe('equipmentParts', () => {
  it('separates the alarm part from the rest, so only alarms get coloured', () => {
    expect(
      equipmentParts({ alarmCount: 2, warningCount: 1, offlineCount: 3 }),
    ).toEqual({ alarm: '2 in alarm', other: '1 warning · 3 offline' })
    expect(equipmentParts({ offlineCount: 1 })).toEqual({
      alarm: null,
      other: '1 offline',
    })
    expect(equipmentParts({})).toEqual({ alarm: null, other: null })
  })
})

describe('needsAttention', () => {
  it('is true only for alarm — warning and offline read normal', () => {
    expect(needsAttention({ status: 'alarm' })).toBe(true)
    expect(needsAttention({ status: 'warning' })).toBe(false)
    expect(needsAttention({ status: 'offline' })).toBe(false)
    expect(needsAttention({ status: undefined })).toBe(false)
  })
})

describe('adminSummarySegments', () => {
  it('builds the summary line with plurals', () => {
    const s = adminSummarySegments({
      total: 12,
      attention: 2,
      models: 46,
      users: 1,
    })
    expect(s.map(x => x.text)).toEqual([
      '12 workspaces',
      '2 need attention',
      '46 models',
      '1 user',
    ])
    expect(s.find(x => x.key === 'attention')?.attention).toBe(true)
  })

  it('singular forms', () => {
    const s = adminSummarySegments({
      total: 1,
      attention: 1,
      models: 1,
      users: 1,
    })
    expect(s.map(x => x.text)).toEqual([
      '1 workspace',
      '1 needs attention',
      '1 model',
      '1 user',
    ])
  })

  it('shows "—" for anything not loaded, and no attention colour', () => {
    const s = adminSummarySegments({
      total: null,
      attention: null,
      models: null,
      users: null,
    })
    expect(s.map(x => x.text)).toEqual([
      '— workspaces',
      '— need attention',
      '— models',
      '— users',
    ])
    // The header renders these as aria-hidden "—" plus sr-only "unknown".
    expect(s.every(x => x.value === null)).toBe(true)
    expect(s.some(x => x.attention)).toBe(false)
  })

  it('a genuine zero is 0, without the attention colour', () => {
    const s = adminSummarySegments({
      total: 3,
      attention: 0,
      models: 0,
      users: 0,
    })
    expect(s[1]).toMatchObject({ text: '0 need attention', attention: false })
    expect(s[2]?.text).toBe('0 models')
  })
})

describe('activityVerb', () => {
  it('reads admin activity as sign-in and sign-out', () => {
    expect(activityVerb('LOGIN')).toBe('signed in')
    expect(activityVerb('LOGOUT')).toBe('signed out')
  })
})

describe('pageFromServer', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => i)

  it('reads the range and page count off the page the server answered with', () => {
    expect(
      pageFromServer({ items: rows(15), total: 40, page: 2, limit: 15 }),
    ).toMatchObject({ page: 2, pageCount: 3, from: 16, to: 30, total: 40 })
    expect(
      pageFromServer({ items: rows(10), total: 40, page: 3, limit: 15 }),
    ).toMatchObject({ from: 31, to: 40 })
  })

  it('labels from data.page, so page-1 rows are never shown under "16–30"', () => {
    // The user asked for page 2; the old page-1 rows are still on screen.
    const label = pageFromServer({
      items: rows(15),
      total: 40,
      page: 1,
      limit: 15,
    })
    expect(label).toMatchObject({ page: 1, from: 1, to: 15 })
  })

  it('keeps an out-of-range page, with an empty range and the true total', () => {
    expect(
      pageFromServer({ items: [], total: 40, page: 9, limit: 15 }),
    ).toMatchObject({
      items: [],
      page: 9,
      pageCount: 3,
      from: 0,
      to: 0,
      total: 40,
    })
  })

  it('reads "not loaded" as an empty first page', () => {
    expect(pageFromServer(null)).toMatchObject({
      items: [],
      page: 1,
      pageCount: 1,
      total: 0,
    })
  })
})
