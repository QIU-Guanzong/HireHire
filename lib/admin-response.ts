type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string';
const nonempty = (value: unknown): value is string => text(value) && value.length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const texts = (value: JsonObject, keys: string[]) => keys.every(key => text(value[key]));
const timestamp = (value: unknown) => nonempty(value) && Number.isFinite(Date.parse(value));
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const identity = (value: JsonObject) => nonempty(value.id) && timestamp(value.createdAt) && timestamp(value.updatedAt);

// Registration versions are sent back verbatim to PATCH, which requires UTC milliseconds.
const recordVersion = (value: unknown) => text(value)
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const recordKeys = ['id', 'reference', 'kind', 'data', 'status', 'notes', 'createdAt', 'updatedAt', 'nextFollowUp', 'photoId', 'requestedCandidateIds'];

// One wire format boundary for every registration detail consumer. A wrapper
// cannot also carry registration fields; neither representation wins silently.
export function unwrapAdminRecordResponse(value: unknown): unknown {
  if (!object(value) || !('record' in value)) return value;
  if (recordKeys.some(key => key in value) || !object(value.record)) return undefined;
  return value.record;
}

function record(value: unknown): value is JsonObject {
  return object(value) && !('record' in value) && identity(value) && recordVersion(value.updatedAt) && texts(value, ['reference', 'status', 'notes'])
    && typeof value.kind === 'string' && ['employer', 'jobseeker'].includes(value.kind) && object(value.data)
    // Older registrations need not contain questions introduced later. Validate
    // the values that exist, without filling missing answers or rewriting data.
    && Object.values(value.data).every(item => text(item) || typeof item === 'boolean' || strings(item))
    && (value.nextFollowUp === undefined || text(value.nextFollowUp))
    && (value.photoId === undefined || text(value.photoId))
    && (value.requestedCandidateIds === undefined || strings(value.requestedCandidateIds));
}
function candidate(value: unknown): value is JsonObject {
  return object(value) && identity(value) && nonempty(value.intakeId)
    && texts(value, ['reference', 'displayName', 'nationality', 'candidateType', 'age', 'education', 'currentLocation', 'yearsExperience', 'employmentType', 'availableFrom', 'expectedSalary', 'salaryUnit', 'summary', 'qualifications'])
    && ['services', 'languages', 'skills', 'workLocations'].every(key => strings(value[key]))
    && typeof value.state === 'string' && ['draft', 'published', 'paused'].includes(value.state)
    && typeof value.consented === 'boolean' && typeof value.hasPhoto === 'boolean'
    && (value.salaryNegotiable === undefined || typeof value.salaryNegotiable === 'boolean')
    && Array.isArray(value.workExperiences) && value.workExperiences.every(item => object(item) && texts(item, ['country', 'from', 'to', 'household', 'duties', 'leavingReason']));
}
function match(value: unknown): value is JsonObject {
  return object(value) && identity(value) && nonempty(value.employerId) && nonempty(value.jobseekerId)
    && texts(value, ['employerName', 'employerReference', 'jobseekerName', 'jobseekerReference', 'stage', 'notes', 'interviewAt']);
}
function page(value: JsonObject, key: string, item: (value: unknown) => boolean) {
  const rows = value[key];
  return Array.isArray(rows) && rows.every(item) && count(value.total) && (value.total as number) >= rows.length
    && count(value.page) && (value.page as number) > 0 && count(value.pageSize) && (value.pageSize as number) > 0;
}

// These are response checks, not input normalizers. Additional fields are kept;
// required data is never fabricated to turn an unconfirmed write into success.
export function validAdminResponse(url: string, method: string, value: unknown): boolean {
  if (!object(value)) return false;
  const [pathname, query = ''] = url.split('?');
  if (pathname === '/api/admin/session' && method === 'GET') {
    return ['configured', 'authenticated', 'authorized'].every(key => typeof value[key] === 'boolean')
      && (value.email === null || text(value.email)) && (value.name == null || text(value.name));
  }
  if (pathname === '/api/admin/settings' && ['GET', 'PATCH'].includes(method)) {
    return texts(value, ['phone', 'whatsapp', 'email', 'address', 'hours'])
      && (timestamp(value.updatedAt) || method === 'GET' && value.updatedAt === '')
      && Array.isArray(value.fees) && value.fees.every(fee => object(fee) && texts(fee, ['service', 'amount', 'unit', 'notes']));
  }
  if (pathname === '/api/admin/records' && method === 'GET') {
    const kind = new URLSearchParams(query).get('kind');
    return page(value, 'records', item => record(item) && (!kind || item.kind === kind)) && timestamp(value.asOf)
      && object(value.counts) && ['all', 'employer', 'jobseeker'].every(key => count((value.counts as JsonObject)[key]))
      && object(value.counts.statuses) && Object.values(value.counts.statuses).every(count);
  }
  if (pathname === '/api/admin/candidates') return method === 'GET' ? page(value, 'candidates', candidate) : method === 'POST' && candidate(value);
  if (pathname === '/api/admin/matches') return method === 'GET' ? page(value, 'matches', match) && timestamp(value.asOf) : method === 'POST' && match(value);
  const detail = /^\/api\/admin\/(records|candidates|matches)\/([^/]+)$/.exec(pathname);
  if (!detail || !['GET', 'PATCH'].includes(method) || detail[1] === 'matches' && method !== 'PATCH') return false;
  // The registration workspace also supports the historical { record } envelope.
  const current = detail[1] === 'records' ? unwrapAdminRecordResponse(value) : value;
  const valid = detail[1] === 'records' ? record(current) : detail[1] === 'candidates' ? candidate(current) : match(current);
  try { return valid && object(current) && current.id === decodeURIComponent(detail[2]); }
  catch { return false; }
}
