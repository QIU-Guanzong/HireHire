import { handleApi, json } from '@/lib/server';
import { publicationById, publicDto } from '@/lib/platform-server';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => json(publicDto(await publicationById((await context.params).id, true)))); }
