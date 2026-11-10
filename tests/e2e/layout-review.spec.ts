import { test, expect, type Page } from '@playwright/test'
import { setupAuthMocks } from './helpers/mocks'

// From a walk-through at 1073×646: sections cut off instead of scrolling, a
// board wider than the screen, and buttons and labels that didn't match.

test.use({ viewport: { width: 1073, height: 646 } })

/** No section in the page's scroll area hides its own content. */
async function clipped(page: Page) {
  return page.evaluate(() => {
    const out: string[] = []
    for (const scroller of document.querySelectorAll('main .overflow-auto')) {
      for (const el of Array.from(scroller.children) as HTMLElement[]) {
        if (el.scrollHeight > el.clientHeight + 1) out.push(`${el.tagName} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').slice(0, 40)}"`)
      }
    }
    return out
  })
}

const FULL_PLAN = {
  lc_identity: [{ project_id: 'project-abc', team_name: 'Team Blaze', vision: 'Every student abroad once', values: ['Ownership'], rules: ['Show up'], ambition: 'Grow', headline_goals: null, main_channel: 'Telegram', tool_links: [], swot_takeaways: 'Focus on iGTa' }],
  lc_swot: (['strength', 'weakness', 'opportunity', 'threat'] as const).map((kind, i) => ({ id: `s${i}`, kind, body: `A ${kind}`, areas: ['oGX'] })),
  lc_battles: [{ id: 'b1', month: `${new Date().toISOString().slice(0, 7)}-01`, title: 'Recruitment week', owner_id: null, done: false }],
  eb_profiles: [],
}

test('Planning: every section shows in full and the page scrolls', async ({ page }) => {
  await setupAuthMocks(page, 'president', { tables: FULL_PLAN })
  await page.goto('/plan')
  await expect(page.getByRole('heading', { level: 1, name: 'Planning' })).toBeVisible({ timeout: 10000 })
  await expect(page.locator('[data-tour="tab:/plan"]')).toHaveText('Planning')
  await expect(page.getByRole('region', { name: 'Threats' })).toBeAttached()
  await expect(page.getByRole('region', { name: 'Set up your LC plan' })).toHaveCount(0)   // all three started
  expect(await clipped(page)).toEqual([])
  await page.getByRole('region', { name: 'Threats' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('region', { name: 'Threats' }).getByText('A threat')).toBeInViewport()
})

test('Routines and Membership criteria: no section cut off', async ({ page }) => {
  await setupAuthMocks(page, 'president', { tables: { routines: [] }, rpc: { lc_compliance: [{ balance: '10.00', currency: 'USD', approvals_12m: 6, meetings_12m: 9, boa_members: 3, university_affiliated: true, debt_plan: null, checks: [] }] } })
  for (const path of ['/routines', '/compliance']) {
    await page.goto(path)
    await expect(page.locator('main h1')).toBeVisible({ timeout: 10000 })
    await page.waitForTimeout(500)
    expect(await clipped(page), path).toEqual([])
  }
})

test('Tasks: all five columns fit, and "Details" only shows on the row you type in', async ({ page }) => {
  await setupAuthMocks(page, 'president')
  await page.goto('/tasks')
  const columns = page.getByRole('textbox', { name: /^Add a task to / })
  await expect(columns).toHaveCount(5, { timeout: 10000 })
  for (const box of await columns.all()) await expect(box).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('button', { name: 'Details' })).toHaveCount(0)
  await columns.first().click()
  await expect(page.getByRole('button', { name: 'Details' })).toHaveCount(1)
})

test('an empty pipeline offers Import once, in the empty state', async ({ page }) => {
  await setupAuthMocks(page, 'president', { tables: { exchanges: [] } })
  await page.goto('/pipeline')
  await expect(page.getByRole('region', { name: 'Your exchange pipeline' })).toBeVisible({ timeout: 10000 })
  await expect(page.getByRole('button', { name: 'Import exchanges' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Download CSV' })).toHaveCount(0)
})

test('the LC president is called the LCP', async ({ page }) => {
  await setupAuthMocks(page, 'president')
  await page.goto('/team')
  await expect(page.locator('main')).toContainText('LCP', { timeout: 10000 })
  await expect(page.locator('main').getByText(/^President$/)).toHaveCount(0)
})
