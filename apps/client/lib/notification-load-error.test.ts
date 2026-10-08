import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/fetcher'
import { describeNotificationLoadError } from './notification-load-error'

describe('describeNotificationLoadError', () => {
  it('a 403 names the access problem, not the server prose', () => {
    expect(
      describeNotificationLoadError(
        new ApiError('Only workspace owners can perform this action', 403),
        'notification channels',
      ),
    ).toBe("You don't have access to this workspace's notification channels.")
  })

  it('other failures keep the server message', () => {
    expect(
      describeNotificationLoadError(
        new ApiError('Workspace not found', 404),
        'notification channels',
      ),
    ).toBe("Couldn't load notification channels — Workspace not found")
  })

  it('a non-Error rejection still gets a sentence', () => {
    expect(describeNotificationLoadError('boom', 'notification channels')).toBe(
      "Couldn't load notification channels",
    )
  })
})
