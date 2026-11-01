'use client'

import { useState } from 'react'
import { clearChartRequestCache } from '@/lib/chart-request-cache'
import {
  mockResponse,
  type MockupModel,
  type MonitoringFixture,
} from '@/lib/monitoring-mockup'

/** sessionStorage flag, set from `/dev/monitoring-mockup`. Per browser tab. */
export const MONITORING_MOCKUP_FLAG = 'monitoring-mockup'

/** ModelTest 1 — the model the fixture was generated for. */
export const MOCKUP_MODEL: MockupModel = {
  modelId: 'c1f7180b-fe05-4bc6-a66d-1af05751cc9c',
  modelVersionId: '3b8fa678-7e0d-493e-9946-45c852348cc0',
  version: 1,
  // The PRODUCTION run's own test residual SD (ModelTrainingRun.metrics.sd).
  baselineSd: 8.432461,
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

export function monitoringMockupEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(MONITORING_MOCKUP_FLAG) === 'on'
  } catch {
    return false
  }
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

/** The models list carries the derived deploy fields; show the model running. */
function markRunning(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(markRunning)
  if (value === null || typeof value !== 'object') return value
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) out[k] = markRunning(v)
  if (
    obj.id === MOCKUP_MODEL.modelId &&
    out.data !== null &&
    typeof out.data === 'object'
  ) {
    out.data = {
      ...(out.data as Record<string, unknown>),
      deployStatus: 'running',
      enabled: true,
      prodStatus: 'normal',
      lastFailure: null,
    }
  }
  return out
}

/**
 * Answers ModelTest 1's monitoring reads from the fixture; every other
 * request reaches the real backend (the models list only gets its deploy
 * fields overlaid). Returns the uninstaller.
 */
function installFetchPatch(load: () => Promise<MonitoringFixture>): () => void {
  const original = window.fetch

  const patched: typeof fetch = async (input, init) => {
    const href =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase()
    if (API_BASE === '' || !href.startsWith(API_BASE) || method !== 'GET') {
      return original(input, init)
    }
    const url = new URL(href)
    const fixture = await load()
    const data = mockResponse(fixture, MOCKUP_MODEL, url, Date.now())
    if (data !== undefined) {
      return json({
        statusCode: 200,
        message: 'Monitoring mockup',
        type: 'SUCCESS',
        data,
      })
    }

    const res = await original(input, init)
    if (
      !url.pathname.includes('/model') ||
      !(res.headers.get('content-type') ?? '').includes('json')
    ) {
      return res
    }
    const text = await res.text()
    let body = text
    try {
      body = JSON.stringify(markRunning(JSON.parse(text) as unknown))
    } catch {
      // Not JSON after all — pass it through untouched.
    }
    const headers = new Headers(res.headers)
    headers.delete('content-length')
    return new Response(body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    })
  }

  window.fetch = patched
  return () => {
    if (window.fetch === patched) window.fetch = original
  }
}

let installed = false

/**
 * Dev-only document mockup of ModelTest 1's Monitoring tab: the REAL page,
 * fed a fixture built from the fake PI (see lib/monitoring-mockup.ts).
 * Mounted BEFORE `MockupNamesPatch` so that patch wraps this one and the
 * fixture's tag names get the document mock names too. Renders nothing.
 */
export function MonitoringMockupPatch() {
  useState(() => {
    if (!monitoringMockupEnabled() || installed) return false
    installed = true
    clearChartRequestCache()
    let cached: Promise<MonitoringFixture> | null = null
    installFetchPatch(() => {
      cached ??= import('./monitoring-mockup-data.json').then(
        m => m.default as unknown as MonitoringFixture,
      )
      return cached
    })
    return true
  })
  return null
}
