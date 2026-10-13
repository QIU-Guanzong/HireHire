import { env } from 'cloudflare:workers';
import { allFields, districts, services, type IntakeData, type IntakeRecord } from './fields';
import { ApiError, assertKeys, db, getRecord, safeText, validateWorkExperiences } from './server';
import { candidateAgeRanges, candidateTypes, matchStages, publicationStates, type CandidatePublic, type CandidatePublication, type MatchRecord, type SiteInfo } from './platform-types';

export const publicProfileKeys = ['displayName', 'services', 'nationality', 'candidateType', 'age', 'education', 'currentLocation', 'languages', 'yearsExperience', 'skills', 'employmentType', 'workLocations', 'availableFrom', 'expectedSalary', 'salaryUnit', 'salaryNegotiable', 'summary', 'qualifications', 'workExperiences'] as const;
type Profile = Omit<CandidatePublic, 'id' | 'reference' | 'hasPhoto' | 'updatedAt'>;
type PublicationRow = { id: string; intake_id: string; profile_json: string; state: CandidatePublication['state']; created_at: string; updated_at: string; source_data_json: string; reference: string; photo_id: string };
const publicationSelect = `SELECT p.*, i.data_json AS source_data_json, i.reference, i.photo_id FROM candidate_publications p JOIN intake_records i ON i.id = p.intake_id`;
const object = (input: unknown): input is Record<string, unknown> => input !== null && typeof input === 'object' && !Array.isArray(input);
export const uuid = (id: unknown): id is string => typeof id === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id);
export const updatedVersion = (previous: string) => new Date(Math.max(Date.now(), new Date(previous).getTime() + 1)).toISOString();
export function assertVersion(input: unknown, current: string) {
  if (typeof input !== 'string' || input !== current) throw new ApiError(409, '資料已有其他更新，請載入最新資料後再儲存。');
}
export function textValue(input: unknown, label: string, max = 1000) {
  if (typeof input !== 'string' || input.length > max || !safeText(input)) throw new ApiError(400, `${label}格式不正確或內容過長。`);
  return input.trim().normalize('NFC');
}
export function optionalDate(input: unknown, label: string, withTime = false) {
  const value = textValue(input ?? '', label, 40);
  if (!value) return '';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const dateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?Z)?$/.test(value);
  const day = value.slice(0, 10);
  const date = new Date(`${day}T00:00:00Z`);
  if (!(dateOnly || (withTime && dateTime)) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day || day < '2000-01-01' || day > '2100-12-31') throw new ApiError(400, `${label}日期不正確。`);
  if (dateTime) {
    const hours = Number(value.slice(11, 13)), minutes = Number(value.slice(14, 16));
    const seconds = value.length > 16 ? Number(value.slice(17, 19)) : 0;
    if (hours > 23 || minutes > 59 || seconds > 59 || value.endsWith('Z') && Number.isNaN(new Date(value).getTime())) throw new ApiError(400, `${label}時間不正確。`);
  }
  return value;
}
const contactText = (value: string) => /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(value) || /(?:\+\d{1,3}[ -]?)?(?:\d[ ().-]*){8,}/.test(value);
function publicText(input: unknown, label: string, max = 2000) {
  const value = textValue(input, label, max);
  if (contactText(value)) throw new ApiError(400, `${label}請勿包含電話、電郵或證件號碼。`);
  return value;
}
const fieldOptions = (name: string) => allFields('jobseeker').find(field => field.name === name)?.options || [];
function enumValue(input: unknown, key: string, choices = fieldOptions(key)) {
  const value = textValue(input ?? '', key, 100);
  if (value && !choices.includes(value)) throw new ApiError(400, `${key}選項無效。`);
  return value;
}
function arrayValue(input: unknown, key: string, choices = fieldOptions(key)) {
  if (!Array.isArray(input) || input.some(value => typeof value !== 'string' || !choices.includes(value)) || new Set(input).size !== input.length) throw new ApiError(400, `${key}選項無效。`);
  return input as string[];
}
export function validatePublicProfile(input: unknown): Profile {
  if (!object(input)) throw new ApiError(400, '請填寫公開簡介。');
  assertKeys(input, [...publicProfileKeys]);
  const experience = validateWorkExperiences(input.workExperiences ?? []);
  for (const row of experience) for (const [key, value] of Object.entries(row)) if (!['from', 'to'].includes(key)) publicText(value, '公開工作經歷', 1500);
  const age = textValue(input.age ?? '', '年齡', 3);
  if (age && (!/^\d+$/.test(age) || Number(age) < 18 || Number(age) > 100)) throw new ApiError(400, '年齡須為18至100。');
  const expectedSalary = textValue(input.expectedSalary ?? '', '期望薪金', 20);
  if (expectedSalary && (!/^\d+(\.\d{1,2})?$/.test(expectedSalary) || Number(expectedSalary) <= 0 || Number(expectedSalary) > 1000000)) throw new ApiError(400, '期望薪金格式不正確。');
  if (typeof input.salaryNegotiable !== 'boolean') throw new ApiError(400, '請選擇薪金安排。');
  const displayName = textValue(input.displayName, '顯示名稱', 80);
  if (contactText(displayName) && !/^JH-[A-Z]-\d{8}-[A-F\d]{8}$/.test(displayName)) throw new ApiError(400, '顯示名稱請勿包含聯絡資料。');
  if (!displayName) throw new ApiError(400, '請填寫公開顯示名稱。');
  return {
    displayName, services: arrayValue(input.services, 'services', services),
    nationality: enumValue(input.nationality, 'nationality'), candidateType: enumValue(input.candidateType, 'candidateType', candidateTypes), age,
    education: enumValue(input.education, 'education'), currentLocation: publicText(input.currentLocation ?? '', '所在地', 100),
    languages: arrayValue(input.languages, 'languages'), yearsExperience: enumValue(input.yearsExperience, 'yearsExperience'),
    skills: arrayValue(input.skills, 'skills'), employmentType: enumValue(input.employmentType, 'employmentType'),
    workLocations: arrayValue(input.workLocations, 'workLocations', ['全香港', ...districts]),
    availableFrom: optionalDate(input.availableFrom, '可開始日期'), expectedSalary, salaryUnit: enumValue(input.salaryUnit, 'salaryUnit'),
    salaryNegotiable: input.salaryNegotiable, summary: publicText(input.summary ?? '', '公開介紹', 2000),
    qualifications: publicText(input.qualifications ?? '', '公開資格', 1000), workExperiences: experience,
  };
}
export function draftProfile(record: IntakeRecord): Profile {
  const data = record.data;
  const text = (key: string) => typeof data[key] === 'string' ? data[key] as string : '';
  const array = (key: string) => Array.isArray(data[key]) ? data[key] as string[] : [];
  const summary = text('publicIntroduction');
  const displayName = text('publicName');
  // Private work history and certificates are never copied into a publication.
  return validatePublicProfile({ displayName: displayName && !contactText(displayName) ? displayName : record.reference, services: array('services'), nationality: text('nationality'), candidateType: text('candidateType'), age: text('age'), education: text('education'), currentLocation: contactText(text('currentLocation')) ? '' : text('currentLocation'), languages: array('languages'), yearsExperience: text('yearsExperience'), skills: array('skills'), employmentType: text('employmentType'), workLocations: array('workLocations'), availableFrom: text('availableFrom'), expectedSalary: text('expectedSalary'), salaryUnit: text('salaryUnit'), salaryNegotiable: data.salaryNegotiable === true, summary: contactText(summary) ? '' : summary, qualifications: '', workExperiences: [] });
}
export function publicationDto(row: PublicationRow): CandidatePublication {
  const stored = JSON.parse(row.profile_json) as Record<string, unknown>;
  const profile = validatePublicProfile(Object.fromEntries(publicProfileKeys.map(key => [key, stored[key]])));
  const source = JSON.parse(row.source_data_json) as IntakeData;
  return { ...profile, id: row.id, reference: row.reference, hasPhoto: Boolean(row.photo_id), updatedAt: row.updated_at, intakeId: row.intake_id, state: row.state, consented: source.publicProfileConsent === true, createdAt: row.created_at };
}
export function publicDto(row: PublicationRow): CandidatePublic {
  const { intakeId: _intakeId, state: _state, consented: _consented, createdAt: _createdAt, ...profile } = publicationDto(row);
  void _intakeId; void _state; void _consented; void _createdAt;
  return profile;
}
export async function publicationById(id: string, publicOnly = false) {
  if (!uuid(id)) throw new ApiError(404, '找不到此人選。');
  const row = await db().prepare(`${publicationSelect} WHERE p.id = ?${publicOnly ? " AND p.state = 'published' AND json_extract(i.data_json, '$.publicProfileConsent') = 1" : ''}`).bind(id).first<PublicationRow>();
  if (!row) throw new ApiError(404, '此人選暫未公開或已停止公開。');
  return row;
}
export function candidateQuery(url: URL) {
  const clauses = ["p.state = 'published'", "json_extract(i.data_json, '$.publicProfileConsent') = 1"];
  const bindings: (string | number)[] = [];
  const ids = url.searchParams.get('ids');
  if (ids !== null) {
    const selected = ids.split(',').filter(Boolean);
    if (!selected.length || selected.length > 30 || selected.some(id => !uuid(id)) || new Set(selected).size !== selected.length) throw new ApiError(400, '人選列表無效。');
    clauses.push(`p.id IN (${selected.map(() => '?').join(',')})`); bindings.push(...selected);
  }
  const q = textValue(url.searchParams.get('q') ?? '', '搜尋文字', 160);
  if (q) { const pattern = `%${q.toLowerCase().replace(/[\\%_]/g, match => `\\${match}`)}%`; clauses.push("(lower(p.profile_json) LIKE ? ESCAPE '\\' OR lower(i.reference) LIKE ? ESCAPE '\\')"); bindings.push(pattern, pattern); }
  const filters: Record<string, [string, string[]]> = {
    service: ['services', services], nationality: ['nationality', fieldOptions('nationality')], candidateType: ['candidateType', candidateTypes], language: ['languages', fieldOptions('languages')], experience: ['yearsExperience', fieldOptions('yearsExperience')], employmentType: ['employmentType', fieldOptions('employmentType')], district: ['workLocations', districts], education: ['education', fieldOptions('education')], skill: ['skills', fieldOptions('skills')],
  };
  for (const [parameter, [field, options]] of Object.entries(filters)) {
    const value = url.searchParams.get(parameter) || ''; if (!value) continue;
    if (!options.includes(value)) throw new ApiError(400, '搜尋條件無效。');
    if (['services', 'languages', 'workLocations', 'skills'].includes(field)) {
      clauses.push(`EXISTS (SELECT 1 FROM json_each(p.profile_json, '$.${field}') WHERE value = ?${field === 'workLocations' ? " OR value = '全香港'" : ''})`);
    } else clauses.push(`json_extract(p.profile_json, '$.${field}') = ?`);
    bindings.push(value);
  }
  const ageRange = url.searchParams.get('ageRange') || '';
  if (ageRange) {
    const range = candidateAgeRanges.find(range => range.value === ageRange);
    if (!range) throw new ApiError(400, '年齡條件無效。');
    clauses.push("CAST(json_extract(p.profile_json, '$.age') AS INTEGER) BETWEEN ? AND ?");
    bindings.push(range.min, range.max);
  }
  const sort = url.searchParams.get('sort') || 'newest';
  const orders: Record<string, string> = {
    newest: 'p.updated_at DESC, p.id DESC', oldest: 'p.updated_at ASC, p.id ASC', available: "CASE WHEN json_extract(p.profile_json, '$.availableFrom') = '' THEN 1 ELSE 0 END, json_extract(p.profile_json, '$.availableFrom') ASC, p.id DESC",
    'salary-asc': "CASE WHEN json_extract(p.profile_json, '$.expectedSalary') = '' THEN 1 ELSE 0 END, CAST(json_extract(p.profile_json, '$.expectedSalary') AS REAL) ASC, p.id DESC",
    'salary-desc': "CAST(json_extract(p.profile_json, '$.expectedSalary') AS REAL) DESC, p.id DESC",
    'age-asc': "CASE WHEN coalesce(json_extract(p.profile_json, '$.age'), '') = '' THEN 1 ELSE 0 END, CAST(json_extract(p.profile_json, '$.age') AS INTEGER) ASC, p.id DESC",
    'age-desc': "CASE WHEN coalesce(json_extract(p.profile_json, '$.age'), '') = '' THEN 1 ELSE 0 END, CAST(json_extract(p.profile_json, '$.age') AS INTEGER) DESC, p.id DESC",
  };
  if (!orders[sort]) throw new ApiError(400, '排序方式無效。');
  const pageText = url.searchParams.get('page') || '1';
  if (!/^[1-9]\d{0,5}$/.test(pageText)) throw new ApiError(400, '頁碼無效。');
  return { where: ` WHERE ${clauses.join(' AND ')}`, bindings, order: orders[sort], page: Number(pageText) };
}
export async function publicCandidates(url: URL) {
  const filter = candidateQuery(url), pageSize = 12;
  const [rows, count] = await Promise.all([
    db().prepare(`${publicationSelect}${filter.where} ORDER BY ${filter.order} LIMIT ? OFFSET ?`).bind(...filter.bindings, pageSize, (filter.page - 1) * pageSize).all<PublicationRow>(),
    db().prepare(`SELECT COUNT(*) AS total FROM candidate_publications p JOIN intake_records i ON i.id = p.intake_id${filter.where}`).bind(...filter.bindings).first<{ total: number }>(),
  ]);
  return { candidates: rows.results.map(publicDto), total: count?.total || 0, page: filter.page, pageSize };
}
export async function selectedPublicCandidates(ids: string[], maximum = 3) {
  if (!ids.length || ids.length > maximum || ids.some(id => !uuid(id)) || new Set(ids).size !== ids.length) throw new ApiError(400, `最多選擇${maximum}位有效人選。`);
  const rows = [];
  for (const id of ids) rows.push(publicDto(await publicationById(id, true)));
  return rows;
}
const privatePage = (url?: URL, pageSize = 200) => {
  const text = url?.searchParams.get('page') || '1';
  if (!/^[1-9]\d{0,5}$/.test(text)) throw new ApiError(400, '頁碼無效。');
  return { page: Number(text), pageSize };
};
export function exportPaging(url: URL) {
  const sizeText = url.searchParams.get('batchSize') || '100';
  if (!['5', '20', '50', '100'].includes(sizeText)) throw new ApiError(400, '每份資料數量須選擇5、20、50或100份。');
  const batchText = url.searchParams.get('batch');
  if (batchText !== null && !/^[1-9]\d{0,5}$/.test(batchText)) throw new ApiError(400, '下載批次無效。');
  return { batchSize: Number(sizeText), batch: batchText ? Number(batchText) : 1, explicitBatch: batchText !== null };
}
export function snapshotTime(url: URL) {
  const asOf = url.searchParams.get('asOf') || new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(asOf) || Number.isNaN(new Date(asOf).getTime()) || new Date(asOf).toISOString() !== asOf) throw new ApiError(400, '資料時間無效，請重新載入列表。');
  return asOf;
}
export async function adminPublications(url?: URL) {
  const { page, pageSize } = privatePage(url), clauses: string[] = [], bindings: string[] = [];
  const q = textValue(url?.searchParams.get('q') || '', '搜尋文字', 160), state = url?.searchParams.get('state');
  if (q) { clauses.push("(lower(p.profile_json) LIKE ? ESCAPE '\\' OR i.search_text LIKE ? ESCAPE '\\')"); const needle = `%${q.toLowerCase().replace(/[\\%_]/g, match => `\\${match}`)}%`; bindings.push(needle, needle); }
  if (state) { if (!publicationStates.includes(state as CandidatePublication['state'])) throw new ApiError(400, '公開狀態無效。'); clauses.push('p.state = ?'); bindings.push(state); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const [rows, count] = await Promise.all([db().prepare(`${publicationSelect}${where} ORDER BY p.updated_at DESC, p.id DESC LIMIT ? OFFSET ?`).bind(...bindings, pageSize, (page - 1) * pageSize).all<PublicationRow>(), db().prepare(`SELECT COUNT(*) AS total FROM candidate_publications p JOIN intake_records i ON i.id = p.intake_id${where}`).bind(...bindings).first<{ total: number }>()]);
  return { candidates: rows.results.map(publicationDto), total: count?.total || 0, page, pageSize };
}

type MatchRow = { id: string; employer_id: string; jobseeker_id: string; stage: MatchRecord['stage']; notes: string; interview_at: string; created_at: string; updated_at: string; employer_name: string; employer_reference: string; jobseeker_name: string; jobseeker_reference: string };
const matchSelect = `SELECT m.*, json_extract(e.data_json, '$.fullName') AS employer_name, e.reference AS employer_reference, json_extract(j.data_json, '$.fullName') AS jobseeker_name, j.reference AS jobseeker_reference FROM record_matches m JOIN intake_records e ON e.id = m.employer_id JOIN intake_records j ON j.id = m.jobseeker_id`;
const matchDto = (row: MatchRow): MatchRecord => ({ id: row.id, employerId: row.employer_id, jobseekerId: row.jobseeker_id, employerName: row.employer_name, employerReference: row.employer_reference, jobseekerName: row.jobseeker_name, jobseekerReference: row.jobseeker_reference, stage: row.stage, notes: row.notes, interviewAt: row.interview_at, createdAt: row.created_at, updatedAt: row.updated_at });
export function validateMatch(input: Record<string, unknown>, partial = false) {
  const result: { stage?: MatchRecord['stage']; notes?: string; interviewAt?: string } = {};
  if (!partial || input.stage !== undefined) {
    const stage = input.stage ?? '待聯絡';
    if (typeof stage !== 'string' || !matchStages.includes(stage as MatchRecord['stage'])) throw new ApiError(400, '配對階段無效。');
    result.stage = stage as MatchRecord['stage'];
  }
  if (!partial || input.notes !== undefined) result.notes = textValue(input.notes ?? '', '配對備註', 4000);
  if (!partial || input.interviewAt !== undefined) result.interviewAt = optionalDate(input.interviewAt, '面試時間', true);
  return result;
}
export async function getMatch(id: string) {
  if (!uuid(id)) throw new ApiError(404, '找不到此配對。');
  const row = await db().prepare(`${matchSelect} WHERE m.id = ?`).bind(id).first<MatchRow>();
  if (!row) throw new ApiError(404, '找不到此配對。');
  return matchDto(row);
}
export async function listMatches(url: URL, pageSizeOverride = 200, stableExportOrder = false) {
  const { page, pageSize } = privatePage(url, pageSizeOverride), asOf = snapshotTime(url);
  const clauses: string[] = [], bindings: string[] = [];
  for (const [query, column] of [['employerId', 'employer_id'], ['jobseekerId', 'jobseeker_id']] as const) {
    const value = url.searchParams.get(query); if (!value) continue;
    if (!uuid(value)) throw new ApiError(400, '配對篩選條件無效。');
    clauses.push(`m.${column} = ?`); bindings.push(value);
  }
  const stage = url.searchParams.get('stage');
  if (stage) { if (!matchStages.includes(stage as MatchRecord['stage'])) throw new ApiError(400, '配對階段無效。'); clauses.push('m.stage = ?'); bindings.push(stage); }
  clauses.push('m.created_at <= ?'); bindings.push(asOf);
  const where = ` WHERE ${clauses.join(' AND ')}`;
  const order = stableExportOrder ? 'm.created_at DESC, m.id DESC' : 'm.updated_at DESC, m.id DESC';
  const [rows, count] = await Promise.all([db().prepare(`${matchSelect}${where} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...bindings, pageSize, (page - 1) * pageSize).all<MatchRow>(), db().prepare(`SELECT COUNT(*) AS total FROM record_matches m${where}`).bind(...bindings).first<{ total: number }>()]);
  return { matches: rows.results.map(matchDto), total: count?.total || 0, page, pageSize, asOf };
}
export async function assertMatchKinds(employerId: string, jobseekerId: string) {
  const employer = await getRecord(employerId), jobseeker = await getRecord(jobseekerId);
  if (employer.kind !== 'employer' || jobseeker.kind !== 'jobseeker') throw new ApiError(400, '請選擇一位僱主及一位求職者。');
  return { employer, jobseeker };
}

export const blankSiteInfo: SiteInfo = { phone: '', whatsapp: '', email: '', address: '', hours: '', fees: [], updatedAt: '' };
export async function siteInfo(): Promise<SiteInfo> {
  const row = await db().prepare("SELECT info_json, updated_at FROM site_settings WHERE id = 'public'").first<{ info_json: string; updated_at: string }>();
  return row ? { ...validateSiteInfo(JSON.parse(row.info_json)), updatedAt: row.updated_at } : { ...blankSiteInfo };
}
export function validateSiteInfo(input: unknown): Omit<SiteInfo, 'updatedAt'> {
  if (!object(input)) throw new ApiError(400, '公司資料格式不正確。');
  assertKeys(input, ['phone', 'whatsapp', 'email', 'address', 'hours', 'fees', 'updatedAt', 'expectedUpdatedAt']);
  const phone = textValue(input.phone ?? '', '電話', 30), whatsapp = textValue(input.whatsapp ?? '', 'WhatsApp', 30), email = textValue(input.email ?? '', '電郵', 160);
  for (const value of [phone, whatsapp]) if (value && (!/^[+\d\s().-]+$/.test(value) || value.replace(/\D/g, '').length < 8 || value.replace(/\D/g, '').length > 20)) throw new ApiError(400, '聯絡電話格式不正確。');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, '電郵格式不正確。');
  const fees = input.fees ?? [];
  if (!Array.isArray(fees) || fees.length > 20) throw new ApiError(400, '收費表最多20項。');
  return { phone, whatsapp, email, address: textValue(input.address ?? '', '地址', 500), hours: textValue(input.hours ?? '', '辦公時間', 300), fees: fees.map(fee => {
    if (!object(fee)) throw new ApiError(400, '收費資料格式不正確。');
    assertKeys(fee, ['service', 'amount', 'unit', 'notes']);
    const service = textValue(fee.service ?? '', '服務', 80), amount = textValue(fee.amount ?? '', '金額', 80);
    if (!service) throw new ApiError(400, '請填寫收費項目名稱。');
    return { service, amount, unit: textValue(fee.unit ?? '', '收費單位', 80), notes: textValue(fee.notes ?? '', '收費說明', 1000) };
  }) };
}

export async function photoResponse(id: string) {
  if (!uuid(id) || !env.BUCKET) throw new ApiError(404, '找不到照片。');
  const row = await db().prepare('SELECT object_key, content_type FROM intake_photos WHERE id = ? AND attached_record_id IS NOT NULL').bind(id).first<{ object_key: string; content_type: string }>();
  if (!row) throw new ApiError(404, '找不到照片。');
  const object = await env.BUCKET.get(row.object_key);
  if (!object) throw new ApiError(404, '找不到照片。');
  return new Response(object.body, { headers: { 'Content-Type': row.content_type, 'Content-Length': String(object.size), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Referrer-Policy': 'same-origin' } });
}
export function imageDimensions(bytes: Uint8Array, type: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === 'image/png') {
    if (bytes.length < 33 || [137,80,78,71,13,10,26,10].some((value, index) => bytes[index] !== value) || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') throw new ApiError(400, '照片格式不正確。');
    let offset = 8, hasData = false, ended = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset), end = offset + length + 12;
      if (end > bytes.length) throw new ApiError(400, '照片內容不完整。');
      const chunk = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (offset === 8 && (chunk !== 'IHDR' || length !== 13)) throw new ApiError(400, '照片格式不正確。');
      let crc = 0xffffffff;
      for (let index = offset + 4; index < offset + length + 8; index++) {
        crc ^= bytes[index];
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(offset + length + 8)) throw new ApiError(400, '照片內容損壞，請重新選擇。');
      if (chunk === 'IDAT' && length) hasData = true;
      if (chunk === 'IEND') { ended = length === 0 && end === bytes.length; break; }
      offset = end;
    }
    if (!hasData || !ended || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) throw new ApiError(400, '照片內容不完整。');
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (type !== 'image/jpeg' || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) throw new ApiError(400, '請上載完整的JPEG或PNG照片。');
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 255) throw new ApiError(400, '照片格式不正確。');
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217 || marker === 218) break;
    if (marker >= 208 && marker <= 215 || marker === 1) continue;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) throw new ApiError(400, '照片格式不正確。');
    if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
      if (length < 8) throw new ApiError(400, '照片格式不正確。');
      return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) };
    }
    offset += length;
  }
  throw new ApiError(400, '未能讀取照片尺寸。');
}
