// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'

const request = (path: string, authorization?: string) => new NextRequest(`http://localhost${path}`, {
  headers: authorization ? { Authorization: authorization } : {},
})

describe('API proxy authentication gate', () => {
  it.each([undefined, 'Bearer ', 'Basic credentials'])('rejects protected calls with %s authorization', authorization => {
    expect(proxy(request('/api/invites/send', authorization)).status).toBe(401)
  })
  it('leaves bearer validation to the route handler', () => {
    expect(proxy(request('/api/invites/send', 'Bearer test-token')).headers.get('x-middleware-next')).toBe('1')
  })
  it.each(['/api/cron/notify', '/api/rsvp', '/api/unsubscribe', '/settings'])('preserves the separately authenticated/public route %s', path => {
    expect(proxy(request(path)).headers.get('x-middleware-next')).toBe('1')
  })
  it.each(['/api/rsvp-private', '/api/unsubscribe-private', '/api/cron-private'])('does not bypass authentication for a lookalike path %s', path => {
    expect(proxy(request(path)).status).toBe(401)
  })
})
