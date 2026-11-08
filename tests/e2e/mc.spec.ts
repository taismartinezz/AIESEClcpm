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

  test('Join needs a code; Create needs a country and names the MC after it; both buttons look the same', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [] }, rpc: { mc_in_country: null } })
    await page.goto('/mc')
    const join = page.getByRole('button', { name: 'Join' })
    const create = page.getByRole('button', { name: /^Create/ })
    await expect(join).toBeDisabled({ timeout: 10000 })
    await expect(create).toBeDisabled()
    await page.getByLabel('MC member code').fill('   ')
    await expect(join).toBeDisabled()                                        // spaces don't count
    await page.locator('#mc-country').fill('portugal')
    await page.getByRole('option', { name: /Portugal/ }).click()
    await expect(page.getByText(/It will be called/)).toContainText('AIESEC in Portugal')
    await expect(page.getByRole('button', { name: 'Create AIESEC in Portugal' })).toBeEnabled()
    await expect(page.getByText(/Ask your MCP for the member code/).first()).toBeVisible()
    expect(await join.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await create.evaluate((el) => getComputedStyle(el).backgroundColor))
  })

  test('MC names use "the" where the country takes it', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [] }, rpc: { mc_in_country: null } })
    await page.goto('/mc')
    await page.locator('#mc-country').fill('netherlands', { timeout: 10000 })
    await page.getByRole('option', { name: /Netherlands/ }).click()
    await expect(page.getByRole('button', { name: 'Create AIESEC in the Netherlands' })).toBeVisible()
  })

  test('the MCP can rename the MC', async ({ page }) => {
    await setupAuthMocks(page, 'member', {
      tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'mcp' }] },
      rpc: { mc_dashboard: [], mc_linked_lcs: [], lcs_in_country: [] },
    })
    await intercept(page)
    await page.goto('/mc')
    await page.getByRole('button', { name: 'Rename' }).click({ timeout: 10000 })
    await page.getByLabel('MC name').fill('AIESEC Portugal')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(async () => (await writes(page)).find((w) => w.url.includes('/rest/v1/mcs') && w.method === 'PATCH')?.body ?? '').toContain('"name":"AIESEC Portugal"')
  })

  test('a country that already has an MC points to the member code instead of letting you create a second', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [] }, rpc: { mc_in_country: 'AIESEC in Portugal' } })
    await page.goto('/mc')
    await page.locator('#mc-country').fill('portugal', { timeout: 10000 })
    await page.getByRole('option', { name: /Portugal/ }).click()
    await expect(page.getByRole('status').filter({ hasText: 'is already on' })).toContainText('AIESEC in Portugal is already on')
    await expect(page.getByRole('button', { name: /^Create/ })).toBeDisabled()
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
    await page.locator('#mc-country').fill('portu', { timeout: 10000 })
    const option = page.getByRole('option', { name: /Portugal/ })
    await expect(option).toBeInViewport()
    await option.click()
    await expect(page.locator('#mc-country')).toHaveValue(/Portugal/)
    await page.getByRole('button', { name: 'Create AIESEC in Portugal' }).click()
    await expect.poll(async () => (await writes(page)).find((w) => w.url.includes('/rpc/create_mc'))?.body ?? '').toContain('"p_country":"PT"')
    expect((await writes(page)).find((w) => w.url.includes('/rpc/create_mc'))?.body).toContain('"p_name":"AIESEC in Portugal"')
  })

  test('typing a full country name and leaving the box picks it', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [] } })
    await page.goto('/mc')
    await page.locator('#mc-country').fill('Portugal', { timeout: 10000 })
    await page.getByLabel('MC member code').click()
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

