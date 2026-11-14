// Everything comes from `pub deps --json`; the only other file read is
// .dart_tool/package_config.json, to find the directory of each workspace package.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SKIP_DIRS = new Set(['.git', '.dart_tool', 'build', 'node_modules', '.symlinks', 'Pods', 'ephemeral', '.fvm']);

/** All directories below `root` that contain a pubspec.lock (i.e. resolved projects / workspace roots). */
export function findProjects(root) {
  const found = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
      else if (e.isFile() && e.name === 'pubspec.lock') found.push(dir);
    }
  };
  walk(root);
  return found.sort();
}

/** Flutter projects lock the `flutter` SDK package; everything else is plain Dart. */
export function sdkFor(projectDir) {
  const lock = fs.readFileSync(path.join(projectDir, 'pubspec.lock'), 'utf8');
  return /description: flutter\s+source: sdk/.test(lock) ? 'flutter' : 'dart';
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' });
  if (r.error?.code === 'ENOENT') {
    throw new Error(`"${cmd}" not found. Set up the SDK before this action (subosito/flutter-action or dart-lang/setup-dart).`);
  }
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`"${cmd} ${args.join(' ')}" failed in ${cwd}:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

/** Runs `pub get --enforce-lockfile` and `pub deps --json` and returns the parsed JSON. */
export function pubDeps(projectDir) {
  const sdk = sdkFor(projectDir);
  run(sdk, ['pub', 'get', '--enforce-lockfile'], projectDir);
  const out = run(sdk, ['pub', 'deps', '--json'], projectDir);
  return JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
}

/** Maps workspace package names to their directory, using .dart_tool/package_config.json. */
export function workspaceDirs(projectDir, rootNames) {
  const configFile = path.join(projectDir, '.dart_tool', 'package_config.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const dirs = {};
  for (const p of config.packages) {
    if (!rootNames.includes(p.name)) continue;
    dirs[p.name] = p.rootUri.startsWith('file:')
      ? new URL(p.rootUri).pathname
      : path.resolve(path.dirname(configFile), p.rootUri);
  }
  return dirs;
}

export const purl = (p) => `pkg:pub/${p.name}@${encodeURIComponent(p.version)}`;

/**
 * Builds one manifest per workspace package from `pub deps --json` output.
 *
 * - The workspace root is reported under the pubspec.lock path, every other
 *   workspace package under its own pubspec.yaml path.
 * - direct = declared by the package; indirect = everything reachable from those.
 * - runtime = reachable from `dependencies`; development = only from `dev_dependencies`.
 * - Path packages are your own code: not reported, their dependencies count as direct.
 * - SDK packages (flutter, flutter_test, ...) are not reported, their dependencies are (indirect).
 * - Other workspace packages are not reported; their dependencies are in their own manifest.
 */
export function buildManifests(deps, { lockfilePath, pubspecPaths }) {
  const byName = new Map(deps.packages.map((p) => [p.name, p]));
  const roots = deps.packages.filter((p) => p.kind === 'root');
  if (roots.some((r) => !Array.isArray(r.directDependencies))) {
    throw new Error('`pub deps --json` output has no "directDependencies"; Dart 3.6 (Flutter 3.27) or newer is required.');
  }
  const manifests = {};
  for (const root of roots) {
    const entries = new Map();
    const queue = [];
    const visited = new Set();
    const add = (name, relationship, scope) => {
      const pkg = byName.get(name);
      if (!pkg || pkg.kind === 'root') return;
      if (pkg.source === 'path' || pkg.source === 'sdk') {
        const key = `${name}:${relationship}:${scope}`;
        if (visited.has(key)) return;
        visited.add(key);
        const rel = pkg.source === 'path' ? relationship : 'indirect';
        for (const d of pkg.directDependencies) add(d, rel, scope);
        return;
      }
      const e = entries.get(name);
      if (e && (e.relationship === 'direct' || relationship === 'indirect') && (e.scope === 'runtime' || scope === 'development')) return;
      entries.set(name, {
        relationship: e?.relationship === 'direct' ? 'direct' : relationship,
        scope: e?.scope === 'runtime' ? 'runtime' : scope,
      });
      queue.push(name);
    };
    root.directDependencies.forEach((d) => add(d, 'direct', 'runtime'));
    root.devDependencies.forEach((d) => add(d, 'direct', 'development'));
    while (queue.length) {
      const name = queue.shift();
      for (const d of byName.get(name).directDependencies) add(d, 'indirect', entries.get(name).scope);
    }

    const file = root.name === deps.root ? lockfilePath : pubspecPaths[root.name];
    const resolved = {};
    for (const [name, e] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
      const pkg = byName.get(name);
      resolved[purl(pkg)] = {
        package_url: purl(pkg),
        relationship: e.relationship,
        scope: e.scope,
        dependencies: pkg.directDependencies.filter((d) => entries.has(d)).map((d) => purl(byName.get(d))).sort(),
      };
    }
    manifests[file] = { name: file, file: { source_location: file }, resolved };
  }
  return manifests;
}
