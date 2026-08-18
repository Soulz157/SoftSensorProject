import '@testing-library/jest-dom'
import React from 'react'
import { vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: { src: string; alt: string }) =>
    React.createElement('img', { src, alt, ...props }),
}))

vi.mock('next-auth/react', () => ({
  useSession: vi.fn(() => ({ data: null, status: 'unauthenticated' })),
  signIn: vi.fn(),
  signOut: vi.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// jsdom has no ResizeObserver at all — @tanstack/react-virtual (used by
// RawReadingsTable, DS-LAKE-005B-B-T02) constructs one to track the scroll
// container's size, so without this stub every virtualized component throws
// `ReferenceError: ResizeObserver is not defined` in every test, not just
// its own. Read @tanstack/virtual-core's own source (node_modules/.pnpm/
// @tanstack+virtual-core.../dist/esm/index.js, `observeElementRect`/
// `getRect`) before assuming a shape: the FIRST measurement is a synchronous
// `element.offsetWidth`/`offsetHeight` read, not a ResizeObserver entry or
// `getBoundingClientRect()` — jsdom hardcodes both to 0, which is the actual
// reason a virtualized table mounts nothing in tests (fixed per-test by
// overriding `offsetWidth`/`offsetHeight`, see raw-readings-table.test.tsx).
// This stub still fires its callback once on `observe()` so a LATER resize
// simulation would also work, but that is not what makes the initial render
// succeed.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    #callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.#callback = callback
    }
    observe(target: Element) {
      this.#callback(
        [
          {
            target,
            contentRect: target.getBoundingClientRect(),
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      )
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver
}
