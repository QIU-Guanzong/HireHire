"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { type IntakeRecord } from '@/lib/fields';
import { matchStages, type MatchRecord } from '@/lib/platform-types';
import { AdminApiError, adminRequest, PrivateAdminShell } from './private-admin-shell';
import { PrivateRecordPicker } from './private-admin-record-picker';

type MatchDraft = { stage: MatchRecord['stage']; notes: string; interviewAt: string; baseUpdatedAt: string };
type MatchResults = { matches: MatchRecord[]; total: number; page: number; pageSize: number; asOf: string };
const fromRecord = (record: MatchRecord): MatchDraft => ({ stage: record.stage, notes: record.notes, interviewAt: record.interviewAt, baseUpdatedAt: record.updatedAt });
function dateParts(value: string) {
  if (!value.endsWith('Z')) return { day: value.slice(0, 10), time: value.slice(11, 16) };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { day: '', time: '' };
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (name: string) => parts.find(part => part.type === name)?.value || '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
const dateLabel = (value: string) => { const parts = dateParts(value); return parts.day ? `${parts.day}${parts.time ? ` ${parts.time}` : ''}` : '未安排'; };
function validInterview(value: string) {
  if (!value) return true;
  const day = value.slice(0, 10), date = new Date(`${day}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?Z)?)?$/.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day && day >= '2000-01-01' && day <= '2100-12-31' && (!value.includes('T') || (Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60));
}
function MatchFields({ value, onChange, disabled, prefix }: { value: MatchDraft; onChange: (value: Partial<MatchDraft>) => void; disabled: boolean; prefix: string }) {
  const parts = dateParts(value.interviewAt);
  return <div className="private-fields">
    <label htmlFor={`${prefix}-stage`}>配對階段<select id={`${prefix}-stage`} disabled={disabled} value={value.stage} onChange={event => onChange({ stage: event.target.value as MatchRecord['stage'] })}>{matchStages.map(stage => <option key={stage}>{stage}</option>)}</select></label>
    <label htmlFor={`${prefix}-day`}>面試日期<input id={`${prefix}-day`} type="date" min="2000-01-01" max="2100-12-31" disabled={disabled} value={parts.day} onChange={event => onChange({ interviewAt: event.target.value ? `${event.target.value}${parts.time ? `T${parts.time}` : ''}` : '' })}/></label>
    <label htmlFor={`${prefix}-time`}>面試時間（香港時間，選填）<input id={`${prefix}-time`} type="time" disabled={disabled || !parts.day} value={parts.time} onChange={event => onChange({ interviewAt: parts.day + (event.target.value ? `T${event.target.value}` : '') })}/></label>
    <label className="private-wide" htmlFor={`${prefix}-notes`}>內部配對備註<textarea id={`${prefix}-notes`} rows={3} maxLength={4000} disabled={disabled} value={value.notes} onChange={event => onChange({ notes: event.target.value })}/><span className="field-hint">只供後台跟進，客戶配對版PDF不包含此備註。</span></label>
  </div>;
}
function MatchesManager() {
  const [employer, setEmployer] = useState<IntakeRecord | null>(null), [jobseeker, setJobseeker] = useState<IntakeRecord | null>(null);
  const [newDraft, setNewDraft] = useState<MatchDraft>({ stage: '待聯絡', notes: '', interviewAt: '', baseUpdatedAt: '' });
  const [stage, setStage] = useState(''), [employerFilter, setEmployerFilter] = useState<{ id: string; label: string } | null>(null), [page, setPage] = useState(1), [result, setResult] = useState<MatchResults | null>(null), [loading, setLoading] = useState(false), [listError, setListError] = useState(''), [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<MatchRecord | null>(null), [drafts, setDrafts] = useState<Record<string, MatchDraft>>({}), [conflict, setConflict] = useState<'detected' | 'review' | null>(null), [detailLoading, setDetailLoading] = useState(false), [creating, setCreating] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(''), [note, setNote] = useState('');
  const [pdfMode, setPdfMode] = useState<'client' | 'full'>('client'), [exportEmployer, setExportEmployer] = useState<{ id: string; label: string } | null>(null), [exportTotal, setExportTotal] = useState(0), [exportAsOf,setExportAsOf] = useState(''), [exportCountLoading, setExportCountLoading] = useState(false), [batchSize, setBatchSize] = useState(20), [batch, setBatch] = useState(1), [exporting, setExporting] = useState(false), [exportError, setExportError] = useState('');
  const editorRef = useRef<HTMLElement>(null), busyRef = useRef(false), exportBusyRef = useRef(false), detailRequestRef = useRef<AbortController | null>(null), downloadUrlsRef = useRef(new Set<string>());

  useEffect(() => { if (!Object.keys(drafts).length) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [drafts]);

  useEffect(() => {
    const controller = new AbortController(), params = new URLSearchParams(window.location.search);
    for (const [name, kind, setter] of [['employerId', 'employer', setEmployer], ['jobseekerId', 'jobseeker', setJobseeker]] as const) {
      const id = params.get(name);
      if (id && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id)) adminRequest<IntakeRecord>(`/api/admin/records/${encodeURIComponent(id)}`, { signal: controller.signal }).then(record => { if (!controller.signal.aborted && record.kind === kind) setter(record); }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '未能讀取指定登記。'); });
    }
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setListError('');
    const params = new URLSearchParams({ stage, page: String(page) }); if (employerFilter) params.set('employerId', employerFilter.id);
    adminRequest<MatchResults>(`/api/admin/matches?${params}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setResult(value); }).catch(caught => { if (!controller.signal.aborted) setListError(caught instanceof Error ? caught.message : '未能讀取配對。'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [stage, employerFilter, page, refresh]);
  useEffect(() => {
    if (!exportEmployer) { setExportTotal(0); return; }
    const controller = new AbortController(); setExportCountLoading(true); setExportError(''); setExportTotal(0); setBatch(1);
    adminRequest<MatchResults>(`/api/admin/matches?employerId=${encodeURIComponent(exportEmployer.id)}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) { setExportTotal(value.total);setExportAsOf(value.asOf); } }).catch(caught => { if (!controller.signal.aborted) setExportError(caught instanceof Error ? caught.message : '未能讀取配對數量。'); }).finally(() => { if (!controller.signal.aborted) setExportCountLoading(false); });
    return () => controller.abort();
  }, [exportEmployer, refresh]);
  useEffect(() => () => { detailRequestRef.current?.abort(); downloadUrlsRef.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  const draft = editing ? drafts[editing.id] || fromRecord(editing) : null;
  const showEditor = (current: MatchRecord) => {
    setEditing(current); setConflict(drafts[current.id] && drafts[current.id].baseUpdatedAt !== current.updatedAt ? 'review' : null);
    requestAnimationFrame(() => { editorRef.current?.focus(); editorRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); });
  };
  async function currentMatch(record: MatchRecord, signal?: AbortSignal) {
    const params = new URLSearchParams({ employerId: record.employerId, jobseekerId: record.jobseekerId });
    const value = await adminRequest<MatchResults>(`/api/admin/matches?${params}`, { signal });
    const current = value.matches.find(item => item.id === record.id);
    if (!current) throw new Error('此配對已不存在，修改內容仍然保留。');
    return current;
  }
  const open = async (record: MatchRecord, reloading = false) => {
    if (busyRef.current) return;
    detailRequestRef.current?.abort(); const controller = new AbortController(); detailRequestRef.current = controller;
    setDetailLoading(true); setError(''); setNote('');
    try { const current = await currentMatch(record, controller.signal); if (!controller.signal.aborted) { showEditor(current); if (reloading) setConflict('review'); } }
    catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '未能讀取配對資料。'); }
    finally { if (!controller.signal.aborted) setDetailLoading(false); }
  };
  const create = async (event: FormEvent) => {
    event.preventDefault(); if (!employer || !jobseeker || busyRef.current || detailLoading) return;
    if (!validInterview(newDraft.interviewAt)) { setError('請填寫有效的面試日期及時間。'); return; }
    busyRef.current = true; setCreating(true); setError(''); setNote('');
    try {
      const record = await adminRequest<MatchRecord>('/api/admin/matches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employerId: employer.id, jobseekerId: jobseeker.id, stage: newDraft.stage, notes: newDraft.notes, interviewAt: newDraft.interviewAt }) });
      showEditor(record); setNote('配對已開啟；同一僱主及求職者只建立一份配對。'); setRefresh(value => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '未能建立配對，填寫內容仍然保留。'); }
    finally { busyRef.current = false; setCreating(false); }
  };
  const change = (next: Partial<MatchDraft>) => { if (!editing || saving || detailLoading) return; setDrafts(value => ({ ...value, [editing.id]: { ...(value[editing.id] || fromRecord(editing)), ...next } })); setNote(''); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!editing || !draft || busyRef.current || detailLoading || conflict === 'detected') return;
    if (!validInterview(draft.interviewAt)) { setError('請填寫有效的面試日期及時間。'); return; }
    busyRef.current = true; setSaving(true); setError(''); setNote('');
    try {
      const saved = await adminRequest<MatchRecord>(`/api/admin/matches/${encodeURIComponent(editing.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: draft.stage, notes: draft.notes, interviewAt: draft.interviewAt, expectedUpdatedAt: editing.updatedAt }) });
      setEditing(saved); setDrafts(value => { const next = { ...value }; delete next[saved.id]; return next; }); setConflict(null); setNote('配對跟進已儲存'); setRefresh(value => value + 1);
    } catch (caught) { if (caught instanceof AdminApiError && caught.status === 409) setConflict('detected'); setError(caught instanceof Error ? caught.message : '未能儲存配對，修改內容仍然保留。'); }
    finally { busyRef.current = false; setSaving(false); }
  };
  const exportPdf = async () => {
    if (!exportEmployer || exportBusyRef.current || exportCountLoading || !exportTotal) return;
    exportBusyRef.current = true; setExporting(true); setExportError('');
    try {
      const params = new URLSearchParams({ employerId: exportEmployer.id, mode: pdfMode, batch: String(batch), batchSize: String(batchSize), ...(exportAsOf?{asOf:exportAsOf}:{}) });
      const response = await fetch(`/api/admin/matches/export?${params}`, { cache: 'no-store' });
      if (!response.ok) { const value = await response.json().catch(() => ({})) as { error?: string }; throw new Error(value.error || '未能產生PDF，請重試。'); }
      if (!response.headers.get('Content-Type')?.includes('application/pdf')) throw new Error('PDF尚未完成，請重試。');
      const url = URL.createObjectURL(await response.blob()); downloadUrlsRef.current.add(url);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `jiahe-matches-${pdfMode}-${batch}.pdf`; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => { URL.revokeObjectURL(url); downloadUrlsRef.current.delete(url); }, 1000);
    } catch (caught) { setExportError(caught instanceof Error ? caught.message : '下載未完成，請重試。'); }
    finally { exportBusyRef.current = false; setExporting(false); }
  };
  const pages = Math.max(1, Math.ceil((result?.total || 0) / (result?.pageSize || 200))), batches = Math.max(1, Math.ceil(exportTotal / batchSize));
  return <>
    <section className="private-editor"><h2>建立配對</h2><form onSubmit={create} noValidate><div className="private-fields"><PrivateRecordPicker kind="employer" label="選擇僱主登記" value={employer?.id || ''} onChange={setEmployer} disabled={creating || saving || detailLoading}/><PrivateRecordPicker kind="jobseeker" label="選擇求職者登記" value={jobseeker?.id || ''} onChange={setJobseeker} disabled={creating || saving || detailLoading}/></div><MatchFields prefix="new-match" value={newDraft} onChange={next => setNewDraft(value => ({ ...value, ...next }))} disabled={creating || saving || detailLoading}/><div className="private-actions"><button className="work-button primary" type="submit" disabled={!employer || !jobseeker || creating || saving || detailLoading}>{creating ? '正在建立…' : '建立或開啟配對'}</button></div></form></section>
    <section className="private-editor"><h2>下載僱主及配對人選資料</h2><p>每批包含一份僱主資料及所列配對的求職者資料；分批下載可取得全部配對。</p><div className="private-fields"><PrivateRecordPicker kind="employer" label="選擇下載資料的僱主" value={exportEmployer?.id || ''} disabled={exporting} onChange={record => setExportEmployer(record ? { id: record.id, label: `${String(record.data.fullName || '')} · ${record.reference}` } : null)}/><div className="private-pdf-options"><fieldset><legend>PDF內容</legend><label className="private-inline-check"><input type="radio" name="match-pdf-mode" value="client" checked={pdfMode === 'client'} disabled={exporting} onChange={() => setPdfMode('client')}/>客戶配對版</label><label className="private-inline-check"><input type="radio" name="match-pdf-mode" value="full" checked={pdfMode === 'full'} disabled={exporting} onChange={() => setPdfMode('full')}/>後台完整資料</label></fieldset><p className="field-hint">{pdfMode === 'client' ? '包含服務及配對資料，不含電話、電郵及內部備註。' : '包含聯絡資料及內部備註，只供內部使用。'}</p><div className="private-fields"><label>每份PDF包含配對數<select value={batchSize} disabled={exporting} onChange={event => { setBatchSize(Number(event.target.value)); setBatch(1); }}>{[5,20,50,100].map(size => <option key={size} value={size}>{size}份</option>)}</select></label><label>下載批次<select value={batch} disabled={exporting || exportCountLoading || !exportTotal} onChange={event => setBatch(Number(event.target.value))}>{exportTotal>0?Array.from({ length: batches }, (_, index) => <option key={index} value={index + 1}>{index * batchSize + 1}–{Math.min(exportTotal, (index + 1) * batchSize)}／{exportTotal}份</option>):<option value={1}>{exportEmployer?'尚未有配對資料':'先選擇僱主'}</option>}</select></label></div></div></div>{exportError && <p className="private-message error" role="alert">{exportError}</p>}<div className="private-actions"><span>{exportCountLoading ? '正在讀取配對數量…' : exportEmployer ? `${exportEmployer.label} · 共${exportTotal}份配對` : '先選擇僱主'}</span><button type="button" className="work-button primary" disabled={exporting || exportCountLoading || !exportEmployer || !exportTotal} onClick={() => void exportPdf()}>{exporting ? '正在產生PDF…' : '下載此批資料'}</button></div></section>
    <div className="private-toolbar"><label>配對階段<select value={stage} onChange={event => { setStage(event.target.value); setPage(1); }}><option value="">全部階段</option>{matchStages.map(item => <option key={item}>{item}</option>)}</select></label>{employerFilter && <p>僱主：{employerFilter.label} <button className="text-action" onClick={() => { setEmployerFilter(null); setPage(1); }}>清除</button></p>}</div>
    {listError ? <p className="private-message error" role="alert">{listError} <button className="text-action" onClick={() => setRefresh(value => value + 1)}>重試</button></p> : loading ? <p className="private-message" role="status">正在讀取配對…</p> : !result?.matches.length ? <p className="private-empty">沒有符合條件的配對。</p> : <div className="admin-table-wrap"><table className="admin-table"><caption className="sr-only">配對跟進，第{page}頁</caption><thead><tr><th scope="col">僱主</th><th scope="col">求職者</th><th scope="col">階段</th><th scope="col">面試（香港時間）</th><th scope="col">操作</th></tr></thead><tbody>{result.matches.map(record => <tr key={record.id}><td><strong>{record.employerName}</strong><span className="record-reference">{record.employerReference}</span><button className="text-action" onClick={() => { setEmployerFilter({ id: record.employerId, label: record.employerName }); setPage(1); }}>此僱主配對</button></td><td><strong>{record.jobseekerName}</strong><span className="record-reference">{record.jobseekerReference}</span></td><td>{record.stage}</td><td>{dateLabel(record.interviewAt)}</td><td><div className="private-row-actions"><button className="text-action" disabled={detailLoading || saving || creating} onClick={() => void open(record)}>修改跟進</button><button className="text-action" disabled={exporting} onClick={() => { setExportEmployer({ id: record.employerId, label: `${record.employerName} · ${record.employerReference}` }); document.getElementById('private-picker-employer-選擇下載資料的僱主')?.focus(); }}>選為下載僱主</button></div></td></tr>)}</tbody></table></div>}
    {result && result.total > 0 && <nav className="admin-pagination" aria-label="配對分頁"><span>共{result.total}份，第{page}／{pages}頁</span><div><button className="work-button secondary" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>上一頁</button><button className="work-button secondary" disabled={loading || page >= pages} onClick={() => setPage(value => value + 1)}>下一頁</button></div></nav>}
    {error && !editing && <p className="private-message error" role="alert">{error}</p>}
    {editing && draft && <section className="private-editor" tabIndex={-1} ref={editorRef} aria-label="修改配對"><h2>{editing.employerName} · {editing.jobseekerName}</h2><p><a className="text-action" href={`/admin?q=${encodeURIComponent(editing.employerReference)}`} target="_blank" rel="noopener noreferrer">僱主登記 {editing.employerReference}</a> · <a className="text-action" href={`/admin?q=${encodeURIComponent(editing.jobseekerReference)}`} target="_blank" rel="noopener noreferrer">求職者登記 {editing.jobseekerReference}</a></p>{conflict === 'detected' && <div className="private-comparison" role="alert"><strong>此配對已有其他更新</strong><p>你的修改仍然保留，請先載入最新內容。</p><button type="button" className="work-button secondary" disabled={detailLoading} onClick={() => void open(editing, true)}>載入最新資料</button></div>}{conflict === 'review' && <div className="private-comparison"><strong>目前已儲存的內容</strong><dl><div><dt>階段</dt><dd>{editing.stage}</dd></div><div><dt>面試時間</dt><dd>{dateLabel(editing.interviewAt)}</dd></div><div><dt>內部備註</dt><dd>{editing.notes || '未填寫'}</dd></div></dl><p>你的修改在下方。核對後可確認覆蓋。</p></div>}{error && <p className="private-message error" role="alert">{error}</p>}{note && <p className="private-message" role="status">{note}</p>}<form noValidate onSubmit={save}><MatchFields prefix="edit-match" value={draft} onChange={change} disabled={saving || detailLoading}/><div className="private-actions"><button type="button" className="work-button secondary" disabled={saving || detailLoading} onClick={() => setEditing(null)}>返回列表</button><button className="work-button primary" type="submit" disabled={saving || detailLoading || conflict === 'detected'}>{saving ? '正在儲存…' : conflict === 'review' ? '確認覆蓋並儲存' : '儲存跟進'}</button></div></form></section>}
  </>;
}

export default function PrivateAdminMatches() { return <PrivateAdminShell active="/admin/matches" title="配對跟進" description="建立僱主與求職者配對，安排面試及下載資料。"><MatchesManager/></PrivateAdminShell>; }
