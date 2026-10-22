import { test, expect } from '@playwright/test'
import { setupAuthMocks } from './helpers/mocks'

// Regression tests for the issues found on the live site.

const TZ = 'America/Chicago'
/** YYYY-MM-DD `days` from today in Chicago. */
function chicagoDay(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
const label = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

test.describe('3 · Dashboard reads tasks and reminders (America/Chicago)', () => {
  test.use({ timezoneId: TZ })

  test('overdue, today and upcoming are filled, with the right dates', async ({ page }) => {
    const base = { project_id: 'project-abc', description: '', priority: 'medium', parent_id: null, archived: false, scope: 'lab', comments: [], files: [], links: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
    const tasks = [
      { ...base, id: 't1', title: 'Collect receipts', status: 'todo', due_date: chicagoDay(-1), created_by: 'someone', task_assignees: [{ user_id: 'mock-user-id' }] },
      { ...base, id: 't2', title: 'Plan the GA', status: 'in_progress', due_date: chicagoDay(4), created_by: 'mock-user-id', task_assignees: [] },
      { ...base, id: 't3', title: 'Someone else’s task', status: 'todo', due_date: chicagoDay(2), created_by: 'someone', task_assignees: [{ user_id: 'someone' }] },
    ]
    const todayAt3pm = new Date(`${chicagoDay(0)}T15:00:00-05:00`).toISOString()
    const reminders = [{ id: 'r1', title: 'Call Demo Bank', due_at: todayAt3pm, scope: 'personal', assignee_id: null }]
    await setupAuthMocks(page, 'president', { tables: { tasks, reminders } })
    await page.goto('/')

    const overdue = page.getByRole('region', { name: 'Overdue' })
    await expect(overdue.getByText('Collect receipts')).toBeVisible({ timeout: 10000 })
    await expect(overdue.getByText(label(chicagoDay(-1)))).toBeVisible()
    await expect(page.getByRole('region', { name: 'Today' }).getByText('Call Demo Bank')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Upcoming' }).getByText('Plan the GA')).toBeVisible()
    await expect(page.getByText('Someone else’s task')).toHaveCount(0)
  })
})

test('4 · the sidebar Settings button opens Settings', async ({ page }) => {
  await setupAuthMocks(page, 'president')
  await page.goto('/')
  await page.getByRole('navigation', { name: 'Main navigation' }).waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole('heading', { level: 1, name: /^settings$/i })).toBeVisible()
})

test.describe('7 · consistent names', () => {
  test('the Events page is called Events everywhere', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { lc_events: [], event_attendance: [], event_rsvps: [] } })
    await page.goto('/attendance')
    await expect(page.getByRole('heading', { level: 1, name: 'Events' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('link', { name: 'Events' })).toBeVisible()
    await expect(page.getByText('Attendance', { exact: true })).toHaveCount(0)
  })

  test('"Import exchanges" opens "Import exchanges"', async ({ page }) => {
    const OGV = { id: 'dep-ogv', project_id: 'project-abc', name: 'Outgoing Global Volunteer', color: '#F85A40', vp_user_id: null, is_finance: false, sort_order: 1, products: ['ogv'] }
    await setupAuthMocks(page, 'president', { departments: [OGV], tables: { exchanges: [] } })
    await page.goto('/pipeline')
    await page.getByRole('button', { name: 'Import exchanges' }).first().click({ timeout: 10000 })
    await expect(page.getByRole('dialog', { name: 'Import exchanges' })).toBeVisible()
  })
})

test.describe('8 · small UI bugs', () => {
  test('Escape closes the Messaging panel', async ({ page }) => {
    await setupAuthMocks(page, 'member')
    await page.goto('/')
    await page.getByRole('banner').getByRole('button', { name: 'Chat', exact: true }).click({ timeout: 10000 })
    await expect(page.getByRole('dialog', { name: 'Messaging' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Messaging' })).toHaveCount(0)
  })

  test('the Notifications tooltip is gone after closing the panel', async ({ page }) => {
    await setupAuthMocks(page, 'member')
    await page.goto('/')
    const bell = page.getByRole('button', { name: /^Notifications/ })
    await bell.click({ timeout: 10000 })
    await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Notifications' })).toHaveCount(0)
    await page.mouse.move(600, 600)
    await page.waitForTimeout(700)
    await expect(page.getByRole('tooltip', { name: 'Notifications', includeHidden: false })).toHaveCount(0)
  })

  test('the Add exchange dialog is opaque with a dark backdrop', async ({ page }) => {
    const OGV = { id: 'dep-ogv', project_id: 'project-abc', name: 'Outgoing Global Volunteer', color: '#F85A40', vp_user_id: null, is_finance: false, sort_order: 1, products: ['ogv'] }
    await setupAuthMocks(page, 'president', { departments: [OGV], tables: { exchanges: [] } })
    await page.goto('/pipeline')
    await page.getByRole('button', { name: /Add exchange|Add one by hand/ }).first().click({ timeout: 10000 })
    const dialog = page.getByRole('dialog', { name: 'Add an exchange' })
    await expect(dialog).toBeVisible()
    const style = await dialog.evaluate((el) => ({
      backdrop: getComputedStyle(el).backgroundColor,
      panel: getComputedStyle(el.firstElementChild as Element).backgroundColor,
    }))
    expect(style.panel).toMatch(/^rgb\(/)                       // no alpha: fully opaque
    const alpha = Number(style.backdrop.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1] ?? 1)
    expect(alpha).toBeGreaterThanOrEqual(0.4)
  })
})

test('sign-up accepts a name filled in by browser autofill', async ({ page }) => {
  await page.route('**/auth/v1/signup**', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'signup-user', identities: [] }, session: null }),
  }))
  await page.goto('/login')
  await page.getByRole('link', { name: /create one|sign up|create an account/i }).or(page.getByRole('button', { name: /create one|sign up|create an account/i })).first().click({ timeout: 10000 })
  await expect(page.getByLabel('Full name')).toBeVisible()
  // Autofill sets the boxes without the typing events React listens to.
  await page.evaluate(() => {
    const set = (label: string, v: string) => { (document.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement).value = v }
    set('Full name', 'Tais Martinez'); set('Email', 'tais@example.com'); set('Password', 'long-enough-password')
  })
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Please enter your full name.')).toHaveCount(0)
  await expect(page.getByText('Please enter a valid email address.')).toHaveCount(0)
})

