import { test, expect } from '@playwright/test'
import { setupAuthMocks } from './helpers/mocks'

// What each role is offered on the Finance, Attendance and Tabling pages.
// The database tests (tests/db) prove the data each role can actually read.

const FL = { id: 'dep-fl', project_id: 'project-abc', name: 'Finance & Legality', color: '#037EF3', vp_user_id: 'someone-else', is_finance: true, sort_order: 7 }

const future = new Date(Date.now() + 3 * 86_400_000)
future.setHours(12, 0, 0, 0)
const slot = {
  id: 'slot-1', project_id: 'project-abc', starts_at: future.toISOString(),
  ends_at: new Date(future.getTime() + 2 * 3_600_000).toISOString(),
  location: 'Library entrance', purpose: 'oGV recruitment', capacity: 2, taken: 2,
  department_id: null, series_id: null, created_by: 'someone-else',
}

test.describe('Finance page', () => {
  test('a member only sees their own claims and can submit one', async ({ page }) => {
    await setupAuthMocks(page, 'member', { departments: [FL] })
    await page.goto('/finance')
    await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('My expense claims')).toBeVisible()
    await expect(page.getByRole('tab', { name: /ledger/i })).toHaveCount(0)
    await page.getByRole('button', { name: /new claim/i }).click()
    await expect(page.getByRole('dialog', { name: 'Submit an expense claim' })).toBeVisible()
  })

  test('the president gets the ledger with totals and CSV export', async ({ page }) => {
    await setupAuthMocks(page, 'president', {
      departments: [FL],
      tables: { finance_entries: [{ id: 'e1', project_id: 'project-abc', type: 'income', amount: 450, currency: 'EUR', entry_date: new Date().toISOString().slice(0, 10), category_id: null, department_id: null, description: 'Sponsorship', recorded_by: null, receipt_path: null, claim_id: null, created_at: new Date().toISOString() }] },
    })
    await page.goto('/finance')
    await expect(page.getByRole('tab', { name: 'Overview & ledger' })).toHaveAttribute('aria-selected', 'true', { timeout: 10000 })
    await expect(page.getByText('Current balance')).toBeVisible()
    await expect(page.getByRole('button', { name: /csv/i })).toBeEnabled()
    await expect(page.getByRole('button', { name: /add entry/i })).toBeVisible()
  })
})

test.describe('Attendance page', () => {
  test('members see their own attendance and cannot log anyone', async ({ page }) => {
    await setupAuthMocks(page, 'member')
    await page.goto('/attendance')
    await expect(page.getByRole('tab', { name: 'My attendance' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /log attendance/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^event$/i })).toHaveCount(0)
  })

  test('VPs can create events and see the table', async ({ page }) => {
    await setupAuthMocks(page, 'vp')
    await page.goto('/attendance')
    await expect(page.getByRole('tab', { name: 'Table' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /event/i }).first()).toBeVisible()
  })
})

test.describe('Tabling page', () => {
  test('a full slot shows as full and offers no sign-up', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { tabling_slots: [slot], tabling_signups: [] } })
    await page.goto('/tabling')
    await expect(page.getByText('oGV recruitment')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Full', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign up' })).toHaveCount(0)
    await expect(page.getByRole('tab', { name: 'Report' })).toHaveCount(0)
  })

  test('VPs get the report tab and can create slots', async ({ page }) => {
    await setupAuthMocks(page, 'vp', { tables: { tabling_slots: [], tabling_signups: [] } })
    await page.goto('/tabling')
    await expect(page.getByRole('tab', { name: 'Report' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /new slot/i })).toBeVisible()
  })
})

test.describe('Pipeline and goals', () => {
  const OGV = { id: 'dep-ogv', project_id: 'project-abc', name: 'Outgoing Global Volunteer', color: '#F85A40', vp_user_id: null, is_finance: false, sort_order: 1, products: ['ogv'] }
  const ex = { id: 'ex1', project_id: 'project-abc', product: 'ogv', stage: 'approved', person_name: 'Marta S.', email: null, phone: null, opportunity: 'Teaching English', host_entity: 'AIESEC in Bogotá', expa_id: null, expa_url: null, department_id: 'dep-ogv', owner_id: null, notes: null, signed_up_at: '2026-09-01', applied_at: '2026-09-05', accepted_at: '2026-09-10', approved_at: '2026-09-20', realized_at: null, finished_at: null, updated_at: new Date().toISOString() }

  test('the president sees every product and the exchange in its stage column', async ({ page }) => {
    await setupAuthMocks(page, 'president', { departments: [OGV], tables: { exchanges: [ex] } })
    await page.goto('/pipeline')
    await expect(page.getByRole('tab', { name: /iGTe/ })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('region', { name: 'Approved: 1' }).getByText('Marta S.')).toBeVisible()
  })

  test('a member of a non-exchange department is told the pipeline is not theirs', async ({ page }) => {
    await setupAuthMocks(page, 'member', { departments: [OGV] })
    await page.goto('/pipeline')
    await expect(page.getByText(/doesn.t run an exchange product/)).toBeVisible({ timeout: 10000 })
  })

  test('goals show progress bars with their numbers', async ({ page }) => {
    const goal = { id: 'g1', project_id: 'project-abc', department_id: null, title: 'New members recruited', metric: 'manual', product: null, stage: null, target: 15, current_value: 6, unit: 'members', starts_on: '2026-02-01', ends_on: '2027-01-31' }
    await setupAuthMocks(page, 'member', { tables: { goals: [goal] }, rpc: { goal_progress: [{ goal_id: 'g1', current: 6 }] } })
    await page.goto('/goals')
    await expect(page.getByRole('progressbar', { name: 'New members recruited' })).toHaveAttribute('aria-valuenow', '6', { timeout: 10000 })
    await expect(page.getByText('6 / 15')).toBeVisible()
    await expect(page.getByRole('button', { name: /new goal/i })).toHaveCount(0)
  })
})

test.describe('Partners', () => {
  test('shows partners by stage and flags overdue follow-ups', async ({ page }) => {
    const partner = { id: 'p1', project_id: 'project-abc', name: 'Demo Bank', industry: 'Banking', website: null, stage: 'meeting', department_id: null, owner_id: 'mock-user-id', next_follow_up: '2020-01-01', notes: null, updated_at: new Date().toISOString() }
    await setupAuthMocks(page, 'vp', { tables: { partners: [partner] } })
    await page.goto('/partners')
    await expect(page.getByRole('button', { name: 'Demo Bank' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/overdue/)).toBeVisible()
    await expect(page.getByText('1 of your partners need a follow-up this week.')).toBeVisible()
  })
})
