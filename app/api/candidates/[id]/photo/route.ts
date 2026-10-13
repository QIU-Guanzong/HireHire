import { handleApi } from '@/lib/server';
import { photoResponse, publicationById } from '@/lib/platform-server';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => { const candidate = await publicationById((await context.params).id, true); return photoResponse(candidate.photo_id); }); }
