'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { inventory, hash, verifyRelease } = require('dispatch-protocol/releases/package');
const { identity, packageRelease, context, assertVerifiedMain, assertUnusedVersion, verifyPublication } = require('../tooling/release-publication');
const selected = { product: 'core', repository: 'example/dispatch-core', version: '1.2.3', commit: 'a'.repeat(40) };

test('release package preserves candidate, binds source and verifies every packaged file', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-publication-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidate = path.join(root, 'candidate');
  fs.mkdirSync(path.join(candidate, 'code'), { recursive: true });
  fs.writeFileSync(path.join(candidate, 'code/package.json'), JSON.stringify({ name: 'dispatch-core', version: '0.0.0' }));
  fs.writeFileSync(path.join(candidate, 'code/server.js'), 'module.exports = {};\n');
  const files = inventory(candidate);
  const manifest = { schemaVersion: 1, product: 'core', version: '0.0.0', channel: 'development', protocol: 1, minimumProtocol: 1,
    sourceDigest: hash(JSON.stringify(files)), packages: {}, plugins: [], files };
  const original = JSON.stringify(manifest);
  fs.writeFileSync(path.join(candidate, 'release.json'), original);
  const options = { ...selected, candidate, notes: 'x'.repeat(30) };
  const first = path.join(root, 'first'), second = path.join(root, 'second');
  const result = packageRelease({ ...options, output: first });
  packageRelease({ ...options, output: second });
  assert.equal(fs.readFileSync(path.join(candidate, 'release.json'), 'utf8'), original);
  assert.deepEqual(fs.readFileSync(path.join(first, result.archive)), fs.readFileSync(path.join(second, result.archive)));
  const extracted = path.join(root, 'extracted');fs.mkdirSync(extracted);
  execFileSync('tar', ['-xzf', path.join(first, result.archive), '-C', extracted]);
  const released = verifyRelease(extracted, result.digest);
  assert.equal(released.channel, 'release');assert.equal(released.source.commit, selected.commit);
  assert.equal(JSON.parse(fs.readFileSync(path.join(extracted, 'code/package.json'))).version, selected.version);
  assert.equal(verifyPublication(first, selected).length, 4);
  fs.appendFileSync(path.join(first, result.archive), 'tampered');
  assert.throws(() => verifyPublication(first, selected), /digest_mismatch/);
  fs.appendFileSync(path.join(candidate, 'code/server.js'), 'tampered');
  assert.throws(() => packageRelease({ ...options, output: path.join(root, 'bad') }), /digest_mismatch/);
});

test('publication rejects invalid versions and another product repository', () => {
  for (const version of ['0.0.0', '01.2.3', '1.2', 'v1.2.3', '1.2.3;echo bad']) assert.throws(() => identity({ ...selected, version }), /identity_invalid/);
  assert.throws(() => identity({ ...selected, repository: 'example/dispatch-dsp' }), /identity_invalid/);
});

test('only an explicit main workflow dispatch at the selected checkout may publish', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-release-context-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'dispatch-core' }));
  const env = { GITHUB_REPOSITORY: selected.repository, RELEASE_COMMIT: selected.commit, RELEASE_VERSION: selected.version,
    GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: selected.commit };
  assert.throws(() => context(root, env), /main_dispatch_required/);
  assert.throws(() => context(root, { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/feature' }), /main_dispatch_required/);
});

test('release requires successful main push checks and refuses changed main', () => {
  const run = runs => (command, args) => JSON.stringify(args.at(-1).endsWith('/commits/main') ? { sha: selected.commit } : { workflow_runs: runs });
  assert.throws(() => assertVerifiedMain(selected, '.', run([])), /checks_required/);
  assert.throws(() => assertVerifiedMain(selected, '.', () => JSON.stringify({ sha: 'b'.repeat(40) })), /main_changed/);
  assert.throws(() => assertVerifiedMain(selected, '.', run([{ head_sha: selected.commit, head_branch: 'main', event: 'pull_request', conclusion: 'success' }])), /checks_required/);
  assert.equal(assertVerifiedMain(selected, '.', run([{ head_sha: selected.commit, head_branch: 'main', event: 'push', conclusion: 'success' }])).verified, true);
});

test('existing tags and draft releases cannot be overwritten, and API errors fail closed', () => {
  assert.throws(() => assertUnusedVersion(selected, '.', () => JSON.stringify([[{ ref: 'refs/tags/v1.2.3' }]])), /version_exists/);
  assert.throws(() => assertUnusedVersion(selected, '.', () => JSON.stringify([[{ tag_name: 'v1.2.3', draft: true }]])), /version_exists/);
  assert.throws(() => assertUnusedVersion(selected, '.', () => { throw new Error('network unavailable'); }), /network unavailable/);
  assert.doesNotThrow(() => assertUnusedVersion(selected, '.', () => '[[]]'));
});
