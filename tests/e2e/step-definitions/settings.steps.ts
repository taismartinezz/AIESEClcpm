import { Given, When, Then, Before, After, setDefaultTimeout } from '@cucumber/cucumber'
import { chromium, Browser, Page } from 'playwright'
import assert from 'node:assert/strict'
import { setupAuthMocks } from '../helpers/mocks'

setDefaultTimeout(30_000)

let browser: Browser
let page: Page

Before(async () => {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  page = await context.newPage()
})

After(async () => {
  await browser?.close()
})

// ── Given ─────────────────────────────────────────────────────────────────────

Given('I am logged in', async () => {
  await setupAuthMocks(page, 'researcher')
})

Given('I am logged in as a PI', async () => {
  await setupAuthMocks(page, 'pi')
})

Given('I am logged in as a researcher', async () => {
  await setupAuthMocks(page, 'researcher')
})

// ── When ──────────────────────────────────────────────────────────────────────

When('I navigate to /settings', async () => {
  await page.goto('http://localhost:3000/settings')
  await page.waitForSelector('h1', { timeout: 10000 })
})

// ── Then ──────────────────────────────────────────────────────────────────────

Then('the page should load without errors', async () => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.waitForTimeout(500)
  assert.equal(errors.length, 0, `Page errors: ${errors.join(', ')}`)
})

Then('I should see a profile section', async () => {
  const heading = page.getByRole('heading', { name: /profile/i })
  assert.ok(await heading.isVisible(), 'Expected profile section heading to be visible')
})

Then('I should see my lab invite code', async () => {
  const heading = page.getByRole('heading', { name: /lab.*invite/i })
  assert.ok(await heading.isVisible(), 'Expected Lab & Invite section to be visible for PI')
})

Then('I should not see an invite code section', async () => {
  const visible = await page.getByRole('heading', { name: /lab.*invite/i }).isVisible().catch(() => false)
  assert.equal(visible, false, 'Expected Lab & Invite section to be hidden for researcher')
})
