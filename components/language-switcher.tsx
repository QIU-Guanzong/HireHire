'use client';

import { usePathname } from 'next/navigation';
import { useLocale } from './locale-provider';

export function LanguageSwitcher() {
  const pathname = usePathname();
  const { locale, setLocale } = useLocale();
  if (pathname.startsWith('/admin')) return null;
  const next = locale === 'en' ? 'zh-Hant' : 'en';
  return <button className="language-switcher" type="button" onClick={() => setLocale(next)} aria-label={locale === 'en' ? 'Switch to Traditional Chinese' : 'Switch to English'}>
    {locale === 'en' ? '中' : 'EN'}
  </button>;
}
