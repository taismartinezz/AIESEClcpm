import { test, expect } from '@playwright/test'
import { setupAuthMocks } from './helpers/mocks'

async function recordWrites(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __writes: { method: string; url: string; body: string }[] }
    w.__writes = []
    const inner = window.fetch
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method !== 'GET') w.__writes.push({ method, url, body: String(init?.body ?? '') })
      return inner.call(this, input, init)
    }
  })
}
const writes = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __writes: { method: string; url: string; body: string }[] }).__writes)

const FIN = { id: 'dep-fin', project_id: 'project-abc', name: 'Finance & Legality', color: '#037EF3', vp_user_id: null, is_finance: true, sort_order: 7, products: [] }

test.describe('Routines', () => {
  test('the LCP adds AIESEC routines; each goes to its department and tasks are created right away', async ({ page }) => {
    await setupAuthMocks(page, 'president', { departments: [FIN], tables: { routines: [] }, rpc: { run_routines: 2 } })
    await recordWrites(page)
    await page.goto('/routines')
    await expect(page.getByRole('heading', { level: 1, name: 'Routines' })).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Add Semester audit' }).click()
    await expect.poll(async () => (await writes(page)).find((w) => w.url.includes('/rest/v1/routines'))?.body ?? '').toContain('"template_key":"fin-audit"')
    const body = (await writes(page)).find((w) => w.url.includes('/rest/v1/routines'))!.body
    expect(body).toContain('"department_id":"dep-fin"')
    expect(body).toContain('"months":[2,9]')
    await expect.poll(async () => (await writes(page)).some((w) => w.url.includes('/rpc/run_routines')), { timeout: 10000 }).toBe(true)
    await expect(page.getByRole('status').filter({ hasText: 'added' })).toContainText('2 tasks created', { timeout: 10000 })
  })

  test('a custom routine shows its schedule in words before it is saved', async ({ page }) => {
    await setupAuthMocks(page, 'president', { departments: [FIN], tables: { routines: [] } })
    await page.goto('/routines')
    await page.getByRole('button', { name: 'New routine' }).click({ timeout: 10000 })
    await page.getByLabel('What').fill('Partner check-in')
    await page.getByLabel('How often').selectOption('monthly')
    await page.getByLabel('When in the month').selectOption('nth')
    await page.getByLabel('Which').selectOption('-1')
    await expect(page.getByText('Last Monday of every month', { exact: true })).toBeVisible()
  })

  test('members see the routines but cannot change them', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { routines: [
      { id: 'r1', title: 'Weekly EB meeting', why: 'Align the board', department_id: null, assignee: 'president', assignee_user_id: null, freq: 'weekly', weekday: 1, anchor: null, month_day: null, nth: null, months: null, lead_days: 2, active: true, template_key: 'lcp-eb-meeting' },
    ] } })
    await page.goto('/routines')
    await expect(page.getByText('Weekly EB meeting')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Every Monday · The LCP · next:/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'New routine' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'AIESEC routines' })).toHaveCount(0)
  })
})

test.describe('Plan backwards from approvals', () => {
  test('approval goals become sign-ups, applicants and acceptances, and a weekly number for Marketing', async ({ page }) => {
    const termEnd = new Date(Date.now() + 70 * 86_400_000).toISOString().slice(0, 10)   // 10 weeks left
    await setupAuthMocks(page, 'president', { tables: {
      goals: [{ id: 'g1', project_id: 'project-abc', department_id: null, title: 'oGV approvals', metric: 'pipeline', product: 'ogv', stage: 'approved', target: 30, current_value: 0, unit: null, starts_on: '2026-02-01', ends_on: termEnd }],
      exchanges: [],
    } })
    await page.goto('/goals')
    const planner = page.locator('section', { has: page.getByRole('heading', { name: 'Plan backwards from approvals' }) })
    await expect(planner.getByLabel('oGV approvals goal')).toHaveValue('30', { timeout: 10000 })
    const ogv = planner.getByRole('row', { name: /oGV/ })
    await expect(ogv).toContainText('787')        // sign-ups at 15% / 47% / 55%
    await expect(ogv).toContainText('118')
    await expect(ogv).toContainText('55')
    await expect(planner.getByRole('status')).toContainText(/Marketing needs about \d+ sign-ups a week/)
    // Other rates change the plan.
    await planner.getByLabel('Sign-up → applicant (%)').fill('30')
    await expect(ogv).toContainText('394')
  })
})

