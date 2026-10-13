import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const intakeRecords = sqliteTable('intake_records', {
  id: text('id').primaryKey(),
  reference: text('reference').notNull(),
  kind: text('kind', { enum: ['jobseeker', 'employer'] }).notNull(),
  dataJson: text('data_json').notNull(),
  searchText: text('search_text').notNull(),
  status: text('status').notNull().default('新登記'),
  notes: text('notes').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  idempotencyHash: text('idempotency_hash').notNull(),
  requestHash: text('request_hash').notNull(),
  originalDataJson: text('original_data_json'),
  nextFollowUp: text('next_follow_up').notNull().default(''),
  photoId: text('photo_id').notNull().default(''),
  requestedCandidateIds: text('requested_candidate_ids').notNull().default('[]'),
}, table => [
  uniqueIndex('intake_reference_unique').on(table.reference),
  uniqueIndex('intake_idempotency_unique').on(table.idempotencyHash),
  index('intake_created_index').on(table.createdAt),
  index('intake_kind_status_index').on(table.kind, table.status),
]);

// The key is an hourly salted hash. No IP addresses are stored.
export const intakeRateLimits = sqliteTable('intake_rate_limits', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const candidatePublications = sqliteTable('candidate_publications', {
  id: text('id').primaryKey(),
  intakeId: text('intake_id').notNull().references(() => intakeRecords.id, { onDelete: 'cascade' }),
  profileJson: text('profile_json').notNull(),
  state: text('state', { enum: ['draft', 'published', 'paused'] }).notNull().default('draft'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [uniqueIndex('candidate_intake_unique').on(table.intakeId), index('candidate_state_updated_index').on(table.state, table.updatedAt)]);

export const intakePhotos = sqliteTable('intake_photos', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  objectKey: text('object_key').notNull(),
  contentType: text('content_type').notNull(),
  byteLength: integer('byte_length').notNull(),
  expiresAt: integer('expires_at').notNull(),
  attachedRecordId: text('attached_record_id').references(() => intakeRecords.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
}, table => [index('photo_expiry_index').on(table.expiresAt)]);

export const recordMatches = sqliteTable('record_matches', {
  id: text('id').primaryKey(),
  employerId: text('employer_id').notNull().references(() => intakeRecords.id, { onDelete: 'cascade' }),
  jobseekerId: text('jobseeker_id').notNull().references(() => intakeRecords.id, { onDelete: 'cascade' }),
  stage: text('stage').notNull().default('待聯絡'),
  notes: text('notes').notNull().default(''),
  interviewAt: text('interview_at').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [uniqueIndex('match_pair_unique').on(table.employerId, table.jobseekerId), index('match_stage_index').on(table.stage)]);

export const siteSettings = sqliteTable('site_settings', {
  id: text('id').primaryKey(),
  infoJson: text('info_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});
