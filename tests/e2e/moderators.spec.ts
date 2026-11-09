import { test, expect, Page } from '@playwright/test'

// Moderators sign in at /moderators with email and password (no EXPA) and
// land on /moderation, with no LC, MC or EXPA connection needed.

const USER = {
  id: 'mod-user-id', aud: 'authenticated', role: 'authenticated', email: 'mod@example.com',
  email_confirmed_at: '2024-01-01T00:00:00.000Z', app_metadata: { provider: 'email' }, user_metadata: {},
  created_at: '2024-01-01T00:00:00.000Z',
}
const SESSION = {
  access_token: 'mock-access-token', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'mock-refresh-token', user: USER,
}
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/** Signed out, with Supabase answering: a password sign-in works; is_app_moderator() says `moderator`. */
async function mockSupabase(page: Page, moderator: boolean, extra: { profile?: boolean } = {}) {
  const calls = { logout: 0 }
  await page.route('**/auth/v1/token**', (route) => route.fulfill(json(SESSION)))
  await page.route('**/auth/v1/user**', (route) => route.fulfill(json(USER)))
  await page.route('**/auth/v1/logout**', (route) => { calls.logout++; return route.fulfill({ status: 204, body: '' }) })
  await page.route('**/rest/v1/**', (route) => {
    const url = route.request().url()
    if (url.includes('/rpc/is_app_moderator')) return route.fulfill(json(moderator))
    if (url.includes('/feature_requests')) return route.fulfill(json([
      { id: 'r1', question: 'Can I export the pipeline?', role: 'vp', page: '/pipeline', closest: [], status: 'new', created_at: '2026-11-01T10:00:00Z', created_by: 'someone' },
    ]))
    const single = (route.request().headers()['accept'] ?? '').includes('vnd.pgrst.object')
    if (url.includes('/user_profiles') && extra.profile) return route.fulfill(json(single ? { id: USER.id } : [{ id: USER.id }]))
    // No LC, no MC, no profile, no EXPA connection.
    return route.fulfill(single ? { status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: 'no rows' }) } : json([]))
  })
  page.on('console', () => {})
  return calls
}

async function signIn(page: Page) {
  await page.getByLabel('Email').fill('mod@example.com')
  await page.getByLabel('Password').fill('secret-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

test.describe('Moderator sign-in at /moderators', () => {
  test('only email and password: no EXPA, Google or sign-up, and hidden from search engines', async ({ page }) => {
    await mockSupabase(page, false)
    await page.goto('/moderators')
    await expect(page.getByRole('heading', { name: 'Moderator sign-in' })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByRole('button', { name: /forgot password/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /expa/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /google/i })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /sign up/i })).toHaveCount(0)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  })

  test('a moderator with no LC and no EXPA connection lands on /moderation', async ({ page }) => {
    await mockSupabase(page, true)
    await page.goto('/moderators')
    await signIn(page)
    await expect(page).toHaveURL(/\/moderation$/, { timeout: 15000 })
    await expect(page.getByText('Can I export the pipeline?')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open your LC' })).toHaveCount(0)
    await expect(page.getByText(/connect expa/i)).toHaveCount(0)
  })

  test('someone who isn\'t a moderator gets the error and is signed out again', async ({ page }) => {
    const calls = await mockSupabase(page, false)
    await page.goto('/moderators')
    await signIn(page)
    await expect(page.getByText("This account isn't a moderator.")).toBeVisible()
    await expect(page).toHaveURL(/\/moderators$/)
    expect(calls.logout).toBeGreaterThan(0)
    const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^sb-.+-auth-token$/.test(k)))
    expect(stored).toEqual([])
  })

  test('the normal login page also sends a moderator with no LC to /moderation', async ({ page }) => {
    await mockSupabase(page, true)
    await page.goto('/login')
    await page.getByRole('button', { name: /signed up before with email or google/i }).click()
    await page.getByLabel('Email', { exact: true }).fill('mod@example.com')
    await page.getByLabel('Password', { exact: true }).fill('secret-password')
    await page.getByRole('button', { name: 'Continue with email' }).click()
    await expect(page).toHaveURL(/\/moderation$/, { timeout: 15000 })
  })

  test('a normal user without an LC still goes to onboarding', async ({ page }) => {
    await mockSupabase(page, false)
    await page.goto('/login')
    await page.getByRole('button', { name: /signed up before with email or google/i }).click()
    await page.getByLabel('Email', { exact: true }).fill('member@example.com')
    await page.getByLabel('Password', { exact: true }).fill('secret-password')
    await page.getByRole('button', { name: 'Continue with email' }).click()
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 15000 })
  })

  test('says why sign-in failed: a wrong password, or an email that isn\'t confirmed', async ({ page }) => {
    await mockSupabase(page, true)
    let reply = { code: 'invalid_credentials', msg: 'Invalid login credentials' }
    await page.route('**/auth/v1/token**', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 400, error_code: reply.code, msg: reply.msg }) }))
    await page.goto('/moderators')
    await signIn(page)
    await expect(page.getByText('Wrong email or password.')).toBeVisible()
    reply = { code: 'email_not_confirmed', msg: 'Email not confirmed' }
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByText(/isn't confirmed yet/)).toBeVisible()
    await expect(page).toHaveURL(/\/moderators$/)
  })
})
