import { env, runtimeSession, expectedOrigin, clientIp, writesEnabled } from './runtime';
import { allFields, isFieldVisible, statuses, type IntakeData, type IntakeKind, type IntakeRecord } from './fields';

export class ApiError extends Error {
  status: number;
  fields?: Record<string, string>;
  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message); this.status = status; this.fields = fields;
  }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  } });
}

export async function handleApi(operation: () => Promise<Response>) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof ApiError) return json({ error: error.message, ...(error.fields ? { fields: error.fields } : {}) }, error.status);
    // Personal data, request bodies and database errors must not be logged.
    return json({ error: '暫時未能處理，請稍後再試。' }, 503);
  }
}

export function db(): D1Database {
  if (!env.DB) throw new ApiError(503, '登記服務暫時未能使用，請稍後再試。');
  return env.DB;
}

export function adminSession(request: Request) {
  return runtimeSession(request);
}

export function requireAdmin(request: Request) {
  const session = adminSession(request);
  if (!session.authenticated) throw new ApiError(401, '請先登入管理帳戶。');
  if (!session.authorized) throw new ApiError(403, session.configured ? '此帳戶沒有後台權限。' : '管理帳戶尚未設定。');
  return session;
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== expectedOrigin(request) || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ApiError(403, '請從本站提交資料。');
  }
  if (!writesEnabled()) throw new ApiError(503, '資料提交暫未開放，請稍後再試。');
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const safeText = (value: string) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);

export async function readJson(request: Request, maximumBytes = 32768): Promise<Record<string, unknown>> {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) throw new ApiError(415, '請以表格提交資料。');
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > maximumBytes) throw new ApiError(413, '資料過長，請縮短後再提交。');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, '請填寫登記資料。');
  const chunks: Uint8Array[] = []; let bytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    bytes += result.value.byteLength;
    if (bytes > maximumBytes) { await reader.cancel(); throw new ApiError(413, '資料過長，請縮短後再提交。'); }
    chunks.push(result.value);
  }
  const merged = new Uint8Array(bytes); let position = 0;
  for (const chunk of chunks) { merged.set(chunk, position); position += chunk.byteLength; }
  try {
    const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(merged));
    if (!isObject(result)) throw new Error('shape');
    return result;
  } catch { throw new ApiError(400, '資料格式不正確，請重新提交。'); }
}

export function assertKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new ApiError(400, '資料包含未支援的欄位。');
}

