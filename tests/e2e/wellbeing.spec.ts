import { test, expect } from '@playwright/test'
import { setupAuthMocks } from './helpers/mocks'

// The database decides what each role may see (tests/db/wellbeing.test.ts);
// these tests check the dashboard renders each role's view correctly.

const MKT = 'dep-marketing'
const OGV = 'dep-ogv'

function mondays(): string[] {
  const now = new Date()
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  return Array.from({ length: 8 }, (_, i) => {
    const d = new Date(monday)
    d.setUTCDate(d.getUTCDate() - (7 - i) * 7)
    return d.toISOString().slice(0, 10)
  })
}

const QUESTIONS = ['energy', 'workload', 'purpose', 'support', 'belonging', 'balance']

function weekRows(dept: string | null | undefined, scores: (number | null)[]) {
  return mondays().flatMap((week_start, i) => {
    const score = scores[i]
    if (score == null) {
      return [{ department_id: dept, week_start, question_id: null, avg_score: null, respondent_count: null, suppressed: true }]
    }
    return QUESTIONS.map((question_id, q) => ({
      department_id: dept, week_start, question_id,
      avg_score: (score + (q % 2 ? 0.1 : -0.1)).toFixed(2), respondent_count: 5, suppressed: false,
    }))
  })
}

const departments = [
  { id: MKT, project_id: 'project-abc', name: 'Marketing', color: '#FFC845', vp_user_id: 'vp-1', is_finance: false, sort_order: 5 },
  { id: OGV, project_id: 'project-abc', name: 'Outgoing Global Volunteer', color: '#F85A40', vp_user_id: 'vp-2', is_finance: false, sort_order: 1 },
]

const execRows = weekRows(undefined, [3.9, 4.0, 4.1, 3.8, 4.0, 4.2, 4.1, 4.0]).map(({ department_id: _d, ...r }) => r)
const memberRows = [
  ...weekRows(null, [3.8, 3.9, 3.9, 4.0, 3.9, 3.8, 3.9, 3.5]),
  ...weekRows(MKT, [4.0, 4.1, 4.0, 4.2, 4.1, 4.0, 4.1, 3.2]),          // noticeable drop this week
  ...weekRows(OGV, [3.6, 3.7, null, 3.8, 3.6, 3.7, 3.8, null]),        // suppressed this week
]

test.describe('Wellbeing on the dashboard', () => {
  test('the president sees Exec Pulse and Member Pulse with a flagged department', async ({ page }) => {
    await setupAuthMocks(page, 'president', { departments, rpc: { get_exec_pulse: execRows, get_member_pulse: memberRows } })
    await page.goto('/')
    await expect(page.getByRole('region', { name: 'Exec Pulse' })).toBeVisible({ timeout: 10000 })
    const member = page.getByRole('region', { name: 'Member Pulse' })
    await expect(member).toBeVisible()
    await expect(member.getByText('1 department dropped noticeably this week')).toBeVisible()
    await expect(member.getByText(/vs 4-wk avg/)).toBeVisible()
    await expect(member.getByText('Not enough responses')).toBeVisible()
    await page.getByRole('button', { name: /skip tour/i }).click().catch(() => {})
    await member.scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'test-results/dashboard-president.png', fullPage: true })
  })

  test('a VP sees only their department card', async ({ page }) => {
    await setupAuthMocks(page, 'vp', {
      departments,
      rpc: { get_member_pulse: weekRows(MKT, [4.0, 4.1, 4.0, 4.2, 4.1, 4.0, 4.1, 4.1]) },
    })
    await page.goto('/')
    await expect(page.getByRole('region', { name: "My Department's Pulse" })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('region', { name: 'Exec Pulse' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Member Pulse' })).toHaveCount(0)
  })

  test('a member sees a check-in nudge and no pulse data', async ({ page }) => {
    await setupAuthMocks(page, 'member', { departments, rpc: { get_member_pulse: memberRows, get_exec_pulse: execRows } })
    await page.goto('/')
    await expect(page.getByText("This week's check-in is waiting")).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('region', { name: /Pulse/ })).toHaveCount(0)
  })

  test('a suppressed week shows the privacy message instead of numbers', async ({ page }) => {
    await setupAuthMocks(page, 'president', {
      departments,
      rpc: { get_exec_pulse: weekRows(undefined, [4, 4, 4, 4, 4, 4, 4, null]).map(({ department_id: _d, ...r }) => r) },
    })
    await page.goto('/')
    const exec = page.getByRole('region', { name: 'Exec Pulse' })
    await expect(exec.getByText('Not enough responses this week to protect privacy.')).toBeVisible({ timeout: 10000 })
  })
})
