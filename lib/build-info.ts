// Next replaces these exact accesses at build time. Runtime variables cannot
// relabel an existing bundle. A dev/dirty/no-Git build has no verified source.
const commit = process.env.HIREHIRE_BUILT_SOURCE_COMMIT;
const tree = process.env.HIREHIRE_BUILT_SOURCE_TREE;
export const BUILD_SOURCE = commit && tree && /^[a-f0-9]{40}$/.test(commit) && /^[a-f0-9]{40}$/.test(tree)
  ? { commit, tree, buildId: commit } : null;