test.describe('National goals and pace', () => {
  const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)
  const dash = (id: string, name: string, approved: number, applied: number) =>
    ({ project_id: id, lc_name: name, members: 20, product: 'ogv', applied, approved, realized: 0, completed: 0 })
  const health = (id: string, over: Record<string, unknown> = {}) => ({
    project_id: id, last_approved: day(2), approved_30d: 3, stuck_approved: 0, last_activity: new Date().toISOString(),
    from_expa: 0, total: 30, last_expa_sync: null, ...over,
  })
  // Half a year into the term: 30 approvals as the target means about 15 expected by now.
  const termStart = day(182)
  const mcOptions = (targets: unknown[]) => ({
    tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'member' }], mc_lc_targets: targets },
    rpc: {
      mc_dashboard: [dash('lc-1', 'AIESEC in Lisbon', 15, 40), dash('lc-2', 'AIESEC in Porto', 3, 40)],
      mc_lc_health: [health('lc-1', { last_expa_sync: new Date().toISOString(), from_expa: 30 }),
                     health('lc-2', { approved_30d: 0, last_approved: day(45), stuck_approved: 2, last_activity: day(40) })],
      mc_term_start: termStart, mc_linked_lcs: [], lcs_in_country: [],
    },
  })

  test('targets show as "actual / target (pct%)" with a pace badge; the source of each LC\'s numbers is shown', async ({ page }) => {
    await setupAuthMocks(page, 'member', mcOptions([
      { project_id: 'lc-1', product: 'ogv', metric: 'approved', target: 30 },
      { project_id: 'lc-2', product: 'ogv', metric: 'approved', target: 30 },
    ]))
    await page.goto('/mc')
    const lisbon = page.getByRole('row', { name: /AIESEC in Lisbon/ })
    await expect(lisbon).toContainText('15 / 30 (50%)', { timeout: 10000 })
    await expect(lisbon).toContainText('On track')
    await expect(lisbon).toContainText(/EXPA sync today/)
    const porto = page.getByRole('row', { name: /AIESEC in Porto/ })
    await expect(porto).toContainText('3 / 30 (10%)')
    await expect(porto).toContainText('Behind')
    await expect(porto).toContainText('entered by hand')
  })

  test('"Needs attention" lists what an MCVP should act on, with counts only', async ({ page }) => {
    await setupAuthMocks(page, 'member', mcOptions([{ project_id: 'lc-2', product: 'ogv', metric: 'approved', target: 30 }]))
    await page.goto('/mc')
    const panel = page.locator('section', { has: page.getByRole('heading', { name: /Needs attention \(1\)/ }) })
    await expect(panel).toContainText('AIESEC in Porto', { timeout: 10000 })
    await expect(panel).toContainText(/No approvals in 4[4-6] days/)   // ±1 for time zones
    await expect(panel).toContainText('2 approved 60+ days ago, not realized yet')
    await expect(panel).toContainText(/Pipeline not updated in (39|40|41) days/)
    await expect(panel).toContainText('Applied → approved 8% (national 23%)')
    await expect(panel).toContainText(/Behind pace: 3 \/ 30 approvals/)
    await expect(panel).not.toContainText('AIESEC in Lisbon')
  })

  test('trends, the funnel with what to coach on, and team numbers EXPA cannot show', async ({ page }) => {
    const insight = (id: string, over: Record<string, unknown>) => ({
      project_id: id, weekly: [0, 1, 0, 2, 1, 0, 3, 1, 2, 0, 1, 4], last_term_to_date: 10,
      applied: 50, accepted: 30, approved: 15, realized: 12, completed: 5,
      members: 20, joined_term: 6, term_ended: 2, active_14d: 15, handover_due: 5, handover_written: 3, recruits_term: 12, recruits_joined: 6, ...over,
    })
    const options = mcOptions([])
    await setupAuthMocks(page, 'member', { ...options, rpc: { ...options.rpc, mc_lc_insights: [
      insight('lc-1', { approved: 15 }),
      insight('lc-2', { approved: 3, accepted: 30, last_term_to_date: 8, active_14d: 2 }),
    ] } })
    await page.goto('/mc')
    await expect(page.getByRole('img', { name: /AIESEC in Lisbon: approvals per week/ })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('row', { name: /AIESEC in Lisbon/ }).first()).toContainText('+5 vs last term')
    await expect(page.getByRole('row', { name: /AIESEC in Porto/ }).first()).toContainText('−5 vs last term')
    const funnel = page.locator('section', { has: page.getByRole('heading', { name: 'Where each LC loses people' }) })
    await expect(funnel.getByRole('row', { name: /AIESEC in Porto/ })).toContainText('sales')
    await expect(funnel.getByRole('row', { name: /AIESEC in Lisbon/ })).not.toContainText('sales')
    const team = page.locator('section', { has: page.getByRole('heading', { name: 'Beyond exchanges' }) })
    await expect(team.getByRole('row', { name: /AIESEC in Lisbon/ })).toContainText('3 / 5')
    await expect(team.getByRole('row', { name: /AIESEC in Porto/ })).toContainText('2 (10%)')
  })

  test('an MC member sets targets for the term', async ({ page }) => {
    await setupAuthMocks(page, 'member', mcOptions([]))
    await intercept(page)
    await page.goto('/mc')
    await page.getByRole('button', { name: 'Set approved targets' }).click({ timeout: 10000 })
    await page.getByLabel('AIESEC in Lisbon oGV approved target').fill('30')
    await page.getByRole('button', { name: 'Save targets' }).click()
    await expect.poll(async () => (await writes(page)).find((w) => w.url.includes('/rest/v1/mc_lc_targets'))?.body ?? '').toContain('"target":30')
    const body = (await writes(page)).find((w) => w.url.includes('/rest/v1/mc_lc_targets'))?.body ?? ''
    expect(body).toContain(`"term_start":"${termStart}"`)
    expect(body).toContain('"project_id":"lc-1"')
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