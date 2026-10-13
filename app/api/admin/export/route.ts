import { createRecordsPdf } from '@/lib/pdf';
import { ApiError, filteredRecords, getRecord, handleApi, recordCount, recordFilters, requireAdmin } from '@/lib/server';
import { exportPaging } from '@/lib/platform-server';
export const dynamic = 'force-dynamic';
const maximumRecords = 100;
export async function GET(request: Request) {
  return handleApi(async () => {
    requireAdmin(request);
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode') || 'client';
    if (mode !== 'full' && mode !== 'client') throw new ApiError(400, 'PDF類型無效。');
    const ids = url.searchParams.get('ids');
    const { batch, batchSize, explicitBatch } = exportPaging(url);
    let total = 0; let batches = 1;
    const asOf = url.searchParams.get('asOf') || new Date().toISOString();
    url.searchParams.set('asOf', asOf);
    const filter = recordFilters(url);
    let records;
    if (ids) {
      if (explicitBatch) throw new ApiError(400, '已選資料不需要指定下載批次。');
      const selected = [...new Set(ids.split(',').filter(Boolean))];
      if (!selected.length || selected.length > maximumRecords) throw new ApiError(400, `每次最多可匯出${maximumRecords}份資料，請分批下載。`);
      records = [];
      for (const id of selected) records.push(await getRecord(id));
      total = records.length;
    } else {
      if (url.searchParams.get('scope') !== 'all') throw new ApiError(400, '請選擇要下載的資料。');
      total = await recordCount(filter);
      batches = Math.max(1, Math.ceil(total / batchSize));
      if (batch > batches) throw new ApiError(400, `下載批次無效，目前共${batches}批。`);
      if (total > batchSize && !explicitBatch) throw new ApiError(413, `符合條件的資料有${total}份，共${batches}批；請選擇批次下載，每批最多${batchSize}份。`);
      records = await filteredRecords(filter, explicitBatch ? batchSize : batchSize + 1, (batch - 1) * batchSize);
      // A concurrent intake must never make an export silently truncate.
      if (records.length > batchSize) throw new ApiError(413, `每次最多可匯出${batchSize}份資料，請分批下載。`);
    }
    if (!records.length) throw new ApiError(404, '沒有可下載的資料。');
    const bytes = await createRecordsPdf(records, mode, request);
    return new Response(bytes as unknown as BodyInit, { headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="jiahe-${mode}-${new Date().toISOString().slice(0, 10)}${explicitBatch ? `-batch-${batch}-of-${batches}` : ''}.pdf"`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'X-Export-Records': String(records.length), 'Referrer-Policy': 'same-origin',
      'X-Export-Total': String(total), 'X-Export-Batch': String(batch),
      'X-Export-Batches': String(batches), 'X-Export-As-Of': asOf,
      'X-Export-Batch-Size': String(batchSize),
    } });
  });
}
