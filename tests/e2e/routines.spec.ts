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
