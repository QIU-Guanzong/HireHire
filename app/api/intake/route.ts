import { ApiError, applyRateLimit, db, handleApi, hash, json, readJson, requireSameOrigin, validateIntake } from '@/lib/server';
import { selectedPublicCandidates } from '@/lib/platform-server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleApi(async () => {
    requireSameOrigin(request);
    const { kind, data, idempotencyKey, candidateIds, photo } = validateIntake(await readJson(request, 131072));
    const idempotencyHash = await hash(idempotencyKey);
    const tokenHash = photo ? await hash(photo.token) : '';
    const requestHash = await hash(JSON.stringify({ kind, data, ...(candidateIds.length ? { candidateIds } : {}), ...(photo ? { photo: { id: photo.id, tokenHash } } : {}) }));
    const previous = await db().prepare('SELECT reference, request_hash, data_json, original_data_json FROM intake_records WHERE idempotency_hash = ?').bind(idempotencyHash).first<{ reference: string; request_hash: string; data_json: string; original_data_json: string | null }>();
    if (previous) {
      let same = previous.request_hash === requestHash;
      // Keep pending submissions from the original form retryable after fields
      // are added. Original values and their immutable hash must still match.
      if (!same && !photo && !candidateIds.length) {
        const original = JSON.parse(previous.original_data_json || previous.data_json);
        const onlyEmptyAdditions = Object.keys(data).filter(key => !(key in original)).every(key => data[key] === '' || data[key] === false || data[key] === '[]' || Array.isArray(data[key]) && (data[key] as string[]).length === 0);
        same = onlyEmptyAdditions && Object.keys(original).every(key => JSON.stringify(original[key]) === JSON.stringify(data[key])) && await hash(JSON.stringify({ kind, data: original })) === previous.request_hash;
      }
      if (!same) throw new ApiError(409, '此登記已提交，請重新開始以登記其他資料。');
      return json({ reference: previous.reference });
    }
    if (candidateIds.length) {
      try { await selectedPublicCandidates(candidateIds); }
      catch { throw new ApiError(400, '部分人選已停止公開，請檢查所選人選後再提交。', { candidateIds: '請移除已停止公開的人選，其他資料仍可保留。' }); }
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (photo) {
      const uploaded = await db().prepare('SELECT id FROM intake_photos WHERE id = ? AND token_hash = ? AND expires_at > ? AND attached_record_id IS NULL').bind(photo.id, tokenHash, nowSeconds).first();
      if (!uploaded) throw new ApiError(400, '照片已過期或已使用，請重新上載。', { photo: '請重新上載照片。' });
    }
    await applyRateLimit(request);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/-/g, '');
    const reference = `JH-${kind === 'jobseeker' ? 'J' : 'E'}-${day}-${id.slice(0, 8).toUpperCase()}`;
    const searchText = [reference, ...Object.values(data).map(value => Array.isArray(value) ? value.join(' ') : String(value))].join(' ').toLowerCase();
    const conditions: string[] = [], guards: (string | number)[] = [];
    if (photo) { conditions.push('EXISTS (SELECT 1 FROM intake_photos WHERE id = ? AND token_hash = ? AND expires_at > unixepoch() AND attached_record_id IS NULL)'); guards.push(photo.id, tokenHash); }
    if (candidateIds.length) {
      conditions.push(`(SELECT COUNT(*) FROM candidate_publications p JOIN intake_records j ON j.id = p.intake_id WHERE p.id IN (${candidateIds.map(() => '?').join(',')}) AND p.state = 'published' AND json_extract(j.data_json, '$.publicProfileConsent') = 1) = ?`); guards.push(...candidateIds, candidateIds.length);
    }
    const commands = [db().prepare(`INSERT INTO intake_records (id, reference, kind, data_json, search_text, status, notes, created_at, updated_at, idempotency_hash, request_hash, photo_id, requested_candidate_ids)
      SELECT ?, ?, ?, ?, ?, '新登記', '', ?, ?, ?, ?, ?, ?${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} ON CONFLICT(idempotency_hash) DO NOTHING`).bind(id, reference, kind, JSON.stringify(data), searchText, now, now, idempotencyHash, requestHash, photo?.id || '', JSON.stringify(candidateIds), ...guards)];
    if (photo) commands.push(db().prepare('UPDATE intake_photos SET attached_record_id = ? WHERE id = ? AND token_hash = ? AND attached_record_id IS NULL AND EXISTS (SELECT 1 FROM intake_records WHERE id = ?)').bind(id, photo.id, tokenHash, id));
    for (const candidateId of candidateIds) commands.push(db().prepare(`INSERT INTO record_matches (id, employer_id, jobseeker_id, stage, notes, interview_at, created_at, updated_at) SELECT ?, ?, p.intake_id, '待聯絡', '', '', ?, ? FROM candidate_publications p WHERE p.id = ? AND EXISTS (SELECT 1 FROM intake_records WHERE id = ?) ON CONFLICT(employer_id, jobseeker_id) DO NOTHING`).bind(crypto.randomUUID(), id, now, now, candidateId, id));
    await db().batch(commands);
    // Resolve concurrent retries against the same key without duplicating a record.
    const saved = await db().prepare('SELECT reference, request_hash FROM intake_records WHERE idempotency_hash = ?').bind(idempotencyHash).first<{ reference: string; request_hash: string }>();
    if (!saved) throw new ApiError(400, '人選或照片狀態已更新，請檢查後再提交。', { ...(photo ? { photo: '請重新上載照片。' } : {}), ...(candidateIds.length ? { candidateIds: '請重新檢查所選人選。' } : {}) });
    if (saved.request_hash !== requestHash) throw new ApiError(409, '此登記已提交，請重新開始以登記其他資料。');
    return json({ reference: saved.reference }, 201);
  });
}
