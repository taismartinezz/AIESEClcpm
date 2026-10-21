import { test, expect } from '@playwright/test'
import { RELEASES } from '../../src/lib/help'

// Use the real browser preview backend, without intercepting application data.
test.beforeEach(async ({ page }) => {
  await page.addInitScript((releaseId) => {
    for (const role of ['president', 'vp', 'member', 'mc']) {
      localStorage.setItem(`aiesec_tour_v3:${role}`, '1')
    }
    localStorage.setItem('aiesec_seen_release', releaseId)
  }, RELEASES[0].id)
})

const routes = ['/', '/tasks', '/chat', '/reminders', '/scheduling', '/pipeline', '/outreach',
  '/goals', '/partners', '/team', '/members', '/attendance', '/tabling', '/finance', '/drive',
  '/handover', '/import', '/checkin', '/journal', '/help', '/settings', '/profile', '/mc', '/privacy']

for (const mobile of [false, true]) {
  test(`all demo routes render without crashes or overflow (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    for (const route of routes) {
      const response = await page.goto(route)
      expect(response?.status(), route).toBe(200)
      await expect(page.locator('h1').first(), route).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: route }).toBeLessThanOrEqual(1)
      expect(errors, route).toEqual([])
    }
  })
}

test('creates a task, changes its status in list view, and resets sample data on reload', async ({ page }) => {
  await page.goto('/tasks')
  await page.getByRole('button', { name: 'Add Task', exact: true }).click()
  await page.getByPlaceholder('Task title').fill('QA demo task')
  await page.getByRole('button', { name: 'Add task', exact: true }).last().click()
  await expect(page.getByText('QA demo task', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'List', exact: true }).click()
  const row = page.getByRole('row').filter({ hasText: 'QA demo task' })
  await row.getByRole('button', { name: 'Status: To do' }).click()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(row.getByRole('button', { name: 'Status: Done' })).toBeVisible()
  await page.reload()
  await expect(page.getByText('QA demo task', { exact: true })).toHaveCount(0)
})

test('sends a chat message through the preview backend', async ({ page }) => {
  await page.goto('/chat')
  const input = page.getByRole('textbox', { name: 'Message Whole LC' })
  await input.fill('QA message in sample LC')
  await input.press('Enter')
  await expect(page.getByText('QA message in sample LC', { exact: true })).toBeVisible()
  await expect(input).toHaveValue('')
})

test('submits and edits the current check-in', async ({ page }) => {
  await page.goto('/checkin')
  const scores = page.getByRole('button', { name: '4: Agree', exact: true })
  await expect(scores).toHaveCount(6)
  for (const score of await scores.all()) await score.click()
  await page.getByRole('button', { name: 'Submit check-in', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Thanks, your check-in is in.' })).toBeVisible()
  await page.getByRole('button', { name: '5: Strongly agree', exact: true }).first().click()
  await page.getByRole('button', { name: 'Update my answers', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Your answers were updated.' })).toBeVisible()
})

test('demo journal warns about privacy, saves an entry and clears the editor', async ({ page }) => {
  await page.goto('/journal')
  await expect(page.getByText(/Demo only — do not enter private information/)).toBeVisible()
  const input = page.getByPlaceholder(/Take a moment/)
  await input.fill('Fictional reflection for QA')
  await page.getByRole('button', { name: 'Save entry', exact: true }).click()
  await expect(page.getByText('✓ Entry saved.', { exact: true })).toBeVisible()
  await expect(page.getByText('Fictional reflection for QA', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'New Entry', exact: true }).click()
  await expect(input).toHaveValue('')
  await expect(page.getByText(/Encryption key unavailable/)).toHaveCount(0)
})

test('search opens an in-session task and closing it does not reopen it', async ({ page }) => {
  await page.goto('/tasks')
  await page.getByRole('button', { name: 'Add Task', exact: true }).click()
  await page.getByPlaceholder('Task title').fill('Searchable QA task')
  await page.getByRole('button', { name: 'Add task', exact: true }).last().click()
  await expect(page.getByText('Searchable QA task', { exact: true })).toBeVisible()
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Search tasks, reminders, the Drive, chat…').fill('Searchable QA')
  await page.getByRole('dialog', { name: 'Search', exact: true }).getByRole('button').filter({ hasText: 'Searchable QA task' }).click()
  await expect(page).toHaveURL(/openTask=/)
  await expect(page.getByRole('heading', { name: 'Searchable QA task', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Searchable QA task', exact: true })).toHaveCount(0)
  await expect(page).not.toHaveURL(/openTask=/)
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder('Search tasks, reminders, the Drive, chat…').fill('Searchable QA')
  await page.getByRole('dialog', { name: 'Search', exact: true }).getByRole('button').filter({ hasText: 'Searchable QA task' }).click()
  await expect(page.getByRole('heading', { name: 'Searchable QA task', exact: true })).toBeVisible()
})

test('the chosen chat channel survives navigating away and back', async ({ page }) => {
  await page.goto('/chat')
  await page.getByRole('button', { name: 'Kwame Mensah', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Kwame Mensah', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
  await page.getByRole('link', { name: 'Chat', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Kwame Mensah', exact: true })).toBeVisible()
})

test('availability autosaves keyboard edits and survives tab changes', async ({ page }) => {
  await page.goto('/scheduling')
  await page.getByRole('button', { name: 'Availability', exact: true }).click()
  const slot = page.getByRole('button', { name: 'Mon 9:00 AM', exact: true })
  await expect(slot).toBeVisible()
  const before = await slot.getAttribute('aria-pressed')
  await slot.focus()
  await slot.press('Space')
  await expect(slot).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true')
  await expect(page.getByText('✓ Saved', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Calendar', exact: true }).click()
  await page.getByRole('button', { name: 'Availability', exact: true }).click()
  await expect(slot).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true')
  await expect(page.getByText('Saving…', { exact: true })).toHaveCount(0)
})

test('folded navigation sections and collapsed sidebar preferences are independent', async ({ page }) => {
  await page.goto('/')
  // The sidebar shows each role's own pages, with the rest under "More" (folded until opened).
  const more = page.getByRole('button', { name: 'More', exact: true })
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await more.click()
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  const sections = await page.evaluate(() => localStorage.getItem('aiesec_nav_sections'))
  expect(sections).not.toBeNull()
  expect(JSON.parse(sections!)).toContain('more')
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
  expect(await page.evaluate(() => localStorage.getItem('aiesec_nav_sections'))).toBe(sections)
  expect(await page.evaluate(() => localStorage.getItem('aiesec_nav_collapsed'))).toBe('false')
})
