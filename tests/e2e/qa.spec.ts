import { test, expect } from '@playwright/test'
import { setupAuthMocks } from './helpers/mocks'

// Regression tests for the QA report on the live site.

test('the president can add a partner, with a contact person and their email', async ({ page }) => {
  await setupAuthMocks(page, 'president', { tables: { partners: [], partner_contacts: [] } })
  await page.goto('/partners')
  await page.getByRole('button', { name: 'Add partner' }).first().click({ timeout: 10000 })
  const dialog = page.getByRole('dialog', { name: 'Add a partner' })
  await expect(dialog.getByRole('group', { name: 'Contact person (optional)' })).toBeVisible()
  await dialog.getByLabel('Organisation').fill('Demo Bank')
  await dialog.getByLabel('Name', { exact: true }).fill('Ana Ruiz')
  await dialog.getByLabel('Email').fill('ana-at-bank')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByText("The contact's email doesn't look right.")).toBeVisible()
})

test('the exchange form rejects a bad email and a non-numeric EXPA ID', async ({ page }) => {
  const OGV = { id: 'dep-ogv', project_id: 'project-abc', name: 'Outgoing Global Volunteer', color: '#F85A40', vp_user_id: null, is_finance: false, sort_order: 1, products: ['ogv'] }
  await setupAuthMocks(page, 'president', { departments: [OGV], tables: { exchanges: [] } })
  await page.goto('/pipeline')
  await page.getByRole('button', { name: /Add exchange|Add one by hand/ }).first().click({ timeout: 10000 })
  const dialog = page.getByRole('dialog', { name: 'Add an exchange' })
  await dialog.getByLabel(/Exchange participant/).fill('Ben')
  await dialog.getByLabel('Email').fill('notanemail')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByText(/That email doesn't look right/)).toBeVisible()
  await dialog.getByLabel('Email').fill('ben@example.com')
  await dialog.getByLabel('EXPA ID').fill('abc')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByText(/The EXPA ID is a number/)).toBeVisible()
})

/** Record the app's writes (POST/PATCH/DELETE to Supabase REST) in window.__writes. */
async function recordWrites(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __writes: { method: string; url: string; body: string }[] }
    w.__writes = []
    const inner = window.fetch
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.includes('/rest/v1/') && method !== 'GET' && method !== 'HEAD') w.__writes.push({ method, url, body: String(init?.body ?? '') })
      return inner.call(this, input, init)
    }
  })
}
const writes = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __writes: { method: string; url: string; body: string }[] }).__writes)

const task = (id: string, title: string, scope = 'lab') => ({
  id, project_id: 'project-abc', title, description: '', status: 'todo', priority: 'medium', due_date: null, parent_id: null, archived: false,
  scope, comments: [], files: [], links: [], created_by: 'mock-user-id', task_assignees: [{ user_id: 'mock-user-id' }],
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
})

test('a task saves with the description left empty', async ({ page }) => {
  await setupAuthMocks(page, 'president', { tables: { tasks: [] } })
  await recordWrites(page)
  await page.goto('/tasks')
  await page.getByRole('button', { name: 'Add Task' }).click({ timeout: 10000 })
  await page.getByPlaceholder('Task title').fill('Book the venue')
  await page.getByRole('button', { name: 'Add task' }).last().click()
  await expect.poll(async () => (await writes(page)).find((w) => w.method === 'POST' && w.url.includes('/rest/v1/tasks'))?.body ?? '')
    .toContain('"description":""')
})

test('task filters: All, Mine (private or assigned to you) and Whole LC', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 })   // the Filters panel starts folded on narrower screens
  await setupAuthMocks(page, 'president', { tables: { tasks: [task('t1', 'LC task'), task('t2', 'My errand', 'personal')] } })
  await page.goto('/tasks')
  await expect(page.getByText('LC task').first()).toBeVisible({ timeout: 10000 })
  const count = (label: string) => page.getByRole('button', { name: new RegExp(`^${label}\\s*\\d+$`) })
  await expect(count('All')).toContainText('2')
  await expect(count('Mine')).toContainText('2')       // the private task, and the LC task assigned to you
  await expect(count('Whole LC')).toContainText('1')
})

