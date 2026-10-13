import type { Metadata } from 'next';
import IntakeForm from '@/components/intake-form';

export const metadata: Metadata = { title: '求職者登記', description: '登記家傭、陪月、長者照顧及家居服務工作經驗與期望。' };
export default function JobseekerPage() { return <IntakeForm kind="jobseeker"/>; }
