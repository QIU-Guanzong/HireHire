import type { Metadata } from 'next';
import { CandidateCatalog } from '@/components/candidate-catalog';
import { getLocale } from '@/lib/server-locale';
import { t } from '@/lib/i18n';
export async function generateMetadata():Promise<Metadata>{const locale=await getLocale();return {title:t(locale,'搜尋人選'),description:t(locale,'按服務、經驗和工作安排，查看合適的求職簡介。')};}
export default function CandidatesPage() { return <CandidateCatalog />; }
