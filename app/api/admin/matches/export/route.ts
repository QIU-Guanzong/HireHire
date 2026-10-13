import { ApiError, getRecord, handleApi, requireAdmin } from '@/lib/server';
import { exportPaging, listMatches, snapshotTime } from '@/lib/platform-server';
import { createRecordsPdf, pdfResponse } from '@/lib/pdf';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handleApi(async () => {
    requireAdmin(request); const url = new URL(request.url), mode = url.searchParams.get('mode') || 'client';
    if (mode !== 'full' && mode !== 'client') throw new ApiError(400, 'PDF版本無效。');
    const employer = await getRecord(url.searchParams.get('employerId') || '');
    if (employer.kind !== 'employer') throw new ApiError(400, '請選擇僱主資料。');
    const { batch, batchSize, explicitBatch } = exportPaging(url), asOf = snapshotTime(url);
    const query = new URL(`/api/admin/matches?employerId=${employer.id}&page=${batch}&asOf=${encodeURIComponent(asOf)}`, url.origin);
    const result = await listMatches(query, batchSize, true), batches = Math.max(1, Math.ceil(result.total / batchSize));
    if (batch > batches) throw new ApiError(400, `下載批次無效，目前共${batches}批。`);
    if (result.total > batchSize && !explicitBatch) throw new ApiError(413, `共有${result.total}位配對人選，請選擇批次下載，每批最多${batchSize}位。`);
    if (!result.matches.length) throw new ApiError(404, '此僱主尚未有配對人選。');
    const records = [employer]; for (const match of result.matches) records.push(await getRecord(match.jobseekerId));
    const response = pdfResponse(await createRecordsPdf(records, mode, request, result.matches), `jiahe-matches-${employer.reference}${explicitBatch ? `-batch-${batch}-of-${batches}` : ''}.pdf`);
    response.headers.set('X-Export-Records', String(records.length)); response.headers.set('X-Export-Total', String(result.total));
    response.headers.set('X-Export-Batch', String(batch)); response.headers.set('X-Export-Batch-Size', String(batchSize));
    response.headers.set('X-Export-Batches', String(batches)); response.headers.set('X-Export-As-Of', asOf);
    return response;
  });
}
