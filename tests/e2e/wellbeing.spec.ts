import { test, expect } from '@playwright/test'
import { setupAuthMocks } from './helpers/mocks'

// An LC with people in it (with just you, the dashboard shows "Invite your VPs" instead of the pulse).
const member = (user_id: string, role: string) => ({ project_id: 'project-abc', user_id, role, department_id: null, joined_at: '2024-01-01T00:00:00.000Z', projects: { name: 'AIESEC in Test City' }, user_profiles: { name: user_id } })
const TEAM = [member('mock-user-id', 'president'), member('vp-1', 'vp'), member('m-1', 'member')]
const VP_TEAM = [member('mock-user-id', 'vp'), member('pres-1', 'president'), member('m-1', 'member')]

// The database decides what each role may see (tests/db/wellbeing.test.ts);
// these tests check the dashboard renders each role's view correctly.

const MKT = 'dep-marketing'
const OGV = 'dep-ogv'

function periodStarts(): string[] {
  const now = new Date()
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  // Two-week periods anchored to Monday 2024-01-01 (same as checkin_period_start in SQL)
  const epoch = Date.UTC(2024, 0, 1)
  const current = epoch + Math.floor((monday.getTime() - epoch) / (14 * 86_400_000)) * 14 * 86_400_000
  return Array.from({ length: 8 }, (_, i) => new Date(current - (7 - i) * 14 * 86_400_000).toISOString().slice(0, 10))
}

const QUESTIONS = ['energy', 'workload', 'purpose', 'support', 'belonging', 'balance']

function periodRows(dept: string | null | undefined, scores: (number | null)[]) {
  return periodStarts().flatMap((period_start, i) => {
    const score = scores[i]
    if (score == null) {
      return [{ department_id: dept, period_start, question_id: null, avg_score: null, respondent_count: null, suppressed: true }]
    }
    return QUESTIONS.map((question_id, q) => ({
      department_id: dept, period_start, question_id,
      avg_score: (score + (q % 2 ? 0.1 : -0.1)).toFixed(2), respondent_count: 5, suppressed: false,
    }))
  })
}

const departments = [
  { id: MKT, project_id: 'project-abc', name: 'Marketing', color: '#FFC845', vp_user_id: 'vp-1', is_finance: false, sort_order: 5 },
  { id: OGV, project_id: 'project-abc', name: 'Outgoing Global Volunteer', color: '#F85A40', vp_user_id: 'vp-2', is_finance: false, sort_order: 1 },
]

const execRows = periodRows(undefined, [3.9, 4.0, 4.1, 3.8, 4.0, 4.2, 4.1, 4.0]).map(({ period_start, question_id, avg_score, respondent_count, suppressed }) => ({ period_start, question_id, avg_score, respondent_count, suppressed }))
const memberRows = [
  ...periodRows(null, [3.8, 3.9, 3.9, 4.0, 3.9, 3.8, 3.9, 3.5]),
  ...periodRows(MKT, [4.0, 4.1, 4.0, 4.2, 4.1, 4.0, 4.1, 3.2]),          // noticeable drop this period
  ...periodRows(OGV, [3.6, 3.7, null, 3.8, 3.6, 3.7, 3.8, null]),        // suppressed this period
]

test.describe('Wellbeing on the dashboard', () => {
  test('the president sees Exec Pulse and Member Pulse with a flagged department', async ({ page }) => {
    await setupAuthMocks(page, 'president', { departments, rpc: { get_exec_pulse: execRows, get_member_pulse: memberRows }, tables: { team_members: TEAM } })
    await page.goto('/')
    await expect(page.getByRole('region', { name: 'Exec Pulse' })).toBeVisible({ timeout: 10000 })
    const member = page.getByRole('region', { name: 'Member Pulse' })
    await expect(member).toBeVisible()
    await expect(member.getByText('1 department dropped noticeably this fortnight')).toBeVisible()
    await expect(member.getByText(/vs last 4/)).toBeVisible()
    await expect(member.getByText(/other departments? (doesn't|don't) have enough responses yet/)).toBeVisible()
    await member.scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'test-results/dashboard-president.png', fullPage: true })
  })

  test('a VP sees only their department card', async ({ page }) => {
    await setupAuthMocks(page, 'vp', {
      departments,
      rpc: { get_member_pulse: periodRows(MKT, [4.0, 4.1, 4.0, 4.2, 4.1, 4.0, 4.1, 4.1]) },
      tables: { team_members: VP_TEAM },
    })
    await page.goto('/')
    await expect(page.getByRole('region', { name: "My Department's Pulse" })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('region', { name: 'Exec Pulse' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Member Pulse' })).toHaveCount(0)
  })

  test('a member sees a check-in nudge and no pulse data', async ({ page }) => {
    await setupAuthMocks(page, 'member', { departments, rpc: { get_member_pulse: memberRows, get_exec_pulse: execRows } })
    await page.goto('/')
    await expect(page.getByText('Your check-in for this fortnight is waiting')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('region', { name: /Pulse/ })).toHaveCount(0)
  })

  test('a member can answer the check-in on its own page', async ({ page }) => {
    await setupAuthMocks(page, 'member', { departments })
    await page.goto('/checkin')
    await expect(page.getByRole('heading', { name: 'Check-in' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/Your VP and LCP see the average for your department, never your individual answers/)).toBeVisible()
    const submit = page.getByRole('button', { name: 'Submit check-in' })
    await expect(submit).toBeDisabled()
    for (const choice of await page.getByRole('button', { name: /^4: Agree$/ }).all()) await choice.click()
    await expect(submit).toBeEnabled()
  })

  test('a suppressed period shows the privacy message instead of numbers', async ({ page }) => {
    await setupAuthMocks(page, 'president', {
      departments,
      rpc: { get_exec_pulse: periodRows(undefined, [4, 4, 4, 4, 4, 4, 4, null]).map(({ period_start, question_id, avg_score, respondent_count, suppressed }) => ({ period_start, question_id, avg_score, respondent_count, suppressed })) },
      tables: { team_members: TEAM },
    })
    await page.goto('/')
    const exec = page.getByRole('region', { name: 'Exec Pulse' })
    await expect(exec.getByText('Not enough responses this fortnight to protect privacy.')).toBeVisible({ timeout: 10000 })
    // Privacy: no score for the suppressed period (earlier periods may appear in the trend).
    await expect(exec.getByText(/\/ 5 this fortnight/)).toHaveCount(0)
  })
})
