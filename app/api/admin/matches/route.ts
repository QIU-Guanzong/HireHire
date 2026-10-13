import { ApiError, assertKeys, db, handleApi, json, readJson, requireAdmin, requireSameOrigin } from '@/lib/server';
import { assertMatchKinds, getMatch, listMatches, uuid, validateMatch } from '@/lib/platform-server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handleApi(async () => { requireAdmin(request); return json(await listMatches(new URL(request.url))); }); }
export async function POST(request: Request) {
  return handleApi(async () => {
    requireAdmin(request); requireSameOrigin(request);
    const body = await readJson(request); assertKeys(body, ['employerId', 'jobseekerId', 'stage', 'notes', 'interviewAt']);
    if (!uuid(body.employerId) || !uuid(body.jobseekerId)) throw new ApiError(400, '請選擇有效的僱主及求職者。');
    await assertMatchKinds(body.employerId, body.jobseekerId);
    const details = validateMatch(body), id = crypto.randomUUID(), now = new Date().toISOString();
    const existing = await db().prepare('SELECT id FROM record_matches WHERE employer_id = ? AND jobseeker_id = ?').bind(body.employerId, body.jobseekerId).first<{ id: string }>();
    if (existing) return json(await getMatch(existing.id));
    await db().prepare('INSERT INTO record_matches (id, employer_id, jobseeker_id, stage, notes, interview_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(employer_id, jobseeker_id) DO NOTHING').bind(id, body.employerId, body.jobseekerId, details.stage, details.notes, details.interviewAt, now, now).run();
    const saved = await db().prepare('SELECT id FROM record_matches WHERE employer_id = ? AND jobseeker_id = ?').bind(body.employerId, body.jobseekerId).first<{ id: string }>();
    if (!saved) throw new ApiError(503, '未能建立配對，請重試。');
    return json(await getMatch(saved.id), 201);
  });
}
