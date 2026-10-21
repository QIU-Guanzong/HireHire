import type { Metadata } from 'next';
import { CandidateCollection } from '@/components/candidate-collection';
import { getLocale } from '@/lib/server-locale';
import { t } from '@/lib/i18n';
export async function generateMetadata():Promise<Metadata>{const locale=await getLocale();return {title:t(locale,'比較人選')};}
export default function ComparePage() { return <CandidateCollection mode="compare" />; }
