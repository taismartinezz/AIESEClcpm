import { test, expect, type Page } from '@playwright/test'
import { setupAuthMocks, type MockRole } from './helpers/mocks'

// The tour, end to end: the core tour and every chapter, per role and screen
// size. At every step: the counter is this step over the total, one element is
// highlighted and it's on screen, and no loading skeleton shows behind the card.

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1073, height: 646 },
  { width: 390, height: 844 },
]

/** Welcome and Finish cards: the only ones with nothing to point at. */
const CARDS_WITHOUT_ANCHOR = ['Welcome to', 'Pick what to learn next', 'The national view', "You're set"]

const card = (page: Page) => page.getByRole('dialog').filter({ has: page.locator('[data-tour-counter]') })

/** Missing anchors are reported as console warnings in development: any one fails the test. */
function watchAnchors(page: Page) {
  const missing: string[] = []
  page.on('console', (m) => { if (m.text().startsWith('[tour] No anchor')) missing.push(m.text()) })
  return missing
}

interface Seen { titles: string[]; total: number }

/** Walk from the current step to the chapter picker (or the end). Checks every step on the way. */
async function walk(page: Page, label: string): Promise<Seen & { picker: boolean }> {
  const titles: string[] = []
  let total = 0
  for (let guard = 0; guard < 40; guard++) {
    const dialog = card(page)
    await expect(dialog, `${label}: step ${titles.length + 1} never finished loading`).toHaveAttribute('aria-busy', 'false', { timeout: 10000 })
    const counter = (await dialog.locator('[data-tour-counter]').textContent()) ?? ''
    const [, at, of] = counter.match(/(\d+) of (\d+)/) ?? []
    const title = ((await dialog.locator('h2').first().textContent()) ?? '').trim()
    expect(Number(at), `${label}: "${title}" says ${counter}`).toBe(titles.length + 1)
    const bar = page.getByRole('progressbar', { name: 'Tour progress' })
    await expect(bar).toHaveAttribute('aria-valuenow', at)
    await expect(bar).toHaveAttribute('aria-valuemax', of)
    total = Number(of)

    const active = page.locator('[data-tour-active]')
    const highlighted = await active.count()
    const isCardOnly = CARDS_WITHOUT_ANCHOR.some((t) => title.startsWith(t))
    expect(highlighted, `${label}: "${title}" highlights ${highlighted} elements`).toBe(isCardOnly ? 0 : 1)
    expect(await page.locator('[data-tour-spotlight]').count()).toBe(highlighted)
    if (highlighted === 1) {
      const box = await active.boundingBox()
      const vp = page.viewportSize()!
      expect(box, `${label}: "${title}" anchor has no box`).not.toBeNull()
      expect(box!.x + box!.width, `${label}: "${title}" anchor off screen`).toBeGreaterThan(0)
      expect(box!.x, `${label}: "${title}" anchor off screen`).toBeLessThan(vp.width)
      expect(box!.y + box!.height, `${label}: "${title}" anchor off screen`).toBeGreaterThan(0)
      expect(box!.y, `${label}: "${title}" anchor off screen`).toBeLessThan(vp.height)
      if (vp.width >= 640) {
        const c = (await dialog.boundingBox())!
        const overlap = c.x < box!.x + box!.width && c.x + c.width > box!.x && c.y < box!.y + box!.height && c.y + c.height > box!.y
        expect(overlap, `${label}: "${title}" card covers its anchor`).toBe(false)
      }
    }
    const skeletons = page.locator('.animate-pulse:visible')
    expect(await skeletons.count(), `${label}: "${title}" shows a loading skeleton`).toBe(0)

    titles.push(title)
    if (await dialog.getByRole('list', { name: 'Chapters' }).count()) return { titles, total, picker: true }
    const next = dialog.getByRole('button', { name: /^(Next|Done)$/ })
    if ((await next.textContent())?.includes('Done')) { await next.click(); return { titles, total, picker: false } }
    const before = `${counter}|${title}`
    await next.click()
    await expect.poll(async () => {
      const d = card(page)
      if (await d.count() === 0) return 'closed'
      return `${await d.locator('[data-tour-counter]').textContent()}|${(await d.locator('h2').first().textContent())?.trim()}`
    }, { timeout: 10000 }).not.toBe(before)
  }
  throw new Error(`${label}: the tour never ended`)
}

async function startTour(page: Page, role: MockRole) {
  await setupAuthMocks(page, role)
  await page.goto('/')
  await expect(page.locator('[data-tour="helper"]')).toBeVisible({ timeout: 15000 })
  await page.evaluate(() => window.dispatchEvent(new Event('app:show-onboarding')))
}

