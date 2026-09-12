'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createConnectionsStack } = require('./helpers/connections-stack.cjs');
const PAYCOM = { clientCode: 'client-fixture', username: 'paycom-fixture-owner', password: 'paycom-fixture-secret',
  pin1: 'answer-one', pin2: 'answer-two', pin3: 'answer-three', pin4: 'answer-four', pin5: 'answer-five' };
async function fixture(t) { const f = await createConnectionsStack(); t.after(() => f.close()); return f; }
function assertNoPlaintext(root, secret) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) assertNoPlaintext(file, secret);
    else if (entry.isFile()) assert.equal(fs.readFileSync(file).includes(Buffer.from(secret)), false, `plaintext in ${entry.name}`);
  }
}

test('HTTP credentials persist encrypted across broker restarts for Cortex and Paycom', async t => {
  const f = await fixture(t);
  for (const [service, profile, credentials] of [
    ['cortex', 'amazon-operations', { username: 'cortex-fixture-owner', password: 'cortex-fixture-secret' }],
    ['paycom', 'paycom-main', PAYCOM],
  ]) {
    const response = await f.save(service, credentials);
    assert.equal(response.status, 202);
    assert.equal((await response.text()).includes(credentials.password), false);
    await f.state.broker.serviceConnections.close();
    await f.restartBroker();
    assert.deepEqual(f.state.broker.vault.readForAdapter(profile).credentials, credentials);
    assertNoPlaintext(f.root, credentials.password);
    assert.equal(fs.statSync(f.paths.database).mode & 0o777, 0o600);
    assert.equal(fs.statSync(f.paths.key).mode & 0o777, 0o600);
  }
  assert.equal(require('../../core/accounts/src/onboarding-store').createOnboardingStore(f.store)
    .latest(f.organizationId).status, 'queued');
});

test('platform owner DSP view saves Cortex and Paycom through HTTP into the selected encrypted vault', async t => {
  const f = await fixture(t), platform = f.access.session(f.platform.token);
  const viewed = f.access.beginDspView(platform, { controlRef: f.access.issuePlatformControlRef(platform, f.organizationId) });
  const headers = { 'Content-Type': 'application/json', Cookie: `dispatch_session=${f.platform.token}`,
    'X-Dispatch-CSRF': platform.csrfToken, 'X-Dispatch-DSP-View': viewed.dspView.viewRef };
  for (const [service, profile, credentials] of [
    ['cortex', 'amazon-operations', { username: 'synthetic-support-owner', password: 'synthetic-cortex-support-secret' }],
    ['paycom', 'paycom-main', PAYCOM],
  ]) {
    const response = await fetch(`${f.base}/api/organization/connections/${service}/save`, {
      method: 'POST', headers, body: JSON.stringify({ credentials }),
    });
    assert.equal(response.status, 202);
    assert.equal((await response.text()).includes(credentials.password), false);
    await f.state.broker.serviceConnections.close();
    await f.restartBroker();
    assert.deepEqual(f.state.broker.vault.readForAdapter(profile).credentials, credentials);
    assertNoPlaintext(f.root, credentials.password);
  }
  const audited = f.store.db.prepare("SELECT actor_user_id,organization_id FROM audit_events WHERE action='connection.save'").all();
  assert.equal(audited.length, 2);
  assert.ok(audited.every(row => row.actor_user_id === platform.user.id && row.organization_id === f.organizationId));
});

test('maximum valid multibyte and JSON-escaped credentials survive every request boundary', async t => {
  const f = await fixture(t);
  for (const character of ['界', '\u0001']) {
    const credentials = { username: '界'.repeat(320), password: character.repeat(4096) };
    assert.equal((await f.save('cortex', credentials)).status, 202);
    await f.state.broker.serviceConnections.close();
    assert.deepEqual(f.state.broker.vault.readForAdapter('amazon-operations').credentials, credentials);
  }
  assert.equal((await f.save('cortex', { username: 'owner', password: 'a'.repeat(4097) })).status, 400);
  assert.equal((await f.save('cortex', { username: 'owner', password: 'a'.repeat(33000) })).status, 413);
  assert.equal(f.state.broker.vault.readForAdapter('amazon-operations').credentials.password, '\u0001'.repeat(4096));
});

