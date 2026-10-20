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
test('local account screen shows identity, separate Mail receipt and styled next action', async ({ page }) => {
  await page.goto('/self.html?state=signed-out');
  await expect(page.getByText('You’re signed out')).toBeVisible();
  await page.getByRole('button', { name: 'Sign in with Google', exact: true }).click();
  await expect(page.getByText('Alex Example', { exact: true })).toBeVisible();
  await expect(page.getByText('Google account verified', { exact: true })).toBeVisible();
  const connect = page.getByRole('button', { name: 'Connect Gmail for this session' });
  await expect(connect).toHaveCSS('background-color', 'rgb(65, 105, 225)');
  await expect(connect).toHaveCSS('min-height', '44px');
  await expect(page.getByText('Gmail access off', { exact: true })).toBeVisible();
  await connect.click();
  await expect(page.getByText('Gmail connected. No Mail has been read yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Read Mail once' }).click();
  await expect(page.getByText('Read complete · 0 messages')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText('You’re signed out')).toBeVisible();
});
test('account failures and bounded loading offer retry without another Google grant', async ({ page }) => {
  for (const state of ['error', 'timeout']) {
    await page.goto('/self.html?state=' + state);
    await expect(page.getByRole('alert')).toContainText(state === 'timeout' ? 'timed out' : 'could not check');
    await expect(page.getByRole('button', { name: 'Connect Gmail for this session' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry account check' }).click();
    await expect(page.getByText('Google account verified', { exact: true })).toBeVisible();
  }
  await page.goto('/self.html?state=wrong');
  await expect(page.getByRole('heading', { name: 'Use the approved Google account' })).toBeVisible();
  await expect(page.getByText('alex@example.invalid', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose Google account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Gmail for this session' })).toHaveCount(0);
});
test('Mail screen remains compact and legible at desktop and phone widths', async ({ page }) => {
  await page.goto('/self.html?state=ready');
  await expect(page.getByText('Google account verified', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/openjob-mail-session-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Connect Gmail for this session' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/openjob-mail-session-phone.png', fullPage: true });
});

test('missing email asks to complete Google identity permission without blaming the selected account', async ({ page }) => {
  await page.goto('/self.html?state=email-missing');
  await expect(page.getByRole('alert')).toContainText('Google did not provide your email address');
  await expect(page.getByRole('button', { name: 'Complete Google sign-in' })).toBeVisible();
  await expect(page.getByText('Use the approved Google account', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect Gmail for this session' })).toHaveCount(0);
});
