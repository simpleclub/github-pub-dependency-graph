import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { submitSnapshot } from '../src/github.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'src', 'index.js');

function runAction(extraEnv) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pubgraph-'));
  for (const f of ['output', 'sdk.log']) fs.writeFileSync(path.join(tmp, f), '');
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(GITHUB_|INPUT_|RUNNER_)/.test(k)) env[k] = v;
  const r = spawnSync(process.execPath, [entry], {
    encoding: 'utf8',
    env: {
      ...env,
      PATH: `${path.join(here, 'fixtures', 'bin')}${path.delimiter}${path.dirname(process.execPath)}`,
      FAKE_SDK_LOG: path.join(tmp, 'sdk.log'),
      GITHUB_WORKSPACE: path.join(here, 'fixtures', 'workspace'),
      GITHUB_SHA: 'a'.repeat(40),
      GITHUB_REF: 'refs/heads/main',
      GITHUB_REPOSITORY: 'octo/repo',
      GITHUB_RUN_ID: '42',
      GITHUB_WORKFLOW: 'deps',
      GITHUB_JOB: 'submit',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_OUTPUT: path.join(tmp, 'output'),
      RUNNER_TEMP: tmp,
      ...extraEnv,
    },
  });
  return { r, tmp };
}

test('dry run: runs pub get + pub deps with flutter and writes the snapshot', { skip: process.platform === 'win32' }, () => {
  const { r, tmp } = runAction({ 'INPUT_DRY-RUN': 'true' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.readFileSync(path.join(tmp, 'sdk.log'), 'utf8'), 'flutter pub get --enforce-lockfile\nflutter pub deps --json\n');
  const snapshot = JSON.parse(fs.readFileSync(path.join(tmp, 'pub-dependency-snapshot.json'), 'utf8'));
  assert.equal(snapshot.sha, 'a'.repeat(40));
  assert.equal(snapshot.ref, 'refs/heads/main');
  assert.deepEqual(snapshot.job, { correlator: 'deps_submit_pub', id: '42', html_url: 'https://github.com/octo/repo/actions/runs/42' });
  assert.deepEqual(Object.keys(snapshot.manifests).sort(), ['packages/app/pubspec.yaml', 'packages/tool/pubspec.yaml', 'pubspec.lock']);
  assert.match(fs.readFileSync(path.join(tmp, 'output'), 'utf8'), /snapshot-path<<EOF_.*\n.*pub-dependency-snapshot\.json\n/);
});

test('include-sdk-packages input', { skip: process.platform === 'win32' }, () => {
  const { r, tmp } = runAction({ 'INPUT_DRY-RUN': 'true', 'INPUT_INCLUDE-SDK-PACKAGES': 'true' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const snapshot = JSON.parse(fs.readFileSync(path.join(tmp, 'pub-dependency-snapshot.json'), 'utf8'));
  assert.ok('pkg:pub/flutter@3.29.0' in snapshot.manifests['packages/app/pubspec.yaml'].resolved);
});

test('pull requests use the head commit and branch', { skip: process.platform === 'win32' }, () => {
  const event = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pubgraph-')), 'event.json');
  fs.writeFileSync(event, JSON.stringify({ pull_request: { head: { sha: 'b'.repeat(40), ref: 'feature' } } }));
  const { r, tmp } = runAction({ 'INPUT_DRY-RUN': 'true', GITHUB_EVENT_PATH: event });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const snapshot = JSON.parse(fs.readFileSync(path.join(tmp, 'pub-dependency-snapshot.json'), 'utf8'));
  assert.equal(snapshot.sha, 'b'.repeat(40));
  assert.equal(snapshot.ref, 'refs/heads/feature');
});

test('fails with a clear message when the SDK is not set up', () => {
  const { r } = runAction({ 'INPUT_DRY-RUN': 'true', PATH: path.dirname(process.execPath) });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /::error::"flutter" not found\. Set up the SDK/);
});

test('submitSnapshot posts the snapshot', async () => {
  let call;
  const fetchImpl = async (url, init) => {
    call = { url, init };
    return { ok: true, status: 201, text: async () => '{"id":7,"result":"SUCCESS"}' };
  };
  const res = await submitSnapshot({ snapshot: { version: 0 }, repository: 'o/r', token: 't', fetchImpl });
  assert.deepEqual(res, { id: 7, result: 'SUCCESS' });
  assert.equal(call.url, 'https://api.github.com/repos/o/r/dependency-graph/snapshots');
  assert.equal(call.init.headers.Authorization, 'Bearer t');
});

test('submitSnapshot explains missing permissions', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => '{"message":"Resource not accessible by integration"}' });
  await assert.rejects(submitSnapshot({ snapshot: {}, repository: 'o/r', token: 't', fetchImpl }), /HTTP 403[\s\S]*contents: write/);
});
