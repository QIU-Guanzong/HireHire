import { assertKeys, db, getRecord, handleApi, json, readJson, requireAdmin, requireSameOrigin, ApiError } from '@/lib/server';
import { adminPublications, draftProfile, publicationById, publicationDto, uuid } from '@/lib/platform-server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handleApi(async () => { requireAdmin(request); return json(await adminPublications(new URL(request.url))); }); }
export async function POST(request: Request) {
  return handleApi(async () => {
    requireAdmin(request); requireSameOrigin(request);
    const body = await readJson(request); assertKeys(body, ['intakeId']);
    if (!uuid(body.intakeId)) throw new ApiError(400, '求職者編號無效。');
    const record = await getRecord(body.intakeId);
    if (record.kind !== 'jobseeker') throw new ApiError(400, '只可為求職者建立公開簡介。');
    const existing = await db().prepare('SELECT id FROM candidate_publications WHERE intake_id = ?').bind(record.id).first<{ id: string }>();
    if (existing) return json(publicationDto(await publicationById(existing.id)));
    const id = crypto.randomUUID(), now = new Date().toISOString();
    await db().prepare("INSERT INTO candidate_publications (id, intake_id, profile_json, state, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?) ON CONFLICT(intake_id) DO NOTHING").bind(id, record.id, JSON.stringify(draftProfile(record)), now, now).run();
    const saved = await db().prepare('SELECT id FROM candidate_publications WHERE intake_id = ?').bind(record.id).first<{ id: string }>();
    if (!saved) throw new ApiError(503, '未能建立公開簡介，請重試。');
    return json(publicationDto(await publicationById(saved.id)), 201);
  });
}
