import type { Metadata } from 'next';
import IntakeForm from '@/components/intake-form';
import { getLocale } from '@/lib/server-locale';
import { t } from '@/lib/i18n';

export async function generateMetadata():Promise<Metadata>{const locale=await getLocale();return {title:t(locale,'求職者登記'),description:t(locale,'登記家傭、陪月、長者照顧及家居服務工作經驗與期望。')};}
export default function JobseekerPage() { return <IntakeForm kind="jobseeker"/>; }
