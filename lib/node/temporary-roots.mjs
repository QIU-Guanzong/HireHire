import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

// A denylist of known temporary locations, not proof that any other mount is persistent.
// Include lexical and canonical names; retain all other ownership/symlink checks.
export const temporaryRoots = Object.freeze([...new Set(
  ['/tmp', '/var/tmp', tmpdir()].filter(isAbsolute).flatMap(directory => {
    const absolute = resolve(directory);
    try { return [absolute, realpathSync(absolute)]; }
    catch { return [absolute]; }
  }),
)]);
