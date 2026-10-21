import { test, expect } from '@playwright/test'
import { setupAuthMocks } from './helpers/mocks'

// Members check the app on their phones: no page may scroll sideways at 390 px.
const PAGES = ['/', '/tasks', '/pipeline', '/goals', '/partners', '/outreach', '/attendance', '/tabling', '/finance',
  '/drive', '/handover', '/members', '/team', '/checkin', '/help', '/settings', '/mc']

test.use({ viewport: { width: 390, height: 844 } })

for (const path of PAGES) {
  test(`no sideways scroll on ${path}`, async ({ page }) => {
    const OGV = { id: 'dep-ogv', project_id: 'project-abc', name: 'Outgoing Global Volunteer', color: '#F85A40', vp_user_id: null, is_finance: false, sort_order: 1, products: ['ogv'] }
    await setupAuthMocks(page, 'president', { departments: [OGV] })
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(300)
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement
      const wide = [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1 && getComputedStyle(el).position !== 'fixed')
        .filter((el) => !el.closest('[style*="overflow"]') || el.closest('[style*="overflow-x: auto"], [style*="overflow: auto"]') === null)
        .slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${(el as HTMLElement).className || ''} ${Math.round(el.getBoundingClientRect().right)}px`)
      return { scroll: doc.scrollWidth - doc.clientWidth, wide }
    })
    await page.screenshot({ path: `test-results/mobile${path === '/' ? '-dashboard' : path.replace(/\//g, '-')}.png`, fullPage: false })
    expect(overflow.scroll, `wider than the screen: ${overflow.wide.join(', ')}`).toBeLessThanOrEqual(1)
  })
}
