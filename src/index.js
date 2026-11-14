// GitHub Action entry point.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { submitSnapshot } from './github.js';
import { buildManifests, findProjects, pubDeps, workspaceDirs } from './pub.js';

const input = (name) => (process.env[`INPUT_${name.toUpperCase()}`] ?? '').trim();
const posix = (p) => p.split(path.sep).join('/');

function setOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  const delimiter = `EOF_${crypto.randomUUID()}`;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

async function main() {
  const env = process.env;
  const workspace = env.GITHUB_WORKSPACE || process.cwd();
  const searchRoot = path.resolve(workspace, input('working-directory') || '.');
  const event = env.GITHUB_EVENT_PATH && fs.existsSync(env.GITHUB_EVENT_PATH) ? JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {};
  const pr = event.pull_request;

  const projects = findProjects(searchRoot);
  if (projects.length === 0) throw new Error(`No pubspec.lock found below ${searchRoot}.`);

  const manifests = {};
  for (const dir of projects) {
    const lockfilePath = posix(path.relative(workspace, path.join(dir, 'pubspec.lock')));
    console.log(`::group::${lockfilePath}`);
    const deps = pubDeps(dir);
    const roots = deps.packages.filter((p) => p.kind === 'root').map((p) => p.name);
    const dirs = workspaceDirs(dir, roots);
    const pubspecPaths = Object.fromEntries(roots.map((n) => [n, posix(path.relative(workspace, path.join(dirs[n], 'pubspec.yaml')))]));
    const result = buildManifests(deps, { lockfilePath, pubspecPaths, includeSdk: input('include-sdk-packages') === 'true' });
    for (const [file, m] of Object.entries(result)) {
      const values = Object.values(m.resolved);
      console.log(`${file}: ${values.filter((v) => v.relationship === 'direct').length} direct, ${values.filter((v) => v.relationship === 'indirect').length} indirect`);
    }
    Object.assign(manifests, result);
    console.log('::endgroup::');
  }

  const snapshot = {
    version: 0,
    sha: pr?.head?.sha ?? env.GITHUB_SHA,
    ref: pr?.head?.ref ? `refs/heads/${pr.head.ref}` : env.GITHUB_REF,
    job: {
      correlator: `${env.GITHUB_WORKFLOW}_${env.GITHUB_JOB}_pub`,
      id: String(env.GITHUB_RUN_ID),
      html_url: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
    },
    detector: {
      name: 'github-pub-dependency-graph',
      version: '1.0.0',
      url: `${env.GITHUB_SERVER_URL}/${env.GITHUB_ACTION_REPOSITORY || 'github-pub-dependency-graph'}`,
    },
    scanned: new Date().toISOString(),
    manifests,
  };

  const snapshotPath = path.join(env.RUNNER_TEMP || workspace, 'pub-dependency-snapshot.json');
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
  setOutput('snapshot-path', snapshotPath);
  console.log(`Snapshot with ${Object.keys(manifests).length} manifest(s) written to ${snapshotPath}`);

  if (input('dry-run') === 'true') return;
  const result = await submitSnapshot({
    snapshot,
    repository: env.GITHUB_REPOSITORY,
    token: input('token'),
    apiUrl: env.GITHUB_API_URL,
  });
  setOutput('snapshot-id', String(result.id));
  console.log(`Submitted snapshot ${result.id}: ${result.result} ${result.message ?? ''}`);
}

main().catch((e) => {
  console.log(`::error::${e.message.replace(/\n/g, '%0A')}`);
  process.exitCode = 1;
});
