import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureBuildSource, compiledSource } from './build-source.mjs';
import { releaseLabel } from '../lib/release-label.ts';
import { releaseChannel } from '../lib/node/runtime.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'hirehire-build-source-check-'));
const checks = [], check = (value, label) => { assert(value, label); checks.push(label); };
const saved = Object.fromEntries(['HIREHIRE_RELEASE_CHANNEL', 'HIREHIRE_BUILT_SOURCE_COMMIT', 'HIREHIRE_BUILT_SOURCE_TREE'].map(key => [key, process.env[key]]));
const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
try {
  check(captureBuildSource(root) === null, 'No Git checkout has unknown source');
  git(['init']); await writeFile(path.join(root, 'source.txt'), 'synthetic build input\n'); git(['add', 'source.txt']);
  git(['-c', 'user.name=HireHire test', '-c', 'user.email=build-test@example.invalid', 'commit', '-m', 'Synthetic source']);
  const source = captureBuildSource(root);
  check(source.commit === git(['rev-parse', 'HEAD']) && source.tree === git(['rev-parse', 'HEAD^{tree}']), 'Clean source is read from actual Git objects');
  process.env.HIREHIRE_BUILT_SOURCE_COMMIT = 'f'.repeat(40); process.env.HIREHIRE_BUILT_SOURCE_TREE = 'e'.repeat(40);
  check(captureBuildSource(root).commit === source.commit, 'Environment cannot replace the captured commit');
  await mkdir(path.join(root, 'nested')); check(captureBuildSource(path.join(root, 'nested')) === null, 'A nested directory cannot borrow its parent checkout identity');
  await writeFile(path.join(root, 'source.txt'), 'dirty\n'); check(captureBuildSource(root) === null, 'Tracked dirty source is unknown');
  git(['restore', 'source.txt']); await writeFile(path.join(root, 'untracked.txt'), 'untracked\n'); check(captureBuildSource(root) === null, 'Untracked inputs make the source unknown');
  await rm(path.join(root, 'untracked.txt'));
  const env = { HIREHIRE_BUILT_SOURCE_COMMIT: source.commit, HIREHIRE_BUILT_SOURCE_TREE: source.tree };
  check(compiledSource(env, source.commit)?.tree === source.tree, 'Compiled metadata binds to the actual build ID');
  check(compiledSource(env, 'f'.repeat(40)) === null, 'Mismatched build ID is rejected');
  check(compiledSource({}, source.commit) === null, 'Missing compiled metadata is rejected');
  check(compiledSource({ ...env, HIREHIRE_BUILT_SOURCE_TREE: 'short' }, source.commit) === null, 'Malformed tree is rejected');
  for (const channel of ['preview', 'candidate', 'production']) {
    process.env.HIREHIRE_RELEASE_CHANNEL = channel;
    check(releaseChannel() === channel, `${channel} is a supported explicit channel`);
    check(releaseLabel({ releaseChannel: channel, source }).mode === (channel === 'production' ? 'live' : channel), `${channel} resolves with valid build identity`);
  }
  delete process.env.HIREHIRE_RELEASE_CHANNEL; check(releaseChannel() === 'preview', 'Default remains preview');
  process.env.HIREHIRE_RELEASE_CHANNEL = 'live'; assert.throws(() => releaseChannel()); checks.push('Unsupported runtime channel fails closed');
  for (const invalid of [null, undefined, {}, { ...source, buildId: 'wrong' }, { ...source, commit: '<script>' }]) {
    check(releaseLabel({ releaseChannel: 'production', source: invalid }).mode === 'unknown', 'Production without valid built source never displays Live');
  }
  check(releaseLabel(null).mode === 'unknown', 'Unavailable runtime status is unknown');
  check(releaseLabel({ releaseChannel: 'candidate' }).mode === 'candidate' && !releaseLabel({ releaseChannel: 'candidate' }).sourceCommit, 'Candidate without source stays candidate with unknown source');
  console.log(JSON.stringify({ passed: true, checks: checks.length, assertions: checks }));
} finally {
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(root, { recursive: true, force: true });
}
