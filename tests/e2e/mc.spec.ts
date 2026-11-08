import { test, expect } from '@playwright/test'
import { setupAuthMocks } from './helpers/mocks'
import { APP_NAME } from '../../src/lib/brand'


/** Record writes, and answer some RPCs with an error (after setupAuthMocks). */
async function intercept(page: import('@playwright/test').Page, failRpc: Record<string, string> = {}) {
  await page.addInitScript((fail) => {
    const w = window as unknown as { __writes: { method: string; url: string; body: string }[] }
    w.__writes = []
    const inner = window.fetch
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method !== 'GET') w.__writes.push({ method, url, body: String(init?.body ?? '') })
      const rpc = url.match(/\/rest\/v1\/rpc\/([a-z_]+)/)?.[1]
      if (rpc && fail[rpc]) return Promise.resolve(new Response(JSON.stringify({ message: fail[rpc] }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
      return inner.call(this, input, init)
    }
  }, failRpc)
}
const writes = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __writes: { method: string; url: string; body: string }[] }).__writes)

const MC = { id: 'mc-1', name: 'AIESEC in Portugal', member_code: '3FA9C21B', lc_code: '7C2E19AD', term_start: null, country_code: 'PT' }

test.describe('National (MC)', () => {
  test('has its own space: no LC sidebar, a National title, and a sample of what you get', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [] } })
    await page.goto('/mc')
    await expect(page.getByText('· National')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('complementary', { name: 'Site navigation' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Your LC' })).toHaveCount(0)        // not in any LC
    await expect(page).toHaveTitle(`National · ${APP_NAME}`)
    await expect(page.getByRole('region', { name: 'Example of the national view' })).toContainText('Numbers only')
  })

  test('Join needs a code; Create needs a name; spaces alone do not count; both buttons look the same', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [] } })
    await page.goto('/mc')
    const join = page.getByRole('button', { name: 'Join' })
    const create = page.getByRole('button', { name: 'Create' })
    await expect(join).toBeDisabled({ timeout: 10000 })
    await expect(create).toBeDisabled()
    await page.getByLabel('MC name').fill('   ')
    await expect(create).toBeDisabled()
    await page.getByLabel('MC name').fill('AIESEC in Portugal')
    await expect(create).toBeEnabled()
    await expect(page.getByLabel('MC name')).toHaveAttribute('maxlength', '80')
    await expect(page.getByText(/Ask your MCP for the member code/)).toBeVisible()
    expect(await join.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await create.evaluate((el) => getComputedStyle(el).backgroundColor))
  })

  test('after joining, the codes say what each is for, with copy buttons, and unlinked LCs are listed', async ({ page }) => {
    await setupAuthMocks(page, 'member', {
      tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'mcp' }] },
      rpc: { mc_dashboard: [], mc_linked_lcs: [{ id: 'lc-1', name: 'AIESEC in Lisbon' }], lcs_in_country: [{ id: 'lc-1', name: 'AIESEC in Lisbon' }, { id: 'lc-2', name: 'AIESEC in Porto' }] },
    })
    await page.goto('/mc')
    await expect(page.getByText('LC code, for LC presidents')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('7C2E19AD')).toBeVisible()
    await expect(page.getByText('Send this to each LCP so they can link their LC')).toBeVisible()
    await expect(page.getByText('Member code, for your national team')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy invite message' })).toHaveCount(2)
    await expect(page.getByText('Linked (1)')).toBeVisible()
    await expect(page.getByText(/not linked yet \(1\)/)).toBeVisible()
    await expect(page.getByText('AIESEC in Porto')).toBeVisible()
  })

  test('onboarding offers the MC as a third card, which leads to the national view', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [] } })
    await page.goto('/onboarding')
    await page.getByRole('button', { name: /I'm on the national team \(MC\)/ }).click({ timeout: 10000 })
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page).toHaveURL(/\/mc$/)
  })

  test('someone in no LC is sent to the national view if on an MC, and to onboarding if not', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'member' }] } })
    await page.goto('/team')
    await expect(page).toHaveURL(/\/mc$/, { timeout: 10000 })
  })

  test('someone in no LC and no MC goes to onboarding instead of an empty LC page', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [] } })
    await page.goto('/')
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10000 })
  })

  test('LC pages have their own tab titles', async ({ page }) => {
    await setupAuthMocks(page, 'member')
    await page.goto('/tasks')
    await expect(page).toHaveTitle(`Tasks · ${APP_NAME}`, { timeout: 10000 })
  })

  test('the setup form sends the country; the country list is not cut off', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [] } })
    await intercept(page)
    await page.goto('/mc')
    await page.getByLabel('MC name').fill('AIESEC in Portugal', { timeout: 10000 })
    await page.locator('#mc-country').fill('portu')
    const option = page.getByRole('option', { name: /Portugal/ })
    await expect(option).toBeInViewport()
    await option.click()
    await expect(page.locator('#mc-country')).toHaveValue(/Portugal/)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect.poll(async () => (await writes(page)).find((w) => w.url.includes('/rpc/create_mc'))?.body ?? '').toContain('"p_country":"PT"')
  })

  test('typing a full country name and leaving the box picks it', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [] } })
    await page.goto('/mc')
    await page.locator('#mc-country').fill('Portugal', { timeout: 10000 })
    await page.getByLabel('MC name').click()
    await expect(page.locator('#mc-country')).toHaveValue(/Portugal/)
  })

  test('a wrong code shows its error under Join, not at the bottom', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [] } })
    await intercept(page, { join_mc: 'No MC has that member code. Check it with your MCP.' })
    await page.goto('/mc')
    await page.getByLabel('MC member code').fill('WRONG123', { timeout: 10000 })
    await page.getByRole('button', { name: 'Join' }).click()
    const joinBox = page.locator('section', { has: page.getByRole('heading', { name: 'Join your MC' }) })
    await expect(joinBox).toContainText('No MC has that member code')
  })

  test('the dashboard is titled with the MC name, shows its country, and copy buttons confirm', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await setupAuthMocks(page, 'member', {
      tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'mcp' }] },
      rpc: { mc_dashboard: [], mc_linked_lcs: [], lcs_in_country: [] },
    })
    await page.goto('/mc')
    await expect(page.getByRole('heading', { level: 1, name: 'AIESEC in Portugal' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Country:')).toContainText('Portugal')
    await expect(page.getByText(/No LCs in Portugal are on/)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Join or create an LC' })).toBeVisible()
    const copyCodes = page.getByRole('button', { name: 'Copy code' })
    await expect(copyCodes).toHaveCount(2)                                  // LC code and member code
    await copyCodes.nth(1).click()
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('3FA9C21B')
  })

  test('an MCP without a country picks one on the dashboard, from a list that is not cut off', async ({ page }) => {
    await setupAuthMocks(page, 'member', {
      tables: { team_members: [], mcs: [{ ...MC, country_code: null }], mc_members: [{ mc_id: 'mc-1', role: 'mcp' }] },
      rpc: { mc_dashboard: [], mc_linked_lcs: [] },
    })
    await intercept(page)
    await page.goto('/mc')
    await page.locator('#mc-set-country').fill('spa', { timeout: 10000 })
    const option = page.getByRole('option', { name: /Spain/ })
    await expect(option).toBeInViewport()
    await option.click()
    await expect.poll(async () => (await writes(page)).find((w) => w.url.includes('/rest/v1/mcs') && w.method === 'PATCH')?.body ?? '').toContain('"country_code":"ES"')
  })

  test('the LC table says "1 member", not "1 members"', async ({ page }) => {
    await setupAuthMocks(page, 'member', {
      tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'member' }] },
      rpc: { mc_dashboard: [{ project_id: 'lc-1', lc_name: 'Claude Test LC', members: 1, product: 'ogv', applied: 1, approved: 1, realized: 0, completed: 0 }], mc_linked_lcs: [], lcs_in_country: [] },
    })
    await page.goto('/mc')
    await expect(page.getByRole('cell', { name: /Claude Test LC/ })).toContainText('1 member', { timeout: 10000 })
    await expect(page.getByRole('cell', { name: /Claude Test LC/ })).not.toContainText('1 members')
  })

  test('the tab is titled with the MC name, and Change can be cancelled', async ({ page }) => {
    await setupAuthMocks(page, 'member', {
      tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'mcp' }] },
      rpc: { mc_dashboard: [], mc_linked_lcs: [], lcs_in_country: [] },
    })
    await page.goto('/mc')
    await expect(page).toHaveTitle(`AIESEC in Portugal · ${APP_NAME}`, { timeout: 10000 })
    await page.getByRole('button', { name: 'Change' }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('Country:')).toContainText('Portugal')
    await page.getByRole('button', { name: 'Change' }).click()
    await page.locator('#mc-set-country').press('Escape')
    await expect(page.getByText('Country:')).toContainText('Portugal')
    await expect(page.getByText(/Only LCs with a country saved are listed/)).toBeVisible()
  })
})

test('the LC president sets the LC country in Settings', async ({ page }) => {
  await setupAuthMocks(page, 'president', { tables: { projects: [{ id: 'project-abc', name: 'AIESEC in Test City', country_code: null, currency: 'EUR' }] } })
  await intercept(page)
  await page.goto('/settings#lc')
  await page.locator('#lc-country').fill('dominican', { timeout: 10000 })
  await page.getByRole('option', { name: /Dominican Republic/ }).click()
  await page.getByRole('button', { name: /save/i }).first().click()
  await expect.poll(async () => (await writes(page)).find((w) => w.url.includes('/rest/v1/projects') && w.method === 'PATCH')?.body ?? '').toContain('"country_code":"DO"')
})
