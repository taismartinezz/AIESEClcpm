import { test, expect, type Page } from '@playwright/test'
import { setupAuthMocks } from './helpers/mocks'

/** Record writes (after setupAuthMocks). */
async function recordWrites(page: Page) {
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
const writes = (page: Page) => page.evaluate(() => (window as unknown as { __writes: { method: string; url: string; body: string }[] }).__writes)

/** Answer /api/helper after a short delay, so the "how long" state shows. */
async function helperAnswers(page: Page, body: object, delayMs = 700) {
  await page.route('**/api/helper', async (route) => {
    await new Promise((r) => setTimeout(r, delayMs))
    await route.fulfill({ json: body })
  })
}

const PARTNERS = {
  found: true, source: 'ai', notForYou: false, closest: ['partners'],
  answer: 'Partners has every company you work with. Add one with the button at the top.',
  entry: { id: 'partners', title: 'Partners and companies', route: '/partners', where: 'Partners', how: ['Add a partner or Import your partner tracker.'], roles: ['vp', 'president'], target: ['[data-tour="page-actions"]', '[data-tour="page-header"]'] },
}

test.describe('Ask the helper', () => {
  test('says how long it will take, then "yes, it\'s here" and takes you there', async ({ page }) => {
    await setupAuthMocks(page, 'president')
    await helperAnswers(page, PARTNERS)
    await page.goto('/')
    await page.getByRole('button', { name: 'Ask' }).click({ timeout: 10000 })
    const panel = page.getByRole('dialog', { name: 'Ask the helper' })
    await panel.getByLabel('What are you looking for?').fill('where do I add a company we work with?')
    await panel.getByRole('button', { name: 'Ask', exact: true }).click()
    await expect(panel.getByRole('status')).toContainText(/this usually takes about \d+ seconds?/)
    await expect(panel.getByText("Yes, it's here")).toBeVisible()
    await expect(panel).toContainText('Where: Partners')
    await panel.getByRole('button', { name: 'Take me there' }).click()
    await expect(page).toHaveURL(/\/partners$/)
    const spot = page.getByRole('dialog', { name: 'Partners and companies' })
    await expect(spot).toContainText('track stage, contacts and follow-ups')     // the app's own map, not the server's text
    await spot.getByRole('button', { name: 'Done' }).click()
    await expect(spot).toHaveCount(0)
  })

  test('"no, it doesn\'t exist" reports the question to the moderators', async ({ page }) => {
    await setupAuthMocks(page, 'member')
    await recordWrites(page)
    await helperAnswers(page, { found: false, source: 'ai', notForYou: false, closest: ['calendar'], entry: null, answer: "LC Manager can't export to Outlook yet." })
    await page.goto('/')
    await page.getByRole('button', { name: 'Ask' }).click({ timeout: 10000 })
    const panel = page.getByRole('dialog', { name: 'Ask the helper' })
    await panel.getByLabel('What are you looking for?').fill('export the calendar to Outlook')
    await panel.getByRole('button', { name: 'Ask', exact: true }).click()
    await expect(panel.getByText("No, that doesn't exist yet")).toBeVisible()
    await expect(panel).toContainText("Reported to the app's moderators as a feature request")
    const report = (await writes(page)).find((w) => w.url.includes('/rest/v1/feature_requests'))
    expect(report?.method).toBe('POST')
    expect(JSON.parse(report!.body)).toMatchObject({ question: 'export the calendar to Outlook', role: 'member', page: '/', closest: ['calendar'] })
  })

  test('tells you when something is for another role', async ({ page }) => {
    await setupAuthMocks(page, 'member')
    await helperAnswers(page, { ...PARTNERS, notForYou: true }, 50)
    await page.goto('/')
    await page.getByRole('button', { name: 'Ask' }).click({ timeout: 10000 })
    const panel = page.getByRole('dialog', { name: 'Ask the helper' })
    await panel.getByRole('button', { name: 'Where do I add a partner?' }).click()
    await panel.getByRole('button', { name: 'Ask', exact: true }).click()
    await expect(panel).toContainText('This is for VPs or the LC president')
  })
})

const tourButton = (page: Page, name: string | RegExp) => page.getByRole('dialog').getByRole('button', { name })

test.describe('The tour', () => {
  test('the president tour opens each page and points at it', async ({ page }) => {
    await setupAuthMocks(page, 'president')
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Ask' })).toBeVisible({ timeout: 10000 })
    await page.evaluate(() => window.dispatchEvent(new Event('app:show-onboarding')))
    const tour = page.getByRole('dialog', { name: /Welcome to/ })
    await expect(tour).toBeVisible()
    await expect(page.getByRole('progressbar', { name: 'Tour progress' })).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('dialog', { name: 'Your dashboard' })).toBeVisible()
    await tourButton(page, 'Next').click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(page.getByRole('dialog', { name: 'Settings: your LC' })).toContainText('linking your LC to your MC')
    await tourButton(page, 'Next').click()
    await expect(page).toHaveURL(/\/pipeline$/)
    await expect(page.getByRole('dialog', { name: 'Pipeline' })).toBeVisible()
    await tourButton(page, 'Back').click()
    await expect(page).toHaveURL(/\/settings$/)
    await tourButton(page, 'Skip tour').click()
    await expect(page.getByRole('dialog', { name: 'Settings: your LC' })).toHaveCount(0)
  })

  test('the MC tour runs on the national view and skips what this person does not have', async ({ page }) => {
    const MC = { id: 'mc-1', name: 'AIESEC in Portugal', member_code: '3FA9C21B', lc_code: '7C2E19AD', term_start: null, country_code: 'PT' }
    await setupAuthMocks(page, 'member', {
      tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'member' }] },
      rpc: { mc_dashboard: [], mc_linked_lcs: [], lcs_in_country: [], mc_team: [] },
    })
    await page.goto('/mc')
    await page.getByRole('button', { name: 'Take the tour' }).click({ timeout: 10000 })
    await expect(page.getByRole('dialog', { name: 'The national view' })).toBeVisible()
    await tourButton(page, 'Next').click()
    await expect(page.getByRole('dialog', { name: 'Codes and linking' })).toBeVisible()
    // A plain member has no Finance tab: walk to the end and never see that step.
    const titles: string[] = []
    for (let i = 0; i < 12; i++) {
      const next = tourButton(page, /^(Next|Done)$/)
      if (await next.count() === 0) break
      await expect(page.getByRole('dialog')).toHaveAttribute('aria-busy', 'false', { timeout: 8000 })
      const title = await page.getByRole('dialog').locator('h2').first().textContent()
      titles.push(title ?? '')
      if ((await next.textContent())?.includes('Done')) { await next.click(); break }
      await next.click()
      await page.waitForTimeout(150)
    }
    expect(titles).not.toContain('Finance')
    expect(titles[titles.length - 1]).toBe("You're set")
  })
})
