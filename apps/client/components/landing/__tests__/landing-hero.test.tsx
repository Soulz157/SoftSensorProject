import { describe, expect, it, vi, beforeAll } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

const setTheme = vi.fn()
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'dark', setTheme }),
}))

import { LandingHero } from '../landing-hero'

beforeAll(() => {
  // jsdom has no matchMedia; the trace, tag feed and aura all ask for
  // prefers-reduced-motion. "reduce" keeps every animation loop off.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
})

describe('LandingHero', () => {
  it('sends both calls to action to the auth pages', () => {
    render(<LandingHero layout="tags" />)
    const signIn = screen.getAllByRole('link', { name: 'Sign in' })
    const create = screen.getAllByRole('link', { name: 'Create account' })
    expect(signIn.length).toBeGreaterThan(0)
    expect(create.length).toBeGreaterThan(0)
    signIn.forEach(a => expect(a.getAttribute('href')).toBe('/login'))
    create.forEach(a => expect(a.getAttribute('href')).toBe('/register'))
  })

  it('shows only mock tag names, never plant tags', () => {
    render(<LandingHero layout="tags" />)
    for (const name of ['TEMP-01', 'FLOW-02', 'PRESS-03', 'RATIO-04']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
    expect(document.body.textContent).not.toMatch(/\b[A-Z]{2}\d{3}\.PV\b/)
  })

  it('offers light, dark and system themes and marks the current one', () => {
    render(<LandingHero layout="tags" />)
    const group = screen.getByRole('radiogroup', { name: 'Theme' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map(r => r.getAttribute('aria-label'))).toEqual([
      'Light theme',
      'Dark theme',
      'Match system',
    ])
    expect(
      within(group)
        .getByRole('radio', { name: 'Dark theme' })
        .getAttribute('aria-checked'),
    ).toBe('true')
    fireEvent.click(within(group).getByRole('radio', { name: 'Light theme' }))
    expect(setTheme).toHaveBeenCalledWith('light')
  })

  it('names the model as text under the chip', () => {
    render(<LandingHero layout="tags" />)
    expect(screen.getByText('XGBoost v4')).toBeTruthy()
  })

  it('has no KPI section or scroll cue unless asked', () => {
    const { container } = render(<LandingHero layout="tags" />)
    expect(container.querySelector('#landing-kpis')).toBeNull()
    expect(screen.queryByRole('link', { name: 'See how it works' })).toBeNull()
  })

  it('cues a scroll down to the sensor-vs-lab section', () => {
    const { container } = render(<LandingHero layout="tags" kpis />)
    expect(
      screen
        .getByRole('link', { name: 'See how it works' })
        .getAttribute('href'),
    ).toBe('#landing-kpis')
    const section = container.querySelector('#landing-kpis')
    expect(section?.querySelectorAll('li')).toHaveLength(4)
    expect(screen.getByText('24')).toBeTruthy()
  })

  it('shows the 24-hour sensor-vs-lab timeline above the tiles', () => {
    render(<LandingHero layout="tags" kpis />)
    expect(screen.getByRole('figure')).toBeTruthy()
    expect(screen.getByText('Last 24 hours')).toBeTruthy()
  })

  it('can turn the aura off', () => {
    const { container } = render(<LandingHero layout="tags" aura={false} />)
    const auras = [...container.querySelectorAll('div[aria-hidden]')].filter(
      d => (d as HTMLElement).style.background.includes('radial-gradient'),
    )
    expect(auras).toHaveLength(0)
  })
})
