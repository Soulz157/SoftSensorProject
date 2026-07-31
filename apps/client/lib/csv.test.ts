import { describe, expect, it } from 'vitest'
import {
  csvToDataset,
  datasetCsvFilename,
  datasetToCsv,
  detectTimestampColumn,
  parseCsvText,
} from './csv'
import { MATERIALIZE_EPOCH } from '@/lib/pipeline-config'
import type { Dataset } from '@/lib/preprocessing'

describe('datasetCsvFilename', () => {
  it('slugs the dataset name', () => {
    expect(datasetCsvFilename('Boiler Feed #2', '24h')).toBe(
      'boiler-feed-2.csv',
    )
  })

  it('collapses runs of non-alphanumerics and trims edges', () => {
    expect(datasetCsvFilename('  --Reactor__Temp!!  ', '1h')).toBe(
      'reactor-temp.csv',
    )
  })

  it('falls back to pi-readings-<range> for a blank name', () => {
    expect(datasetCsvFilename('', '7d')).toBe('pi-readings-7d.csv')
    expect(datasetCsvFilename('   ', '7d')).toBe('pi-readings-7d.csv')
  })

  it('falls back when the name slugs to nothing', () => {
    expect(datasetCsvFilename('!!!', '1min')).toBe('pi-readings-1min.csv')
  })
})

describe('datasetToCsv', () => {
  it('serializes header + blank for missing cells and RFC-4180 quotes', () => {
    const ds: Dataset = {
      tags: ['a,b', 'c'],
      rows: [
        {
          timestamp: '2026-06-22 00:00:00',
          cells: { 'a,b': { value: 1, status: 'Good' } },
        },
      ],
    }
    expect(datasetToCsv(ds)).toBe('timestamp,"a,b",c\n2026-06-22 00:00:00,1,')
  })
})

describe('parseCsvText', () => {
  it('reads header + rows, trimming quotes and CR', () => {
    const parsed = parseCsvText('"ts", a \r\n2026-01-01,1\r\n')
    expect(parsed.columns).toEqual(['ts', 'a'])
    expect(parsed.rows).toEqual([{ ts: '2026-01-01', a: '1' }])
  })

  it('skips blank lines and pads short rows', () => {
    const parsed = parseCsvText('ts,a,b\n\n2026-01-01,1\n')
    expect(parsed.rows).toEqual([{ ts: '2026-01-01', a: '1', b: '' }])
  })

  it('returns empty for empty text', () => {
    expect(parseCsvText('')).toEqual({ columns: [], rows: [] })
  })
})

describe('detectTimestampColumn', () => {
  it('picks the first time-like column', () => {
    expect(detectTimestampColumn(['TI-101', 'Timestamp', 'date'])).toBe(
      'Timestamp',
    )
  })

  it('returns null when nothing looks like time', () => {
    expect(detectTimestampColumn(['TI-101', 'PI-303'])).toBeNull()
  })
})

describe('csvToDataset', () => {
  it('normalizes timestamps to ISO, sorts rows, and drops the time column from tags', () => {
    const ds = csvToDataset(
      parseCsvText(
        'timestamp,TI-101\n2026-01-02 00:00:00Z,2\n2026-01-01 00:00:00Z,1',
      ),
    )
    expect(ds.tags).toEqual(['TI-101'])
    expect(ds.rows.map(r => r.timestamp)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
    ])
    expect(ds.rows[0]?.cells['TI-101']).toEqual({ value: 1, status: 'Good' })
  })

  it('synthesizes a 1-minute series from the materialize epoch with no time column', () => {
    const ds = csvToDataset(parseCsvText('TI-101\n1\n2'))
    expect(ds.tags).toEqual(['TI-101'])
    expect(ds.rows.map(r => r.timestamp)).toEqual([
      new Date(MATERIALIZE_EPOCH).toISOString(),
      new Date(MATERIALIZE_EPOCH + 60_000).toISOString(),
    ])
  })

  it('marks blank and non-numeric cells Bad with value 0', () => {
    const ds = csvToDataset(parseCsvText('timestamp,a,b,c\n2026-01-01,,abc,3'))
    const cells = ds.rows[0]?.cells
    expect(cells?.a).toEqual({ value: 0, status: 'Bad' })
    expect(cells?.b).toEqual({ value: 0, status: 'Bad' })
    expect(cells?.c).toEqual({ value: 3, status: 'Good' })
  })

  it('backfills ragged rows so every row carries every tag', () => {
    const ds = csvToDataset(parseCsvText('timestamp,a,b\n2026-01-01,1'))
    expect(Object.keys(ds.rows[0]?.cells ?? {}).sort()).toEqual(['a', 'b'])
    expect(ds.rows[0]?.cells.b).toEqual({ value: 0, status: 'Bad' })
  })

  it('falls back to a synthetic timestamp for an unparseable time cell', () => {
    const ds = csvToDataset(parseCsvText('timestamp,a\nnot-a-date,1'))
    expect(ds.rows[0]?.timestamp).toBe(
      new Date(MATERIALIZE_EPOCH).toISOString(),
    )
  })

  it('collapses duplicate timestamps into one row', () => {
    const ds = csvToDataset(
      parseCsvText(
        'timestamp,a\n2026-01-01T00:00:00Z,1\n2026-01-01T00:00:00Z,5',
      ),
    )
    expect(ds.rows).toHaveLength(1)
    expect(ds.rows[0]?.cells.a).toEqual({ value: 5, status: 'Good' })
  })
})
