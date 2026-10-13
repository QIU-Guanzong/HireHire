import { allFields, districts, services } from './fields';
import { candidateAgeRanges, candidateFilterKeys, candidateSortOptions, candidateTypes } from './platform-types';

export type CandidateFilters = Record<typeof candidateFilterKeys[number], string>;
export const blankCandidateFilters: CandidateFilters = { q: '', service: '', nationality: '', candidateType: '', language: '', experience: '', employmentType: '', district: '', education: '', skill: '', ageRange: '', sort: 'newest', page: '1' };
const options = (name: string) => allFields('jobseeker').find(field => field.name === name)?.options || [];
export const candidateFilterOptions: Partial<Record<keyof CandidateFilters, string[]>> = {
  service: services, nationality: options('nationality'), candidateType: candidateTypes,
  language: options('languages'), experience: options('yearsExperience'), employmentType: options('employmentType'),
  district: districts, education: options('education'), skill: options('skills'), ageRange: candidateAgeRanges.map(range => range.value),
};
export const candidateFilterLabels: [keyof CandidateFilters, string][] = [
  ['service', '服務類別'], ['candidateType', '求職情況'], ['nationality', '國籍／地區'], ['language', '溝通語言'],
  ['experience', '工作年資'], ['employmentType', '工作形式'], ['district', '工作地區'], ['education', '教育程度'], ['ageRange', '年齡'], ['skill', '工作技能'],
];
export function candidateFilterText(key: keyof CandidateFilters, value: string) {
  return key === 'ageRange' ? candidateAgeRanges.find(range => range.value === value)?.label || value : value;
}
export function candidateFiltersFromSearch(search: string): CandidateFilters {
  const query = new URLSearchParams(search), values = { ...blankCandidateFilters };
  values.q = (query.get('q') || '').slice(0, 100);
  for (const key of Object.keys(candidateFilterOptions) as (keyof CandidateFilters)[]) {
    const value = query.get(key);
    if (value && candidateFilterOptions[key]?.includes(value)) values[key] = value;
  }
  const sort = query.get('sort');
  if (sort && candidateSortOptions.some(option => option.value === sort)) values.sort = sort;
  const page = Number(query.get('page'));
  if (Number.isInteger(page) && page > 0 && page <= 10000) values.page = String(page);
  return values;
}
export function candidateFiltersQuery(filters: CandidateFilters) {
  const query = new URLSearchParams();
  for (const key of candidateFilterKeys) {
    const value = filters[key];
    if (value && !(key === 'page' && value === '1') && !(key === 'sort' && value === 'newest')) query.set(key, value);
  }
  return query;
}
export function candidateSearchHref(filters: CandidateFilters) {
  const query = candidateFiltersQuery(filters).toString();
  return `/candidates${query ? `?${query}` : ''}`;
}
export function safeCandidateSearchReturn(value: string | null) {
  if (!value || value.length > 2000) return '/candidates';
  try {
    const url = new URL(value, 'https://local.example.test');
    if (url.origin !== 'https://local.example.test' || url.pathname !== '/candidates') return '/candidates';
    return candidateSearchHref(candidateFiltersFromSearch(url.search));
  } catch { return '/candidates'; }
}
export function candidateEmployerHref(filters: CandidateFilters) {
  const query = new URLSearchParams();
  if (services.includes(filters.service)) query.set('service', filters.service);
  if (districts.includes(filters.district)) query.set('district', filters.district);
  const employmentOptions = allFields('employer').find(field => field.name === 'employmentType')?.options || [];
  if (employmentOptions.includes(filters.employmentType)) query.set('employmentType', filters.employmentType);
  return `/employer${query.size ? `?${query}` : ''}`;
}
