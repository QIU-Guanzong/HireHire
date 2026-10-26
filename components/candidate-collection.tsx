"use client";

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CandidatePublic } from '@/lib/platform-types';
import { CandidateCard, CandidateNoScript, CandidatePortrait, CandidateSelectionBar, CandidateUtilityLinks, candidateDate, candidateIds, candidateLink, candidateSalary, employerLink, readCandidates, useCandidateSelections } from './candidate-common';
import './candidates.css';
import { useLocale } from './locale-provider';
import { t } from '@/lib/i18n';

type CollectionMode = 'saved' | 'compare';
export function CandidateCollection({ mode }: { mode: CollectionMode }) {
  const {locale}=useLocale(),tr=(value:string)=>t(locale,value);
  const selection = useCandidateSelections(), [candidates, setCandidates] = useState<CandidatePublic[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const initialized = useRef(false), collectionHeading = useRef<HTMLHeadingElement>(null), focusAfterRemove = useRef(false), ids = mode === 'saved' ? selection.saved : selection.compared, signature = ids.join(',');
  useEffect(() => {
    if (!selection.ready || initialized.current) return;
    initialized.current = true;
    if (mode === 'compare') {
      const params = new URLSearchParams(window.location.search);
      if (params.has('ids')) {
        const idsFromUrl = candidateIds(params.get('ids'), 3), persisted = selection.write('compare', idsFromUrl);
        if (persisted && candidateIds(params.get('ids')).length > 3) selection.setMessage('每次最多比較3位，已保留前3位人選。');
        window.history.replaceState(null, '', `/compare${idsFromUrl.length ? `?ids=${encodeURIComponent(idsFromUrl.join(','))}` : ''}`);
      }
    }
  }, [selection.ready, mode]);
  useEffect(() => { if (!loading && focusAfterRemove.current) { collectionHeading.current?.focus(); focusAfterRemove.current = false; } }, [loading, signature]);
  useEffect(() => { if (mode === 'compare' && selection.ready && initialized.current) window.history.replaceState(null, '', `/compare${ids.length ? `?ids=${encodeURIComponent(signature)}` : ''}`); }, [mode, signature, selection.ready]);
  useEffect(() => {
    if (!selection.ready) return;
    const controller = new AbortController(); setError('');
    if (!signature) { setCandidates([]); setLoading(false); return () => controller.abort(); }
    setLoading(true);
    readCandidates(candidateIds(signature), controller.signal).then(data => { setCandidates(data); setLoading(false); }).catch((reason: unknown) => { if (controller.signal.aborted) return; setError(reason instanceof Error ? reason.message : '暫時未能載入人選，請再試一次。'); setLoading(false); });
    return () => controller.abort();
  }, [signature, selection.ready, retry]);
  const current = candidates.filter(candidate => ids.includes(candidate.id)), missing = loading || error ? [] : ids.filter(id => !current.some(candidate => candidate.id === id));
  const writeCollection = (next: string[]) => {
    const persisted = selection.write(mode === 'saved' ? 'saved' : 'compare', next);
    if (mode === 'compare') window.history.replaceState(null, '', `/compare${next.length ? `?ids=${encodeURIComponent(next.join(','))}` : ''}`);
    return persisted;
  };
  const remove = (id: string) => { focusAfterRemove.current = true; if (writeCollection(ids.filter(item => item !== id))) selection.setMessage(mode === 'saved' ? '已取消收藏。' : '已移出比較。'); };
  const title = tr(mode === 'saved' ? '已收藏人選' : '比較人選');
  const compareRows: { label: string; value: (candidate: CandidatePublic) => ReactNode }[] = [
    { label: '服務類別', value: c => c.services.map(tr).join('、') || tr('待確認') },
    { label: '求職情況', value: c => tr(c.candidateType || '待確認') },
    { label: '國籍／地區', value: c => tr(c.nationality || '待確認') },
    { label: '年齡', value: c => c.age ? tr(`${c.age}歲`) : tr('未填寫') },
    { label: '教育程度', value: c => tr(c.education || '未填寫') },
    { label: '目前所在地', value: c => tr(c.currentLocation || '未填寫') },
    { label: '相關工作年資', value: c => tr(c.yearsExperience || '待確認') },
    { label: '溝通語言', value: c => c.languages.map(tr).join('、') || tr('待確認') },
    { label: '工作技能', value: c => c.skills.map(tr).join('、') || tr('未填寫') },
    { label: '工作形式', value: c => tr(c.employmentType || '待確認') },
    { label: '可工作地區', value: c => c.workLocations.map(tr).join('、') || tr('待確認') },
    { label: '最快可到職', value: c => candidateDate(c.availableFrom) },
    { label: '期望薪金', value: c => tr(candidateSalary(c)) },
    { label: '培訓及證書', value: c => c.qualifications || tr('未填寫') },
    { label: '自我介紹', value: c => c.summary || tr('未填寫') },
    { label: '工作經歷', value: c => c.workExperiences.length ? <ol className="candidate-compare-history">{c.workExperiences.map((work, index) => <li key={index}><strong>{work.country || tr(`工作${index + 1}`)}</strong><span>{work.from ? candidateDate(work.from) : tr('日期待確認')}{work.to ? ` ${tr('至')} ${candidateDate(work.to)}` : ` ${tr('至今')}`}</span>{work.household && <span>{tr('家庭：')}{work.household}</span>}{work.duties && <span>{tr('工作：')}{work.duties}</span>}{work.leavingReason && <span>{tr('離職：')}{work.leavingReason}</span>}</li>)}</ol> : tr('暫未提供') },
  ];
  return <main id="main-content" className="site-width candidate-page candidate-collection-page">
    <div className="candidate-page-heading"><div><p className="candidate-breadcrumb"><a href="/">{tr('首頁')}</a><span aria-hidden="true">／</span><a href="/candidates">{tr('搜尋人選')}</a><span aria-hidden="true">／</span>{title}</p><h1>{title}</h1><p>{tr(mode === 'saved' ? '收藏保存在此瀏覽器，方便稍後查看。最多可收藏30位。' : '最多比較3位，查看經驗、工作意向及期望薪金。')}</p></div><CandidateUtilityLinks selection={selection} /></div>
    <CandidateNoScript /><p className="candidate-status" role="status">{loading ? tr('正在載入人選…') : tr(selection.message)}</p>
    {error ? <div className="candidate-error" role="alert"><p>{tr(error)}</p><button className="button secondary" type="button" onClick={() => setRetry(retry + 1)}>{tr('重新載入')}</button></div> : <>
      {missing.length > 0 && <div className="candidate-unavailable-notice"><p>{tr(`${missing.length}位人選暫未能查看資料。`)}</p><button type="button" onClick={() => { focusAfterRemove.current = true; if (writeCollection(ids.filter(id => !missing.includes(id)))) selection.setMessage('已移除未能查看的人選。'); }}>{tr('移除這些人選')}</button></div>}
      {!loading && current.length === 0 && <div className="candidate-empty"><h2 ref={collectionHeading} tabIndex={-1}>{tr(mode === 'saved' ? '還沒有可查看的收藏' : '尚未選擇可比較的人選')}</h2><p>{tr(mode === 'saved' ? '在人選履歷按「收藏」，即可保留在此瀏覽器。' : '在人選履歷按「加入比較」，最多選擇3位。')}</p><a className="button primary" href="/candidates">{tr('搜尋人選')}</a><a className="candidate-text-link" href="/employer">{tr('直接填寫聘用需要')}</a></div>}
      {current.length > 0 && mode === 'saved' && <><div className="candidate-collection-toolbar"><h2>{tr(`${current.length}位已收藏人選`)}</h2><a href="/candidates" className="candidate-text-link">{tr('繼續搜尋')} →</a></div><div className="candidate-grid candidate-saved-grid">{current.map(candidate => <CandidateCard candidate={candidate} key={candidate.id} selection={selection} />)}</div></>}
      {current.length > 0 && mode === 'compare' && <>
        <div className="candidate-compare-toolbar"><div><h2 ref={collectionHeading} tabIndex={-1}>{tr(`比較${current.length}位人選`)}</h2>{current.length === 1 && <p>{tr('可再加入2位人選作比較。')}</p>}</div><div className="candidate-action-row"><a className="button secondary" href="/candidates">{tr('再選人選')}</a><a className="button secondary" href={`/api/candidates/export?ids=${encodeURIComponent(current.map(candidate => candidate.id).join(','))}`} target="_blank" rel="noopener">{tr('下載履歷 PDF')}</a><a className="button primary" href={employerLink(current.map(candidate => candidate.id))}>{tr('提交聘用需要')}</a></div></div>
        <p className="candidate-compare-scroll-hint">{tr('左右滑動查看所有人選。')}</p>
        <div className="candidate-compare-scroll" tabIndex={0} role="region" aria-label={tr('人選資料比較表，可左右捲動')}><table className="candidate-compare-table"><caption className="visually-hidden">{tr('所選人選資料比較')}</caption><thead><tr><th scope="col">{tr('資料')}</th>{current.map(candidate => <th scope="col" key={candidate.id}><CandidatePortrait candidate={candidate} /><a href={candidateLink(candidate.id)} className="candidate-compare-name">{candidate.displayName}</a><p className="candidate-reference">{candidate.reference}</p><div className="candidate-compare-actions"><a href={candidateLink(candidate.id)}>{tr('查看履歷')}</a><button type="button" onClick={() => remove(candidate.id)} aria-label={tr(`從比較移除${candidate.displayName}`)}>{tr('移除')}</button></div></th>)}</tr></thead><tbody>{compareRows.map(row => <tr key={row.label}><th scope="row">{tr(row.label)}</th>{current.map(candidate => <td key={candidate.id}>{row.value(candidate)}</td>)}</tr>)}</tbody></table></div>
      </>}
    </>}
    {mode === 'saved' && <CandidateSelectionBar selection={selection} />}
  </main>;
}
