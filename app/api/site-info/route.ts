import { handleApi, json } from '@/lib/server';
import { siteInfo } from '@/lib/platform-server';
export const dynamic = 'force-dynamic';
export async function GET() { return handleApi(async () => json(await siteInfo())); }
