import type { Metadata } from 'next';
import { CandidateCollection } from '@/components/candidate-collection';
export const metadata: Metadata = { title: '比較人選' };
export default function ComparePage() { return <CandidateCollection mode="compare" />; }