test('deleting from the task panel asks in the app, and Cancel keeps the task', async ({ page }) => {
  await setupAuthMocks(page, 'president', { tables: { tasks: [task('t1', 'Keep me')] } })
  await recordWrites(page)
  await page.goto('/tasks')
  await page.getByText('Keep me').first().click({ timeout: 10000 })
  await page.getByRole('button', { name: 'More options' }).click()
  await page.getByRole('menuitem', { name: 'Delete task' }).click()
  const ask = page.getByRole('alertdialog', { name: 'Are you sure?' })
  await expect(ask).toContainText('Delete "Keep me"')
  await ask.getByRole('button', { name: 'Cancel' }).click()
  await expect(ask).toHaveCount(0)
  expect((await writes(page)).filter((w) => w.method === 'DELETE')).toHaveLength(0)
})

test('search looks in your personal reminders too', async ({ page }) => {
  await setupAuthMocks(page, 'president', { tables: { reminders: [{ id: 'r1', title: 'hi', due_at: null, completed: false }] } })
  await page.addInitScript(() => {
    const w = window as unknown as { __reads: string[] }
    w.__reads = []
    const inner = window.fetch
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      if (url.includes('/rest/v1/reminders')) w.__reads.push(decodeURIComponent(url))
      return inner.call(this, input, init)
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Open search' }).click({ timeout: 10000 })
  await page.getByPlaceholder(/Search tasks, reminders/).fill('hi')
  await expect(page.getByRole('button', { name: 'hi Reminder' })).toBeVisible()
  const reads = await page.evaluate(() => (window as unknown as { __reads: string[] }).__reads)
  const search = reads.find((u) => u.includes('ilike'))!
  expect(search).toContain('project_id.is.null')   // personal reminders have no LC
  expect(search).toContain('due_at')               // the column is due_at, not due_date
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 780 } })

  test('chat gives the messages the screen: the chat list starts closed', async ({ page }) => {
    await setupAuthMocks(page, 'president')
    await page.goto('/chat')
    const composer = page.locator('[data-chat-composer]')
    await expect(composer).toBeVisible({ timeout: 10000 })
    expect((await composer.boundingBox())!.width).toBeGreaterThan(150)
    await expect(page.getByRole('button', { name: 'Open messaging' })).toHaveCount(0)
  })
})

test('the profile links are just LinkedIn and GitHub', async ({ page }) => {
  await setupAuthMocks(page, 'president')
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Links' }).click({ timeout: 10000 })
  await expect(page.getByText('LinkedIn', { exact: true })).toBeVisible()
  await expect(page.getByText('GitHub', { exact: true })).toBeVisible()
  await expect(page.getByText(/Google Scholar|ResearchGate|ORCID/)).toHaveCount(0)
})

test('a member sees a short sidebar, with the rest under More', async ({ page }) => {
  await setupAuthMocks(page, 'member')
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  for (const label of ['Dashboard', 'Tasks', 'Chat', 'Events', 'Tabling', 'Check-in']) await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible({ timeout: 10000 })
  await expect(nav.getByRole('link', { name: 'Finance' })).toHaveCount(0)
  await nav.getByRole('button', { name: 'More' }).click()
  await expect(nav.getByRole('link', { name: 'Finance' })).toBeVisible()
})

test('a task can be added from the board with just a title and Enter', async ({ page }) => {
  await setupAuthMocks(page, 'president', { tables: { tasks: [] } })
  await recordWrites(page)
  await page.goto('/tasks')
  const input = page.getByRole('textbox', { name: 'Add a task to To Do' })
  await input.fill('Call the venue')
  await input.press('Enter')
  await expect.poll(async () => (await writes(page)).find((w) => w.method === 'POST' && w.url.includes('/rest/v1/tasks'))?.body ?? '')
    .toContain('"title":"Call the venue"')
})

const OGV_DEP = { id: 'dep-ogv', project_id: 'project-abc', name: 'Outgoing Global Volunteer', color: '#F85A40', vp_user_id: null, is_finance: false, sort_order: 1, products: ['ogv'] }
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
const exchange = (over: Record<string, unknown>) => ({
  id: 'ex1', project_id: 'project-abc', product: 'ogv', stage: 'applied', person_name: 'Nadia Farah', email: null, phone: null,
  opportunity: null, host_entity: null, expa_id: null, expa_url: null, department_id: 'dep-ogv', owner_id: null, notes: null,
  signed_up_at: daysAgo(40), applied_at: daysAgo(30), accepted_at: null, approved_at: null, realized_at: null, finished_at: null,
  created_by: 'mock-user-id', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...over,
})

test('an unassigned exchange stays unassigned in its form, and its history shows', async ({ page }) => {
  await setupAuthMocks(page, 'president', { departments: [OGV_DEP], tables: { exchanges: [exchange({})], exchange_history: [] } })
  await page.goto('/pipeline')
  await page.getByRole('button', { name: 'Nadia Farah' }).first().click({ timeout: 10000 })
  const dialog = page.getByRole('dialog', { name: 'Nadia Farah' })
  await expect(dialog.getByLabel('Responsible member')).toHaveValue('')
  await expect(dialog.getByRole('region', { name: 'History' })).toContainText('Applied')
})

