import type { Metadata } from 'next';
import { CandidateDetail } from '@/components/candidate-detail';
export const metadata: Metadata = { title: '人選履歷' };
export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CandidateDetail id={id} />;
}
