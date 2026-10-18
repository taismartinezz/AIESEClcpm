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
