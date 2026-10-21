"use client";

import { useEffect, useState } from 'react';
import type { CandidatePublic } from '@/lib/platform-types';
import { safeCandidateSearchReturn } from '@/lib/candidate-search';
import { CandidateButtons, CandidateNoScript, CandidatePortrait, CandidateSelectionBar, CandidateUtilityLinks, candidateDate, candidateSalary, useCandidateSelections } from './candidate-common';
import './candidates.css';
import { useLocale } from './locale-provider';
import { t } from '@/lib/i18n';

export function CandidateDetail({ id }: { id: string }) {
  const {locale}=useLocale(),tr=(value:string)=>t(locale,value);
  const selection = useCandidateSelections(), [candidate, setCandidate] = useState<CandidatePublic | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [unavailable, setUnavailable] = useState(false), [retry, setRetry] = useState(0);
  const [searchReturn, setSearchReturn] = useState('/candidates');
  useEffect(() => { setSearchReturn(safeCandidateSearchReturn(new URLSearchParams(window.location.search).get('returnTo'))); }, [id]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setUnavailable(false); setCandidate(null);
    fetch(`/api/candidates/${encodeURIComponent(id)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { if (response.status === 404) { setUnavailable(true); return null; } if (!response.ok) throw new Error('暫時未能載入履歷，請再試一次。'); return response.json() as Promise<CandidatePublic>; })
      .then(data => { if (controller.signal.aborted) return; setCandidate(data); setLoading(false); })
      .catch((reason: unknown) => { if (controller.signal.aborted) return; setError(reason instanceof Error ? reason.message : '暫時未能載入履歷，請再試一次。'); setLoading(false); });
    return () => controller.abort();
  }, [id, retry]);
  const facts: [string,string][] = candidate ? [
    ['國籍／地區',candidate.nationality], ['求職情況',candidate.candidateType], ['年齡',candidate.age ? `${candidate.age}歲` : ''], ['教育程度',candidate.education], ['目前所在地',candidate.currentLocation], ['相關工作年資',candidate.yearsExperience], ['可使用語言',candidate.languages.join('、')],
  ] : [];
  return <main id="main-content" className="site-width candidate-page candidate-detail-page">
    <div className="candidate-page-heading"><p className="candidate-breadcrumb"><a href="/">{tr('首頁')}</a><span aria-hidden="true">／</span><a href={searchReturn}>{tr('搜尋人選')}</a><span aria-hidden="true">／</span>{tr('人選履歷')}</p><CandidateUtilityLinks selection={selection} /></div>
    <CandidateNoScript /><p className="candidate-status" role="status">{loading ? tr('正在載入履歷…') : tr(selection.message)}</p>
    {error && <div className="candidate-error" role="alert"><p>{tr(error)}</p><button className="button secondary" type="button" onClick={() => setRetry(retry + 1)}>{tr('重新載入')}</button></div>}
    {unavailable && <div className="candidate-empty"><h1>{tr('此人選履歷暫未能查看')}</h1><p>{tr('履歷可能已暫停公開，你可查看其他人選或提交聘用需要。')}</p><div className="candidate-action-row"><a className="button primary" href={searchReturn}>{tr('返回搜尋')}</a><a className="button secondary" href="/employer">{tr('填寫聘用需要')}</a></div>{(selection.saved.includes(id) || selection.compared.includes(id)) && <button className="candidate-text-link" type="button" onClick={() => { selection.write('saved', selection.saved.filter(item => item !== id)); selection.write('compare', selection.compared.filter(item => item !== id)); selection.setMessage('已從清單移除此人選。'); }}>{tr('從收藏及比較清單移除')}</button>}</div>}
    {candidate && <>
      <section className="candidate-profile-summary" aria-labelledby="candidate-name">
        <CandidatePortrait candidate={candidate} large />
        <div className="candidate-profile-heading"><p className="candidate-reference">{tr('履歷編號')} {candidate.reference}</p><h1 id="candidate-name">{candidate.displayName}</h1><p className="candidate-profile-type">{[candidate.candidateType&&tr(candidate.candidateType),candidate.nationality&&tr(candidate.nationality),candidate.yearsExperience && `${tr(candidate.yearsExperience)} ${tr('經驗')}`].filter(Boolean).join(' · ')}</p>
          <p className="candidate-profile-services">{candidate.services.map(service=>tr(service)).join(' · ')}</p>
          <dl className="candidate-profile-keyfacts"><div><dt>{tr('最快可到職')}</dt><dd>{candidateDate(candidate.availableFrom)}</dd></div><div><dt>{tr('期望薪金')}</dt><dd>{tr(candidateSalary(candidate))}</dd></div><div><dt>{tr('工作形式')}</dt><dd>{tr(candidate.employmentType || '待確認')}</dd></div></dl>
          <CandidateButtons candidate={candidate} selection={selection} includeChoose />
          <div className="candidate-profile-links"><a href={`/api/candidates/${encodeURIComponent(candidate.id)}/pdf`} target="_blank" rel="noopener">{tr('下載公開履歷 PDF')}</a><span>{tr('更新：')}{candidateDate(candidate.updatedAt.slice(0, 10))}</span></div>
        </div>
      </section>
      <div className="candidate-profile-body">
        <div className="candidate-profile-main">
          <section className="candidate-profile-section"><h2>{tr('基本資料')}</h2><dl className="candidate-detail-facts">{facts.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{tr(label)}</dt><dd>{tr(value)}</dd></div>)}</dl></section>
          {candidate.summary && <section className="candidate-profile-section"><h2>{tr('自我介紹')}</h2><p className="candidate-preserve-lines">{candidate.summary}</p></section>}
          <section className="candidate-profile-section"><h2>{tr('工作經歷')}</h2>{candidate.workExperiences.length ? <ol className="candidate-work-history">{candidate.workExperiences.map((work, index) => <li key={`${work.country}-${work.from}-${index}`}><div className="candidate-work-heading"><h3>{work.country || `${tr('工作')}${index + 1}`}</h3><p>{work.from ? candidateDate(work.from) : tr('開始日期待確認')}{work.to ? ` ${tr('至')} ${candidateDate(work.to)}` : ` ${tr('至今')}`}</p></div><dl><div><dt>{tr('家庭情況')}</dt><dd>{work.household || tr('未填寫')}</dd></div><div><dt>{tr('主要工作')}</dt><dd className="candidate-preserve-lines">{work.duties || tr('未填寫')}</dd></div>{work.leavingReason && <div><dt>{tr('離職原因')}</dt><dd>{work.leavingReason}</dd></div>}</dl></li>)}</ol> : <p className="candidate-muted">{tr('暫未提供分段工作經歷。')}</p>}</section>
          {candidate.qualifications && <section className="candidate-profile-section"><h2>{tr('培訓及證書')}</h2><p className="candidate-preserve-lines">{candidate.qualifications}</p></section>}
        </div>
        <aside className="candidate-profile-side">
          <section className="candidate-profile-section"><h2>{tr('工作意向')}</h2><dl className="candidate-side-facts"><div><dt>{tr('希望從事')}</dt><dd>{candidate.services.map(service=>tr(service)).join('、') || tr('待確認')}</dd></div><div><dt>{tr('可工作地區')}</dt><dd>{candidate.workLocations.map(area=>tr(area)).join('、') || tr('待確認')}</dd></div><div><dt>{tr('工作形式')}</dt><dd>{tr(candidate.employmentType || '待確認')}</dd></div></dl></section>
          <section className="candidate-profile-section"><h2>{tr('工作技能')}</h2>{candidate.skills.length ? <ul className="candidate-skill-list">{candidate.skills.map(skill => <li key={skill}>{tr(skill)}</li>)}</ul> : <p className="candidate-muted">{tr('暫未填寫。')}</p>}</section>
          <div className="candidate-side-help"><h2>{tr('想了解此人選？')}</h2><p>{tr('選擇人選後填寫家庭及服務需要，我們會跟進聘用安排。')}</p><a href={`/employer?candidates=${encodeURIComponent(candidate.id)}`} className="button primary">{tr('填寫聘用需要')}</a></div>
        </aside>
      </div>
      <a className="candidate-back" href={searchReturn}>← {tr('返回人選搜尋')}</a>
    </>}
    <CandidateSelectionBar selection={selection} />
  </main>;
}