test('failed SQLite replacement preserves the previous account and can be retried', async t => {
  const f = await fixture(t);
  const original = { username: 'old-owner', password: 'old-fixture-secret' };
  const replacement = { username: 'new-owner', password: 'new-fixture-secret' };
  assert.equal((await f.save('cortex', original)).status, 202);
  await f.state.broker.serviceConnections.close();
  f.state.broker.vault.db.exec("CREATE TEMP TRIGGER fail_save BEFORE UPDATE ON credential_profiles BEGIN SELECT RAISE(ABORT, 'injected write failure'); END");
  assert.notEqual((await f.save('cortex', replacement)).status, 202);
  assert.deepEqual(f.state.broker.vault.readForAdapter('amazon-operations').credentials, original);
  assert.notEqual((await f.list())[0].state, 'connected');
  f.state.broker.vault.db.exec('DROP TRIGGER fail_save');
  assert.equal((await f.save('cortex', replacement)).status, 202);
  await f.state.broker.serviceConnections.close();
  await f.restartBroker();
  assert.deepEqual(f.state.broker.vault.readForAdapter('amazon-operations').credentials, replacement);
});

test('an existing Paycom vault account without an onboarding receipt can be updated from Connections', async t => {
  const f = await fixture(t);
  f.state.broker.vault.put('paycom-main', 'paycom', { ...PAYCOM, password: 'previous-fixture-secret' });
  const response = await f.save('paycom', PAYCOM);
  assert.equal(response.status, 202);
  assert.deepEqual(f.state.broker.vault.readForAdapter('paycom-main').credentials, PAYCOM);
});

test('a lost save acknowledgement does not lose credentials and Paycom enrollment can recover', async t => {
  const f = await fixture(t);
  f.state.dropReply = true;
  assert.notEqual((await f.save('paycom', PAYCOM)).status, 202);
  await f.restartBroker();
  assert.deepEqual(f.state.broker.vault.readForAdapter('paycom-main').credentials, PAYCOM);
  assert.equal((await f.save('paycom', PAYCOM)).status, 202);
  assertNoPlaintext(f.root, PAYCOM.password);
});

test('a Core audit write failure after Paycom persistence reports an unconfirmed save, not invalid credentials', async t => {
  const f = await fixture(t);
  f.access.audit = () => { throw new Error('injected Core audit write failure'); };
  const response = await f.save('paycom', PAYCOM);
  assert.equal(response.status, 503);
  assert.deepEqual(f.state.broker.vault.readForAdapter('paycom-main').credentials, PAYCOM);
});

test('failure to invalidate old verification cannot replace the saved account', async t => {
  const f = await fixture(t);
  const original = { username: 'old-owner', password: 'old-diagnostic-fixture' };
  assert.equal((await f.save('cortex', original)).status, 202);
  await f.state.broker.serviceConnections.close();
  const diagnostics = f.state.broker.sessions.lastAuthentication;
  const remove = diagnostics.delete;
  diagnostics.delete = () => { throw new Error('injected diagnostic storage failure'); };
  try {
    assert.notEqual((await f.save('cortex', { username: 'replacement', password: 'new-diagnostic-fixture' })).status, 202);
    assert.deepEqual(f.state.broker.vault.readForAdapter('amazon-operations').credentials, original);
  } finally { diagnostics.delete = remove; }
  await f.restartBroker();
  assert.notEqual((await f.list())[0].state, 'connected');
});

test('competing saves and disconnects cannot overwrite a connection being verified', async t => {
  const f = await fixture(t);
  let finish;
  const checking = new Promise(resolve => { finish = () => resolve({ status: 'authenticated' }); });
  f.state.authentication = () => checking;
  const original = { username: 'concurrent-owner', password: 'concurrent-fixture-secret' };
  try {
    assert.equal((await f.save('cortex', original)).status, 202);
    const [save, disconnect] = await Promise.all([
      f.save('cortex', { username: 'other-owner', password: 'other-fixture-secret' }),
      fetch(`${f.base}/api/organization/connections/cortex/disconnect`, { method: 'POST', headers: f.headers, body: '{}' }),
    ]);
    assert.equal(save.status, 409);
    assert.equal(disconnect.status, 409);
    assert.deepEqual(f.state.broker.vault.readForAdapter('amazon-operations').credentials, original);
  } finally { finish(); }
});

test('restart during login verification preserves the saved account without reporting connected', async t => {
  const f = await fixture(t);
  f.state.authentication = (_browser, _credentials, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'acquisition_cancelled' })), { once: true });
  });
  const credentials = { username: 'restart-owner', password: 'restart-fixture-secret' };
  assert.equal((await f.save('cortex', credentials)).status, 202);
  await f.restartBroker();
  assert.deepEqual(f.state.broker.vault.readForAdapter('amazon-operations').credentials, credentials);
  assert.notEqual((await f.list())[0].state, 'connected');
});
