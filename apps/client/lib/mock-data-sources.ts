export type DataSourceKind = 'aveva' | 'sql' | 'csv' | 'api'

/**
 * Non-secret, type-specific connection fields. Persisted as DataSource.config
 * (JSON) on the backend; the secret (password / token / api key) is stored
 * separately encrypted and never lives here.
 */
export interface DataSourceConfig {
  // PI (aveva)
  piServer?: string
  // SQL
  driver?: string
  port?: number
  schema?: string
  // REST (api)
  baseUrl?: string
  endpoint?: string
  method?: string
  authType?: string
  apiKeyName?: string
  apiKeyLocation?: string
  headers?: Record<string, string>
}

export interface SavedDataSource {
  id: string
  name: string
  type: DataSourceKind
  host: string
  username: string
  /** Not returned by API — only present when locally constructed in the dialog. */
  password?: string
  dbName: string
  /** Non-secret type-specific fields (SQL driver/port, REST baseUrl/method, …). */
  config?: DataSourceConfig | null
  status: 'connected' | 'offline'
  /** ISO date YYYY-MM-DD */
  lastUsed: string
  createdBy: string
}
