"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { candidateSortOptions as sortOptions, type CandidateResults } from '@/lib/platform-types';
import { blankCandidateFilters as blankFilters, candidateFilterOptions as filterOptions, candidateFilterLabels, candidateFilterText, candidateFiltersFromSearch as filtersFromSearch, candidateFiltersQuery as filtersQuery, candidateSearchHref, candidateEmployerHref, type CandidateFilters as Filters } from '@/lib/candidate-search';
import { CandidateCard, CandidateEmpty, CandidateNoScript, CandidateSelectionBar, CandidateUtilityLinks, useCandidateSelections } from './candidate-common';
import './candidates.css';
import './candidates-visual.css';
import { useLocale } from './locale-provider';
import { t } from '@/lib/i18n';

export function CandidateCatalog() {
  const { locale } = useLocale();
  const tr = (value: string) => t(locale, value);
  const selection = useCandidateSelections(), [filters, setFilters] = useState<Filters>(blankFilters), [applied, setApplied] = useState<Filters>(blankFilters);
  const [ready, setReady] = useState(false), [result, setResult] = useState<CandidateResults | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const resultHeading = useRef<HTMLHeadingElement>(null), filterDisclosure = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const restore = () => { const parsed = filtersFromSearch(window.location.search); setFilters(parsed); setLoading(true); setApplied(parsed); setReady(true); };
    restore(); if (filterDisclosure.current && window.matchMedia('(max-width: 760px)').matches) filterDisclosure.current.open = false;
    window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController(); setLoading(true); setError('');
    fetch(`/api/candidates?${filtersQuery(applied)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error('暫時未能載入人選，請再試一次。'); const data = await response.json() as CandidateResults; if (!Array.isArray(data.candidates)) throw new Error('暫時未能載入人選，請再試一次。'); return data; })
      .then(data => { if (controller.signal.aborted) return; setResult(data); setLoading(false); })
      .catch((reason: unknown) => { if (controller.signal.aborted) return; setError(reason instanceof Error ? reason.message : '暫時未能載入人選，請再試一次。'); setLoading(false); });
    return () => controller.abort();
  }, [applied, ready, retry]);
  const apply = (next: Filters, moveFocus = false, draftChanges?: Partial<Filters>) => {
    const href = candidateSearchHref(next), changed = filtersQuery(next).toString() !== filtersQuery(applied).toString();
    if (`${window.location.pathname}${window.location.search}` !== href) {
      if (changed) window.history.pushState(null, '', href);
      else window.history.replaceState(null, '', href);
    }
    setFilters(current => draftChanges ? { ...current, ...draftChanges } : next);
    if (changed) { setLoading(true); setApplied(next); }
    if (moveFocus) { resultHeading.current?.focus({ preventScroll: true }); resultHeading.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); }
    if (window.matchMedia('(max-width: 760px)').matches && filterDisclosure.current) filterDisclosure.current.open = false;
  };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); apply({ ...filters, q: filters.q.trim(), page: '1' }, window.matchMedia('(max-width: 760px)').matches); };
  const hasFilters = Object.entries(applied).some(([key, value]) => value && !['sort','page'].includes(key));
  const activeCount = Object.entries(applied).filter(([key, value]) => value && !['q','sort','page'].includes(key)).length;
  const pages = result ? Math.ceil(result.total / result.pageSize) : 1;
  const pendingChanges = filtersQuery(filters).toString() !== filtersQuery(applied).toString();
  const appliedConditions = [['q', '關鍵字'], ...candidateFilterLabels].filter(([key]) => applied[key as keyof Filters]).map(([key, label]) => ({ key: key as keyof Filters, label, value: candidateFilterText(key as keyof Filters, applied[key as keyof Filters]) }));
  return <main id="main-content" className="site-width candidate-page candidate-catalog-page">
    <div className="candidate-page-heading"><div><p className="candidate-breadcrumb"><a href="/">{tr('首頁')}</a><span aria-hidden="true">／</span>{tr('搜尋人選')}</p><h1>{tr('搜尋人選')}</h1><p>{tr('按服務、經驗和工作安排，查看合適的求職簡介。')}</p></div><CandidateUtilityLinks selection={selection} /></div>
    <CandidateNoScript />
    <div className="candidate-search-layout">
      <aside className="candidate-filter-panel" aria-label={tr('篩選人選')}>
        <details className="candidate-filter-disclosure" ref={filterDisclosure} open>
          <summary>{tr('篩選人選')}{activeCount ? <span>{locale==='en'?`${activeCount} selected`:`已選${activeCount}項`}</span> : null}</summary>
          <form method="get" action="/candidates" onSubmit={submit} className="candidate-filter-form">
            <label>{tr('姓名或履歷編號')}<input type="search" name="q" value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} maxLength={100} placeholder={tr('輸入姓名、編號或技能')} /></label>
            {candidateFilterLabels.map(([key, label]) => <label key={key}>{tr(label)}<select name={key} value={filters[key]} onChange={event => setFilters({ ...filters, [key]: event.target.value })}><option value="">{tr('不限')}</option>{filterOptions[key]?.map(value => <option value={value} key={value}>{tr(candidateFilterText(key, value))}</option>)}</select></label>)}
            <input type="hidden" name="sort" value={filters.sort} />
            {pendingChanges && <p className="candidate-filter-pending" role="status">{tr('條件已更改，按「搜尋人選」更新結果。')}</p>}
            <button type="submit" className="button primary">{tr('搜尋人選')}</button><button type="button" className="candidate-filter-reset" onClick={() => apply({ ...blankFilters }, window.matchMedia('(max-width: 760px)').matches)}>{tr('清除所有條件')}</button>
          </form>
        </details>
      </aside>
      <section className="candidate-results" aria-busy={loading} aria-labelledby="candidate-result-heading">
        <div className="candidate-result-toolbar"><h2 id="candidate-result-heading" tabIndex={-1} ref={resultHeading}>{result && !loading && !error ? tr(`共${result.total}位人選`) : tr('人選列表')}</h2><label>{tr('排序')}<select value={applied.sort} onChange={event => apply({ ...applied, sort: event.target.value, page: '1' }, false, { sort: event.target.value, page: '1' })}>{sortOptions.map(option => <option key={option.value} value={option.value}>{tr(option.label)}</option>)}</select></label></div>
        {appliedConditions.length > 0 && <div className="candidate-applied-filters" aria-label="已套用篩選條件"><span>已套用</span>{appliedConditions.map(condition => <button key={condition.key} type="button" onClick={() => apply({ ...applied, [condition.key]: '', page: '1' }, true, { [condition.key]: '', page: '1' })} aria-label={`移除${condition.label}：${condition.value}`}>{condition.label}：{condition.value}<span aria-hidden="true">×</span></button>)}</div>}
        {applied.sort !== 'newest' && <button type="button" className="candidate-sort-reset" onClick={() => apply({ ...applied, sort: 'newest', page: '1' }, false, { sort: 'newest', page: '1' })}>{tr('重設排序')}</button>}
      <p className="candidate-status" role="status">{loading ? tr('正在載入人選…') : tr(selection.message)}</p>
        {error ? <div className="candidate-error" role="alert"><p>{error}</p><button type="button" className="button secondary" onClick={() => { resultHeading.current?.focus({ preventScroll: true }); setRetry(retry + 1); }}>重新載入</button></div> : result && !loading && <>
          {result.candidates.length ? <div className="candidate-grid">{result.candidates.map(candidate => <CandidateCard key={candidate.id} candidate={candidate} selection={selection} returnTo={candidateSearchHref(applied)} />)}</div> : result.total > 0 && result.page > 1 ? <div className="candidate-empty"><h3>這一頁已沒有公開人選</h3><p>返回第一頁查看目前結果。</p><button type="button" className="button secondary" onClick={() => apply({ ...applied, page: '1' }, true, { page: '1' })}>返回第一頁</button></div> : <CandidateEmpty filtered={hasFilters} employerHref={candidateEmployerHref(applied)} />}
          {pages > 1 && <nav className="candidate-pagination" aria-label="人選分頁"><button type="button" className="button secondary" disabled={loading || result.page <= 1} onClick={() => apply({ ...applied, page: String(result.page - 1) }, true, { page: String(result.page - 1) })}>上一頁</button><span>第{result.page}頁／共{pages}頁</span><button type="button" className="button secondary" disabled={loading || result.page >= pages} onClick={() => apply({ ...applied, page: String(result.page + 1) }, true, { page: String(result.page + 1) })}>下一頁</button></nav>}
        </>}
      </section>
    </div>
    <CandidateSelectionBar selection={selection} />
  </main>;
}
