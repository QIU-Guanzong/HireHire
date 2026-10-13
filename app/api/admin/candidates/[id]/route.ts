import { ApiError, assertKeys, db, handleApi, json, readJson, requireAdmin, requireSameOrigin } from '@/lib/server';
import { assertVersion, publicationById, publicationDto, updatedVersion, validatePublicProfile } from '@/lib/platform-server';
import { publicationStates } from '@/lib/platform-types';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return handleApi(async () => { requireAdmin(request); return json(publicationDto(await publicationById((await context.params).id))); }); }
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    requireAdmin(request); requireSameOrigin(request);
    const row = await publicationById((await context.params).id);
    const body = await readJson(request, 131072); assertKeys(body, ['profile', 'state', 'expectedUpdatedAt']); assertVersion(body.expectedUpdatedAt, row.updated_at);
    if (body.profile === undefined && body.state === undefined) throw new ApiError(400, '請選擇要修改的內容。');
    const state = body.state ?? row.state;
    if (typeof state !== 'string' || !publicationStates.includes(state as typeof publicationStates[number])) throw new ApiError(400, '公開狀態無效。');
    const profile = validatePublicProfile(body.profile ?? JSON.parse(row.profile_json));
    if (state === 'published' && JSON.parse(row.source_data_json).publicProfileConsent !== true) throw new ApiError(400, '求職者尚未同意公開簡介，不能發布。');
    if (state === 'published' && (!profile.services.length || !profile.languages.length || !profile.summary)) throw new ApiError(400, '發布前請填寫服務、語言及公開介紹。');
    const result = await db().prepare(`UPDATE candidate_publications SET profile_json = ?, state = ?, updated_at = ? WHERE id = ? AND updated_at = ?${state === 'published' ? " AND EXISTS (SELECT 1 FROM intake_records i WHERE i.id = intake_id AND json_extract(i.data_json, '$.publicProfileConsent') = 1)" : ''}`).bind(JSON.stringify(profile), state, updatedVersion(row.updated_at), row.id, body.expectedUpdatedAt).run();
    if (!result.meta.changes) throw new ApiError(409, '資料或公開同意已更新，請重新載入。');
    return json(publicationDto(await publicationById(row.id)));
  });
}
