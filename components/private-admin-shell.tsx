"use client";
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { adminRequest } from '@/lib/admin-request';
export { adminRequest, AdminApiError } from '@/lib/admin-request';
import './private-admin.css';

export function AdminNavigation({ active }: { active: string }) {
  return <nav className="private-admin-nav" aria-label="後台功能">{[['/admin','登記資料'],['/admin/candidates','人選管理'],['/admin/matches','配對跟進'],['/admin/settings','聯絡與收費設定']].map(([href,label]) => <a key={href} href={href} aria-current={active === href ? 'page' : undefined}>{label}</a>)}</nav>;
}
export function PrivateAdminShell({ active, title, description, children }: { active: string; title: string; description: string; children: ReactNode }) {
  const [session, setSession] = useState<{ authenticated: boolean; authorized: boolean; configured: boolean; email: string | null; name?: string | null } | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setSession(await adminRequest('/api/admin/session')); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '未能讀取管理帳戶。'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <main id="main-content" className="site-width admin-gate"><h1>正在讀取管理帳戶…</h1><noscript><p>請開啟 JavaScript 以使用管理後台。</p></noscript></main>;
  if (error) return <main id="main-content" className="site-width admin-gate"><h1>未能開啟後台</h1><p role="alert">{error}</p><button className="work-button primary" onClick={() => void load()}>重試</button></main>;
  if (!session?.configured) return <main id="main-content" className="site-width admin-gate"><h1>管理帳戶尚未設定</h1><p>設定管理帳戶後，可管理登記、人選及配對資料。</p><a href="/" className="work-button secondary">返回首頁</a></main>;
  if (!session.authenticated || !session.authorized) return <main id="main-content" className="site-width admin-gate"><h1>請從管理入口開啟後台</h1><a className="work-button secondary" href="/">返回首頁</a></main>;
  return <main id="main-content" className="site-width admin-page"><AdminNavigation active={active}/><div className="admin-title-row"><div><h1>{title}</h1><p>{description}</p></div><div className="admin-account"><span>{session.name || session.email}</span><a href="/">離開後台</a></div></div>{children}</main>;
}
