import type { Metadata } from 'next';
import { CandidateCatalog } from '@/components/candidate-catalog';
export const metadata: Metadata = { title: '搜尋人選', description: '按服務、經驗及工作安排查看公開求職簡介。' };
export default function CandidatesPage() { return <CandidateCatalog />; }
