import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { access, chmod, copyFile, lstat, mkdir, readFile, readdir, readlink, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createGunzip } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

// Packaging is separate from building, testing and deploying. This entry never
// starts a service, changes the checkout, copies live storage or reads secrets.
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const outputRoot = path.join(projectRoot, 'work/gcp-migration');
const nextRootFiles = new Set([
  'BUILD_ID', 'package.json', 'build-manifest.json', 'app-build-manifest.json',
  'app-path-routes-manifest.json', 'routes-manifest.json', 'prerender-manifest.json',
  'react-loadable-manifest.json', 'required-server-files.json', 'required-server-files.js', 'images-manifest.json',
  'fallback-build-manifest.json', 'dynamic-css-manifest.json',
  'export-marker.json', 'next-server.js.nft.json', 'next-minimal-server.js.nft.json',
]);
const checkedManifests = ['BUILD_ID', 'build-manifest.json', 'app-build-manifest.json',
  'routes-manifest.json', 'prerender-manifest.json'];
const migrations = ['0000_parched_betty_ross.sql', '0001_handy_robbie_robertson.sql'];
const shaPattern = /^[a-f0-9]{40}$/;
const archiveLimits = Object.freeze({ maximumMembers: 50000,
  maximumCompressedBytes: 1024 ** 3, maximumExpandedBytes: 2 * 1024 ** 3 });

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function command(program, args, { cwd = projectRoot, env = process.env, logPath } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const log = logPath ? createWriteStream(logPath, { flags: 'wx', mode: 0o600 }) : null;
    const consume = chunk => { if (log) log.write(chunk); else output += chunk.toString('utf8'); };
    child.stdout.on('data', consume); child.stderr.on('data', consume);
    child.once('error', error => { log?.end(); reject(error); });
    child.once('close', code => {
      if (log) log.end(() => code === 0 ? resolve('') : reject(new Error(`${program} failed; see the task-local log.`)));
      else if (code === 0) resolve(output.trimEnd());
      else reject(new Error(`${program} failed (${code}).`));
    });
  });
}

async function sha256(filename) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  return digest.digest('hex');
}

async function regularFile(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('An allowlisted file is not a regular file.');
  return info;
}

async function checkNoBuildEnvFiles() {
  for (const name of await readdir(projectRoot)) {
    if (name === '.env' || name.startsWith('.env.') || name === '.dev.vars' || name.startsWith('.dev.vars.')) {
      throw new Error('Remove checkout-local environment files before recording or packaging a public release.');
    }
  }
}

function excludedBuildInput(filename) {
  return filename.startsWith('docs/') || ['README.md', 'AGENTS.md', 'scripts/package-node-release.mjs'].includes(filename) ||
    /^scripts\/[^/]*check[^/]*$/u.test(filename);
}

