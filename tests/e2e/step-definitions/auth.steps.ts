/**
 * Cucumber step definitions for auth.feature
 * Uses Playwright's page object; run via: npm run test:cucumber
 */

import { Given, When, Then, Before, After, setDefaultTimeout } from '@cucumber/cucumber'
import { chromium, Browser, Page } from 'playwright'
import assert from 'node:assert/strict'

setDefaultTimeout(30_000)

let browser: Browser
let page: Page

Before(async () => {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  page = await context.newPage()

  // Mock Supabase session — no user logged in
  await page.route('**/auth/v1/session**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  )
  await page.route('**/rest/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  )
})

After(async () => {
  await browser?.close()
})

// ── Given ─────────────────────────────────────────────────────────────────────

Given('I am on the login page', async () => {
  await page.goto('http://localhost:3000/login')
  await page.waitForSelector('h1', { timeout: 10000 })
})

// ── When ──────────────────────────────────────────────────────────────────────

When('I look at the sign up toggle', async () => {
  // Step is a lookup — actual assertion is in Then
})

When('I click {string}', async (buttonText: string) => {
  await page.getByRole('button', { name: new RegExp(buttonText, 'i') }).click()
})

When('I enter my email and click {string}', async (buttonText: string) => {
  await page.getByLabel(/email for password reset/i).fill('test@example.com')
  await page.getByRole('button', { name: new RegExp(buttonText, 'i') }).click()
})

When('I click the password visibility toggle', async () => {
  await page.getByRole('button', { name: /show password/i }).click()
})

// ── Then ──────────────────────────────────────────────────────────────────────

Then('the page should have an h1 heading', async () => {
  const h1 = page.locator('h1').first()
  assert.ok((await h1.count()) > 0, 'Expected an h1 element to be in the DOM')
})

Then('it should be an anchor element with a valid href', async () => {
  const link = page.getByRole('link', { name: /sign up/i })
  const tagName = await link.evaluate((el) => el.tagName)
  assert.equal(tagName, 'A', 'Expected sign-up toggle to be an <a> element')
  const href = await link.getAttribute('href')
  assert.ok(href && href.includes('signup'), `Expected href to contain "signup", got: ${href}`)
})

Then('{string} should be a link', async (text: string) => {
  const link = page.getByRole('link', { name: new RegExp(text, 'i') })
  assert.ok(await link.isVisible(), `Expected "${text}" to be a visible link`)
  const href = await link.getAttribute('href')
  assert.ok(href, `Expected the link to have an href attribute`)
})

Then('I should see a password reset form', async () => {
  await page.waitForSelector('[aria-label*="email for password reset" i]', { timeout: 5000 })
  const form = page.getByLabel(/email for password reset/i)
  assert.ok(await form.isVisible(), 'Expected password reset email input to be visible')
})

Then('I should see a confirmation message', async () => {
  await page.waitForSelector('text=/check your email/i', { timeout: 5000 })
})

Then('I should see a {string} button', async (label: string) => {
  const btn = page.getByRole('button', { name: new RegExp(label, 'i') })
  assert.ok(await btn.isVisible(), `Expected button "${label}" to be visible`)
})

Then('I should not see a {string} button', async (label: string) => {
  const count = await page.getByRole('button', { name: new RegExp(label, 'i') }).count()
  assert.equal(count, 0, `Expected no "${label}" button`)
})

Then('no user data should be logged to the console', async () => {
  const violations: string[] = []
  const sensitivePatterns = [/user_profiles row/i, /key prefix/i, /tati06mar/i]
  page.on('console', (msg) => {
    if (msg.type() === 'log' && sensitivePatterns.some((p) => p.test(msg.text()))) {
      violations.push(msg.text())
    }
  })
  await page.reload()
  await page.waitForTimeout(1000)
  assert.equal(violations.length, 0, `Sensitive data logged: ${violations.join(', ')}`)
})

Then('the password field should show plain text', async () => {
  const input = page.getByLabel(/^password$/i)
  const type = await input.getAttribute('type')
  assert.equal(type, 'text', 'Expected password input type to be "text" after toggling')
})
