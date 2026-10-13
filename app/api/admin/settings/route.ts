import { ApiError, db, handleApi, json, readJson, requireAdmin, requireSameOrigin } from '@/lib/server';
import { assertVersion, siteInfo, updatedVersion, validateSiteInfo } from '@/lib/platform-server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handleApi(async () => { requireAdmin(request); return json(await siteInfo()); }); }
export async function PATCH(request: Request) {
  return handleApi(async () => {
    requireAdmin(request); requireSameOrigin(request);
    const body = await readJson(request, 131072), current = await siteInfo(); assertVersion(body.expectedUpdatedAt, current.updatedAt);
    const info = validateSiteInfo(body), version = current.updatedAt ? updatedVersion(current.updatedAt) : new Date().toISOString();
    const result = await db().prepare("INSERT INTO site_settings (id, info_json, updated_at) VALUES ('public', ?, ?) ON CONFLICT(id) DO UPDATE SET info_json = excluded.info_json, updated_at = excluded.updated_at WHERE site_settings.updated_at = ?").bind(JSON.stringify(info), version, body.expectedUpdatedAt).run();
    if (!result.meta.changes) throw new ApiError(409, '公司資料已有其他更新，請重新載入。');
    return json(await siteInfo());
  });
}
