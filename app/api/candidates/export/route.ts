import { handleApi } from '@/lib/server';
import { selectedPublicCandidates } from '@/lib/platform-server';
import { createCandidatesPdf, pdfResponse } from '@/lib/pdf';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handleApi(async () => { const candidates = await selectedPublicCandidates((new URL(request.url).searchParams.get('ids') || '').split(',').filter(Boolean)); return pdfResponse(await createCandidatesPdf(candidates, request), 'jiahe-candidates.pdf'); });
}
