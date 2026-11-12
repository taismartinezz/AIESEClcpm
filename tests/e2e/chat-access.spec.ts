import { test, expect } from '@playwright/test'
import { setupAuthMocks } from './helpers/mocks'

for (const role of ['member', 'vp', 'president'] as const) {
  test(`${role} can open Chat from the main navigation`, async ({ page }) => {
    await setupAuthMocks(page, role)
    await page.goto('/')
    const chat = page.getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Chat', exact: true })
    await expect(chat).toBeVisible()
    await chat.click()
    await expect(page).toHaveURL(/\/chat$/, { timeout: 15000 })
    await expect(page.locator('[data-chat-composer]')).toBeVisible()
  })
}
