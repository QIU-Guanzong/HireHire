import { handleApi, json } from '@/lib/server';
import { publicCandidates } from '@/lib/platform-server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handleApi(async () => json(await publicCandidates(new URL(request.url)))); }
