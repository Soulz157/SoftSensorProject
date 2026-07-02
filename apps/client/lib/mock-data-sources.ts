export type DataSourceKind = 'aveva' | 'sql' | 'csv' | 'api'

export interface SavedDataSource {
  id: string
  name: string
  type: DataSourceKind
  host: string
  username: string
  /** Not returned by API — only present when locally constructed in the dialog. */
  password?: string
  dbName: string
  status: 'connected' | 'offline'
  /** ISO date YYYY-MM-DD */
  lastUsed: string
  createdBy: string
}
