import { adminSession, json } from '@/lib/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return json(adminSession(request)); }
