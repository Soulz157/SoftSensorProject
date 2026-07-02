'use client'

import { cn } from '@/lib/utils'
import {
  type DataSourceConfig,
  DEFAULT_PI_CONFIG,
  DEFAULT_SQL_CONFIG,
  DEFAULT_REST_API_CONFIG,
  DEFAULT_CSV_CONFIG,
} from '@/store/model-pipeline'
import type { SavedDataSource, DataSourceKind } from '@/lib/mock-data-sources'
import { PIConfigForm } from './pi-config-form'
import { SQLConfigForm } from './sql-config-form'
import { RestApiConfigForm } from './rest-api-config-form'
import { CSVConfigForm } from './csv-config-form'
import { KIND_META } from '../add-connection-dialog'

export function defaultConfigForKind(kind: DataSourceKind): DataSourceConfig {
  switch (kind) {
    case 'aveva':
      return { ...DEFAULT_PI_CONFIG }
    case 'sql':
      return { ...DEFAULT_SQL_CONFIG }
    case 'api':
      return { ...DEFAULT_REST_API_CONFIG }
    case 'csv':
      return { ...DEFAULT_CSV_CONFIG }
  }
}

/**
 * Prefill a fetch config from the Phase-2 saved source so the card shows the
 * *inherited* connection details instead of blanks. Backend `SavedDataSource`
 * only stores `host`/`dbName`/`username`, so higher-level fields (calc type,
 * method, interval) fall back to their kind defaults and stay editable.
 */
export function configFromSource(source: SavedDataSource): DataSourceConfig {
  const host = source.host.trim()
  const db = source.dbName.trim()
  switch (source.type) {
    case 'aveva':
      return {
        ...DEFAULT_PI_CONFIG,
        endpoint: host ? `https://${host}/piwebapi` : '',
        piServerUrl: host ? `\\\\${host}\\PI` : db,
      }
    case 'sql':
      return {
        ...DEFAULT_SQL_CONFIG,
        connectionString: [host, db].filter(Boolean).join('/'),
      }
    case 'api':
      return {
        ...DEFAULT_REST_API_CONFIG,
        url: host ? `https://${host}` : '',
      }
    case 'csv':
      return { ...DEFAULT_CSV_CONFIG }
  }
}

interface Props {
  source: SavedDataSource
  config: DataSourceConfig
  onChange: (config: DataSourceConfig) => void
  disabled?: boolean
}

export function SourceFetchConfigCard({
  source,
  config,
  onChange,
  disabled,
}: Props) {
  const { icon: Icon, label } = KIND_META[source.type]

  return (
    <div
      className={cn(
        'space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{source.name}</p>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {label}
        </span>
      </div>

      {config.type === 'pi' && (
        <PIConfigForm config={config} onChange={onChange} disabled={disabled} />
      )}
      {config.type === 'sql' && (
        <SQLConfigForm
          config={config}
          onChange={onChange}
          disabled={disabled}
        />
      )}
      {config.type === 'rest_api' && (
        <RestApiConfigForm
          config={config}
          onChange={onChange}
          disabled={disabled}
        />
      )}
      {config.type === 'csv' && (
        <CSVConfigForm
          config={config}
          onChange={onChange}
          disabled={disabled}
        />
      )}
    </div>
  )
}
