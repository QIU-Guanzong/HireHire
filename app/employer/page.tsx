import type { Metadata } from 'next';
import IntakeForm from '@/components/intake-form';

export const metadata: Metadata = { title: '僱主登記', description: '登記家庭需要、服務時間及聘用安排。' };
export default function EmployerPage() { return <IntakeForm kind="employer"/>; }
