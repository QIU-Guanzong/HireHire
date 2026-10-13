import { ApiError, assertKeys, db, getRecord, handleApi, json, readJson, requireAdmin, requireSameOrigin, validateData } from '@/lib/server';
import { optionalDate } from '@/lib/platform-server';
import { statuses } from '@/lib/fields';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return handleApi(async () => { requireAdmin(request); return json(await getRecord((await context.params).id)); });
}
export async function PATCH(request: Request, context: Context) {
  return handleApi(async () => {
    requireAdmin(request); requireSameOrigin(request);
    const id = (await context.params).id;
    const record = await getRecord(id);
    const body = await readJson(request, 131072); assertKeys(body, ['status', 'notes', 'data', 'nextFollowUp', 'expectedUpdatedAt']);
    if (body.status === undefined && body.notes === undefined && body.data === undefined && body.nextFollowUp === undefined) throw new ApiError(400, '請選擇要更新的資料。');
    if (typeof body.expectedUpdatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.expectedUpdatedAt)) throw new ApiError(400, '請重新載入資料後再修改。');
    if (body.expectedUpdatedAt !== record.updatedAt) throw new ApiError(409, '資料已由其他管理員更新，請重新載入後再修改。');
    if (body.status !== undefined && (typeof body.status !== 'string' || !statuses.includes(body.status))) throw new ApiError(400, '跟進狀態無效。');
    if (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 4000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(body.notes))) throw new ApiError(400, '備註最多可填寫4000個字。');
    const data = body.data === undefined ? record.data : validateData(record.kind, body.data);
    if (data.publicProfileConsent === true && record.data.publicProfileConsent !== true) throw new ApiError(400, '公開同意須由求職者登記時提供，後台不能代為授予。', { publicProfileConsent: '可撤回同意，不能代為授予。' });
    const nextFollowUp = body.nextFollowUp === undefined ? record.nextFollowUp : optionalDate(body.nextFollowUp, '下次跟進', true);
    const searchText = [record.reference, ...Object.values(data).map(value => Array.isArray(value) ? value.join(' ') : String(value))].join(' ').toLowerCase();
    const updatedAt = new Date(Math.max(Date.now(), new Date(record.updatedAt).getTime() + 1)).toISOString();
    const result = await db().prepare('UPDATE intake_records SET status = ?, notes = ?, next_follow_up = ?, original_data_json = CASE WHEN ? = 1 THEN COALESCE(original_data_json, data_json) ELSE original_data_json END, data_json = ?, search_text = ?, updated_at = ? WHERE id = ? AND updated_at = ?').bind(body.status ?? record.status, body.notes ?? record.notes, nextFollowUp, body.data === undefined ? 0 : 1, JSON.stringify(data), searchText, updatedAt, id, body.expectedUpdatedAt).run();
    if (result.meta.changes === 0) throw new ApiError(409, '資料已由其他管理員更新，請重新載入後再修改。');
    return json(await getRecord(id));
  });
}