test.describe('Membership criteria', () => {
  const data = (over: Record<string, unknown> = {}) => [{
    balance: '-40.00', currency: 'USD', approvals_12m: 6, meetings_12m: 3, boa_members: 3, university_affiliated: true, debt_plan: null, checks: [], ...over,
  }]

  test('each criterion shows met, at risk or not met, with its owner, and monthly reports can be ticked off', async ({ page }) => {
    await setupAuthMocks(page, 'president', { rpc: { lc_compliance: data() } })
    await recordWrites(page)
    await page.goto('/compliance')
    const row = (name: RegExp) => page.getByRole('listitem').filter({ hasText: name })
    await expect(row(/Bank balance not below zero/)).toContainText('Not met', { timeout: 10000 })
    await expect(row(/Bank balance not below zero/)).toContainText('no debt repayment plan')
    await expect(row(/5 oGX approvals a year/)).toContainText('Met')
    await expect(row(/8 iGTa meetings a year/)).toContainText('Not met')
    await expect(row(/3 board of advisors/)).toContainText('Met')
    // A debt plan moves the balance to "at risk".
    await page.getByLabel('Debt repayment plan').fill('Repay 20 a month')
    await page.getByRole('button', { name: 'Save plan' }).click()
    await expect.poll(async () => (await writes(page)).find((w) => w.url.includes('lc_compliance_info'))?.body ?? '').toContain('"debt_plan":"Repay 20 a month"')
    // Tick this month's SONA.
    await row(/SONA to the MC/).getByRole('button', { name: /Mark as done today/ }).last().click()
    await expect.poll(async () => (await writes(page)).find((w) => w.url.includes('lc_compliance_checks'))?.body ?? '').toContain('"kind":"sona"')
  })

  test('members are told the execs keep track of it', async ({ page }) => {
    await setupAuthMocks(page, 'member', { rpc: { lc_compliance: data() } })
    await page.goto('/compliance')
    await expect(page.getByText(/president and VPs keep track of the membership criteria/)).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Our LC', () => {
  test('the EB writes its identity, a SWOT tagged by area, and a battle for this month', async ({ page }) => {
    await setupAuthMocks(page, 'president', { tables: { lc_identity: [], lc_swot: [], lc_battles: [] } })
    await recordWrites(page)
    await page.goto('/plan')
    await page.getByRole('button', { name: 'Edit identity' }).click({ timeout: 10000 })
    await page.getByLabel('Team name').fill('Team Blaze')
    await page.getByLabel('Values').fill('Ownership\nCare')
    await page.getByLabel('Links to other tools').fill('Podio | https://podio.com/x')
    await page.getByRole('button', { name: 'Save identity' }).click()
    await expect.poll(async () => (await writes(page)).find((w) => w.url.includes('lc_identity'))?.body ?? '').toContain('"values":["Ownership","Care"]')
    expect((await writes(page)).find((w) => w.url.includes('lc_identity'))?.body).toContain('"tool_links":[{"label":"Podio","url":"https://podio.com/x"}]')

    await page.getByLabel('Add to Weaknesses').fill('Few iGTa partners')
    await page.getByRole('region', { name: 'Weaknesses' }).getByRole('button', { name: 'iGX' }).click()
    await page.getByRole('region', { name: 'Weaknesses' }).getByRole('button', { name: 'Add' }).click()
    await expect.poll(async () => (await writes(page)).find((w) => w.url.includes('lc_swot'))?.body ?? '').toContain('"areas":["iGX"]')

    const month = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    await page.getByLabel(`Battle for ${month}`).fill('Recruitment week')
    await page.getByRole('region', { name: month }).getByRole('button', { name: 'Add' }).click()
    await expect.poll(async () => (await writes(page)).find((w) => w.url.includes('lc_battles'))?.body ?? '').toContain('"title":"Recruitment week"')
  })

  test('members read it but cannot change it', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: {
      lc_identity: [{ project_id: 'project-abc', team_name: 'Team Blaze', vision: 'Every student abroad once', values: ['Ownership'], rules: [], ambition: null, headline_goals: null, main_channel: 'Telegram', tool_links: [], swot_takeaways: null }],
      lc_swot: [], lc_battles: [],
    } })
    await page.goto('/plan')
    await expect(page.getByRole('heading', { name: 'Team Blaze' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Every student abroad once')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit identity' })).toHaveCount(0)
    await expect(page.getByLabel('Add to Strengths')).toHaveCount(0)
  })
})