for (const viewport of VIEWPORTS) {
  test.describe(`The tour at ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport })
    test.setTimeout(240_000)

    for (const role of ['member', 'vp', 'president'] as const) {
      test(`${role}: the core tour and every chapter`, async ({ page }) => {
        const missing = watchAnchors(page)
        await startTour(page, role)
        const core = await walk(page, `${role} core`)
        expect(core.picker).toBe(true)
        expect(core.titles.length).toBeLessThanOrEqual(10)
        expect(core.titles.length).toBe(core.total)

        const names = (await card(page).getByRole('list', { name: 'Chapters' }).getByRole('button').allTextContents()).map((t) => t.replace('(done)', '').trim())
        expect(names.length).toBe(role === 'member' ? 5 : 6)
        if (role === 'member') expect(names).not.toContain('Setting up your LC')
        expect(names[names.length - 1]).toBe('Getting around')       // what the core tour just showed goes last
        for (const name of names) {
          const list = card(page).getByRole('list', { name: 'Chapters' })
          await list.getByRole('button', { name: new RegExp(`^${name.replace(/[&]/g, '\\$&')}`) }).click()
          const seen = await walk(page, `${role} / ${name}`)
          expect(seen.picker, `${role} / ${name} ends on the chapter picker`).toBe(true)
          expect(seen.titles.length).toBe(seen.total)
          if (role === 'member') expect(seen.titles).not.toContain('Departments')
          // The picker leaves out the chapter just finished, and ticks the others you've done.
          const now = card(page).getByRole('list', { name: 'Chapters' })
          await expect(now.getByRole('button', { name: new RegExp(`^${name}`) })).toHaveCount(0)
          const box = await card(page).boundingBox()
          expect(box!.height, 'the chapter picker fits the screen').toBeLessThanOrEqual(page.viewportSize()!.height)
        }
        await card(page).getByRole('button', { name: 'Done', exact: true }).click()
        await expect(card(page)).toHaveCount(0)
        expect(missing).toEqual([])
      })
    }

    test('mc: the national view tour', async ({ page }) => {
      const missing = watchAnchors(page)
      const MC = { id: 'mc-1', name: 'AIESEC in Portugal', member_code: '3FA9C21B', lc_code: '7C2E19AD', term_start: null, country_code: 'PT' }
      await setupAuthMocks(page, 'member', {
        tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'mcp' }] },
        rpc: { mc_dashboard: [], mc_linked_lcs: [], lcs_in_country: [], mc_team: [] },
      })
      await page.goto('/mc')
      await page.getByRole('button', { name: 'Take the tour' }).click({ timeout: 15000 })
      const seen = await walk(page, 'mc')
      expect(seen.picker).toBe(false)
      expect(seen.titles[0]).toBe('The national view')
      expect(seen.titles[seen.titles.length - 1]).toBe("You're set")
      expect(seen.titles.length).toBe(seen.total)
      expect(missing).toEqual([])
    })
  })
}

test.describe('Tour controls', () => {
  test('in a brand-new LC (just the LCP), the Pulse step is left out instead of spinning', async ({ page }) => {
    const missing = watchAnchors(page)
    await setupAuthMocks(page, 'president', { tables: { team_members: [{ id: 'tm1', user_id: 'mock-user-id', project_id: 'project-abc', role: 'president', department_id: null }] } })
    await page.goto('/')
    await expect(page.locator('[data-tour="helper"]')).toBeVisible({ timeout: 15000 })
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('app:show-onboarding', { detail: { chapter: 'wellbeing' } })))
    const seen = await walk(page, 'solo LC / wellbeing')
    expect(seen.titles).not.toContain('Pulse')
    expect(seen.picker).toBe(true)
    expect(missing).toEqual([])
  })

  test('keys: → and Enter go on, ← goes back, Esc ends it and focus goes back to the page', async ({ page }) => {
    await startTour(page, 'member')
    await expect(card(page)).toHaveAttribute('aria-busy', 'false', { timeout: 10000 })
    await expect(card(page).locator('[data-tour-counter]')).toHaveText(/^1 of/)
    await page.keyboard.press('ArrowRight')
    await expect(card(page).locator('[data-tour-counter]')).toHaveText(/^2 of/)
    await expect(card(page)).toHaveAttribute('aria-busy', 'false', { timeout: 10000 })
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Enter')
    await expect(card(page).locator('[data-tour-counter]')).toHaveText(/^3 of/)
    await page.keyboard.press('ArrowLeft')
    await expect(card(page).locator('[data-tour-counter]')).toHaveText(/^2 of/)
    await page.keyboard.press('Escape')
    await expect(card(page)).toHaveCount(0)
    expect(await page.evaluate(() => document.activeElement !== document.body && document.activeElement !== null)).toBe(true)
    await expect(page.locator('[data-tour-active]')).toHaveCount(0)
  })

  test('Try it pauses the tour to open + New, and Back to the tour resumes on the same step', async ({ page }) => {
    await startTour(page, 'member')
    for (const n of [2, 3]) {
      await expect(card(page)).toHaveAttribute('aria-busy', 'false', { timeout: 10000 })
      await page.keyboard.press('ArrowRight')
      await expect(card(page).locator('[data-tour-counter]')).toHaveText(new RegExp(`^${n} of`))
    }
    await expect(card(page).getByRole('heading', { name: '+ New' })).toBeVisible({ timeout: 10000 })
    await expect(card(page)).toHaveAttribute('aria-busy', 'false', { timeout: 10000 })
    await card(page).getByRole('button', { name: /Try it/ }).click()
    await expect(page.getByRole('button', { name: 'Task', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Back to the tour' }).click()
    await expect(card(page).getByRole('heading', { name: '+ New' })).toBeVisible()
  })

  test('Show me this page runs only that page\'s steps (Settings for the LCP)', async ({ page }) => {
    await setupAuthMocks(page, 'president')
    await page.goto('/team')
    await page.getByRole('button', { name: 'Show me this page' }).click({ timeout: 15000 })
    const seen = await walk(page, 'page /team')
    expect(seen.titles).toEqual(['People'])
  })

  test('Help lists the chapters, with a ✓ once one is finished', async ({ page }) => {
    await setupAuthMocks(page, 'vp')
    await page.goto('/help')
    const chapters = page.locator('[data-tour="help-chapters"]')
    await expect(chapters.getByRole('listitem')).toHaveCount(6, { timeout: 15000 })
    await chapters.getByRole('button', { name: 'Start Wellbeing & privacy' }).click()
    const seen = await walk(page, 'vp / wellbeing from Help')
    expect(seen.picker).toBe(true)
    await card(page).getByRole('button', { name: 'Done', exact: true }).click()
    await page.goto('/help')
    await expect(chapters.getByRole('button', { name: 'Replay Wellbeing & privacy' })).toBeVisible({ timeout: 15000 })
  })
})
