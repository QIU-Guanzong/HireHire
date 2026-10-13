import { ApiError, db, filteredRecords, handleApi, json, recordCount, recordFilters, requireAdmin } from '@/lib/server';
import { statuses } from '@/lib/fields';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return handleApi(async () => {
    requireAdmin(request);
    const url = new URL(request.url);
    const asOf = url.searchParams.get('asOf') || new Date().toISOString();
    url.searchParams.set('asOf', asOf);
    const pageText = url.searchParams.get('page') || '1';
    if (!/^[1-9]\d{0,5}$/.test(pageText)) throw new ApiError(400, '頁碼無效。');
    const page = Number(pageText); const pageSize = 20;
    const filter = recordFilters(url);
    const [records, total, grouped] = await Promise.all([
      filteredRecords(filter, pageSize, (page - 1) * pageSize), recordCount(filter),
      db().prepare('SELECT kind, status, COUNT(*) AS total FROM intake_records GROUP BY kind, status').all<{kind:string;status:string;total:number}>(),
    ]);
    const counts = { all: 0, total: 0, new: 0, jobseeker: 0, employer: 0, statuses: Object.fromEntries(statuses.map(status => [status, 0])) };
    for (const group of grouped.results) {
      counts.all += group.total; counts.total += group.total;
      if (group.kind === 'jobseeker' || group.kind === 'employer') counts[group.kind] += group.total;
      if (group.status === '新登記') counts.new += group.total;
      if (group.status in counts.statuses) counts.statuses[group.status] += group.total;
    }
    return json({ records, total, counts, page, pageSize, asOf });
  });
}
