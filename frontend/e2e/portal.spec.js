const { test, expect } = require('@playwright/test');

function collectRuntimeFailures(page) {
  const failures = [];
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('requestfailed', request => {
    const reason = request.failure()?.errorText || '';
    if (reason !== 'net::ERR_ABORTED') failures.push(`request: ${request.method()} ${request.url()} ${reason}`);
  });
  return failures;
}

async function setIdentity(page, username, role) {
  await page.addInitScript(({ username, role }) => {
    sessionStorage.setItem('reviewer_identity', JSON.stringify({ username, role }));
    localStorage.setItem('cdsco_announcement_dismissed', '2026-04-21-gr50e');
  }, { username, role });
}

test('applicant authentication, navigation, refresh, and role guard', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.goto('/');
  await page.getByRole('button', { name: /login to portal/i }).click();
  await page.getByPlaceholder('username or email').fill('wrong-user');
  await page.getByPlaceholder('password').fill('wrong-password');
  await page.getByPlaceholder('Enter Captcha').fill(await page.locator('.captcha-display').innerText());
  await page.getByRole('button', { name: /^login$/i }).click();
  await expect(page.getByText('Invalid username or password.')).toBeVisible();

  await page.getByPlaceholder('username or email').fill('shivek');
  await page.getByPlaceholder('password').fill('1234');
  await page.getByPlaceholder('Enter Captcha').fill(await page.locator('.captcha-display').innerText());
  await page.getByRole('button', { name: /^login$/i }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('reviewer_identity')))
    .toContain('shivek');

  await page.goto('/apply');
  await expect(page).toHaveURL(/\/apply$/);
  await page.reload();
  await expect(page).toHaveURL(/\/apply$/);
  await page.goto('/track');
  await expect(page.getByPlaceholder('e.g. EXP-2026-000145')).toBeVisible();
  await page.goto('/review');
  await expect(page).toHaveURL(/\/$/);
  expect(failures).toEqual([]);
});

test('reviewer queue controls and applicant-route guard', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await setIdentity(page, 'reviewer-e2e', 'reviewer');
  await page.goto('/review');
  await expect(page.getByLabel('Search applications')).toBeVisible();
  await page.getByLabel('Search applications').fill('EXP-NOT-FOUND');
  await expect(page.getByLabel('Rows per page')).toBeVisible();
  await page.getByLabel('Rows per page').selectOption('25');
  await expect(page.getByLabel('First page')).toBeDisabled();
  await expect(page.getByLabel('Previous page')).toBeDisabled();

  const clear = page.getByRole('button', { name: /clear all/i });
  if (await clear.isVisible()) await clear.click();
  await page.reload();
  await expect(page.getByLabel('Search applications')).toBeVisible();
  await page.goto('/apply');
  await expect(page).toHaveURL(/\/review/);
  expect(failures).toEqual([]);
});