export function validateData(kind: IntakeKind, input: unknown) {
  if (!isObject(input)) throw new ApiError(400, '請填寫登記資料。');
  const fields = allFields(kind);
  assertKeys(input, [...fields.map(field => field.name), 'consent']);
  const errors: Record<string, string> = {};
  const data: IntakeData = {};
  for (const field of fields) {
    const value = input[field.name];
    if (!isFieldVisible(field, input as IntakeData)) { data[field.name] = field.type === 'checkboxes' ? [] : ''; continue; }
    if (field.type === 'boolean') {
      if (value !== undefined && typeof value !== 'boolean') errors[field.name] = `請選擇有效的${field.label}。`;
      data[field.name] = value === true; continue;
    }
    if (field.type === 'experience') {
      if (value === undefined || value === '') { data[field.name] = '[]'; continue; }
      if (typeof value !== 'string' || value.length > (field.max || 18000)) { errors[field.name] = '工作經歷內容過長。'; continue; }
      try { data[field.name] = JSON.stringify(validateWorkExperiences(JSON.parse(value))); }
      catch { errors[field.name] = '請檢查工作經歷，每份須填寫地區及主要工作，日期順序須正確。'; }
      continue;
    }
    if (field.type === 'checkboxes') {
      if (value === undefined && !field.required) { data[field.name] = []; continue; }
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !field.options?.includes(item)) || new Set(value).size !== value.length) {
        errors[field.name] = `請選擇有效的${field.label}。`; continue;
      }
      if (field.required && value.length === 0) errors[field.name] = `請選擇${field.label}。`;
      data[field.name] = value as string[];
      continue;
    }
    if (value === undefined && !field.required) { data[field.name] = ''; continue; }
    if (typeof value !== 'string') { errors[field.name] = `請填寫有效的${field.label}。`; continue; }
    const text = value.trim().normalize('NFC');
    const max = field.max ?? (field.type === 'number' ? 20 : 200);
    if (!safeText(text) || text.length > max) { errors[field.name] = `${field.label}最多可填寫${max}個字。`; continue; }
    if (!text) {
      if (field.required) errors[field.name] = `請填寫${field.label}。`;
      data[field.name] = ''; continue;
    }
    if (field.type === 'select' && !field.options?.includes(text)) errors[field.name] = `請選擇有效的${field.label}。`;
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) errors[field.name] = '請填寫有效的電郵地址。';
    if (field.type === 'tel' && (!/^[+\d\s().-]+$/.test(text) || text.replace(/\D/g, '').length < 8 || text.replace(/\D/g, '').length > 20)) errors[field.name] = '請填寫有效的聯絡電話（8至20位數字）。';
    if (field.type === 'date') {
      const date = new Date(`${text}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text || text < '2000-01-01' || text > '2100-12-31') errors[field.name] = '請填寫有效日期。';
    }
    if (field.type === 'number') {
      const number = Number(text);
      const integerField = ['householdAdults', 'homeSize', 'age', 'serviceDays'].includes(field.name);
      const maximum = field.name === 'householdAdults' ? 30 : field.name === 'homeSize' ? 100000 : field.name === 'age' ? 100 : field.name === 'serviceDays' ? 365 : 1000000;
      const minimum = field.name === 'age' ? 18 : .01;
      if (!/^\d+(\.\d{1,2})?$/.test(text) || !Number.isFinite(number) || number < minimum || number > maximum || (integerField && !Number.isInteger(number))) errors[field.name] = `請填寫有效的${field.label}（${integerField ? Math.max(1, minimum) : minimum}至${maximum}）。`;
    }
    data[field.name] = text;
  }
  if (kind === 'jobseeker' && !String(data.workHistory || '').trim() && (!data.workExperienceJson || data.workExperienceJson === '[]')) errors.workHistory = '請填寫工作經歷或補充經驗；首次求職可填寫「首次求職」。';
  if (input.consent !== true) errors.consent = '請同意資料用於聯絡及服務配對。';
  data.consent = true;
  if (Object.keys(errors).length) throw new ApiError(400, '請檢查表格內的資料。', errors);
  return data;
}

export function validateWorkExperiences(input: unknown) {
  if (!Array.isArray(input) || input.length > 8) throw new ApiError(400, '最多填寫8份工作經歷。');
  return input.map(entry => {
    if (!isObject(entry)) throw new ApiError(400, '工作經歷格式不正確。');
    assertKeys(entry, ['country', 'from', 'to', 'household', 'duties', 'leavingReason']);
    const result: Record<string, string> = {};
    for (const key of ['country', 'from', 'to', 'household', 'duties', 'leavingReason']) {
      const value = entry[key] ?? '';
      if (typeof value !== 'string' || !safeText(value) || value.length > (key === 'duties' ? 1500 : key === 'country' ? 80 : 600)) throw new ApiError(400, '工作經歷內容不正確。');
      result[key] = value.trim();
    }
    if (!result.country || !result.duties) throw new ApiError(400, '請填寫工作地區及主要工作。');
    for (const key of ['from', 'to']) if (result[key] && !/^\d{4}-(0[1-9]|1[0-2])$/.test(result[key])) throw new ApiError(400, '工作經歷日期須為年月。');
    if (result.from && result.to && result.from > result.to) throw new ApiError(400, '工作結束月份不可早於開始月份。');
    return result as { country: string; from: string; to: string; household: string; duties: string; leavingReason: string };
  });
}

export function validateIntake(body: Record<string, unknown>) {
  assertKeys(body, ['kind', 'data', 'idempotencyKey', 'website', 'candidateIds', 'photo']);
  if (body.kind !== 'jobseeker' && body.kind !== 'employer') throw new ApiError(400, '請選擇登記類型。');
  if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(body.idempotencyKey)) throw new ApiError(400, '登記識別碼無效，請重新整理後再試。');
  if (body.website !== undefined && body.website !== '') throw new ApiError(400, '未能提交，請重新填寫。');
  const data = validateData(body.kind, body.data);
  const candidateIds = body.candidateIds ?? [];
  if (!Array.isArray(candidateIds) || candidateIds.length > 3 || new Set(candidateIds).size !== candidateIds.length || candidateIds.some(id => typeof id !== 'string' || !/^[a-f\d-]{36}$/.test(id)) || (candidateIds.length && body.kind !== 'employer')) throw new ApiError(400, '最多選擇3位有效人選。', { candidateIds: '請重新選擇人選。' });
  let photo: { id: string; token: string } | undefined;
  if (body.photo !== undefined) {
    if (body.kind !== 'jobseeker' || !isObject(body.photo)) throw new ApiError(400, '照片資料無效。', { photo: '請重新上載照片。' });
    assertKeys(body.photo, ['id', 'token']);
    if (typeof body.photo.id !== 'string' || !/^[a-f\d-]{36}$/.test(body.photo.id) || typeof body.photo.token !== 'string' || !/^[a-f\d-]{36}$/.test(body.photo.token)) throw new ApiError(400, '照片資料無效。', { photo: '請重新上載照片。' });
    photo = { id: body.photo.id, token: body.photo.token };
  }
  return { kind: body.kind as IntakeKind, data, idempotencyKey: body.idempotencyKey, candidateIds: candidateIds as string[], photo };
}

export async function hash(text: string) {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, '0')).join('');
}

export async function applyRateLimit(request: Request) {
  const now = Math.floor(Date.now() / 1000);
  const hour = Math.floor(now / 3600);
  const ip = clientIp(request);
  const key = await hash(`${env.RATE_LIMIT_SALT}:${hour}:${ip}`);
  await db().prepare('DELETE FROM intake_rate_limits WHERE expires_at < ?').bind(now).run();
  const result = await db().prepare(`INSERT INTO intake_rate_limits (key, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1 WHERE attempts < 8
    RETURNING attempts`).bind(key, (hour + 1) * 3600).first<{ attempts: number }>();
  if (!result) throw new ApiError(429, '提交次數較多，請稍後再試。');
}

type RecordRow = { id: string; reference: string; kind: IntakeKind; data_json: string; status: string; notes: string; next_follow_up?: string; photo_id?: string; requested_candidate_ids?: string; created_at: string; updated_at: string; request_hash?: string };
export function fromRow(row: RecordRow): IntakeRecord {
  return { id: row.id, reference: row.reference, kind: row.kind, data: JSON.parse(row.data_json) as IntakeData, status: row.status, notes: row.notes, nextFollowUp: row.next_follow_up || '', ...(row.photo_id ? { photoId: row.photo_id } : {}), requestedCandidateIds: JSON.parse(row.requested_candidate_ids || '[]'), createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function getRecord(id: string) {
  if (!/^[a-f\d-]{36}$/.test(id)) throw new ApiError(404, '找不到此登記。');
  const row = await db().prepare('SELECT * FROM intake_records WHERE id = ?').bind(id).first<RecordRow>();
  if (!row) throw new ApiError(404, '找不到此登記。');
  return fromRow(row);
}

export function recordFilters(url: URL) {
  const kind = url.searchParams.get('kind') || '';
  const status = url.searchParams.get('status') || '';
  const q = (url.searchParams.get('q') || '').trim();
  const asOf = url.searchParams.get('asOf') || '';
  if (kind && kind !== 'jobseeker' && kind !== 'employer') throw new ApiError(400, '登記類型無效。');
  if (status && !statuses.includes(status)) throw new ApiError(400, '跟進狀態無效。');
  if (q.length > 160 || !safeText(q)) throw new ApiError(400, '搜尋文字過長。');
  if (asOf && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(asOf) || Number.isNaN(new Date(asOf).getTime()) || new Date(asOf).toISOString() !== asOf)) throw new ApiError(400, '資料時間無效，請重新載入列表。');
  const clauses: string[] = []; const bindings: string[] = [];
  if (kind) { clauses.push('kind = ?'); bindings.push(kind); }
  if (status) { clauses.push('status = ?'); bindings.push(status); }
  if (q) { clauses.push("search_text LIKE ? ESCAPE '\\'"); bindings.push(`%${q.toLowerCase().replace(/[\\%_]/g, match => `\\${match}`)}%`); }
  if (asOf) { clauses.push('created_at <= ?'); bindings.push(asOf); }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', bindings };
}

export async function filteredRecords(filter: ReturnType<typeof recordFilters>, limit: number, offset = 0) {
  const result = await db().prepare(`SELECT * FROM intake_records${filter.sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).bind(...filter.bindings, limit, offset).all<RecordRow>();
  return result.results.map(fromRow);
}

export async function recordCount(filter: ReturnType<typeof recordFilters>) {
  const result = await db().prepare(`SELECT COUNT(*) AS total FROM intake_records${filter.sql}`).bind(...filter.bindings).first<{ total: number }>();
  return result?.total || 0;
}
