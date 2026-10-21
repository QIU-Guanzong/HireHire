import type { Metadata } from 'next';
import IntakeForm from '@/components/intake-form';
import { getLocale } from '@/lib/server-locale';
import { t } from '@/lib/i18n';

export async function generateMetadata():Promise<Metadata>{const locale=await getLocale();return {title:t(locale,'僱主登記'),description:t(locale,'登記家庭需要、服務時間及聘用安排。')};}
export default function EmployerPage() { return <IntakeForm kind="employer"/>; }
