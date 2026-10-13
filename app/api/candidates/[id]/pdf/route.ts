import { handleApi } from '@/lib/server';
import { publicationById, publicDto } from '@/lib/platform-server';
import { createCandidatesPdf, pdfResponse } from '@/lib/pdf';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => { const candidate = publicDto(await publicationById((await context.params).id, true)); return pdfResponse(await createCandidatesPdf([candidate], request), `jiahe-candidate-${candidate.id.slice(0, 8)}.pdf`); });
}
