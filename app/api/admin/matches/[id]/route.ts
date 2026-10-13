import { ApiError, assertKeys, db, handleApi, json, readJson, requireAdmin, requireSameOrigin } from '@/lib/server';
import { assertVersion, getMatch, updatedVersion, validateMatch } from '@/lib/platform-server';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleApi(async () => {
    requireAdmin(request); requireSameOrigin(request);
    const match = await getMatch((await context.params).id), body = await readJson(request);
    assertKeys(body, ['stage', 'notes', 'interviewAt', 'expectedUpdatedAt']); assertVersion(body.expectedUpdatedAt, match.updatedAt);
    const data = validateMatch(body, true);
    if (!Object.keys(data).length) throw new ApiError(400, '請選擇要更新的配對資料。');
    const result = await db().prepare('UPDATE record_matches SET stage = ?, notes = ?, interview_at = ?, updated_at = ? WHERE id = ? AND updated_at = ?').bind(data.stage ?? match.stage, data.notes ?? match.notes, data.interviewAt ?? match.interviewAt, updatedVersion(match.updatedAt), match.id, body.expectedUpdatedAt).run();
    if (!result.meta.changes) throw new ApiError(409, '配對已有其他更新，請重新載入。');
    return json(await getMatch(match.id));
  });
}
