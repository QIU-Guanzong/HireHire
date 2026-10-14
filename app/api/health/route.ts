import { db, handleApi, json } from '@/lib/server';
import { APP_VERSION } from '@/lib/app-version';
import { checkRuntimeReadiness } from '@/lib/runtime';
export const dynamic = 'force-dynamic';
export async function GET() {
  return handleApi(async () => {
    await db().prepare(`SELECT i.original_data_json, i.next_follow_up, i.photo_id, i.requested_candidate_ids,
      p.profile_json, p.state, ph.object_key, ph.token_hash, ph.expires_at, m.stage, m.interview_at, s.info_json
      FROM intake_records i LEFT JOIN candidate_publications p ON p.intake_id = i.id
      LEFT JOIN intake_photos ph ON ph.id = i.photo_id LEFT JOIN record_matches m ON m.employer_id = i.id
      LEFT JOIN site_settings s ON s.id = 'public' LIMIT 0`).all();
    await checkRuntimeReadiness();
    return json({ status: 'ready', version: APP_VERSION, storage: 'ready', runtime: 'node-sqlite' });
  });
}
