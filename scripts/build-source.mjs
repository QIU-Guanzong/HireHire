import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

// Never accept a source SHA supplied through runtime environment variables.
export function captureBuildSource(projectRoot) {
  const git = args => execFileSync('git', ['-C', projectRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    if (git(['rev-parse', '--show-toplevel']) !== realpathSync(projectRoot)) return null;
    if (git(['status', '--porcelain=v1', '--untracked-files=normal'])) return null;
    const commit = git(['rev-parse', 'HEAD']), tree = git(['rev-parse', 'HEAD^{tree}']);
    return sha(commit) && sha(tree) ? { commit, tree, buildId: commit } : null;
  } catch { return null; }
}

export function compiledSource(env, buildId) {
  const commit = env?.HIREHIRE_BUILT_SOURCE_COMMIT, tree = env?.HIREHIRE_BUILT_SOURCE_TREE;
  return sha(commit) && sha(tree) && buildId === commit ? { commit, tree, buildId } : null;
}
