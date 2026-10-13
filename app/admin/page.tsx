import type { Metadata } from 'next';
import AdminWorkspace from '@/components/admin-workspace';

export const metadata: Metadata = { title: '資料管理', robots: { index: false, follow: false } };
export default function AdminPage() { return <AdminWorkspace/>; }
