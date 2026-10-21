"use client";

import { useEffect, useState } from 'react';
import type { CandidatePublic, CandidateResults } from '@/lib/platform-types';
import { useLocale } from './locale-provider';
import { t } from '@/lib/i18n';

export const savedStorageKey = 'jiahe.saved-candidates.v1';
export const compareStorageKey = 'jiahe.compare-candidates.v1';
const selectionEvent = 'jiahe:candidate-selection';
export function candidateIds(value: unknown, limit = 30) {
  const values = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [];
  return [...new Set(values.filter((id): id is string => typeof id === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id)))].slice(0, limit);
}
export function useCandidateSelections() {
  const [saved, setSaved] = useState<string[]>([]), [compared, setCompared] = useState<string[]>([]);
  const [ready, setReady] = useState(false), [message, setMessage] = useState('');
  useEffect(() => {
    const read = () => {
      try { setSaved(candidateIds(JSON.parse(localStorage.getItem(savedStorageKey) || '[]'))); setCompared(candidateIds(JSON.parse(localStorage.getItem(compareStorageKey) || '[]'), 3)); }
      catch { setMessage('此瀏覽器未能讀取已保存的人選。'); }
      setReady(true);
    };
    read(); window.addEventListener('storage', read); window.addEventListener(selectionEvent, read);
    return () => { window.removeEventListener('storage', read); window.removeEventListener(selectionEvent, read); };
  }, []);
  const write = (kind: 'saved' | 'compare', next: string[]) => {
    const setter = kind === 'saved' ? setSaved : setCompared, key = kind === 'saved' ? savedStorageKey : compareStorageKey;
    setter(next);
    try { localStorage.setItem(key, JSON.stringify(next)); window.dispatchEvent(new Event(selectionEvent)); }
    catch { setMessage('此瀏覽器未能保存選擇，關閉頁面後可能不會保留。'); }
  };
  const toggle = (kind: 'saved' | 'compare', id: string) => {
    const current = kind === 'saved' ? saved : compared, maximum = kind === 'saved' ? 30 : 3;
    if (current.includes(id)) { write(kind, current.filter(item => item !== id)); setMessage(kind === 'saved' ? '已取消收藏。' : '已移出比較。'); return; }
    if (current.length >= maximum) { setMessage(kind === 'saved' ? '最多可收藏30位人選，請先移除部分收藏。' : '最多可比較3位人選，請先移除一位。'); return; }
    write(kind, [...current, id]); setMessage(kind === 'saved' ? '已加入收藏。' : `已加入比較，共${current.length + 1}位。`);
  };
  return { saved, compared, ready, message, setMessage, toggle, write };
}
export type CandidateSelection = ReturnType<typeof useCandidateSelections>;
export async function readCandidates(ids: string[], signal: AbortSignal): Promise<CandidatePublic[]> {
  if (!ids.length) return [];
  const fetched: CandidatePublic[] = [];
  for (let page = 1; page <= 3; page++) {
    const query = new URLSearchParams({ ids: ids.join(','), page: String(page) });
    const response = await fetch(`/api/candidates?${query}`, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error('暫時未能載入人選，請再試一次。');
    const result = await response.json() as CandidateResults;
    if (!Array.isArray(result.candidates)) throw new Error('暫時未能載入人選，請再試一次。');
    fetched.push(...result.candidates);
    if (fetched.length >= result.total || result.candidates.length === 0) break;
  }
  const byId = new Map(fetched.map(candidate => [candidate.id, candidate]));
  return ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
}
export function candidateSalary(candidate: CandidatePublic) {
  if (candidate.salaryNegotiable) return '可商議';
  if (!candidate.expectedSalary) return '待確認';
  const value = /^\d+(\.\d+)?$/.test(candidate.expectedSalary) ? Number(candidate.expectedSalary).toLocaleString('en-HK') : candidate.expectedSalary;
  return `HK$ ${value}${candidate.salaryUnit ? `／${candidate.salaryUnit.replace(/^每/, '')}` : ''}`;
}
export function candidateDate(value: string) { return value ? value.replace(/-/g, '/') : '待確認'; }
export const candidateLink = (id: string, returnTo?: string) => `/candidates/${encodeURIComponent(id)}${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
export const employerLink = (ids: string[]) => `/employer${ids.length ? `?candidates=${encodeURIComponent(ids.join(','))}` : ''}`;
export const compareLink = (ids: string[]) => `/compare${ids.length ? `?ids=${encodeURIComponent(ids.join(','))}` : ''}`;

export function CandidatePortrait({ candidate, large = false }: { candidate: CandidatePublic; large?: boolean }) {
  const {locale}=useLocale(),tr=(value:string)=>t(locale,value);
  const [failed, setFailed] = useState(false);
  return <div className={`candidate-portrait${large ? ' candidate-portrait-large' : ''}`}>
    {candidate.hasPhoto && !failed ? <img src={`/api/candidates/${encodeURIComponent(candidate.id)}/photo`} alt={locale==='en'?`Photo of ${candidate.displayName}`:`${candidate.displayName}的照片`} loading={large ? 'eager' : 'lazy'} onError={() => setFailed(true)} /> : <div className="candidate-no-photo"><span aria-hidden="true">{candidate.displayName.trim().slice(0, 1) || '人'}</span><small>{tr(failed ? '照片暫未能顯示' : '未提供照片')}</small></div>}
  </div>;
}
export function CandidateButtons({ candidate, selection, includeChoose = false }: { candidate: CandidatePublic; selection: CandidateSelection; includeChoose?: boolean }) {
  const {locale}=useLocale(),tr=(value:string)=>t(locale,value);
  const saved = selection.saved.includes(candidate.id), compared = selection.compared.includes(candidate.id);
  return <div className="candidate-action-row">
    {includeChoose && <a className="button primary" href={employerLink([candidate.id])}>{tr('選擇此人選')}</a>}
    <button className="candidate-action" type="button" aria-pressed={saved} disabled={!selection.ready} onClick={() => selection.toggle('saved', candidate.id)} aria-label={`${tr(saved ? '取消收藏' : '收藏')}${candidate.displayName}`}>{tr(saved ? '已收藏' : '收藏')}</button>
    <button className="candidate-action" type="button" aria-pressed={compared} disabled={!selection.ready} onClick={() => selection.toggle('compare', candidate.id)} aria-label={`${tr(compared ? '移出比較' : '加入比較')}${candidate.displayName}`}>{tr(compared ? '已加入比較' : '加入比較')}</button>
  </div>;
}
export function CandidateCard({ candidate, selection, returnTo }: { candidate: CandidatePublic; selection: CandidateSelection; returnTo?: string }) {
  const {locale}=useLocale(),tr=(value:string)=>t(locale,value);
  return <article className="candidate-card">
    <a className="candidate-card-main" href={candidateLink(candidate.id, returnTo)}>
      <CandidatePortrait candidate={candidate} />
      <div className="candidate-card-info">
        <p className="candidate-reference">{candidate.reference}</p><h2>{candidate.displayName}</h2>
        <p className="candidate-type">{tr(candidate.candidateType || '求職者')}{candidate.nationality ? ` · ${tr(candidate.nationality)}` : ''}</p>
        <dl className="candidate-card-facts"><div><dt>{tr('經驗')}</dt><dd>{tr(candidate.yearsExperience || '待確認')}</dd></div><div><dt>{tr('可到職')}</dt><dd>{candidateDate(candidate.availableFrom)}</dd></div><div><dt>{tr('期望薪金')}</dt><dd>{candidateSalary(candidate).split('、').map(x=>tr(x)).join('、')}</dd></div></dl>
        <p className="candidate-services">{candidate.services.map(service=>tr(service)).join(' · ') || tr('服務待確認')}</p>
        {candidate.languages.length > 0 && <p className="candidate-languages">{candidate.languages.map(language=>tr(language)).join('、')}</p>}
        {candidate.skills.length > 0 && <p className="candidate-skills">{candidate.skills.slice(0, 4).map(skill=>tr(skill)).join('、')}{candidate.skills.length > 4 ? tr(' 等') : ''}</p>}
        <span className="candidate-view">{tr('查看履歷')} <span aria-hidden="true">→</span></span>
      </div>
    </a>
    <CandidateButtons candidate={candidate} selection={selection} />
  </article>;
}
export function CandidateUtilityLinks({ selection }: { selection: CandidateSelection }) {
  const {locale}=useLocale(),tr=(value:string)=>t(locale,value);
  return <nav className="candidate-utility" aria-label={tr('人選清單')}><a href="/saved">{tr('已收藏人選')}{selection.ready ? `（${selection.saved.length}）` : ''}</a><a href={compareLink(selection.compared)}>{tr('比較人選')}{selection.ready ? `（${selection.compared.length}/3）` : ''}</a></nav>;
}
export function CandidateSelectionBar({ selection }: { selection: CandidateSelection }) {
  const {locale}=useLocale(),tr=(value:string)=>t(locale,value);
  if (!selection.compared.length) return null;
  return <aside className="candidate-selection-bar" aria-label={tr('比較清單')}><span>{tr(`已選${selection.compared.length}位人選`)}</span><a className="button secondary" href={compareLink(selection.compared)}>{tr('比較資料')}</a><a className="button primary" href={employerLink(selection.compared)}>{tr('提交聘用需要')}</a><button className="candidate-clear" type="button" onClick={() => { selection.write('compare', []); selection.setMessage('已清空比較清單。'); }}>{tr('清空')}</button></aside>;
}
export function CandidateNoScript() { return <noscript><style>{'.candidate-status,.candidate-search-layout,.candidate-utility{display:none!important}'}</style><div className="candidate-notice">請啟用 JavaScript 查看及選擇人選。你也可以先查看<a href="/services">服務介紹</a>。</div></noscript>; }
export function CandidateEmpty({ filtered = false, employerHref = '/employer' }: { filtered?: boolean; employerHref?: string }) {
  const {locale}=useLocale(),tr=(value:string)=>t(locale,value);
  return <div className="candidate-empty"><h2>{tr(filtered ? '暫時沒有符合條件的人選' : '暫時未有公開人選')}</h2><p>{tr(filtered ? '可以減少篩選條件，或把需要交給我們跟進。' : '你可先填寫服務需要，方便安排合適人選。')}</p><a className="button primary" href={employerHref}>{tr('填寫聘用需要')}</a><a className="candidate-text-link" href="/jobseeker">{tr('我想登記求職')}</a></div>;
}
