import { expect, test } from '@playwright/test';
import { setupAuthMocks } from './helpers/mocks';

for (const role of ['president', 'member'] as const) {
  test(`${role} onboarding finishes without a check-in step`, async ({ page }) => {
    await setupAuthMocks(page, role);
    await page.goto('/onboarding');
    await page.getByText(role === 'president' ? 'Create a Local Committee' : 'Join an LC', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    if (role === 'president') {
      await page.getByPlaceholder('e.g. AIESEC in Lisbon').fill('AIESEC in Permission Test');
      await page.getByPlaceholder('Full name').fill('Test President');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByText('Your time zone', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Invite your executive board and members' })).toBeVisible();
    } else {
      await page.getByPlaceholder('e.g. CANOPY-XXXX').fill('LC-TESTING');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByPlaceholder('Full name').fill('Test Member');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByText('Your time zone', { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '5');
    await expect(page.getByRole('button', { name: 'Go to my workspace' })).toBeVisible();
    await expect(page.getByText(/Team wellbeing check-ins|A quick preview of what to expect|Try it out/)).toHaveCount(0);
    // Final action submits instead of navigating to the former check-in preview.
    await page.getByRole('button', { name: 'Go to my workspace' }).click();
    await expect(page.getByRole('heading', { name: /Team wellbeing check-ins|Check-ins/, exact: true })).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/checkin/);
  });
}
