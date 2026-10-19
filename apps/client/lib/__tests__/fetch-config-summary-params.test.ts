import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FETCH_CONFIG,
  piSummaryParams,
  withPiFetchSettings,
} from '@/lib/fetch-config'

describe('piSummaryParams', () => {
  it('derives the bucket from the period when no override is set', () => {
    expect(piSummaryParams(DEFAULT_FETCH_CONFIG, '1h', null)).toEqual({
      summaryDuration: '1h',
      calBasis: 'TimeWeighted',
      summaryType: ['Average'],
      batchSize: 300,
    })
    expect(
      piSummaryParams(DEFAULT_FETCH_CONFIG, '1min', { value: 15, unit: 'min' })
        .summaryDuration,
    ).toBe('15m')
  })

  it('an override bucket wins, and the summary settings ride along', () => {
    expect(
      piSummaryParams(
        {
          calBasis: 'EventWeighted',
          summaryType: ['Maximum'],
          summaryDuration: ' 30m ',
          batchSize: 20,
        },
        '1h',
        null,
      ),
    ).toEqual({
      summaryDuration: '30m',
      calBasis: 'EventWeighted',
      summaryType: ['Maximum'],
      batchSize: 20,
    })
  })

  it('a recipe saved before fetchConfig was stored gets python’s own defaults', () => {
    expect(piSummaryParams(undefined, '1min', null)).toEqual({
      summaryDuration: '1m',
      calBasis: 'TimeWeighted',
      summaryType: ['Average'],
      batchSize: 300,
    })
  })
})

describe('withPiFetchSettings', () => {
  it('stamps every PI config with the bucket and summary settings inference fetches with', () => {
    const out = withPiFetchSettings(
      {
        'src-pi': {
          type: 'pi',
          piServerUrl: '\\\\pi\\PI',
          calcType: 'Average',
          calcBasis: 'TimeWeighted',
          intervalTime: '1m',
        },
        'src-sql': { type: 'sql', connectionString: 'db', query: 'select 1' },
      } as Parameters<typeof withPiFetchSettings>[0],
      {
        summaryDuration: '1h',
        calBasis: 'EventWeighted',
        summaryType: ['Maximum'],
        batchSize: 300,
      },
    )
    expect(out['src-pi']).toMatchObject({
      intervalTime: '1h',
      calcBasis: 'EventWeighted',
      calcType: 'Maximum',
      piServerUrl: '\\\\pi\\PI',
    })
    expect(out['src-sql']).toEqual({
      type: 'sql',
      connectionString: 'db',
      query: 'select 1',
    })
  })
})
