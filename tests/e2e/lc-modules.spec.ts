import { test, expect } from '@playwright/test'
import { setupAuthMocks } from './helpers/mocks'

// What each role is offered on the Finance, Attendance and Tabling pages.
// The database tests (tests/db) prove the data each role can actually read.

const FL = { id: 'dep-fl', project_id: 'project-abc', name: 'Finance & Legality', color: '#037EF3', vp_user_id: 'someone-else', is_finance: true, sort_order: 7 }

// Later today, so the shift is in this week's view whatever day the test runs.
const future = new Date(Date.now() + 2 * 3_600_000)
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

  test('headline numbers, conversion and stuck exchanges for the term', async ({ page }) => {
    const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)
    const stuck = { ...ex, id: 'ex2', person_name: 'Leo K.', stage: 'accepted', applied_at: ago(30), accepted_at: ago(20), approved_at: null }
    await setupAuthMocks(page, 'president', { departments: [OGV], tables: { exchanges: [ex, stuck] }, rpc: { lc_term_start: '2026-02-01' } })
    await page.goto('/pipeline')
    await expect(page.getByText('Approved this term', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Applied → approved', { exact: true })).toBeVisible()
    await expect(page.getByRole('status').getByText('1 stuck')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Completed: 0' })).toBeVisible()
    await page.getByRole('button', { name: 'Import exchanges' }).click()
    await expect(page.getByRole('dialog', { name: 'Import exchanges' })).toBeVisible()
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

test.describe('LC Drive and handover', () => {
  test('the Drive lists folders and files, and /bookmarks redirects to it', async ({ page }) => {
    const folders = [{ id: 'f1', name: 'Templates', sort_order: 1 }, { id: 'f2', name: 'Brand kit', sort_order: 2 }]
    const items = [
      { id: 'b1', project_id: 'project-abc', scope: 'lab', folder_id: 'f2', kind: 'link', url: 'https://example.com/brand', title: 'Brand guidelines', added_by: 'mock-user-id', added_at: new Date().toISOString() },
      { id: 'b2', project_id: 'project-abc', scope: 'lab', folder_id: 'f1', kind: 'file', url: '', storage_path: 'project-abc/x-proposal.pdf', file_name: 'proposal.pdf', size_bytes: 204800, title: 'Proposal template', added_by: 'mock-user-id', added_at: new Date().toISOString() },
    ]
    await setupAuthMocks(page, 'member', { tables: { drive_folders: folders, bookmarks: items } })
    await page.goto('/bookmarks')
    await expect(page).toHaveURL(/\/drive$/)
    await expect(page.getByRole('heading', { name: 'LC Drive' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Proposal template')).toBeVisible()
    await expect(page.getByText('proposal.pdf · 200 KB')).toBeVisible()
    await page.getByRole('navigation', { name: 'Drive folders' }).getByRole('button', { name: /Brand kit/ }).click()
    await expect(page.getByText('Brand guidelines')).toBeVisible()
    await expect(page.getByText('Proposal template')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New folder' })).toHaveCount(0)
  })

  test('the president writes the LC-wide handover from the template', async ({ page }) => {
    await setupAuthMocks(page, 'president', { rpc: { lc_term_start: '2026-02-01' }, tables: { handover_notes: [] } })
    await page.goto('/handover')
    await expect(page.getByRole('heading', { name: 'Handover' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByLabel('Term')).toHaveValue('2026/27')
    await page.getByRole('button', { name: /write handover/i }).first().click()
    await expect(page.getByLabel(/Handover for LC-wide/)).toHaveValue(/What we did this term/)
  })
})

test.describe('Members and import', () => {
  test('the president sees recruitment, onboarding and activity', async ({ page }) => {
    const recruit = { id: 'r1', project_id: 'project-abc', name: 'Lucía P.', email: 'lucia@x.example', phone: null, source: 'Tabling', department_id: null, stage: 'interview', interview_at: null, notes: null, owner_id: null, applied_on: '2026-10-01' }
    await setupAuthMocks(page, 'president', { tables: { recruits: [recruit], onboarding_steps: [], member_onboarding: [] }, rpc: { member_activity: [] } })
    await page.goto('/members')
    await expect(page.getByText('Lucía P.')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('combobox', { name: 'Stage for Lucía P.' })).toHaveValue('interview')
    await page.getByRole('tab', { name: 'Activity & terms' }).click()
    await expect(page.getByText(/Check-in answers and who did the check-in are never shown/)).toBeVisible()
  })

  test('the import page offers trackers by role and explains Google Sheets sharing', async ({ page }) => {
    await setupAuthMocks(page, 'member')
    await page.goto('/import')
    await expect(page.getByText('Anyone with the link can view')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /Partners \(B2B/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Recruitment/ })).toHaveCount(0)
    await page.getByRole('button', { name: /Tasks \(to-do/ }).click()
    await expect(page.getByRole('dialog', { name: 'Import a tracker' })).toBeVisible()
    await expect(page.getByLabel('Link to the sheet')).toBeVisible()
  })
})

test.describe('National (MC)', () => {
  test('an MC member sees LCs side by side with national totals', async ({ page }) => {
    const mc = { id: 'mc1', name: 'AIESEC in Portugal', member_code: 'AAAA1111', lc_code: 'BBBB2222', term_start: null }
    const rows = [
      { project_id: 'l1', lc_name: 'LC Lisbon', members: 30, product: 'ogv', applied: 10, approved: 4, realized: 2, completed: 0 },
      { project_id: 'l2', lc_name: 'LC Porto', members: 22, product: 'ogv', applied: 5, approved: 1, realized: 0, completed: 0 },
    ]
    await setupAuthMocks(page, 'member', { tables: { mcs: [mc], mc_members: [{ mc_id: 'mc1', role: 'mcp' }] }, rpc: { mc_dashboard: rows } })
    await page.goto('/mc')
    await expect(page.getByText('LC Lisbon')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('rowheader', { name: 'National' })).toBeVisible()
    await expect(page.getByText('33%')).toBeVisible()
    await expect(page.getByRole('link', { name: 'National' }).first()).toBeVisible()
  })
})

test.describe('Learning the app', () => {
  test('an empty pipeline explains itself and offers the import', async ({ page }) => {
    const OGV = { id: 'dep-ogv', project_id: 'project-abc', name: 'Outgoing Global Volunteer', color: '#F85A40', vp_user_id: null, is_finance: false, sort_order: 1, products: ['ogv'] }
    await setupAuthMocks(page, 'president', { departments: [OGV], tables: { exchanges: [] } })
    await page.goto('/pipeline')
    await expect(page.getByRole('region', { name: 'Your exchange pipeline' })).toBeVisible({ timeout: 10000 })
    await page.getByRole('region', { name: 'Your exchange pipeline' }).getByRole('button', { name: 'Import exchanges' }).click()
    await expect(page.getByRole('dialog', { name: 'Import exchanges' })).toBeVisible()
  })

  test('the help page has guides per feature and can replay the tour', async ({ page }) => {
    await setupAuthMocks(page, 'vp')
    await page.goto('/help')
    await expect(page.getByRole('heading', { name: 'Importing a Google Sheet' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: /Replay the tour/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: "What's new" })).toBeVisible()
  })
})

test.describe('Events, RSVPs and announcements', () => {
  const ev = { id: 'ev1', project_id: 'project-abc', name: 'General Assembly', type: 'local_event', starts_on: '2099-01-10', ends_on: '2099-01-10', starts_at: '2099-01-10T17:00:00Z', ends_at: null, location: 'Room 2.1', meeting_url: 'https://zoom.example/j/1', description: null, department_id: null, audience: 'lc', audience_role: null, invites_sent_at: null, created_by: 'someone-else' }

  test('a member answers Going on an upcoming event', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { lc_events: [ev], event_attendance: [], event_rsvps: [] } })
    await page.goto('/attendance')
    await page.getByRole('tab', { name: 'Events' }).click()
    await expect(page.getByRole('group', { name: 'Are you going?' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('link', { name: 'Join online' })).toBeVisible()
  })

  test('the exec board sees RSVP counts, can email invites and send announcements', async ({ page }) => {
    await setupAuthMocks(page, 'president', { tables: { lc_events: [ev], event_attendance: [], event_rsvps: [{ event_id: 'ev1', user_id: 'x', response: 'going' }], announcements: [] } })
    await page.goto('/attendance')
    await expect(page.getByText('1', { exact: true }).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Email the invite' })).toBeVisible()
    await page.getByRole('button', { name: /Announcement/ }).click()
    await expect(page.getByRole('dialog', { name: 'Send an announcement' })).toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: /^Event$/ }).click()
    await page.getByLabel('Who is it for?').selectOption('people')
    await expect(page.getByRole('group', { name: /People/ })).toBeVisible()
  })
})

test.describe('Outreach', () => {
  const OGV = { id: 'dep-ogv', project_id: 'project-abc', name: 'Outgoing Global Volunteer', color: '#F85A40', vp_user_id: 'mock-user-id', is_finance: false, sort_order: 1, products: ['ogv'] }
  const tpl = { id: 't1', project_id: 'project-abc', department_id: 'dep-ogv', name: 'Day 0 welcome', subject: 'Hi {first_name}', body: 'Hi {first_name}, I am {sender_name}.', status: 'pending', review_note: null, created_by: 'x', updated_at: new Date().toISOString() }

  test('an empty outreach page explains sequences', async ({ page }) => {
    await setupAuthMocks(page, 'president', { departments: [OGV], tables: { outreach_templates: [], outreach_sequences: [] }, rpc: { outreach_stats: [] } })
    await page.goto('/outreach')
    await expect(page.getByRole('region', { name: /Follow up with every sign-up/ })).toBeVisible({ timeout: 10000 })
  })

  test('templates show their status, preview merge fields and can be approved by the LCP', async ({ page }) => {
    await setupAuthMocks(page, 'president', { departments: [OGV], tables: { outreach_templates: [tpl], outreach_sequences: [] }, rpc: { outreach_stats: [] } })
    await page.goto('/outreach')
    await page.getByRole('tab', { name: /Templates \(1 to review\)/ }).click({ timeout: 10000 })
    await page.getByRole('button', { name: /Day 0 welcome/ }).click()
    const preview = page.getByRole('region', { name: 'Preview' })
    await expect(preview.getByText('Hi Ana', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible()
    await page.getByLabel('Subject').fill('Hi {firstname}')
    await expect(page.getByRole('alert').filter({ hasText: '{firstname}' })).toBeVisible()
  })
})
