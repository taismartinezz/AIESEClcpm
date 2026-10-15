/**
 * Shared Supabase mock setup for e2e tests.
 *
 * AppShell calls supabase.auth.getUser() (server-verified) which hits
 * /auth/v1/user. We intercept that — and /auth/v1/token for the
 * refreshSession() fallback — via addInitScript so they never reach the
 * real Supabase project.
 */

import type { Page } from 'playwright'

export const MOCK_USER_ID = 'mock-user-id'
export const MOCK_EMAIL = 'test@example.com'

export function mockSession() {
  return JSON.stringify({
    access_token: 'mock-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    // expires_at well in the future — avoids a proactive refresh attempt
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'mock-refresh-token',
    user: {
      id: MOCK_USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: MOCK_EMAIL,
      email_confirmed_at: '2024-01-01T00:00:00.000Z',
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: '2024-01-01T00:00:00.000Z',
    },
  })
}

export async function setupAuthMocks(page: Page, role: 'pi' | 'researcher') {
  const session = mockSession()
  const profileData = {
    id: MOCK_USER_ID, name: 'Test User', role,
    avatar_color: '#B4D4E3', avatar_initials: 'TU',
    email: MOCK_EMAIL, bio: '',
  }
  const membershipData = { project_id: 'project-abc', user_id: MOCK_USER_ID, role }
  const projectData = {
    id: 'project-abc', name: 'Test Project', institution: 'Test Uni',
    active_prompt_ids: ['jp2', 'jp7', 'jp11'],
  }
  const inviteCodes = role === 'pi'
    ? [{ id: 'code-1', code: 'CANOPY-ABCD', used_by: null }]
    : []

  await page.addInitScript(
    ({ session, profileData, membershipData, projectData, inviteCodes }) => {
      // 1. Auth storage: return fake session so Supabase reads from cache first
      const _origGet = Storage.prototype.getItem
      Storage.prototype.getItem = function (key) {
        if (typeof key === 'string' && /^sb-.+-auth-token$/.test(key)) return session
        return _origGet.call(this, key)
      }

      // 2. Fetch override: intercept all Supabase calls before they reach the network
      const _origFetch = window.fetch
      const sessionObj = JSON.parse(session) as {
        access_token: string; token_type: string; expires_in: number;
        expires_at: number; refresh_token: string;
        user: { id: string; aud: string; role: string; email: string }
      }

      const ok = (body: unknown) =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        )

      window.fetch = function (input, init) {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
            ? input.href
            : (input as Request).url

        // Auth endpoints — needed by getUser() and refreshSession() (AppShell)
        if (url.includes('/auth/v1/user'))  return ok(sessionObj.user)
        if (url.includes('/auth/v1/token')) return ok(sessionObj)

        // REST endpoints
        if (url.includes('/rest/v1/user_profiles')) return ok([profileData])
        if (url.includes('/rest/v1/team_members'))  return ok([membershipData])
        if (url.includes('/rest/v1/projects'))       return ok([projectData])
        if (url.includes('/rest/v1/invite_codes'))   return ok(inviteCodes)
        if (url.includes('/rest/v1/'))               return ok([])

        // Next.js assets and anything else can pass through
        return _origFetch.call(this, input, init)
      }
    },
    { session, profileData, membershipData, projectData, inviteCodes }
  )
}
