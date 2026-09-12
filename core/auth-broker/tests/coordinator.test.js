'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BrowserStore } = require('../../browser-manager/store');
const { BrowserManager } = require('../../browser-manager/manager');
const { AuthenticationCoordinator } = require('../coordinator');

test('one admitted auth worker serves a DSP; SDK leases remain bound to the originating plugin job', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-auth-coordinator-'));
  const file = path.join(root, 'state/browser.sqlite3');
  const store = new BrowserStore(file);
  const started = [], stopped = [], calls = [], requests = [], relays = [];
  let granted = true, generation = 'first', busy = false, manual = false;
  const workers = { start: async row => { started.push(row.id); return { protocol: 'worker', endpoint: 'worker://' + row.id, access: row.id }; },
    close: async row => { stopped.push(row.id); return true; },
    request: async (_row, input) => {
      calls.push(input.action); requests.push(input);
      if (input.action === 'connections') return { ok: true, items: [{ service: 'paycom', configured: true, state: 'connected' }] };
      if (input.action === 'acquire-browser') return { ok: true, session: { lease: 'private-lease', browser: { protocol: 'cdp', endpoint: 'private-browser', access: 'full' } } };
      if (input.action === 'renew-browser') return { ok: true };
      if (input.action === 'release-browser') return { ok: true };
      if (input.action === 'enroll-paycom') return { ok: true, status: 'configured' };
      if (input.action === 'activity') return { ok: true, busy };
      throw new Error('unexpected worker operation');
    } };
  const manager = new BrowserManager({ store, workers, authorize: () => true, limits: { sessions: 1, tabs: 6, perDsp: 1 } }); await manager.start();
  const coordinator = new AuthenticationCoordinator({ manager, workers, idleMs: 0, generationFor: () => generation,
    contextFor: async dspId => ({ dspId, pluginId: 'auth-broker', installationRevision: 1, jobId: 'auth' }),
    authorizeRequest: () => true, authorizePlugin: () => granted, manualRetryFor: () => manual,
    relay: async () => { const value = { endpoint: 'job-private-browser', closed: false, async close() { this.closed = true; } }; relays.push(value); return value; },
  });
  t.after(async () => { await coordinator.close(); await manager.close(); store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const context = { dspId: 'dsp_' + 'a'.repeat(32), pluginId: 'sample', installationRevision: 1, jobId: 'job-a' };
  const statuses = await Promise.all([coordinator.connectionStatus(context, 'paycom'), coordinator.connectionStatus(context, 'paycom')]);
  assert.equal(started.length, 1); assert.equal(statuses[0].state, 'ready');
  await coordinator.request(context.dspId, { action: 'enroll-paycom', credentials: { password: 'never-persist-this' }, intent: 'create' });
  assert.equal(fs.readFileSync(file).includes('never-persist-this'), false);
  const lease = await coordinator.acquire(context, { connection: 'paycom', ttlMs: 90000 });
  assert.equal(lease.endpoint, 'job-private-browser');
  assert.equal(requests.findLast(input => input.action === 'acquire-browser').manualRetry, undefined);
  manual = true;
  const manualLease = await coordinator.acquire(context, { connection: 'paycom', ttlMs: 90000 });
  assert.equal(requests.findLast(input => input.action === 'acquire-browser').manualRetry, true);
  await coordinator.release(context, manualLease.leaseId);
  await assert.rejects(coordinator.release({ ...context, jobId: 'job-b' }, lease.leaseId), { code: 'lease_not_found' });
  assert.equal((await coordinator.renew(context, lease.leaseId)).renewed, true);
  granted = false;
  await assert.rejects(coordinator.renew(context, lease.leaseId), { code: 'permission_denied' });
  assert.equal(relays[0].closed, true);
  assert.ok(calls.includes('release-browser'));
  generation = 'updated'; busy = true;
  await coordinator.request(context.dspId, { action: 'connections', input: { command: 'verify', service: 'cortex',
    verificationId: 'v'.repeat(22), code: '123456', expiresAt: Date.now() + 60000 } });
  assert.equal(started.length, 1);
  await assert.rejects(coordinator.request(context.dspId, { action: 'enroll-paycom', credentials: { password: 'synthetic' }, intent: 'create' }), { code: 'session_busy' });
  busy = false;
  await coordinator.request(context.dspId, { action: 'enroll-paycom', credentials: { password: 'synthetic' }, intent: 'create' });
  assert.equal(started.length, 2); assert.equal(stopped.length, 1);
  const cancellation = new AbortController();
  const queued = coordinator.request('dsp_' + 'b'.repeat(32), { action: 'connections', input: { command: 'list' } }, { signal: cancellation.signal });
  const rejected = assert.rejects(queued, { code: 'cancelled' });
  await new Promise(resolve => setImmediate(resolve)); cancellation.abort(); await rejected;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(manager.pending.size, 0); assert.equal(started.length, 2);
  await coordinator.poll();
  assert.equal(stopped.length, 2); assert.equal(manager.status().sessions, 0);
});

