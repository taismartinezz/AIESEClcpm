import { test, expect } from '@playwright/test'
import { setupAuthMocks, MOCK_USER_ID } from './helpers/mocks'

test('switching LCs refreshes membership permissions without reloading the document', async ({ page }) => {
  await setupAuthMocks(page, 'president', { tables: {
    team_members: [
      { project_id: 'project-abc', user_id: MOCK_USER_ID, role: 'president', department_id: null, projects: { name: 'LC Alpha' } },
      { project_id: 'lc-beta', user_id: MOCK_USER_ID, role: 'member', department_id: null, projects: { name: 'LC Beta' } },
    ],
    projects: [
      { id: 'project-abc', name: 'LC Alpha', institution: 'Alpha University', active_prompt_ids: [] },
      { id: 'lc-beta', name: 'LC Beta', institution: 'Beta University', active_prompt_ids: [] },
    ],
  } })
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: /members.*invites/i })).toBeVisible()
  await page.evaluate(() => { (window as Window & { qaDocumentMarker?: string }).qaDocumentMarker = 'retained' })
  await page.getByRole('button', { name: 'Switch workspace', exact: true }).click()
  await page.getByRole('button', { name: /LC Beta/ }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: /members.*invites/i })).toHaveCount(0)
  expect(await page.evaluate(() => (window as Window & { qaDocumentMarker?: string }).qaDocumentMarker)).toBe('retained')
})

test('the renamed API proxy still enforces the bearer-token gate', async ({ request }) => {
  expect((await request.get('/api/qa-missing-route')).status()).toBe(401)
  expect((await request.get('/api/qa-missing-route', { headers: { Authorization: 'Bearer test-token' } })).status()).toBe(404)
})
