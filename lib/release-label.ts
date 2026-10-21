export type ReleaseLabel = { mode: 'preview' | 'candidate' | 'live' | 'unknown'; sourceCommit: string | null; sourceTree: string | null };

export function releaseLabel(value: unknown): ReleaseLabel {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const source = body.source && typeof body.source === 'object' ? body.source as Record<string, unknown> : {};
  const known = typeof source.commit === 'string' && /^[a-f0-9]{40}$/.test(source.commit) &&
    typeof source.tree === 'string' && /^[a-f0-9]{40}$/.test(source.tree) && source.buildId === source.commit;
  const sourceCommit = known ? source.commit as string : null, sourceTree = known ? source.tree as string : null;
  const mode = body.releaseChannel === 'preview' ? 'preview' : body.releaseChannel === 'candidate' ? 'candidate' :
    body.releaseChannel === 'production' && known ? 'live' : 'unknown';
  return { mode, sourceCommit, sourceTree };
}
