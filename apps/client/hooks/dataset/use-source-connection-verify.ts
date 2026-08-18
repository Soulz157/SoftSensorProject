import { useCallback, useState } from 'react'
import { dataSourceService } from '@/services/data-sources'
import type { VerifyState } from '@/lib/connection-status'

export interface SourceVerifyStatus {
  state: VerifyState
  message: string
}

const IDLE: SourceVerifyStatus = { state: 'idle', message: '' }

export interface UseSourceConnectionVerifyResult {
  /** Per-source verify status, keyed by source id (missing = idle). */
  statuses: Record<string, SourceVerifyStatus>
  /** Read one source's status (never undefined). */
  statusFor: (id: string) => SourceVerifyStatus
  /** Run F6 test-connection for a saved source and record the result. */
  verify: (id: string) => void
}

/**
 * Drive the wizard Verify-Connection panel (P8): calls the F6
 * `testConnection(id)` for a saved source and tracks per-source lifecycle
 * (idle → testing → ok/error). A non-2xx response throws in `fetchClient`; a
 * 2xx with `ok:false` (e.g. PI data server not found) is an `error` state with
 * the backend message. State is component-local — verifying is an ephemeral
 * check, not persisted wizard state.
 */
export function useSourceConnectionVerify(): UseSourceConnectionVerifyResult {
  const [statuses, setStatuses] = useState<Record<string, SourceVerifyStatus>>(
    {},
  )

  const verify = useCallback((id: string) => {
    setStatuses(prev => ({ ...prev, [id]: { state: 'testing', message: '' } }))
    dataSourceService
      .testConnection(id)
      .then(res => {
        setStatuses(prev => ({
          ...prev,
          [id]: {
            state: res.data.ok ? 'ok' : 'error',
            message: res.data.message,
          },
        }))
      })
      .catch((err: unknown) => {
        setStatuses(prev => ({
          ...prev,
          [id]: {
            state: 'error',
            message:
              err instanceof Error ? err.message : 'Connection test failed.',
          },
        }))
      })
  }, [])

  const statusFor = useCallback(
    (id: string) => statuses[id] ?? IDLE,
    [statuses],
  )

  return { statuses, statusFor, verify }
}
