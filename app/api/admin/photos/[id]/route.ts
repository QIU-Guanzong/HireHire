import { handleApi, requireAdmin } from '@/lib/server';
import { photoResponse } from '@/lib/platform-server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => { requireAdmin(request); return photoResponse((await context.params).id); }); }
