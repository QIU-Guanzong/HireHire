"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { districts, services } from '@/lib/fields';
import { candidateTypes, type CandidateResults } from '@/lib/platform-types';
import { CandidateCard, CandidateEmpty, CandidateNoScript, CandidateSelectionBar, CandidateUtilityLinks, useCandidateSelections } from './candidate-common';
import './candidates.css';

type Filters = { q: string; service: string; nationality: string; candidateType: string; language: string; experience: string; employmentType: string; district: string; sort: string; page: string };
const blankFilters: Filters = { q: '', service: '', nationality: '', candidateType: '', language: '', experience: '', employmentType: '', district: '', sort: 'newest', page: '1' };
const filterOptions: Partial<Record<keyof Filters, string[]>> = {
  service: services, nationality: ['香港','中國內地','菲律賓','印尼','其他'], candidateType: candidateTypes,
  language: ['廣東話','普通話','英語','印尼語','菲律賓語','其他'], experience: ['少於1年','1–2年','3–5年','6–10年','10年以上'],
  employmentType: ['全職住家','全職非住家','兼職','按次／短期','均可'], district: districts,
};
const sortOptions = [{ value: 'newest', label: '最近更新' }, { value: 'available', label: '最快可到職' }, { value: 'salary-asc', label: '期望薪金：低至高' }, { value: 'salary-desc', label: '期望薪金：高至低' }];
function filtersFromSearch(search: string): Filters {
  const query = new URLSearchParams(search), values = { ...blankFilters };
  values.q = (query.get('q') || '').slice(0, 100);
  for (const key of Object.keys(filterOptions) as (keyof Filters)[]) { const value = query.get(key); if (value && filterOptions[key]?.includes(value)) values[key] = value; }
  const sort = query.get('sort'); if (sort && sortOptions.some(option => option.value === sort)) values.sort = sort;
  const page = Number(query.get('page')); if (Number.isInteger(page) && page > 0 && page <= 10000) values.page = String(page);
  return values;
}
function filtersQuery(filters: Filters) { const query = new URLSearchParams(); for (const [key, value] of Object.entries(filters)) if (value && !(key === 'page' && value === '1') && !(key === 'sort' && value === 'newest')) query.set(key, value); return query; }

