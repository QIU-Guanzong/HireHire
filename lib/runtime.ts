import { env as nodeEnvironment } from './node/runtime.mjs';

// Preserve the narrow D1/R2 call contract while using persistent Node adapters.
export const env = nodeEnvironment as unknown as { DB: D1Database; BUCKET: R2Bucket; RATE_LIMIT_SALT: string };
export { runtimeSession, expectedOrigin, clientIp, loadPdfFont, checkRuntimeReadiness, releaseChannel, writesEnabled } from './node/runtime.mjs';
