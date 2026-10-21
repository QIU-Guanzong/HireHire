import type { Metadata } from 'next';
import { CandidateDetail } from '@/components/candidate-detail';
import { getLocale } from '@/lib/server-locale';
import { t } from '@/lib/i18n';
export async function generateMetadata():Promise<Metadata>{const locale=await getLocale();return {title:t(locale,'人選履歷')};}
export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CandidateDetail id={id} />;
}