test('the Calendar (formerly Scheduling) offers Connect Google Calendar', async ({ page }) => {
  await setupAuthMocks(page, 'member', { tables: { schedule_events: [], user_availability: [], meeting_proposals: [] } })
  await page.goto('/scheduling')
  await expect(page.getByRole('heading', { level: 1, name: 'Calendar' })).toBeVisible({ timeout: 10000 })
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Calendar', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Availability' }).first().click()
  const card = page.getByRole('region', { name: 'Google Calendar' })
  await expect(card.getByRole('button', { name: 'Connect Google Calendar' })).toBeVisible()
  await expect(card.getByText(/Read-only. Only you see your Google events/)).toBeVisible()
})

test('Google sign-in: the /auth/callback?code=… return lands in the app, not on a login error', async ({ page }) => {
  await setupAuthMocks(page, 'member')
  await page.goto('/auth/callback?code=test-code')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 10000 })
  await expect(page).toHaveURL(/localhost:3000\/(\?.*)?$/)
})

test.describe('Email sign-in', () => {
  test('an unconfirmed email says so and offers to resend the confirmation', async ({ page }) => {
    await page.route('**/auth/v1/token**', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' }) }))
    let resent = false
    await page.route('**/auth/v1/resend**', (r) => { resent = true; return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) })
    await page.goto('/login')
    await page.getByLabel('Email').fill('new@example.com')
    await page.locator('input[aria-label="Password"]').fill('long-enough-password')
    await page.getByRole('button', { name: /continue with email/i }).click()
    await expect(page.getByText(/isn't confirmed yet/)).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Resend confirmation email' }).click()
    await expect(page.getByRole('button', { name: /Sent: check your inbox/ })).toBeVisible()
    expect(resent).toBe(true)
  })

  test('a first-time visitor is not told their session expired', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/, { timeout: 10000 })
    await expect(page.getByText(/session expired/i)).toHaveCount(0)
  })
})
