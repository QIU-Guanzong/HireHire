import { cookies } from 'next/headers';
import type { Locale } from './i18n';

export async function getLocale(): Promise<Locale> {
  return (await cookies()).get('jiahe_locale')?.value === 'en' ? 'en' : 'zh-Hant';
}
