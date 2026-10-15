import { test, expect, Page } from '@playwright/test'

// ── Shared: mock Supabase and skip auth redirect ──────────────────────────────

async function mockSupabaseAndVisitLogin(page: Page) {
  // Intercept Supabase auth session check — return no session so login page renders
  await page.route('**/auth/v1/session**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  )
  // Intercept all other Supabase API calls
  await page.route('**/rest/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  )

  // Suppress console errors from network mocking
  page.on('console', () => {})

  await page.goto('/login')

  // Wait for login card to be visible — the h1 is visually hidden but in DOM
  await page.waitForSelector('h1', { timeout: 10000 })
}

// ── Feature: Authentication page ──────────────────────────────────────────────

test.describe('Auth page — Issue #16: accessible heading', () => {
  test('login page has an h1 heading', async ({ page }) => {
    await mockSupabaseAndVisitLogin(page)
    const h1 = page.locator('h1').first()
    await expect(h1).toBeAttached()
    await expect(h1).toContainText(/sign in to aiesec ?lcpm/i)
  })
})

test.describe('Auth page — Issue #1/#2: real anchor tags', () => {
  test('sign up toggle is an <a> element with a valid href', async ({ page }) => {
    await mockSupabaseAndVisitLogin(page)
    const signUpLink = page.getByRole('link', { name: /sign up/i })
    await expect(signUpLink).toBeVisible()
    const href = await signUpLink.getAttribute('href')
    expect(href).toMatch(/signup/)
  })
})

test.describe('Auth page — Issue #3: privacy link', () => {
  test('"privacy-first principles" is a real link', async ({ page }) => {
    await mockSupabaseAndVisitLogin(page)
    const link = page.getByRole('link', { name: /privacy-first principles/i })
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', '/privacy')
  })
})

test.describe('Auth page — Issue #4: forgot password', () => {
  test('shows Forgot password? button and expands inline form', async ({ page }) => {
    await mockSupabaseAndVisitLogin(page)
    const forgotBtn = page.getByRole('button', { name: /forgot password/i })
    await expect(forgotBtn).toBeVisible()
    await forgotBtn.click()
    await expect(page.getByRole('button', { name: /send reset link/i })).toBeVisible()
    await expect(page.getByLabel(/email for password reset/i)).toBeVisible()
  })

  test('shows confirmation after submitting email', async ({ page }) => {
    // Mock the password reset email endpoint
    await page.route('**/auth/v1/recover**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    )
    await mockSupabaseAndVisitLogin(page)
    await page.getByRole('button', { name: /forgot password/i }).click()
    await page.getByLabel(/email for password reset/i).fill('test@example.com')
    await page.getByRole('button', { name: /send reset link/i }).click()
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Auth page — Issue #6: OAuth providers', () => {
  test('no OAuth buttons are shown unless NEXT_PUBLIC_AUTH_PROVIDERS lists them', async ({ page }) => {
    await mockSupabaseAndVisitLogin(page)
    await expect(page.getByRole('button', { name: /sign in with google/i })).toHaveCount(0)
  })
})

test.describe('Auth page — Issue #13/#17: clean console', () => {
  test('no user data appears in console on page load', async ({ page }) => {
    const sensitivePatterns = [/user_profiles row/i, /key prefix/i, /tati06mar/i, /sb_publishable/i]
    const violations: string[] = []

    page.on('console', (msg) => {
      if (msg.type() === 'log') {
        const text = msg.text()
        if (sensitivePatterns.some((p) => p.test(text))) {
          violations.push(text)
        }
      }
    })

    await mockSupabaseAndVisitLogin(page)
    // Give time for any async effects to fire
    await page.waitForTimeout(1000)
    expect(violations).toHaveLength(0)
  })
})

test.describe('Auth page — password visibility toggle', () => {
  test('password field has a visibility toggle and shows plain text when clicked', async ({ page }) => {
    await mockSupabaseAndVisitLogin(page)
    const passwordInput = page.getByLabel(/^password$/i)
    await expect(passwordInput).toHaveAttribute('type', 'password')
    const toggleBtn = page.getByRole('button', { name: /show password/i })
    await expect(toggleBtn).toBeVisible()
    await toggleBtn.click()
    await expect(passwordInput).toHaveAttribute('type', 'text')
  })
})
