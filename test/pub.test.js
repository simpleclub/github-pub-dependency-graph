import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifests, findProjects, sdkFor, workspaceDirs } from '../src/pub.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ws = path.join(fixtures, 'workspace');
const deps = () => JSON.parse(fs.readFileSync(path.join(fixtures, 'pub-deps.json'), 'utf8'));
const paths = {
  lockfilePath: 'pubspec.lock',
  pubspecPaths: { app: 'packages/app/pubspec.yaml', tool: 'packages/tool/pubspec.yaml', ws_root: 'pubspec.yaml' },
};
const view = (m) => Object.fromEntries(Object.values(m.resolved).map((r) => [r.package_url, `${r.relationship}/${r.scope}`]));

test('finds projects by pubspec.lock and detects Flutter', () => {
  assert.deepEqual(findProjects(ws), [ws]);
  assert.equal(sdkFor(ws), 'flutter');
});

test('workspace package directories come from package_config.json', () => {
  assert.deepEqual(workspaceDirs(ws, ['ws_root', 'app', 'tool']), {
    ws_root: ws,
    app: path.join(ws, 'packages', 'app'),
    tool: path.join(ws, 'packages', 'tool'),
  });
});

test('one manifest per workspace package with relationships and scopes', () => {
  const m = buildManifests(deps(), paths);
  assert.deepEqual(Object.keys(m).sort(), ['packages/app/pubspec.yaml', 'packages/tool/pubspec.yaml', 'pubspec.lock']);
  assert.deepEqual(view(m['pubspec.lock']), { 'pkg:pub/lints@5.1.1': 'direct/development' });
  assert.deepEqual(view(m['packages/app/pubspec.yaml']), {
    'pkg:pub/collection@1.19.1': 'direct/runtime', // via the path package local_lib
    'pkg:pub/git_pkg@0.3.0%2B1': 'direct/runtime',
    'pkg:pub/http@1.6.0': 'direct/runtime',
    'pkg:pub/http_parser@4.1.2': 'indirect/runtime',
    'pkg:pub/meta@1.16.0': 'indirect/runtime',
    'pkg:pub/mocktail@1.0.4': 'direct/development',
    'pkg:pub/vector_math@2.1.4': 'indirect/runtime', // via the flutter SDK package
  });
  // the workspace package "app" is not reported in tool's manifest, it has its own
  assert.deepEqual(view(m['packages/tool/pubspec.yaml']), { 'pkg:pub/args@2.6.0': 'direct/runtime' });
  assert.deepEqual(m['packages/app/pubspec.yaml'].resolved['pkg:pub/http@1.6.0'].dependencies, ['pkg:pub/http_parser@4.1.2', 'pkg:pub/meta@1.16.0']);
  assert.equal(m['packages/app/pubspec.yaml'].file.source_location, 'packages/app/pubspec.yaml');
});

test('a package reachable from runtime and dev dependencies gets scope runtime', () => {
  const d = deps();
  const app = d.packages.find((p) => p.name === 'app');
  app.directDependencies = app.directDependencies.filter((n) => n !== 'http');
  app.devDependencies.push('http');
  d.packages.find((p) => p.name === 'git_pkg').directDependencies.push('http_parser');
  const v = view(buildManifests(d, paths)['packages/app/pubspec.yaml']);
  assert.equal(v['pkg:pub/http@1.6.0'], 'direct/development');
  assert.equal(v['pkg:pub/http_parser@4.1.2'], 'indirect/runtime');
});

test('requires Dart 3.6+ output', () => {
  const d = deps();
  for (const p of d.packages) delete p.directDependencies;
  assert.throws(() => buildManifests(d, paths), /Dart 3\.6/);
});
