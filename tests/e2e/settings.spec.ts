import { test, expect } from '@playwright/test'
import { setupAuthMocks } from './helpers/mocks'

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Settings page — Issue #15', () => {
  test('settings page loads and shows profile and account sections', async ({ page }) => {
    await setupAuthMocks(page, 'president')
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: /profile/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /account/i })).toBeVisible()
  })

  test('the president sees the members & invites section', async ({ page }) => {
    await setupAuthMocks(page, 'president')
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: /members.*invites/i })).toBeVisible({ timeout: 10000 })
  })

  test('a member does not see the members & invites section', async ({ page }) => {
    await setupAuthMocks(page, 'member')
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: /members.*invites/i })).not.toBeVisible()
  })
})