test('a stuck exchange offers one-click actions that reach a person', async ({ page }) => {
  await setupAuthMocks(page, 'president', { departments: [OGV_DEP], tables: { exchanges: [exchange({ owner_id: 'someone-else' })] } })
  await recordWrites(page)
  await page.goto('/pipeline')
  await page.getByRole('button', { name: /^Nudge/ }).first().click({ timeout: 10000 })
  await expect.poll(async () => (await writes(page)).find((w) => w.url.includes('/rest/v1/notifications'))?.body ?? '')
    .toContain('"user_id":"someone-else"')
  await expect(page.getByRole('status').filter({ hasText: /Nudged/ }).first()).toBeVisible()
})

test('a brand-new LC shows one next step instead of empty pulse and wins cards', async ({ page }) => {
  await setupAuthMocks(page, 'president')
  await page.goto('/')
  const next = page.getByRole('region', { name: 'Next step' })
  await expect(next).toContainText('Invite your VPs', { timeout: 10000 })
  await expect(next.getByRole('link', { name: 'Invite people' })).toHaveAttribute('href', '/settings#invite')
})

test('creating an LC: the university is optional and there are no working hours to fill in', async ({ page }) => {
  await setupAuthMocks(page, 'president')
  await page.goto('/onboarding')
  await page.getByText('Create a Local Committee').click({ timeout: 10000 })
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('e.g. AIESEC in Lisbon').fill('AIESEC in Porto')
  await page.getByPlaceholder('Full name').fill('Tais Martinez')
  await expect(page.getByText('University (optional)')).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByText('Your time zone')).toBeVisible()
  await expect(page.getByText('Working hours')).toHaveCount(0)
})

test('Find a time suggests slots from the server and says who is free', async ({ page }) => {
  const team = [
    { project_id: 'project-abc', user_id: 'mock-user-id', role: 'president', department_id: null, joined_at: '2024-01-01T00:00:00.000Z', projects: { name: 'AIESEC in Test City' }, user_profiles: { name: 'Test User' } },
    { project_id: 'project-abc', user_id: 'diego', role: 'member', department_id: null, joined_at: '2024-01-01T00:00:00.000Z', projects: { name: 'AIESEC in Test City' }, user_profiles: { name: 'Diego Ramos' } },
  ]
  await setupAuthMocks(page, 'president', { tables: { team_members: team } })
  const start = new Date(Date.now() + 2 * 86_400_000); start.setHours(18, 0, 0, 0)
  const end = new Date(start.getTime() + 30 * 60_000)
  let asked: Record<string, unknown> | null = null
  await page.route('**/api/scheduling/find-time', async (route) => {
    asked = route.request().postDataJSON()
    await route.fulfill({ json: { timeZone: 'UTC', sources: { 'mock-user-id': 'google', diego: 'grid' },
      suggestions: [{ start: start.toISOString(), end: end.toISOString(), free: ['mock-user-id', 'diego'], busy: [], unknown: [] }] } })
  })
  await page.goto('/scheduling')
  await page.getByRole('button', { name: /Meetings/ }).first().click({ timeout: 10000 })
  await page.getByRole('button', { name: /Propose/ }).first().click()
  await page.getByRole('button', { name: /Diego/ }).first().click()
  await page.getByRole('button', { name: 'Find best times' }).click()
  await expect(page.getByText("Everyone's free")).toBeVisible()
  expect(asked).toMatchObject({ projectId: 'project-abc', userIds: ['diego'], durationMinutes: 30 })
  await page.getByText("Everyone's free").click()
  const pad = (n: number) => String(n).padStart(2, '0')
  await expect(page.locator('input[type="date"]')).toHaveValue(`${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`)
})

test.describe('on a phone, chat lives in the top bar', () => {
  test.use({ viewport: { width: 390, height: 780 } })

  test('there is no floating chat button covering the page, and the top-bar icon opens Chat', async ({ page }) => {
    await setupAuthMocks(page, 'president')
    await page.goto('/settings')
    await expect(page.getByRole('link', { name: 'Chat', exact: true }).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Open messaging' })).toBeHidden()
    await page.getByRole('banner').getByRole('link', { name: 'Chat', exact: true }).click()
    await expect(page).toHaveURL(/\/chat$/)
  })
})
