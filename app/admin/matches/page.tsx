import type { Metadata } from 'next';
import PrivateAdminMatches from '@/components/private-admin-matches';
export const metadata: Metadata = { title: '配對跟進', robots: { index: false, follow: false } };
export default function Page() { return <PrivateAdminMatches/>; }
