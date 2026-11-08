import { test, expect } from '@playwright/test'
import { setupAuthMocks } from './helpers/mocks'
import { APP_NAME } from '../../src/lib/brand'

const MC = { id: 'mc-1', name: 'AIESEC in Portugal', member_code: '3FA9C21B', lc_code: '7C2E19AD', term_start: null, country_code: 'PT' }

test.describe('National (MC)', () => {
  test('has its own space: no LC sidebar, a National title, and a sample of what you get', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [] } })
    await page.goto('/mc')
    await expect(page.getByText('· National')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('complementary', { name: 'Site navigation' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Your LC' })).toHaveCount(0)        // not in any LC
    await expect(page).toHaveTitle(`National · ${APP_NAME}`)
    await expect(page.getByRole('region', { name: 'Example of the national view' })).toContainText('Numbers only')
  })

  test('Join needs a code; Create needs a name; spaces alone do not count; both buttons look the same', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [] } })
    await page.goto('/mc')
    const join = page.getByRole('button', { name: 'Join' })
    const create = page.getByRole('button', { name: 'Create' })
    await expect(join).toBeDisabled({ timeout: 10000 })
    await expect(create).toBeDisabled()
    await page.getByLabel('MC name').fill('   ')
    await expect(create).toBeDisabled()
    await page.getByLabel('MC name').fill('AIESEC in Portugal')
    await expect(create).toBeEnabled()
    await expect(page.getByLabel('MC name')).toHaveAttribute('maxlength', '80')
    await expect(page.getByText(/Ask your MCP for the member code/)).toBeVisible()
    expect(await join.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await create.evaluate((el) => getComputedStyle(el).backgroundColor))
  })

  test('after joining, the codes say what each is for, with copy buttons, and unlinked LCs are listed', async ({ page }) => {
    await setupAuthMocks(page, 'member', {
      tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'mcp' }] },
      rpc: { mc_dashboard: [], mc_linked_lcs: [{ id: 'lc-1', name: 'AIESEC in Lisbon' }], lcs_in_country: [{ id: 'lc-1', name: 'AIESEC in Lisbon' }, { id: 'lc-2', name: 'AIESEC in Porto' }] },
    })
    await page.goto('/mc')
    await expect(page.getByText('LC code, for LC presidents')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('7C2E19AD')).toBeVisible()
    await expect(page.getByText('Send this to each LCP so they can link their LC')).toBeVisible()
    await expect(page.getByText('Member code, for your national team')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy invite message' })).toHaveCount(2)
    await expect(page.getByText('Linked (1)')).toBeVisible()
    await expect(page.getByText(/not linked yet \(1\)/)).toBeVisible()
    await expect(page.getByText('AIESEC in Porto')).toBeVisible()
  })

  test('onboarding offers the MC as a third card, which leads to the national view', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [] } })
    await page.goto('/onboarding')
    await page.getByRole('button', { name: /I'm on the national team \(MC\)/ }).click({ timeout: 10000 })
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page).toHaveURL(/\/mc$/)
  })

  test('someone in no LC is sent to the national view if on an MC, and to onboarding if not', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [], mcs: [MC], mc_members: [{ mc_id: 'mc-1', role: 'member' }] } })
    await page.goto('/team')
    await expect(page).toHaveURL(/\/mc$/, { timeout: 10000 })
  })

  test('someone in no LC and no MC goes to onboarding instead of an empty LC page', async ({ page }) => {
    await setupAuthMocks(page, 'member', { tables: { team_members: [] } })
    await page.goto('/')
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10000 })
  })

  test('LC pages have their own tab titles', async ({ page }) => {
    await setupAuthMocks(page, 'member')
    await page.goto('/tasks')
    await expect(page).toHaveTitle(`Tasks · ${APP_NAME}`, { timeout: 10000 })
  })
})
