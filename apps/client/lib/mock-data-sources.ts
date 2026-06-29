/**
 * Mock saved data-source connections.
 *
 * Phase 6 placeholder — same approved exception pattern as `lib/mock-pi-servers.ts`.
 * Swap path: replace `MOCK_DATA_SOURCES` with a `fetchClient('/api/v1/authorized/data-sources')`
 * call returning `SavedDataSource[]` — one-file change.
 */

export type DataSourceKind = 'aveva' | 'sql' | 'csv' | 'api'

export interface SavedDataSource {
  id: string
  name: string
  type: DataSourceKind
  host: string
  username: string
  /** Placeholder only — never stored or transmitted in clear text. */
  password: string
  dbName: string
  status: 'connected' | 'offline'
  /** ISO date YYYY-MM-DD */
  lastUsed: string
  createdBy: string
}

export const MOCK_DATA_SOURCES: SavedDataSource[] = [
  {
    id: 'ds-1',
    name: 'Main Plant Historian (PI)',
    type: 'aveva',
    host: '192.168.1.10',
    username: 'piuser',
    password: '••••••',
    dbName: '',
    status: 'connected',
    lastUsed: '2026-06-23',
    createdBy: 'System Admin',
  },
  {
    id: 'ds-2',
    name: 'Pump Station SQL DB',
    type: 'sql',
    host: 'db.plant.local',
    username: 'readonly',
    password: '••••••',
    dbName: 'pump_station',
    status: 'connected',
    lastUsed: '2026-06-20',
    createdBy: 'Engineering Team',
  },
  {
    id: 'ds-3',
    name: 'Compressor API Gateway',
    type: 'api',
    host: 'api.compressor.local',
    username: 'svc_account',
    password: '••••••',
    dbName: '',
    status: 'offline',
    lastUsed: '2026-06-15',
    createdBy: 'Engineering Team',
  },
]
