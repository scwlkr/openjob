import { expect, test } from '@playwright/test';
test('connect read disconnect keeps Mail out of browser storage', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Connect Gmail for this session' }).click();
  await page.getByRole('button', { name: 'Read Mail once' }).click();
  await expect(page.getByText('Invented session body', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('invented-ui-access');
  await page.getByRole('button', { name: 'Disconnect Mail session' }).click();
  await expect(page.getByText('Invented session body', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect Gmail for this session' })).toBeVisible();
});
test('cancelled popup and disconnected delayed read cannot repopulate Mail', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Delay popup', exact: true }).click();
  await page.getByRole('button', { name: 'Connect Gmail for this session' }).click();
  await page.getByRole('button', { name: 'Disconnect Mail session' }).click(); await page.getByRole('button', { name: 'Release pending' }).click();
  await expect(page.getByRole('button', { name: 'Read Mail once' })).toHaveCount(0);
  await page.reload(); await page.getByRole('button', { name: 'Connect Gmail for this session' }).click();
  await page.getByRole('button', { name: 'Delay read', exact: true }).click(); await page.getByRole('button', { name: 'Read Mail once' }).click();
  await page.getByRole('button', { name: 'Disconnect Mail session' }).click(); await page.getByRole('button', { name: 'Release pending' }).click();
  await expect(page.getByText('Invented session body', { exact: true })).toHaveCount(0);
});
test('expiry and sign out clear the view and disable the old read', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Short expiry' }).click(); await page.getByRole('button', { name: 'Connect Gmail for this session' }).click();
  await expect(page.getByText('Mail session expired. Connect again to read.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Read Mail once' })).toHaveCount(0);
  await page.reload(); await page.getByRole('button', { name: 'Connect Gmail for this session' }).click(); await page.getByRole('button', { name: 'Read Mail once' }).click();
  await page.getByRole('button', { name: 'Fixture sign out' }).click(); await expect(page.getByText('Invented session body', { exact: true })).toHaveCount(0);
});
