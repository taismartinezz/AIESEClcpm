import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  workers: 2,
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  webServer: {
    // Build and serve with the same deterministic public test configuration.
    // These are dummy values; browser fixtures intercept Supabase requests.
    command: process.env.CI ? 'npm run build && npm run start' : 'npm run dev',
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://e2e-test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-public-test-key',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
    },
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
