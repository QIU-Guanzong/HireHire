"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronRight, FileText, Search, ShieldCheck, X } from 'lucide-react';
import { allFields, isFieldVisible, kindLabel, sections, statuses, type IntakeData, type IntakeKind, type IntakeRecord } from '@/lib/fields';
import { IntakeDataFields, intakeFieldValue, validateIntakeFields } from './intake-form';
import { AdminNavigation } from './private-admin-shell';
import './workspace.css';

type Session = { authenticated: boolean; authorized: boolean; configured: boolean; email: string | null };
type RecordsResult = { records: IntakeRecord[]; total: number; page: number; pageSize: number; asOf: string; counts: { all: number; jobseeker: number; employer: number; statuses: Record<string, number> } };
type RecordDraft = { status: string; notes: string; nextFollowUp: string; data: IntakeData };
const recordDraft = (record: IntakeRecord): RecordDraft => ({status:record.status,notes:record.notes,nextFollowUp:record.nextFollowUp||'',data:{...record.data}});
const followUpParts = (value: string) => { if(!value.endsWith('Z')) return {day:value.slice(0,10),time:value.slice(11,16)}; const date=new Date(value); if(Number.isNaN(date.getTime()))return {day:'',time:''}; const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Hong_Kong',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);const get=(type:string)=>parts.find(part=>part.type===type)?.value||'';return {day:`${get('year')}-${get('month')}-${get('day')}`,time:`${get('hour')}:${get('minute')}`}; };
const followUpLabel = (value: string) => {const parts=followUpParts(value);return parts.day?`${parts.day}${parts.time?' '+parts.time:''}`:'未設定';};
const formatDate = (date: string, time = false) => new Intl.DateTimeFormat('zh-HK', { timeZone: 'Asia/Hong_Kong', month: 'short', day: 'numeric', ...(time ? { year: 'numeric', hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(date));
const displayValue = (value: IntakeRecord['data'][string] | undefined) => Array.isArray(value) ? value.join('、') : typeof value === 'string' ? value : '';
const responseError = async (response: Response, fallback: string) => { const body = await response.json().catch(() => ({})) as { error?: string }; return body.error || fallback; };

export default function AdminWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [sessionLoading, setSessionLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<IntakeKind | ''>('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<RecordsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportMode, setExportMode] = useState<'full' | 'client'>('client');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [exportBatch, setExportBatch] = useState(1);
  const [exportBatchSize,setExportBatchSize] = useState(20);
  const [conflicts, setConflicts] = useState<Record<string, 'detected' | 'review'>>({});
  const [drawer, setDrawer] = useState<IntakeRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailReadError, setDetailReadError] = useState(false);
  const [recordDrafts, setRecordDrafts] = useState<Record<string, RecordDraft>>({});
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState('');
  const [recordErrors,setRecordErrors] = useState<Record<string,string>>({});
  const completeEditorRef=useRef<HTMLDetailsElement>(null);
  const pageCheckboxRef = useRef<HTMLInputElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const triggerIdentityRef = useRef<{ id: string; kind: 'name' | 'view' } | null>(null);
  const restoreFocusRef = useRef(false);
  const listLoadingRef = useRef(false);
  const detailAbortRef = useRef<AbortController | null>(null);
  const exportBusyRef = useRef(false);
  const saveBusyRef = useRef(false);
  const listAsOfRef = useRef('');
  const drawerOpen = drawer !== null;

  const loadSession = useCallback(async () => {
    setSessionLoading(true); setSessionError('');
    try {
      const response = await fetch('/api/admin/session', { cache: 'no-store' });
      if (!response.ok) throw new Error(await responseError(response, '未能讀取管理帳戶，請重試。'));
      setSession(await response.json() as Session);
    } catch (caught) { setSessionError(caught instanceof Error ? caught.message : '未能讀取管理帳戶。'); }
    finally { setSessionLoading(false); }
  }, []);

  useEffect(() => { void loadSession(); }, [loadSession]);
  useEffect(()=>{const initial=new URLSearchParams(window.location.search).get('q');if(initial&&initial.length<=160){setQuery(initial);setSearch(initial.trim());}},[]);
  useEffect(() => { if (query.trim() === search) return; const timer = window.setTimeout(() => { listAsOfRef.current = ''; setSearch(query.trim()); setPage(1); setExportBatch(1); setSelected(new Set()); }, 300); return () => window.clearTimeout(timer); }, [query, search]);
  useEffect(() => {
    if (!session?.authorized) return;
    const controller = new AbortController();
    listLoadingRef.current = true;
    setLoading(true); setError('');
    const params = new URLSearchParams({ q: search, kind, status, page: String(page) });
    if (listAsOfRef.current) params.set('asOf', listAsOfRef.current);
    fetch(`/api/admin/records?${params}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error(await responseError(response, '未能讀取登記資料，請重試。'));
      return response.json() as Promise<RecordsResult>;
    }).then(next => { if (!controller.signal.aborted) { listAsOfRef.current = next.asOf; setResult(next); setExportBatch(current => Math.min(current, Math.max(1, Math.ceil(next.total / exportBatchSize)))); } }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '未能讀取資料。'); }).finally(() => { if (!controller.signal.aborted) { listLoadingRef.current = false; setLoading(false); } });
    return () => controller.abort();
  }, [session?.authorized, search, kind, status, page, refresh]);

  const records = result?.records ?? [];
  const allPageSelected = records.length > 0 && records.every(record => selected.has(record.id));
  const somePageSelected = records.some(record => selected.has(record.id));
  useEffect(() => { if (pageCheckboxRef.current) pageCheckboxRef.current.indeterminate = somePageSelected && !allPageSelected; }, [somePageSelected, allPageSelected]);

  const closeDrawer = useCallback(() => {
    if (saveBusyRef.current) return;
    detailAbortRef.current?.abort();
    restoreFocusRef.current = true;
    setDrawer(null); setDetailError(''); setDetailReadError(false); setSaveNote('');
  }, []);

  useEffect(() => {
    if (drawerOpen || loading || listLoadingRef.current || !restoreFocusRef.current) return;
    const identity = triggerIdentityRef.current;
    const stableTrigger = identity ? Array.from(document.querySelectorAll<HTMLElement>('[data-record-id][data-record-trigger]')).find(element => element.dataset.recordId === identity.id && element.dataset.recordTrigger === identity.kind) : null;
    const target = triggerRef.current?.isConnected ? triggerRef.current : stableTrigger || document.getElementById('admin-search');
    if (!target || target.closest('[inert]')) return;
    target.focus({ preventScroll: true });
    if (document.activeElement === target) { triggerRef.current = target; restoreFocusRef.current = false; }
  }, [drawerOpen, loading, result, error]);

  useEffect(() => {
    if (!drawerOpen) return;
    const originalOverflow = document.body.style.overflow;
    const surrounding = Array.from(document.querySelectorAll<HTMLElement>('.site-header,.site-footer,.skip-link')).map(element => ({ element, inert: element.inert }));
    surrounding.forEach(({ element }) => { element.inert = true; });
    document.body.style.overflow = 'hidden';
    drawerCloseRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); }
      if (event.key !== 'Tab') return;
      const controls = drawerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || !drawerRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = originalOverflow; surrounding.forEach(({ element, inert }) => { element.inert = inert; }); document.removeEventListener('keydown', handleKey); };
  }, [drawerOpen, closeDrawer]);
  useEffect(() => () => detailAbortRef.current?.abort(), []);

  const openDrawer = async (record: IntakeRecord, trigger: HTMLElement) => {
    restoreFocusRef.current = false;
    triggerRef.current = trigger;
    const triggerKind = trigger.dataset.recordTrigger;
    if (trigger.dataset.recordId === record.id && (triggerKind === 'name' || triggerKind === 'view')) triggerIdentityRef.current = { id: record.id, kind: triggerKind };
    detailAbortRef.current?.abort();
    const controller = new AbortController(); detailAbortRef.current = controller;
    setDrawer(record); setRecordErrors({}); setDetailLoading(true); setDetailError(''); setDetailReadError(false); setSaveNote('');
    try {
      const response = await fetch(`/api/admin/records/${encodeURIComponent(record.id)}`, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(await responseError(response, '未能讀取完整資料。'));
      const body = await response.json() as IntakeRecord | { record: IntakeRecord };
      if (!controller.signal.aborted) { setDrawer('record' in body ? body.record : body); setConflicts(current => current[record.id] === 'detected' ? { ...current, [record.id]: 'review' } : current); if (conflicts[record.id] === 'detected') requestAnimationFrame(() => drawerCloseRef.current?.focus()); }
    } catch (caught) { if (!controller.signal.aborted) { setDetailError(caught instanceof Error ? caught.message : '未能讀取完整資料。'); setDetailReadError(true); } }
    finally { if (!controller.signal.aborted) setDetailLoading(false); }
  };

  const updateDraft = (next: Partial<RecordDraft>) => {
    if (!drawer) return;
    setRecordDrafts(current => ({ ...current, [drawer.id]: { ...(current[drawer.id] || recordDraft(drawer)), ...next } }));
    setSaveNote(''); setDetailError(''); setDetailReadError(false);
  };

  const saveRecord = async (event: FormEvent) => {
    event.preventDefault();
    if (!drawer || saveBusyRef.current || conflicts[drawer.id] === 'detected') return;
    const desired=recordDrafts[drawer.id]||recordDraft(drawer);
    const dataChanged=JSON.stringify(desired.data)!==JSON.stringify(drawer.data);
    const nextErrors=dataChanged?validateIntakeFields(drawer.kind,desired.data,allFields(drawer.kind),true):{};
    if(drawer.data.publicProfileConsent!==true&&desired.data.publicProfileConsent===true)nextErrors.publicProfileConsent='公開同意須由求職者本人提供，後台不能代為授予。';
    setRecordErrors(nextErrors);
    if(Object.keys(nextErrors).length){if(completeEditorRef.current)completeEditorRef.current.open=true;setDetailError('請檢查登記資料。');requestAnimationFrame(()=>document.getElementById(`record-field-${Object.keys(nextErrors)[0]}`)?.focus());return;}
    saveBusyRef.current = true; setSaving(true); setDetailError(''); setDetailReadError(false); setSaveNote('');
    try {
      const response = await fetch(`/api/admin/records/${encodeURIComponent(drawer.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({status:desired.status,notes:desired.notes,nextFollowUp:desired.nextFollowUp,...(dataChanged?{data:desired.data}:{}),expectedUpdatedAt: drawer.updatedAt}) });
      if (response.status === 409) setConflicts(current => ({ ...current, [drawer.id]: 'detected' }));
      const body = await response.json().catch(()=>({})) as IntakeRecord & {record?:IntakeRecord;error?:string;fields?:Record<string,string>};
      if(!response.ok){if(body.fields)setRecordErrors(body.fields);throw new Error(body.error||'未能儲存更新，請重試。');}
      const updated = body.record || body;
      setDrawer(updated); setRecordDrafts(current => { const next = { ...current }; delete next[updated.id]; return next; });
      setConflicts(current => { const next = { ...current }; delete next[updated.id]; return next; });
      setSaveNote('更新已儲存'); setRefresh(current => current + 1);
    } catch (caught) { setDetailError(caught instanceof Error ? caught.message : '未能儲存更新。'); }
    finally { saveBusyRef.current = false; setSaving(false); }
  };

  const downloadPdf = async (scope: 'selected' | 'all', singleId?: string) => {
    if (exportBusyRef.current) return;
    exportBusyRef.current = true; setExporting(true); setExportError('');
    const params = new URLSearchParams({ mode: exportMode });
    if (singleId) params.set('ids', singleId);
    else if (scope === 'selected') params.set('ids', Array.from(selected).join(','));
    else { params.set('scope', 'all'); params.set('q', search); params.set('kind', kind); params.set('status', status); if (result?.asOf) params.set('asOf', result.asOf); params.set('batchSize', String(exportBatchSize)); params.set('batch', String(exportBatch)); }
    try {
      const response = await fetch(`/api/admin/export?${params}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(await responseError(response, '未能下載PDF，請重試。'));
      const blob = await response.blob();
      if (!blob.type.includes('pdf')) throw new Error('未能取得PDF檔案，請重試。');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url;
      const disposition = response.headers.get('Content-Disposition');
      const fileName = disposition?.match(/filename="?([^";]+)"?/)?.[1];
      link.download = fileName || `家合僱傭-${exportMode === 'client' ? '客戶配對版' : '完整資料'}-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (caught) { setExportError(caught instanceof Error ? caught.message : '未能下載PDF。'); }
    finally { exportBusyRef.current = false; setExporting(false); }
  };

  const changeKind = (next: IntakeKind | '') => { if (next === kind) return; listAsOfRef.current = ''; setKind(next); setPage(1); setExportBatch(1); setSelected(new Set()); };
  const draft = drawer ? recordDrafts[drawer.id] || recordDraft(drawer) : null;
  const draftChanged = drawer && draft && (drawer.status !== draft.status || drawer.notes !== draft.notes || (drawer.nextFollowUp||'')!==draft.nextFollowUp || JSON.stringify(drawer.data)!==JSON.stringify(draft.data));
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / (result?.pageSize || 20)));
  const exportBatches = Math.max(1, Math.ceil((result?.total ?? 0) / exportBatchSize));
  const conflictState = drawer ? conflicts[drawer.id] : undefined;
  const followUp=draft?followUpParts(draft.nextFollowUp):{day:'',time:''};
  const editingDisabled=saving||detailLoading||detailReadError;

  if (sessionLoading) return <main id="main-content" className="site-width admin-gate"><p className="workspace-eyebrow">管理後台</p><h1>正在讀取管理帳戶…</h1><p role="status">請稍候。</p><noscript><p className="form-message">請開啟瀏覽器的 JavaScript 以使用管理後台。</p></noscript></main>;
  if (sessionError) return <main id="main-content" className="site-width admin-gate"><h1>暫時無法開啟後台</h1><p role="alert">{sessionError}</p><button className="work-button primary" onClick={() => void loadSession()}>重新載入</button></main>;
  if (!session?.configured) return <main id="main-content" className="site-width admin-gate"><ShieldCheck size={32} strokeWidth={1.4} aria-hidden="true"/><p className="workspace-eyebrow">管理後台</p><h1>管理帳戶尚未設定</h1><p>設定管理帳戶後，可查看登記、更新狀態及下載PDF。</p><a className="work-button secondary" href="/">返回首頁<ArrowRight size={16} aria-hidden="true"/></a></main>;
  if (!session.authenticated) return <main id="main-content" className="site-width admin-gate"><ShieldCheck size={32} strokeWidth={1.4} aria-hidden="true"/><p className="workspace-eyebrow">管理後台</p><h1>登入管理後台</h1><p>使用管理帳戶登入。</p><a className="work-button primary" href="/signin-with-chatgpt?return_to=%2Fadmin" target="_top">以管理帳戶登入<ArrowRight size={16} aria-hidden="true"/></a></main>;
  if (!session.authorized) return <main id="main-content" className="site-width admin-gate"><ShieldCheck size={32} strokeWidth={1.4} aria-hidden="true"/><h1>此帳戶未獲管理權限</h1><p>{session.email}</p><a className="work-button secondary" href="/signout-with-chatgpt?return_to=%2Fadmin" target="_top">更換登入帳戶<ArrowRight size={16} aria-hidden="true"/></a></main>;

  return <main id="main-content" className="site-width admin-page">
    <div inert={Boolean(drawer)} className="admin-content"><AdminNavigation active="/admin"/>
      <div className="workspace-breadcrumb"><a href="/">首頁</a><ChevronRight size={14} aria-hidden="true"/><span>管理後台</span></div>
      <div className="admin-title-row"><div><p className="workspace-eyebrow">管理後台</p><h1>登記資料</h1><p>搜尋登記、更新跟進狀態及下載PDF。</p></div><div className="admin-account"><span>{session.email}</span><a href="/signout-with-chatgpt?return_to=%2Fadmin" target="_top">登出</a></div></div>
      <div className="admin-counts"><div><span>全部登記</span><strong>{result?.counts.all ?? '—'}</strong></div><div><span>求職者</span><strong>{result?.counts.jobseeker ?? '—'}</strong></div><div><span>僱主</span><strong>{result?.counts.employer ?? '—'}</strong></div><div><span>待聯絡</span><strong>{result?.counts.statuses['新登記'] ?? '—'}</strong></div></div>
      <div className="admin-filters"><div className="admin-kind-filter" aria-label="登記類別">{([['','全部'],['jobseeker','求職者'],['employer','僱主']] as const).map(([value,label]) => <button key={value} className={kind === value ? 'active' : ''} aria-pressed={kind === value} onClick={() => changeKind(value)}>{label}</button>)}</div><div className="admin-search"><Search size={17} aria-hidden="true"/><label className="sr-only" htmlFor="admin-search">搜尋姓名、電話或登記編號</label><input id="admin-search" type="search" placeholder="姓名、電話或登記編號" value={query} onChange={event => setQuery(event.target.value)}/></div><label className="admin-status-filter"><span className="sr-only">跟進狀態</span><select value={status} onChange={event => { listAsOfRef.current = ''; setStatus(event.target.value); setPage(1); setExportBatch(1); setSelected(new Set()); }}><option value="">全部狀態</option>{statuses.map(item => <option key={item}>{item}</option>)}</select></label></div>
      <section className="export-toolbar" aria-label="PDF下載設定"><div className="export-choice"><FileText size={20} strokeWidth={1.4} aria-hidden="true"/><fieldset><legend>PDF資料版本</legend><label><input type="radio" name="export-mode" value="client" disabled={exporting} checked={exportMode === 'client'} onChange={() => setExportMode('client')}/>客戶配對版</label><label><input type="radio" name="export-mode" value="full" disabled={exporting} checked={exportMode === 'full'} onChange={() => setExportMode('full')}/>完整資料</label></fieldset><p>{exportMode === 'client' ? '包含服務及配對資料，不含電話、電郵及內部備註。' : '包含聯絡資料及內部備註，供後台保存及跟進。'}</p><label className="export-batch"><span>篩選結果每份PDF包含</span><select value={exportBatchSize} disabled={exporting} onChange={event=>{setExportBatchSize(Number(event.target.value));setExportBatch(1);}}>{[5,20,50,100].map(size=><option key={size} value={size}>{size}份</option>)}</select></label>{exportBatches > 1 && <label className="export-batch"><span>全部篩選結果分批下載</span><select aria-label="下載批次" value={exportBatch} disabled={loading || exporting} onChange={event => setExportBatch(Number(event.target.value))}>{Array.from({ length: exportBatches }, (_, index) => <option value={index + 1} key={index}>第 {index + 1} 批：{index * exportBatchSize + 1}–{Math.min((index + 1) * exportBatchSize, result?.total ?? 0)}／{result?.total} 份</option>)}</select></label>}</div><div className="export-buttons"><button className="work-button secondary" disabled={exporting || selected.size === 0} onClick={() => void downloadPdf('selected')}><ArrowDownToLine size={16} aria-hidden="true"/>下載已選（{selected.size}）</button><button className="work-button primary" disabled={exporting || loading || Boolean(error) || !result?.total} onClick={() => void downloadPdf('all')}><ArrowDownToLine size={16} aria-hidden="true"/>{exporting ? '正在製作PDF…' : exportBatches > 1 ? '下載此批資料' : '下載全部篩選結果'}</button></div></section>
      {exportError && <p className="form-message error" role="alert">{exportError}</p>}
      <div className="admin-list-heading"><p aria-live="polite">{loading ? '正在讀取資料…' : `找到 ${result?.total ?? 0} 份登記`}{selected.size > 0 && <span>　已選 {selected.size} 份 <button type="button" className="text-action" onClick={() => setSelected(new Set())}>取消選取</button></span>}</p><button type="button" className="text-action" disabled={loading} onClick={() => { listAsOfRef.current = ''; setExportBatch(1); setRefresh(current => current + 1); }}>重新整理</button></div>
      {error ? <div className="admin-empty" role="alert"><h2>未能讀取登記資料</h2><p>{error}</p><button className="work-button secondary" onClick={() => { listAsOfRef.current = ''; setExportBatch(1); setRefresh(current => current + 1); }}>重試</button></div> : loading ? <div className="admin-empty" role="status"><p>正在讀取登記資料…</p></div> : records.length === 0 ? <div className="admin-empty"><FileText size={30} strokeWidth={1.3} aria-hidden="true"/><h2>{query || status || kind ? '沒有符合條件的登記' : '尚未有登記資料'}</h2><p>{query || status || kind ? '試試另一個關鍵字，或清除篩選條件。' : '求職者及僱主提交資料後，會顯示在這裡。'}</p>{(query || status || kind) && <button className="work-button secondary" onClick={() => { listAsOfRef.current = ''; setQuery(''); setSearch(''); setKind(''); setStatus(''); setPage(1); setExportBatch(1); setSelected(new Set()); }}>清除篩選</button>}</div> : <div className="admin-table-wrap"><table className="admin-table"><caption className="sr-only">登記資料，第 {page} 頁</caption><thead><tr><th scope="col" className="checkbox-column"><input ref={pageCheckboxRef} type="checkbox" aria-label="選取此頁全部登記" checked={allPageSelected} onChange={event => setSelected(current => { const next = new Set(current); records.forEach(record => event.target.checked ? next.add(record.id) : next.delete(record.id)); return next; })}/></th><th scope="col">登記人</th><th scope="col">類別</th><th scope="col">服務需要</th><th scope="col">聯絡電話</th><th scope="col">跟進狀態</th><th scope="col">提交日期</th><th scope="col">下次跟進</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead><tbody>{records.map(record => <tr key={record.id} className={selected.has(record.id) ? 'row-selected' : ''}><td><input type="checkbox" aria-label={`選取 ${displayValue(record.data.fullName)} ${record.reference}`} checked={selected.has(record.id)} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(record.id); else next.delete(record.id); return next; })}/></td><td><button className="record-name" data-record-id={record.id} data-record-trigger="name" onClick={event => void openDrawer(record, event.currentTarget)}>{displayValue(record.data.fullName)}</button><span className="record-reference">{record.reference}</span></td><td><span className={`kind-tag ${record.kind}`}>{kindLabel(record.kind)}</span></td><td className="table-services">{displayValue(record.data.services) || '—'}</td><td className="table-phone">{displayValue(record.data.phone) || '—'}</td><td><span className={`status-tag status-${statuses.indexOf(record.status)}`}>{record.status}</span></td><td className="table-date">{formatDate(record.createdAt)}</td><td className="table-date">{record.nextFollowUp?followUpLabel(record.nextFollowUp):'—'}</td><td><button className="record-view" data-record-id={record.id} data-record-trigger="view" onClick={event => void openDrawer(record, event.currentTarget)} aria-label={`查看 ${record.reference}`}>查看<ChevronRight size={14} aria-hidden="true"/></button></td></tr>)}</tbody></table></div>}
      {result && result.total > 0 && !error && <nav className="admin-pagination" aria-label="登記分頁"><span>第 {page} 頁，共 {totalPages} 頁</span><div><button className="work-button secondary" disabled={loading || page <= 1} onClick={() => setPage(current => current - 1)}><ArrowLeft size={15} aria-hidden="true"/>上一頁</button><button className="work-button secondary" disabled={loading || page >= totalPages} onClick={() => setPage(current => current + 1)}>下一頁<ArrowRight size={15} aria-hidden="true"/></button></div></nav>}
    </div>
    {drawer && <div className="drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeDrawer(); }}><div ref={drawerRef} className="record-drawer" role="dialog" aria-modal="true" aria-labelledby="record-detail-title"><div className="drawer-header"><div><p>{kindLabel(drawer.kind)}登記 · {drawer.reference}</p><h2 id="record-detail-title">{displayValue(drawer.data.fullName)}</h2><span>提交於 {formatDate(drawer.createdAt, true)}</span></div><button ref={drawerCloseRef} className="drawer-close" disabled={saving} onClick={closeDrawer} aria-label="關閉資料詳情"><X size={22} aria-hidden="true"/></button></div><div className="drawer-body">
      {detailLoading && <p className="form-message" role="status">正在更新完整資料…</p>}{conflictState === 'detected' && <div className="conflict-notice" role="alert"><strong>此登記已有其他更新</strong><p>你的修改仍然保留。請先載入最新資料，檢查後再儲存。</p><button type="button" className="work-button secondary" disabled={detailLoading} onClick={() => void openDrawer(drawer, triggerRef.current || drawerCloseRef.current!)}>載入最新資料</button></div>}{conflictState === 'review' && <div className="conflict-notice" role="status"><strong>已載入最新資料</strong><p>以下是目前已儲存的內容。請比較你的修改，確認後再儲存。</p><dl><div><dt>目前狀態</dt><dd>{drawer.status}</dd></div><div><dt>目前內部備註</dt><dd>{drawer.notes || '未填寫'}</dd></div><div><dt>目前跟進日期</dt><dd>{followUpLabel(drawer.nextFollowUp||'')}</dd></div>{allFields(drawer.kind).filter(field=>isFieldVisible(field,drawer.data)&&JSON.stringify(drawer.data[field.name])!==JSON.stringify(draft?.data[field.name])).map(field=><div key={field.name}><dt>{field.label}</dt><dd>{intakeFieldValue(field,drawer.data[field.name])}</dd></div>)}</dl></div>}
      {detailError && <div className="form-message error" role="alert"><p>{detailError}</p>{detailReadError && !saving && <button className="text-action" onClick={() => void openDrawer(drawer, triggerRef.current || drawerCloseRef.current!)}>重試讀取</button>}</div>}
      <form className="record-followup" noValidate onSubmit={saveRecord}><h3>跟進安排</h3><div className="followup-fields"><label htmlFor="record-status">跟進狀態<select id="record-status" value={draft?.status||''} disabled={editingDisabled} onChange={event=>updateDraft({status:event.target.value})}>{statuses.map(item=><option key={item}>{item}</option>)}</select></label><label htmlFor="record-notes">內部備註<span className="field-hint">只供後台跟進，客戶配對版PDF不會包含。</span><textarea id="record-notes" rows={3} maxLength={4000} disabled={editingDisabled} value={draft?.notes||''} onChange={event=>updateDraft({notes:event.target.value})}/></label><div className="followup-date-grid"><label htmlFor="record-followup-day">下次跟進日期<input id="record-followup-day" type="date" min="2000-01-01" max="2100-12-31" disabled={editingDisabled} value={followUp.day} onChange={event=>updateDraft({nextFollowUp:event.target.value?`${event.target.value}${followUp.time?'T'+followUp.time:''}`:''})}/></label><label htmlFor="record-followup-time">時間（香港時間，選填）<input id="record-followup-time" type="time" disabled={editingDisabled||!followUp.day} value={followUp.time} onChange={event=>updateDraft({nextFollowUp:followUp.day+(event.target.value?'T'+event.target.value:'')})}/></label></div></div>
        <details className="complete-record-editor private-intake-editor" ref={completeEditorRef}><summary>修改完整登記資料</summary>{drawer.photoId&&<img className="private-photo" src={`/api/admin/photos/${encodeURIComponent(drawer.photoId)}`} alt="登記人照片"/>}{Object.keys(recordErrors).length>0&&<div className="form-message error" role="alert"><strong>請檢查以下資料</strong><ul>{Object.entries(recordErrors).map(([name,message])=><li key={name}><a href={`#record-field-${name}`}>{message}</a></li>)}</ul></div>}{sections[drawer.kind].map(section=><section key={section.title}><h3>{section.title}</h3><IntakeDataFields fields={section.fields} data={draft?.data||drawer.data} errors={recordErrors} disabled={editingDisabled} idPrefix="record-" restrictPublicConsent={drawer.data.publicProfileConsent!==true} onChange={(name,value)=>{updateDraft({data:{...(draft?.data||drawer.data),[name]:value}});setRecordErrors(current=>{const next={...current};delete next[name];return next;});}}/></section>)}</details>
        <div className="followup-save"><span aria-live="polite">{saveNote&&<><Check size={15} aria-hidden="true"/>{saveNote}</>}{draftChanged&&!saveNote?'有未儲存的修改':''}</span><button type="submit" className="work-button primary" disabled={editingDisabled||conflictState==='detected'||!draftChanged}>{saving?'正在儲存…':conflictState==='review'?'確認覆蓋並儲存':'儲存更新'}</button></div>
      </form>
      <div className="drawer-details">{sections[drawer.kind].map(section => <section key={section.title}><h3>{section.title}</h3><dl>{section.fields.filter(field=>isFieldVisible(field,drawer.data)).map(field => <div key={field.name}><dt>{field.label}</dt><dd>{intakeFieldValue(field,drawer.data[field.name])}</dd></div>)}</dl></section>)}</div>
      <div className="drawer-export"><p>目前PDF版本：<strong>{exportMode === 'client' ? '客戶配對版' : '完整資料'}</strong></p><button className="work-button secondary" disabled={exporting || detailLoading} onClick={() => void downloadPdf('selected', drawer.id)}><ArrowDownToLine size={16} aria-hidden="true"/>{exporting ? '正在製作PDF…' : '下載這份登記'}</button>{exportError && <p className="field-error" role="alert">{exportError}</p>}</div>
    </div></div></div>}
  </main>;
}
