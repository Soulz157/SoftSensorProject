import { type NodeStatus } from '@/store/status-colors'
import { toBinaryStatus } from '@/lib/overview-status'

/** Workspace accent → hex, for the focus / selected rings. */
export const COLOR_HEX: Record<string, string> = {
  blue: '#3b82f6',
  violet: '#8b5cf6',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e',
  cyan: '#06b6d4',
}

export const DEFAULT_ACCENT_HEX = '#3b82f6'

export type Skin = {
  line: string
  dim: string
  glow: string
  f0: string
  f1: string
  f2: string
  deck: string
  deckSide: string
}

const SKIN: Record<'normal' | 'abnormal' | 'offline', Skin> = {
  normal: {
    line: '#22c55e',
    dim: '#166534',
    glow: '#86efac',
    f0: '#0f2e1c',
    f1: '#0a2013',
    f2: '#051209',
    deck: '#0a1f12',
    deckSide: '#061309',
  },
  abnormal: {
    line: '#f43f5e',
    dim: '#881337',
    glow: '#fda4af',
    f0: '#31101a',
    f1: '#240b12',
    f2: '#160609',
    deck: '#2a0e16',
    deckSide: '#18070c',
  },
  offline: {
    line: '#94a3b8',
    dim: '#3f4c5f',
    glow: '#cbd5e1',
    f0: '#1c232c',
    f1: '#151b22',
    f2: '#0e1216',
    deck: '#181f26',
    deckSide: '#0f1419',
  },
}

/** Offline keeps its own grey skin; everything else follows the binary rule. */
export function skinFor(status: NodeStatus): Skin {
  return SKIN[status === 'offline' ? 'offline' : toBinaryStatus(status)]
}