export function CandidateCatalog() {
  const selection = useCandidateSelections(), [filters, setFilters] = useState<Filters>(blankFilters), [applied, setApplied] = useState<Filters>(blankFilters);
  const [ready, setReady] = useState(false), [result, setResult] = useState<CandidateResults | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const resultHeading = useRef<HTMLHeadingElement>(null), filterDisclosure = useRef<HTMLDetailsElement>(null), focusResults = useRef(false);
  useEffect(() => {
    const restore = () => { const parsed = filtersFromSearch(window.location.search); setFilters(parsed); setApplied(parsed); setReady(true); };
    restore(); if (filterDisclosure.current && window.matchMedia('(max-width: 760px)').matches) filterDisclosure.current.open = false;
    window.addEventListener('popstate', restore); return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController(); setLoading(true); setError('');
    fetch(`/api/candidates?${filtersQuery(applied)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error('暫時未能載入人選，請再試一次。'); const data = await response.json() as CandidateResults; if (!Array.isArray(data.candidates)) throw new Error('暫時未能載入人選，請再試一次。'); return data; })
      .then(data => { setResult(data); setLoading(false); if (focusResults.current) { resultHeading.current?.focus({ preventScroll: true }); resultHeading.current?.scrollIntoView({ block: 'start' }); focusResults.current = false; } })
      .catch((reason: unknown) => { if (controller.signal.aborted) return; setError(reason instanceof Error ? reason.message : '暫時未能載入人選，請再試一次。'); setLoading(false); });
    return () => controller.abort();
  }, [applied, ready, retry]);
  const apply = (next: Filters, moveFocus = false) => {
    const query = filtersQuery(next).toString(); window.history.pushState(null, '', `/candidates${query ? `?${query}` : ''}`);
    setFilters(next); setApplied(next); focusResults.current = moveFocus;
  };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); apply({ ...filters, q: filters.q.trim(), page: '1' }, window.matchMedia('(max-width: 760px)').matches); };
  const hasFilters = Object.entries(applied).some(([key, value]) => value && !['sort','page'].includes(key));
  const activeCount = Object.entries(applied).filter(([key, value]) => value && !['q','sort','page'].includes(key)).length;
  const pages = result ? Math.ceil(result.total / result.pageSize) : 1;
  return <main id="main-content" className="site-width candidate-page">
    <div className="candidate-page-heading"><div><p className="candidate-breadcrumb"><a href="/">首頁</a><span aria-hidden="true">／</span>搜尋人選</p><h1>搜尋人選</h1><p>按服務、經驗和工作安排，查看合適的求職簡介。</p></div><CandidateUtilityLinks selection={selection} /></div>
    <CandidateNoScript />
    <div className="candidate-search-layout">
      <aside className="candidate-filter-panel" aria-label="人選篩選">
        <details className="candidate-filter-disclosure" ref={filterDisclosure} open>
          <summary>篩選人選{activeCount ? <span>已選{activeCount}項</span> : null}</summary>
          <form method="get" action="/candidates" onSubmit={submit} className="candidate-filter-form">
            <label>姓名或履歷編號<input type="search" name="q" value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} maxLength={100} placeholder="輸入姓名、編號或技能" /></label>
            {([
              ['service','服務類別'], ['candidateType','求職情況'], ['nationality','國籍／地區'], ['language','溝通語言'], ['experience','工作年資'], ['employmentType','工作形式'], ['district','工作地區'],
            ] as [keyof Filters,string][]).map(([key, label]) => <label key={key}>{label}<select name={key} value={filters[key]} onChange={event => setFilters({ ...filters, [key]: event.target.value })}><option value="">不限</option>{filterOptions[key]?.map(value => <option value={value} key={value}>{value}</option>)}</select></label>)}
            <input type="hidden" name="sort" value={filters.sort} />
            <button type="submit" className="button primary">搜尋人選</button><button type="button" className="candidate-filter-reset" onClick={() => apply({ ...blankFilters })}>清除條件</button>
          </form>
        </details>
      </aside>
      <section className="candidate-results" aria-busy={loading} aria-labelledby="candidate-result-heading">
        <div className="candidate-result-toolbar"><h2 id="candidate-result-heading" tabIndex={-1} ref={resultHeading}>{result ? `共${result.total}位人選` : '人選列表'}</h2><label>排序<select value={applied.sort} onChange={event => apply({ ...applied, sort: event.target.value, page: '1' })}>{sortOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></div>
        <p className="candidate-status" role="status">{loading ? '正在載入人選…' : selection.message}</p>
        {error ? <div className="candidate-error" role="alert"><p>{error}</p><button type="button" className="button secondary" onClick={() => setRetry(retry + 1)}>重新載入</button></div> : result && <>
          {result.candidates.length ? <div className="candidate-grid">{result.candidates.map(candidate => <CandidateCard key={candidate.id} candidate={candidate} selection={selection} />)}</div> : <CandidateEmpty filtered={hasFilters} />}
          {pages > 1 && <nav className="candidate-pagination" aria-label="人選分頁"><button type="button" className="button secondary" disabled={loading || result.page <= 1} onClick={() => apply({ ...applied, page: String(result.page - 1) }, true)}>上一頁</button><span>第{result.page}頁／共{pages}頁</span><button type="button" className="button secondary" disabled={loading || result.page >= pages} onClick={() => apply({ ...applied, page: String(result.page + 1) }, true)}>下一頁</button></nav>}
        </>}
      </section>
    </div>
    <CandidateSelectionBar selection={selection} />
  </main>;
}
