import { env } from 'cloudflare:workers';
import { ApiError, applyRateLimit, db, handleApi, hash, json, requireSameOrigin } from '@/lib/server';
import { imageDimensions } from '@/lib/platform-server';
export const dynamic = 'force-dynamic';
const maximumBytes = 2 * 1024 * 1024;
export async function POST(request: Request) {
  return handleApi(async () => {
    requireSameOrigin(request);
    if (!env.BUCKET) throw new ApiError(503, '照片上載暫未開放，可先提交其他資料。');
    const type = (request.headers.get('content-type') || '').split(';')[0].trim();
    if (!['image/jpeg', 'image/png'].includes(type)) throw new ApiError(415, '請上載JPEG或PNG照片。');
    if (Number(request.headers.get('content-length') || 0) > maximumBytes) throw new ApiError(413, '照片不可大於2MB。');
    await applyRateLimit(request);
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, '請選擇照片。');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const result = await reader.read(); if (result.done) break; size += result.value.byteLength; if (size > maximumBytes) { await reader.cancel(); throw new ApiError(413, '照片不可大於2MB。'); } chunks.push(result.value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const dimensions = imageDimensions(bytes, type);
    if (!dimensions.width || !dimensions.height || dimensions.width > 1600 || dimensions.height > 1600) throw new ApiError(400, '照片長邊不可超過1600像素。');
    const id = crypto.randomUUID(), token = crypto.randomUUID(), objectKey = `intake-photos/${id}`, now = Math.floor(Date.now() / 1000);
    await env.BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: type } });
    try { await db().prepare('INSERT INTO intake_photos (id, token_hash, object_key, content_type, byte_length, expires_at, attached_record_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)').bind(id, await hash(token), objectKey, type, bytes.length, now + 86400, new Date().toISOString()).run(); }
    catch (error) { await env.BUCKET.delete(objectKey); throw error; }
    // Expired unsubmitted uploads are rebuildable and never become records.
    const expired = await db().prepare('SELECT id FROM intake_photos WHERE attached_record_id IS NULL AND expires_at <= unixepoch() LIMIT 10').all<{ id: string }>();
    for (const photo of expired.results) {
      // Claim the expired metadata atomically before touching the object. A
      // concurrent successful attachment must always preserve its portrait.
      const removed = await db().prepare('DELETE FROM intake_photos WHERE id = ? AND attached_record_id IS NULL AND expires_at <= unixepoch() RETURNING object_key').bind(photo.id).first<{ object_key: string }>();
      if (removed) await env.BUCKET.delete(removed.object_key);
    }
    return json({ id, token }, 201);
  });
}
