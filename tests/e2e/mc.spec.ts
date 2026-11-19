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


  test('not on an MC yet: you join with EXPA, no codes', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [] } })
    await page.goto('/mc')
    const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Join your MC with EXPA' }) })
    await expect(panel).toContainText('Your MC and your role (MCP, VP Finance or MC member) come from your EXPA position', { timeout: 10000 })
    await expect(panel.getByRole('button', { name: 'Continue with EXPA' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Use a different EXPA account' })).toBeVisible()
    await expect(page.getByLabel('MC member code')).toHaveCount(0)
  })

  test('on the MC: no codes; LCs in the country join on their own, and the linked and missing ones are listed', async ({ page }) => {
    await setupAuthMocks(page, 'member', {
      tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'mcp' }] },
      rpc: { mc_dashboard: [], mc_linked_lcs: [{ id: 'lc-1', name: 'AIESEC in Lisbon' }], lcs_in_country: [{ id: 'lc-1', name: 'AIESEC in Lisbon' }, { id: 'lc-2', name: 'AIESEC in Porto' }] },
    })
    await page.goto('/mc')
    await expect(page.getByText(/Every LC in Portugal joins automatically/)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Your national team joins by signing in with EXPA/)).toBeVisible()
    await expect(page.getByText('7C2E19AD')).toHaveCount(0)
    await expect(page.getByText('3FA9C21B')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Copy code' })).toHaveCount(0)
    await expect(page.getByText('Linked (1)')).toBeVisible()
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




  test('the dashboard is titled with the MC name and shows its country', async ({ page }) => {
    await setupAuthMocks(page, 'member', {
      tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'mcp' }] },
      rpc: { mc_dashboard: [], mc_linked_lcs: [], lcs_in_country: [] },
    })
    await page.goto('/mc')
    await expect(page.getByRole('heading', { level: 1, name: 'AIESEC in Portugal' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Country:')).toContainText('Portugal')
    await expect(page.getByText(/No LCs in Portugal are on/)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Join or create an LC' })).toBeVisible()
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

  const TEAM = [
    { user_id: 'u-ana', name: 'Ana Costa', role: 'mcp', joined_at: '2026-02-01T00:00:00Z', is_me: true, handover_pending: false },
    { user_id: 'u-rui', name: 'Rui Silva', role: 'member', joined_at: '2026-10-01T00:00:00Z', is_me: false, handover_pending: false },
  ]

  test('handover: the MCP chooses the next MCP from the team, after confirming', async ({ page }) => {
    await setupAuthMocks(page, 'member', {
      tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'mcp' }] },
      rpc: { mc_dashboard: [], mc_linked_lcs: [], lcs_in_country: [], mc_team: TEAM },
    })
    await intercept(page)
    await page.goto('/mc')
    const team = page.locator('section', { has: page.getByRole('heading', { name: 'National team (2)' }) })
    await expect(team).toContainText('Ana Costa (you)', { timeout: 10000 })
    await expect(team).toContainText('MCP')
    await expect(team.getByRole('button', { name: 'Make MCP' })).toHaveCount(1)       // not next to yourself
    await team.getByRole('button', { name: 'Make MCP' }).click()
    await page.getByRole('button', { name: 'Hand over' }).click()
    await expect.poll(async () => (await writes(page)).find((w) => w.url.includes('/rpc/offer_mcp_handover'))?.body ?? '').toContain('"p_to":"u-rui"')
  })

  test('handover: while waiting, the MCP sees who it is waiting for and can cancel', async ({ page }) => {
    await setupAuthMocks(page, 'member', {
      tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'mcp' }] },
      rpc: { mc_dashboard: [], mc_linked_lcs: [], lcs_in_country: [], mc_team: [TEAM[0], { ...TEAM[1], handover_pending: true }] },
    })
    await intercept(page)
    await page.goto('/mc')
    await expect(page.getByText('Waiting for Rui Silva to accept becoming MCP.')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Make MCP' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Cancel handover' }).click()
    await expect.poll(async () => (await writes(page)).some((w) => w.url.includes('/rpc/cancel_mcp_handover'))).toBe(true)
  })

  test('handover: the chosen person accepts from a banner; members can leave but not hand over', async ({ page }) => {
    await setupAuthMocks(page, 'member', {
      tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'member' }] },
      rpc: { mc_dashboard: [], mc_linked_lcs: [], lcs_in_country: [], mc_team: [
        { ...TEAM[0], is_me: false },
        { ...TEAM[1], is_me: true, handover_pending: true },
      ] },
    })
    await intercept(page)
    await page.goto('/mc')
    const banner = page.getByRole('region', { name: 'MCP handover' })
    await expect(banner).toContainText('Ana Costa is handing AIESEC in Portugal over to you', { timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Make MCP' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New member code' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Leave the MC' })).toBeVisible()
    await banner.getByRole('button', { name: 'Become MCP' }).click()
    await expect.poll(async () => (await writes(page)).find((w) => w.url.includes('/rpc/accept_mcp_handover'))?.body ?? '').toContain('"p_mc_id":"mc-1"')
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

  test('targets show as "actual / target (pct%)" with a pace badge and no private activity metadata', async ({ page }) => {
    await setupAuthMocks(page, 'member', mcOptions([
      { project_id: 'lc-1', product: 'ogv', metric: 'approved', target: 30 },
      { project_id: 'lc-2', product: 'ogv', metric: 'approved', target: 30 },
    ]))
    await page.goto('/mc')
    const lisbon = page.getByRole('row', { name: /AIESEC in Lisbon/ })
    await expect(lisbon).toContainText('15 / 30 (50%)', { timeout: 10000 })
    await expect(lisbon).toContainText('On track')
    await expect(lisbon).not.toContainText(/EXPA sync today/)
    const porto = page.getByRole('row', { name: /AIESEC in Porto/ })
    await expect(porto).toContainText('3 / 30 (10%)')
    await expect(porto).toContainText('Behind')
    await expect(porto).not.toContainText('entered by hand')
  })

  test('"Needs attention" lists what an MCVP should act on, with counts only', async ({ page }) => {
    await setupAuthMocks(page, 'member', mcOptions([{ project_id: 'lc-2', product: 'ogv', metric: 'approved', target: 30 }]))
    await page.goto('/mc')
    const panel = page.locator('section', { has: page.getByRole('heading', { name: /Needs attention \(1\)/ }) })
    await expect(panel).toContainText('AIESEC in Porto', { timeout: 10000 })
    await expect(panel).not.toContainText(/No approvals in 4[4-6] days/)   // ±1 for time zones
    await expect(panel).not.toContainText('2 approved 60+ days ago, not realized yet')
    await expect(panel).not.toContainText(/Pipeline not updated in (39|40|41) days/)
    await expect(panel).toContainText('Applied → approved 8% (national 23%)')
    await expect(panel).toContainText(/Behind pace: 3 \/ 30 approvals/)
    await expect(panel).not.toContainText('AIESEC in Lisbon')
  })

  test('legacy private team and activity RPCs are neither called nor displayed', async ({ page }) => {
    const options = mcOptions([])
    await setupAuthMocks(page, 'member', { ...options, rpc: { ...options.rpc, mc_lc_insights: [{ project_id: 'lc-1', active_14d: 15, handover_written: 3 }] } })
    await intercept(page)
    await page.goto('/mc')
    await expect(page.getByRole('row', { name: /AIESEC in Lisbon/ }).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'Beyond exchanges' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Where each LC loses people' })).toHaveCount(0)
    await expect(page.getByRole('img', { name: /approvals per week/ })).toHaveCount(0)
    expect((await writes(page)).some(w => /mc_lc_health|mc_lc_insights/.test(w.url))).toBe(false)
  })

  test('the MC sends an announcement to every LC, and a reminder to an LC that needs attention', async ({ page }) => {
    await setupAuthMocks(page, 'member', { ...mcOptions([]), tables: { ...mcOptions([]).tables, mc_messages: [] } })
    await intercept(page)
    await page.goto('/mc')
    await page.getByLabel('Message to LCs').fill('Targets are set for this term.', { timeout: 10000 })
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(async () => (await writes(page)).find((w) => w.url.includes('/rest/v1/mc_messages'))?.body ?? '').toContain('"body":"Targets are set for this term."')
    expect((await writes(page)).find((w) => w.url.includes('/rest/v1/mc_messages'))?.body).toContain('"project_id":null')

    const panel = page.locator('section', { has: page.getByRole('heading', { name: /Needs attention/ }) })
    await panel.getByRole('button', { name: 'Send a reminder' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Send' }).click()
    await expect(panel.getByText('Reminder sent')).toBeVisible()
    const nudge = (await writes(page)).filter((w) => w.url.includes('/rest/v1/mc_messages')).map((w) => w.body).find((b) => b.includes('"kind":"nudge"')) ?? ''
    expect(nudge).toContain('"project_id":"lc-2"')
    expect(nudge).toContain('Applied → approved')
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

  const today = new Date().toISOString().slice(0, 10)
  const FIN_LCS = [
    { project_id: 'lc-nw', name: 'AIESEC in Northwestern', currency: 'USD', term_start_date: `${today.slice(0, 4)}-01-01`, finance_reviewed_on: null, has_university_account: true },
    { project_id: 'lc-ch', name: 'AIESEC in Chicago', currency: 'USD', term_start_date: `${today.slice(0, 4)}-01-01`, finance_reviewed_on: today, has_university_account: false },
  ]
  const fin = (id: string, project: string, account: string, type: string, amount: number, description: string) => ({
    id, project_id: project, account, type, amount, currency: 'USD', entry_date: today, category_id: null, department_id: null, description,
    recorded_by: null, receipt_path: null, claim_id: null, created_at: new Date().toISOString(), payment_method: null, processed_via: null, area: 'MXP', notes: null,
  })
  const FIN_ENTRIES = [
    fin('1', 'lc-nw', 'lc', 'opening', 1401.16, 'Opening balance'),
    fin('2', 'lc-nw', 'university', 'income', 1117.43, 'Northwestern reimbursement'),
    fin('3', 'lc-ch', 'lc', 'expense', 250, 'Conference fees'),
  ]

  const BUDGET_LINES = [
    { id: 'l-fund', mc_id: 'mc-1', fy_start: 2026, code: '6251', name: 'Strategic Fund', parent_id: null, prev_budget: null, budget: 0, month_budgets: null, notes: null, sort_order: 0 },
    { id: 'l-fund-01', mc_id: 'mc-1', fy_start: 2026, code: '6251-01', name: 'National projects', parent_id: 'l-fund', prev_budget: 2000, budget: 2500, month_budgets: null, notes: null, sort_order: 0 },
    { id: 'l-hotel', mc_id: 'mc-1', fy_start: 2026, code: '6300', name: 'Conference Hotel', parent_id: null, prev_budget: 11000, budget: 12000, month_budgets: [0, 0, 0, 6000, 0, 0, 0, 0, 0, 6000, 0, 0], notes: 'Two conferences', sort_order: 0 },
  ]
  const BUDGET_PAYMENTS = [
    { id: 'p-1', line_id: 'l-hotel', mc_id: 'mc-1', paid_on: '2026-10-03', amount: 5000, description: 'Hotel deposit', tags: ['FallCo 2026'], comment: 'Half now, half at check-in' },
    { id: 'p-2', line_id: 'l-hotel', mc_id: 'mc-1', paid_on: '2026-10-20', amount: 1500, description: 'Extra rooms', tags: ['FallCo 2026'], comment: null },
    { id: 'p-3', line_id: 'l-fund-01', mc_id: 'mc-1', paid_on: '2027-01-10', amount: 300, description: 'Project kit', tags: [], comment: null },
  ]
  // The budget year follows the date: 26.27 runs July 2026 to June 2027.
  const BUDGET_NOW = new Date('2026-11-19T10:00:00Z')
  const budgetMocks = (role: string, keeps: boolean) => ({
    tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role }], finance_entries: FIN_ENTRIES, mc_budget_lines: BUDGET_LINES, mc_budget_payments: BUDGET_PAYMENTS },
    rpc: { mc_dashboard: [], mc_linked_lcs: [], lcs_in_country: [], mc_finance_lcs: FIN_LCS, can_keep_mc_budget: keeps, currency_for_country: 'EUR' },
  })

  for (const nationalRole of ['mcp', 'vp_finance']) {
    test(`finance: ${nationalRole} sees the MC budget, never an LC's ledger`, async ({ page }) => {
      await page.clock.setFixedTime(BUDGET_NOW)
      await setupAuthMocks(page, 'member', budgetMocks(nationalRole, nationalRole === 'vp_finance'))
      await intercept(page)
      await page.goto('/mc')
      if (nationalRole === 'mcp') await page.getByRole('tab', { name: 'Finance' }).click({ timeout: 10000 })
      await expect(page.getByRole('tab', { name: 'Finance' })).toHaveAttribute('aria-selected', 'true', { timeout: 10000 })
      const table = page.getByRole('table')
      await expect(table).toContainText('Conference Hotel')
      await expect(table).toContainText('National projects')
      // 6,500 spent on the hotel in October (two payments), 300 on the fund's sub-line.
      await expect(table.getByRole('button', { name: /6,500/ })).toBeVisible()
      await expect(page.getByText('Spent so far')).toBeVisible()
      await expect(page.getByRole('button', { name: /FallCo 2026/ })).toBeVisible()
      await expect(page.getByText('Northwestern reimbursement')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Add line' })).toHaveCount(nationalRole === 'vp_finance' ? 1 : 0)
      if (nationalRole === 'mcp') await expect(page.getByText(/Read-only: your VP Finance keeps it/)).toBeVisible()
      expect((await writes(page)).some(w => w.url.includes('/rpc/mc_finance_lcs'))).toBe(false)
    })
  }

  test('finance: a tag shows only what was spent under it', async ({ page }) => {
    await page.clock.setFixedTime(BUDGET_NOW)
    await setupAuthMocks(page, 'member', budgetMocks('vp_finance', true))
    await page.goto('/mc')
    await page.getByRole('button', { name: /FallCo 2026/ }).click({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: /only payments tagged FallCo 2026/ })).toBeVisible()
    await expect(page.getByRole('table')).not.toContainText('€300.00')
    await expect(page.getByText('Spent on FallCo 2026')).toBeVisible()
  })

  test('finance: the VP Finance records a payment with tags and a comment', async ({ page }) => {
    await page.clock.setFixedTime(BUDGET_NOW)
    await setupAuthMocks(page, 'member', budgetMocks('vp_finance', true))
    await intercept(page)
    await page.goto('/mc')
    await page.getByRole('table').getByRole('button', { name: /6,500/ }).click({ timeout: 10000 })
    const dialog = page.getByRole('dialog', { name: '6300 Conference Hotel' })
    await expect(dialog).toContainText('Two conferences')
    await expect(dialog).toContainText('Hotel deposit')
    await expect(dialog).toContainText('Half now, half at check-in')
    await expect(dialog).toContainText('2 payments')
    await dialog.getByLabel('Amount spent').fill('420.50')
    await dialog.getByLabel('What it was').fill('Bus to the venue')
    await dialog.getByLabel('Tags').fill('FallCo 2026')
    await dialog.getByLabel('Tags').press('Enter')
    await dialog.getByLabel('Tags').fill('Transport')
    await dialog.getByLabel('Comment').fill('Paid by card')
    await dialog.getByRole('button', { name: 'Add payment' }).click()
    await expect.poll(async () => (await writes(page)).find((w) => w.method === 'POST' && w.url.includes('/rest/v1/mc_budget_payments'))?.body ?? '').toContain('"amount":420.5')
    const body = JSON.parse((await writes(page)).find((w) => w.method === 'POST' && w.url.includes('/rest/v1/mc_budget_payments'))!.body)
    expect(body).toMatchObject({ line_id: 'l-hotel', mc_id: 'mc-1', paid_on: '2026-10-01', description: 'Bus to the venue', tags: ['FallCo 2026', 'Transport'], comment: 'Paid by card' })
  })

  test('finance: the VP Finance pastes lines from the budget sheet', async ({ page }) => {
    await page.clock.setFixedTime(BUDGET_NOW)
    await setupAuthMocks(page, 'member', budgetMocks('vp_finance', true))
    await intercept(page)
    await page.goto('/mc')
    await page.getByRole('button', { name: 'Paste from your sheet' }).click({ timeout: 10000 })
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Rows from your budget sheet').fill('Code\tAccount\tBudget 25.26\tBudget 26.27\n6304\tConference Travel\t3,000\t3,500\n6300\tConference Hotel\t11,000\t12,500')
    await dialog.getByRole('button', { name: 'Add 1 line, update 1' }).click()
    await expect.poll(async () => (await writes(page)).filter((w) => w.url.includes('/rest/v1/mc_budget_lines')).length).toBe(2)
    const sent = (await writes(page)).filter((w) => w.url.includes('/rest/v1/mc_budget_lines'))
    expect(sent[0].method).toBe('POST')
    expect(JSON.parse(sent[0].body)).toEqual([expect.objectContaining({ code: '6304', name: 'Conference Travel', prev_budget: 3000, budget: 3500, fy_start: 2026 })])
    expect(sent[1].method).toBe('PATCH')
    expect(sent[1].url).toContain('id=eq.l-hotel')
    expect(JSON.parse(sent[1].body)).toMatchObject({ budget: 12500, prev_budget: 11000 })
  })

  test('finance: other MC members have no Finance tab; the MCP can name a VP Finance', async ({ page }) => {
    await setupAuthMocks(page, 'member', {
      tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'member' }] },
      rpc: { mc_dashboard: [], mc_linked_lcs: [], lcs_in_country: [] },
    })
    await page.goto('/mc')
    await expect(page.getByText(/joins automatically/)).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('tab', { name: 'Finance' })).toHaveCount(0)
  })

  test('finance: the MCP names a VP Finance from the team', async ({ page }) => {
    await setupAuthMocks(page, 'member', {
      tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'mcp' }] },
      rpc: { mc_dashboard: [], mc_linked_lcs: [], lcs_in_country: [], mc_team: [
        { user_id: 'u-ana', name: 'Ana Costa', role: 'mcp', joined_at: '2026-02-01T00:00:00Z', is_me: true, handover_pending: false },
        { user_id: 'u-rui', name: 'Rui Silva', role: 'member', joined_at: '2026-10-01T00:00:00Z', is_me: false, handover_pending: false },
      ] },
    })
    await intercept(page)
    await page.goto('/mc')
    await page.getByRole('button', { name: 'Make VP Finance' }).click({ timeout: 10000 })
    await page.getByRole('button', { name: 'Make VP Finance' }).last().click()
    await expect.poll(async () => (await writes(page)).find((w) => w.url.includes('/rpc/set_mc_member_role'))?.body ?? '').toContain('"p_role":"vp_finance"')
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

test('the LC dashboard shows what its MC sent, and the national targets with pace', async ({ page }) => {
  const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)
  await setupAuthMocks(page, 'president', {
    rpc: { lc_national: [{ mc_id: 'mc-1', mc_name: 'AIESEC in Portugal', term_start: day(182) }] },
    tables: {
      mc_messages: [{ id: 'm1', kind: 'announcement', body: 'National targets are set.', created_at: new Date().toISOString(), project_id: null }],
      mc_lc_targets: [{ product: 'ogv', metric: 'approved', target: 30 }],
      exchanges: [
        { id: 'e1', project_id: 'project-abc', product: 'ogv', stage: 'approved', person_name: 'A', approved_at: day(10), realized_at: null },
        { id: 'e2', project_id: 'project-abc', product: 'ogv', stage: 'approved', person_name: 'B', approved_at: day(400), realized_at: null },
      ],
    },
  })
  await page.goto('/')
  const card = page.getByRole('region', { name: 'From AIESEC in Portugal' })
  await expect(card).toContainText('National targets are set.', { timeout: 10000 })
  await expect(card).toContainText('oGV approvals')
  await expect(card).toContainText('1 / 30')                // the one from 400 days ago was last term
  await expect(card).toContainText('Behind')
})
