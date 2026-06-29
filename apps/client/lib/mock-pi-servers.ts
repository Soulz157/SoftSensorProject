/**
 * Mock PI server list.
 *
 * Placeholder until Phase 6 (real PI connector) lands — only one server is
 * configured today (`docs/PI_DATA.md`, `PI_NAME = "TPERYPIDH01"`). Same
 * "approved mock-data exception" pattern as `lib/mock-readings.ts`.
 *
 * Pure module — no React, no IO.
 */

export interface PiServer {
  id: string
  name: string
  host: string
  status: 'online' | 'offline'
}

export const MOCK_PI_SERVERS: PiServer[] = [
  {
    id: 'pi-server-1',
    name: 'TPERYPIDH01',
    host: 'pi-web-api.internal',
    status: 'online',
  },
]

export function getDefaultPiServer(): PiServer {
  return MOCK_PI_SERVERS[0] as PiServer
}