/** Capture this after the actual build; compare again after documentation commits. */
export async function fingerprintBuildInputs() {
  await checkNoBuildEnvFiles();
  const listed = await command('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  const names = [...new Set(listed.split('\0').filter(Boolean))].filter(name => !excludedBuildInput(name)).sort();
  const files = [];
  for (const filename of names) {
    const absolute = path.resolve(projectRoot, filename);
    if (!inside(projectRoot, absolute)) throw new Error('A source input escaped the checkout.');
    const info = await regularFile(absolute);
    files.push({ path: filename, bytes: info.size, sha256: await sha256(absolute) });
  }
  return { sourceInputsHash: createHash('sha256').update(JSON.stringify(files)).digest('hex'), sourceInputs: files };
}

async function gitIdentity() {
  const sourceCommit = await command('git', ['rev-parse', 'HEAD']);
  const sourceTree = await command('git', ['rev-parse', 'HEAD^{tree}']);
  const sourceBranch = await command('git', ['branch', '--show-current']);
  const sourceClean = (await command('git', ['status', '--porcelain=v1', '--untracked-files=normal'])) === '';
  const remote = await command('git', ['remote', 'get-url', 'origin']);
  if (!['https://github.com/QIU-Guanzong/HireHire', 'https://github.com/QIU-Guanzong/HireHire.git',
    'git@github.com:QIU-Guanzong/HireHire.git'].includes(remote)) throw new Error('The source remote is not HireHire.');
  return { sourceCommit, sourceTree, sourceBranch, sourceClean, repository: 'https://github.com/QIU-Guanzong/HireHire' };
}

async function buildIdentity() {
  const manifestHashes = {};
  for (const filename of checkedManifests) {
    const absolute = path.join(projectRoot, '.next', filename);
    try { await regularFile(absolute); }
    catch (error) { if (filename === 'app-build-manifest.json' && error.code === 'ENOENT') continue; throw error; }
    manifestHashes[filename] = await sha256(absolute);
  }
  const buildId = (await readFile(path.join(projectRoot, '.next/BUILD_ID'), 'utf8')).trim();
  if (!buildId || buildId.length > 200 || /[\s/\\]/u.test(buildId)) throw new Error('The Next build ID is invalid.');
  await access(path.join(projectRoot, '.next/server'));
  await access(path.join(projectRoot, '.next/static'));
  const runtimeBuildFiles = [];
  async function walk(relative) {
    const absolute = path.join(projectRoot, relative), info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error('Runtime build output cannot contain symlinks.');
    if (info.isDirectory()) {
      for (const name of (await readdir(absolute)).sort()) await walk(`${relative}/${name}`);
    } else if (info.isFile()) runtimeBuildFiles.push({ path: relative, bytes: info.size, sha256: await sha256(absolute) });
    else throw new Error('Runtime build output has an unsupported type.');
  }
  for (const relative of ['.next/server', '.next/static']) await walk(relative);
  for (const name of (await readdir(path.join(projectRoot, '.next'))).sort()) {
    if (nextRootFiles.has(name)) await walk(`.next/${name}`);
  }
  runtimeBuildFiles.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const runtimeBuildHash = createHash('sha256').update(JSON.stringify(runtimeBuildFiles)).digest('hex');
  return { buildId, manifestHashes, runtimeBuildHash };
}

function taskLocalPath(value) {
  const absolute = path.resolve(projectRoot, value);
  if (!inside(outputRoot, absolute) || absolute === outputRoot) throw new Error('Receipt paths must stay within work/gcp-migration.');
  return absolute;
}

export async function recordBuildReceipt(filename, { builtSourceCommit } = {}) {
  const destination = taskLocalPath(filename);
  const identity = await gitIdentity(), inputs = await fingerprintBuildInputs(), build = await buildIdentity();
  let previous;
  try { previous = JSON.parse(await readFile(destination, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && (previous.sourceInputsHash !== inputs.sourceInputsHash ||
    previous.buildId !== build.buildId || previous.runtimeBuildHash !== build.runtimeBuildHash ||
    JSON.stringify(previous.manifestHashes) !== JSON.stringify(build.manifestHashes))) {
    throw new Error('The saved build inputs or outputs changed; use a new receipt after a newly validated build.');
  }
  const builtCommit = builtSourceCommit || previous?.builtSourceCommit || identity.sourceCommit;
  if (!shaPattern.test(builtCommit)) throw new Error('builtSourceCommit must be a full Git SHA.');
  await command('git', ['merge-base', '--is-ancestor', builtCommit, identity.sourceCommit]);
  const receipt = { schemaVersion: 1, kind: 'hirehire-node-build', ...identity,
    builtSourceCommit: builtCommit, builtSourceClean: previous?.builtSourceClean ?? identity.sourceClean,
    builtAt: previous?.builtAt || new Date().toISOString(),
    recordedAt: new Date().toISOString(), ...inputs, ...build,
    note: 'Recorded after a build by the operator; this records bytes and is not a test or deployment result.' };
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await writeFile(destination, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  return receipt;
}

async function copyRegular(relative, destination) {
  const source = path.join(projectRoot, relative);
  await regularFile(source);
  await mkdir(path.dirname(path.join(destination, relative)), { recursive: true, mode: 0o755 });
  await copyFile(source, path.join(destination, relative));
}

async function copyTree(relative, destination) {
  const source = path.join(projectRoot, relative);
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error('Source symlinks are not permitted in an allowlisted runtime tree.');
  if (info.isFile()) { await copyRegular(relative, destination); return; }
  if (!info.isDirectory()) throw new Error('An allowlisted runtime entry has an unsupported type.');
  await mkdir(path.join(destination, relative), { recursive: true, mode: 0o755 });
  for (const name of (await readdir(source)).sort()) await copyTree(path.posix.join(relative, name), destination);
}

async function validateLock() {
  const lock = JSON.parse(await readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  if (lock.lockfileVersion !== 3 || !lock.packages?.['']) throw new Error('Expected the existing npm v3 lockfile.');
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (name === '') continue;
    // npm lockfiles omit individual tarball metadata for dependencies bundled
    // inside a parent tarball. These reviewed dev-only WASM children are not
    // installed by --omit=dev; verify their integrity-locked parent instead.
    if (entry.dev === true && entry.inBundle === true && !entry.link && !entry.resolved && !entry.integrity) {
      const parentName = name.slice(0, name.lastIndexOf('/node_modules/'));
      const parent = lock.packages[parentName];
      if (!parent || parent.dev !== true || !parent.resolved || !parent.integrity || parent.link) {
        throw new Error('A bundled development dependency has no integrity-locked parent.');
      }
      continue;
    }
    if (entry.link || !entry.resolved || !entry.integrity) throw new Error('Only registry packages locked with integrity are permitted.');
    const source = new URL(entry.resolved);
    if (source.protocol !== 'https:' || source.hostname !== 'registry.npmjs.org' || source.port ||
      source.username || source.password || source.search || source.hash) {
      throw new Error('A dependency does not use the permitted public npm registry.');
    }
  }
}

function npmEnvironment(cachePath) {
  // Do not forward app secrets, npm auth variables or an operator's npmrc.
  const allowed = ['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
    'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'];
  const environment = Object.fromEntries(allowed.filter(name => process.env[name] !== undefined)
    .map(name => [name, process.env[name]]));
  return { ...environment, NODE_ENV: 'production', npm_config_userconfig: path.join(cachePath, 'empty-user.npmrc'),
    npm_config_globalconfig: path.join(cachePath, 'empty-global.npmrc'), npm_config_cache: cachePath,
    npm_config_registry: 'https://registry.npmjs.org', npm_config_ignore_scripts: 'true',
    npm_config_audit: 'false', npm_config_fund: 'false', NEXT_TELEMETRY_DISABLED: '1' };
}

function prohibitedEntry(relative) {
  const parts = relative.split('/');
  return parts.some(name => ['.git', '.wrangler', '.openai', 'work', '.npmrc', '.dev.vars'].includes(name) ||
    name === '.env' || name.startsWith('.env.') || name.startsWith('.dev.vars.') ||
    /\.(?:sqlite|sqlite3|db|pem|key)(?:-wal|-shm)?$/iu.test(name));
}

/** npm .bin file links become ordinary files; directories/foreign links are refused. */
export async function materializeDependencyFiles(directory) {
  const root = path.resolve(directory);
  if (await realpath(root) !== root) throw new Error('The isolated package root cannot be a symlink.');
  let materializedSymlinks = 0, materializedHardlinks = 0;
  async function replaceWithRegularFile(filename, source, expected) {
    const temporary = path.join(path.dirname(filename), `.hirehire-materialize-${randomUUID()}`);
    try {
      await copyFile(source, temporary, constants.COPYFILE_EXCL);
      await chmod(temporary, expected.mode & 0o777);
      const copied = await lstat(temporary), current = await lstat(source);
      if (!copied.isFile() || copied.nlink !== 1 || current.dev !== expected.dev ||
        current.ino !== expected.ino || current.size !== expected.size || !current.isFile()) {
        throw new Error('A dependency changed while its link was materialized.');
      }
      await rename(temporary, filename);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async function walk(filename) {
    const info = await lstat(filename);
    if (info.isSymbolicLink()) {
      const target = await readlink(filename), resolved = await realpath(filename);
      if (path.isAbsolute(target) || !inside(root, resolved)) throw new Error('A dependency link escaped the isolated package.');
      const targetInfo = await lstat(resolved);
      if (!targetInfo.isFile() || targetInfo.isSymbolicLink()) throw new Error('Only dependency links to regular files can be materialized.');
      await replaceWithRegularFile(filename, resolved, targetInfo); materializedSymlinks++;
    } else if (info.isDirectory()) {
      for (const name of (await readdir(filename)).sort()) await walk(path.join(filename, name));
    } else if (info.isFile()) {
      if (info.nlink > 1) { await replaceWithRegularFile(filename, filename, info); materializedHardlinks++; }
      else if (info.nlink !== 1) throw new Error('A dependency has an invalid file link count.');
    } else throw new Error('A dependency contains a device, socket or unsupported entry.');
  }
  const dependencies = path.join(root, 'node_modules');
  const dependencyInfo = await lstat(dependencies);
  if (!dependencyInfo.isDirectory() || dependencyInfo.isSymbolicLink()) throw new Error('The dependency root must be an ordinary directory.');
  await walk(dependencies);
  return { materializedSymlinks, materializedHardlinks };
}

async function packageManifest(directory, relative = '', budget = { members: 1, fileBytes: 0 }) {
  const entries = [];
  for (const name of (await readdir(path.join(directory, relative))).sort()) {
    if (++budget.members > archiveLimits.maximumMembers) throw new Error('The archive member limit was exceeded.');
    const filename = relative ? `${relative}/${name}` : name;
    if (prohibitedEntry(filename)) throw new Error('A forbidden data, credential or runtime-state path entered the package.');
    const absolute = path.join(directory, filename), info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error('The final package must not contain symbolic links.');
    if (info.isDirectory()) entries.push(...await packageManifest(directory, filename, budget));
    else if (info.isFile()) {
      if (info.nlink !== 1) throw new Error('The final package must not contain hardlinked files.');
      budget.fileBytes += info.size;
      if (!Number.isSafeInteger(budget.fileBytes) || budget.fileBytes > archiveLimits.maximumExpandedBytes) {
        throw new Error('The expanded archive file budget was exceeded.');
      }
      entries.push({ path: filename, type: 'file', bytes: info.size, sha256: await sha256(absolute) });
    }
    else throw new Error('A runtime package entry has an unsupported type.');
  }
  return entries;
}

async function expandedArchiveBytes(archivePath) {
  const source = createReadStream(archivePath), decoder = createGunzip();
  source.on('error', error => decoder.destroy(error));
  source.pipe(decoder);
  let bytes = 0;
  try {
    for await (const chunk of decoder) {
      bytes += chunk.length;
      if (bytes > archiveLimits.maximumExpandedBytes) throw new Error('The decompressed tar budget was exceeded.');
    }
  } finally { source.destroy(); decoder.destroy(); }
  return bytes;
}

export async function packageNodeRelease({ candidate, buildReceipt, releaseId }) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Build this runtime artifact in the Linux x64 execution environment.');
  if (!shaPattern.test(candidate || '')) throw new Error('--candidate requires the full accepted Git SHA.');
  if (!/^[a-z0-9][a-z0-9-]{0,90}$/u.test(releaseId || '')) throw new Error('--release-id must be a simple task-local name.');
  const identity = await gitIdentity();
  if (!identity.sourceClean || identity.sourceCommit !== candidate) throw new Error('Packaging requires clean Git HEAD equal to the accepted candidate.');
  const receipt = JSON.parse(await readFile(taskLocalPath(buildReceipt), 'utf8'));
  const inputs = await fingerprintBuildInputs(), build = await buildIdentity();
  if (receipt.schemaVersion !== 1 || receipt.kind !== 'hirehire-node-build' || receipt.sourceCommit !== candidate ||
    receipt.sourceTree !== identity.sourceTree || !receipt.sourceClean || receipt.sourceInputsHash !== inputs.sourceInputsHash ||
    receipt.buildId !== build.buildId || receipt.runtimeBuildHash !== build.runtimeBuildHash ||
    JSON.stringify(receipt.manifestHashes) !== JSON.stringify(build.manifestHashes)) {
    throw new Error('Build receipt does not match the clean candidate and current build bytes.');
  }
  if (!shaPattern.test(receipt.builtSourceCommit || '')) throw new Error('The build source provenance is missing.');
  await command('git', ['merge-base', '--is-ancestor', receipt.builtSourceCommit, candidate]);
  await validateLock();
  const stagingRoot = path.join(outputRoot, releaseId);
  // A release directory is never overwritten or deleted, even after a failure.
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await mkdir(stagingRoot, { mode: 0o700 });
  const destination = path.join(stagingRoot, 'runtime');
  await mkdir(destination, { mode: 0o755 });
  for (const relative of ['package.json', 'package-lock.json', 'next.config.mjs', 'scripts/node-server.mjs', 'scripts/node-data-backup.mjs',
    'docs/GCP_MIGRATION_HANDOFF.md', ...migrations.map(name => `drizzle/${name}`)]) await copyRegular(relative, destination);
  for (const name of (await readdir(path.join(projectRoot, 'lib/node'))).sort()) {
    if (name.endsWith('.mjs')) await copyRegular(`lib/node/${name}`, destination);
  }
  for (const relative of ['public', '.next/server', '.next/static']) await copyTree(relative, destination);
  for (const name of (await readdir(path.join(projectRoot, '.next'))).sort()) {
    if (nextRootFiles.has(name)) await copyRegular(`.next/${name}`, destination);
  }
  const required = JSON.parse(await readFile(path.join(destination, '.next/required-server-files.json'), 'utf8'));
  if (required.config?.output === 'standalone') throw new Error('Standalone output cannot replace this custom server.');
  for (const relative of required.files || []) {
    const absolute = path.resolve(destination, relative);
    if (!inside(destination, absolute)) throw new Error('A required server file escaped the allowlisted runtime.');
    await access(absolute);
  }
  const dependencyLog = path.join(stagingRoot, 'npm-install.log');
  console.log('Installing locked production dependencies into the isolated release directory.');
  await command('npm', ['ci', '--omit=dev', '--include=optional', '--ignore-scripts', '--no-audit', '--no-fund',
    '--registry=https://registry.npmjs.org'], { cwd: destination,
    env: npmEnvironment(path.join(stagingRoot, 'npm-cache')), logPath: dependencyLog });
  const linkMaterialization = await materializeDependencyFiles(destination);
  // No lifecycle scripts or dependency upgrades. Native optional packages come
  // from the integrity-locked registry tarballs for this exact Linux platform.
  const header = process.report?.getReport().header;
  const sqlite = new DatabaseSync(':memory:');
  let sqliteVersion;
  try { sqliteVersion = sqlite.prepare('SELECT sqlite_version() AS version').get().version; }
  finally { sqlite.close(); }
  const provenance = { schemaVersion: 1, kind: 'hirehire-node-runtime', ...identity,
    builtSourceCommit: receipt.builtSourceCommit, builtSourceClean: receipt.builtSourceClean,
    sourceInputsHash: inputs.sourceInputsHash,
    ...build, applicationVersion: JSON.parse(await readFile(path.join(destination, 'package.json'), 'utf8')).version,
    platform: process.platform, architecture: process.arch, nodeVersion: process.version,
    glibcVersion: header?.glibcVersionRuntime || null, sqliteVersion,
    dependencyInstall: 'npm ci --omit=dev --include=optional --ignore-scripts --no-audit --no-fund',
    dependencyRegistry: 'https://registry.npmjs.org', lockfileSha256: await sha256(path.join(destination, 'package-lock.json')),
    managementEnabledByDefault: false, writesEnabledByDefault: false, releaseChannelByDefault: 'preview', deployed: false,
    runtimeEntry: 'scripts/node-server.mjs', dataIncluded: false, environmentIncluded: false,
    archiveLimits, ...linkMaterialization, packageFileTypes: ['regular-file', 'directory'] };
  await writeFile(path.join(destination, 'release-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o644 });
  const packageBudget = { members: 1, fileBytes: 0 };
  const files = await packageManifest(destination, '', packageBudget);
  const manifestPath = path.join(stagingRoot, 'package-manifest.json');
  await writeFile(manifestPath, `${JSON.stringify({ schemaVersion: 1, ...provenance,
    archiveMemberCount: packageBudget.members, expandedFileBytes: packageBudget.fileBytes, files }, null, 2)}\n`, { mode: 0o600 });
  // Prevent a concurrent source/build edit being hidden by dependency installation.
  const finalIdentity = await gitIdentity(), finalInputs = await fingerprintBuildInputs(), finalBuild = await buildIdentity();
  if (!finalIdentity.sourceClean || finalIdentity.sourceCommit !== candidate ||
    finalInputs.sourceInputsHash !== inputs.sourceInputsHash || JSON.stringify(finalBuild) !== JSON.stringify(build)) {
    throw new Error('Candidate or build changed during packaging; this release is not accepted.');
  }
  const archivePath = path.join(stagingRoot, `hirehire-node-${candidate.slice(0, 12)}-${process.platform}-${process.arch}.tar.gz`);
  await command('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
    '--format=posix', '--pax-option=delete=atime,delete=ctime', '--hard-dereference', '-czf', archivePath, '-C', destination, '.']);
  const archiveInfo = await regularFile(archivePath);
  if (archiveInfo.size > archiveLimits.maximumCompressedBytes) throw new Error('The compressed archive budget was exceeded.');
  const uncompressedTarBytes = await expandedArchiveBytes(archivePath);
  const result = { schemaVersion: 1, kind: 'hirehire-node-package-receipt', ...provenance,
    releaseId, archivePath, archiveBytes: archiveInfo.size, archiveSha256: await sha256(archivePath),
    manifestPath, manifestSha256: await sha256(manifestPath), packageEntryCount: files.length,
    archiveMemberCount: packageBudget.members, expandedFileBytes: packageBudget.fileBytes, uncompressedTarBytes,
    createdAt: new Date().toISOString(), note: 'Local artifact only; no production configuration, publish or DNS operation performed.' };
  await writeFile(path.join(stagingRoot, 'package-receipt.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return result;
}

function options(arguments_) {
  const result = {};
  for (const argument of arguments_) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(argument);
    if (!match || result[match[1]] !== undefined) throw new Error('Use unique --name=value options.');
    result[match[1]] = match[2];
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = options(process.argv.slice(2));
    if (args['record-build']) {
      if (Object.keys(args).some(name => !['record-build', 'built-source-commit'].includes(name))) throw new Error('Unknown build receipt option.');
      const receipt = await recordBuildReceipt(args['record-build'], { builtSourceCommit: args['built-source-commit'] });
      console.log(JSON.stringify({ sourceCommit: receipt.sourceCommit, sourceTree: receipt.sourceTree,
        builtSourceCommit: receipt.builtSourceCommit, sourceClean: receipt.sourceClean,
        buildId: receipt.buildId, sourceInputsHash: receipt.sourceInputsHash,
        receiptPath: taskLocalPath(args['record-build']) }, null, 2));
    } else {
      if (Object.keys(args).some(name => !['candidate', 'build-receipt', 'release-id'].includes(name))) throw new Error('Unknown package option.');
      console.log(JSON.stringify(await packageNodeRelease({ candidate: args.candidate,
        buildReceipt: args['build-receipt'], releaseId: args['release-id'] }), null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Node release packaging failed.');
    process.exitCode = 1;
  }
}
