const { test, expect } = require('@playwright/test');
const { createConnectionsStack } = require('../helpers/connections-stack.cjs');

async function login(page, f) {
  await page.goto(`${f.base}/#/settings?tab=connections`);
  await page.getByLabel('Email address').fill('owner@save.test');
  await page.getByLabel('Password', { exact: true }).fill(f.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveTitle('Settings · Dispatch');
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
}

for (const mobile of [false, true]) test(`form credentials reach the real encrypted vault (${mobile ? 'mobile' : 'desktop'})`, async ({ page }) => {
  const f = await createConnectionsStack();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await login(page, f);
    await page.getByRole('button', { name: 'Connect Cortex', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const credentials = { username: 'form-fixture-owner', password: 'form-fixture-password-界-"-\\' };
    await dialog.getByLabel('Amazon username').fill(credentials.username);
    await dialog.getByLabel('Amazon password').fill(credentials.password);
    const saved = page.waitForResponse(response => response.url().endsWith('/connections/cortex/save'));
    await dialog.getByRole('button', { name: 'Save and connect' }).click();
    expect((await saved).status()).toBe(202);
    await expect(dialog).toHaveCount(0);
    const cortex = page.locator('[data-slot="card"]').filter({ has: page.getByText('Cortex', { exact: true }) });
    await expect(cortex.getByText('Connected', { exact: true })).toBeVisible();
    expect(f.state.broker.vault.readForAdapter('amazon-operations').credentials).toEqual(credentials);
    await f.restartBroker();
    expect(f.state.broker.vault.readForAdapter('amazon-operations').credentials).toEqual(credentials);
    await page.reload();
    await expect(cortex.getByText('Connected', { exact: true })).toBeVisible();
    await cortex.getByRole('button', { name: 'Update credentials' }).click();
    await expect(dialog.getByLabel('Amazon password')).toHaveValue('');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Connect Paycom', exact: true }).click();
    const paycom = { clientCode: 'form-client', username: 'form-paycom-owner', password: 'form-paycom-secret',
      pin1: 'one', pin2: 'two', pin3: 'three', pin4: 'four', pin5: 'five' };
    for (const [name, label] of [['clientCode', 'Client code'], ['username', 'Username'], ['password', 'Password'],
      ...[1, 2, 3, 4, 5].map(index => [`pin${index}`, `Security answer ${index}`])]) {
      await dialog.getByLabel(label, { exact: true }).fill(paycom[name]);
    }
    const paycomSaved = page.waitForResponse(response => response.url().endsWith('/connections/paycom/save'));
    await dialog.getByRole('button', { name: 'Save and connect' }).click();
    expect((await paycomSaved).status()).toBe(202);
    await expect(dialog).toHaveCount(0);
    await f.restartBroker();
    expect(f.state.broker.vault.readForAdapter('paycom-main').credentials).toEqual(paycom);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Update credentials', exact: true })).toHaveCount(2);
    expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(credentials.password);
    expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(paycom.password);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: `/tmp/dispatch-save-verified-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    expect(errors).toEqual([]);
  } finally { await page.close(); await f.close(); }
});

test('lost acknowledgement explains uncertainty while the saved connection can be recovered', async ({ page }) => {
  const f = await createConnectionsStack();
  try {
    await login(page, f);
    await page.getByRole('button', { name: 'Connect Cortex', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Amazon username').fill('reply-loss-owner');
    await dialog.getByLabel('Amazon password').fill('reply-loss-fixture-password');
    f.state.dropReply = true;
    await dialog.getByRole('button', { name: 'Save and connect' }).click();
    await expect(dialog.getByText('We couldn’t confirm this save.', { exact: false })).toBeVisible();
    await expect(dialog.getByLabel('Amazon password')).toHaveValue('');
    expect(f.state.broker.vault.readForAdapter('amazon-operations').credentials.password).toBe('reply-loss-fixture-password');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const cortex = page.locator('[data-slot="card"]').filter({ has: page.getByText('Cortex', { exact: true }) });
    await expect(cortex.getByText('Connected', { exact: true })).toBeVisible();
  } finally { await page.close(); await f.close(); }
});
