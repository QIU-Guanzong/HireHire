import { APP_VERSION } from '@/lib/app-version';
import { json } from '@/lib/server';
import { releaseChannel } from '@/lib/runtime';
import { BUILD_SOURCE } from '@/lib/build-info';
export const dynamic = 'force-dynamic';
// Liveness stays independent of the database; readiness is /api/health.
export async function GET() { return json({ status: 'alive', version: APP_VERSION, runtime: 'node-sqlite', releaseChannel: releaseChannel(), source: BUILD_SOURCE }); }
