import { test, expect } from '@playwright/test'
import { setupAuthMocks } from './helpers/mocks'

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Settings page — Issue #15', () => {
  test('settings page loads and shows profile and account sections', async ({ page }) => {
    await setupAuthMocks(page, 'pi')
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: /profile/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /account/i })).toBeVisible()
  })

  test('PI user sees Lab & Invite section', async ({ page }) => {
    await setupAuthMocks(page, 'pi')
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: /lab.*invite/i })).toBeVisible({ timeout: 10000 })
  })

  test('researcher does not see Lab & Invite section', async ({ page }) => {
    await setupAuthMocks(page, 'researcher')
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: /lab.*invite/i })).not.toBeVisible()
  })
})
