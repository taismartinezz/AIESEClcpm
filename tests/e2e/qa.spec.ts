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
  for (const label of ['Dashboard', 'Tasks', 'Reminders', 'Chat', 'Calendar', 'People', 'Drive', 'Check-in']) await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible({ timeout: 10000 })
  await expect(nav.getByRole('link', { name: 'Finance' })).toHaveCount(0)
  await nav.getByRole('button', { name: 'More' }).click()
  await expect(nav.getByRole('link', { name: 'Finance' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Check-in' })).toBeVisible()
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('aiesec_nav_sections') ?? '[]'))).toContain('more')
})

test('merged sections: one menu item, tabs inside, and the item stays lit on every tab', async ({ page }) => {
  await setupAuthMocks(page, 'president')
  for (const [path, item, tabs] of [
    ['/attendance', 'Calendar', ['Calendar', 'Events', 'Tabling']],
    ['/outreach', 'Pipeline', ['Pipeline', 'Outreach', 'Goals']],
    ['/members', 'People', ['Directory', 'Recruitment & onboarding']],
    ['/handover', 'Drive', ['Files', 'Handover']],
  ] as const) {
    await page.goto(path)
    const tabBar = page.getByRole('navigation', { name: item, exact: true })
    for (const t of tabs) await expect(tabBar.getByRole('link', { name: t, exact: true })).toBeVisible({ timeout: 10000 })
    await expect(tabBar.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: item, exact: true })).toHaveAttribute('aria-current', 'page')
  }
})

test('tabling shifts show on the Calendar, and can be filtered out', async ({ page }) => {
  const start = new Date(); start.setHours(12, 0, 0, 0)
  const slot = { id: 's1', purpose: 'oGV recruitment', location: 'Library', starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 2 * 3_600_000).toISOString(), capacity: 3, taken: 1 }
  await setupAuthMocks(page, 'president', { tables: { tabling_slots: [slot], schedule_events: [], lc_events: [] } })
  await page.goto('/scheduling')
  await expect(page.getByText('Tabling: oGV recruitment (1/3)').first()).toBeVisible({ timeout: 10000 })
  await page.getByRole('group', { name: 'Show on the calendar' }).getByRole('button', { name: 'Tabling' }).click()
  await expect(page.getByText('Tabling: oGV recruitment (1/3)')).toHaveCount(0)
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

test.describe('chat lives in the top bar', () => {
  test('on a phone: no floating chat button, and the top-bar icon opens Chat', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 })
    await setupAuthMocks(page, 'president')
    await page.goto('/settings')
    await expect(page.getByRole('banner').getByRole('button', { name: 'Chat', exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Open messaging' })).toHaveCount(0)
    await page.getByRole('banner').getByRole('button', { name: 'Chat', exact: true }).click()
    await expect(page).toHaveURL(/\/chat$/)
  })

  test('on a laptop: nothing floats over the page; the top-bar icon drops quick messaging down and closes it', async ({ page }) => {
    await setupAuthMocks(page, 'president')
    await page.goto('/settings')
    await expect(page.getByRole('button', { name: 'Open messaging' })).toHaveCount(0)
    const chat = page.getByRole('banner').getByRole('button', { name: 'Chat', exact: true })
    await chat.click({ timeout: 10000 })
    await expect(page.getByRole('dialog', { name: 'Messaging' })).toBeVisible()
    await chat.click()
    await expect(page.getByRole('dialog', { name: 'Messaging' })).toHaveCount(0)
  })
})

test('before the history migration, an exchange still shows its stage dates and no error', async ({ page }) => {
  await setupAuthMocks(page, 'president', { departments: [OGV_DEP], tables: { exchanges: [exchange({})] } })
  // The mocks answer inside the page, so the missing-table error is injected there too.
  await page.addInitScript(() => {
    const inner = window.fetch
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      if (url.includes('/rest/v1/exchange_history')) {
        return Promise.resolve(new Response(JSON.stringify({ code: 'PGRST205', message: "Could not find the table 'public.exchange_history' in the schema cache" }), { status: 404, headers: { 'Content-Type': 'application/json' } }))
      }
      return inner.call(this, input, init)
    }
  })
  await page.goto('/pipeline')
  await page.getByRole('button', { name: 'Nadia Farah' }).first().click({ timeout: 10000 })
  const history = page.getByRole('dialog', { name: 'Nadia Farah' }).getByRole('region', { name: 'History' })
  await expect(history).toContainText('Applied')
  await expect(history.getByRole('alert')).toHaveCount(0)
})

test("People counts only this LC's tasks, and not subtasks", async ({ page }) => {
  const me = { project_id: 'project-abc', user_id: 'mock-user-id', role: 'president', department_id: null, joined_at: '2024-01-01T00:00:00.000Z', projects: { name: 'AIESEC in Test City' }, user_profiles: { name: 'Test User' } }
  const row = (task_id: string, project_id: string, parent_id: string | null) => ({ user_id: 'mock-user-id', task_id, tasks: { id: task_id, status: 'in_progress', archived: false, project_id, parent_id } })
  await setupAuthMocks(page, 'president', { tables: { team_members: [me], task_assignees: [row('t1', 'project-abc', null), row('t2', 'other-lc', null), row('t3', 'project-abc', 't1')] } })
  await page.goto('/team')
  await expect(page.getByText(/In progress:\s*1/).first()).toBeVisible({ timeout: 10000 })
  await expect(page.getByText(/In progress:\s*[23]/)).toHaveCount(0)
})

test('Calendar week view: weeks start on Monday and all-day LC events show in an "All day" row', async ({ page }) => {
  const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const tue = new Date(monday); tue.setDate(monday.getDate() + 1)
  await setupAuthMocks(page, 'president', { tables: { lc_events: [{ id: 'ev1', name: 'oGV info session', starts_on: day(tue), ends_on: day(tue) }], schedule_events: [], tabling_slots: [] } })
  await page.goto('/scheduling')
  await page.getByRole('button', { name: 'Week', exact: true }).click({ timeout: 10000 })
  await expect(page.getByText('ALL DAY')).toBeVisible()
  await expect(page.getByText('oGV info session').first()).toBeVisible()
  await expect(page.getByText('Mon', { exact: true }).first()).toBeVisible()
})

test('Escape closes the LC switcher', async ({ page }) => {
  await setupAuthMocks(page, 'president')
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch workspace', exact: true }).click({ timeout: 10000 })
  await expect(page.getByText('Local Committees', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Local Committees', { exact: true })).toHaveCount(0)
})

test('duplicating a Backlog task keeps the copy in Backlog', async ({ page }) => {
  await setupAuthMocks(page, 'president', { tables: { tasks: [task('t1', 'Plan the GA')].map((t) => ({ ...t, status: 'backlog' })) } })
  await recordWrites(page)
  await page.goto('/tasks')
  await page.getByText('Plan the GA').first().click({ timeout: 10000 })
  await page.getByRole('button', { name: 'More options' }).click()
  await page.getByRole('menuitem', { name: 'Duplicate task' }).click()
  await expect.poll(async () => (await writes(page)).find((w) => w.method === 'POST' && w.url.includes('/rest/v1/tasks'))?.body ?? '').toContain('"status":"backlog"')
})
