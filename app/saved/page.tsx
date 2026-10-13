import type { Metadata } from 'next';
import { CandidateCollection } from '@/components/candidate-collection';
export const metadata: Metadata = { title: '已收藏人選' };
export default function SavedPage() { return <CandidateCollection mode="saved" />; }
