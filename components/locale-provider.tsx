'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Locale } from '@/lib/i18n';

const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void } | null>(null);

export function LocaleProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [locale, setCurrentLocale] = useState(initialLocale);
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => setCurrentLocale(initialLocale), [initialLocale]);
  useEffect(() => {
    if (!pathname.startsWith('/admin') || locale === 'zh-Hant') return;
    document.cookie = `jiahe_locale=zh-Hant; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    setCurrentLocale('zh-Hant');
    router.refresh();
  }, [locale, pathname, router]);
  const value = useMemo(() => ({
    locale,
    setLocale(next: Locale) {
      setCurrentLocale(next);
      document.cookie = `jiahe_locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
      document.documentElement.lang = next === 'en' ? 'en-HK' : 'zh-Hant-HK';
      router.refresh();
    },
  }), [locale, router]);
  if (pathname.startsWith('/admin')) return <LocaleContext.Provider value={{ ...value, locale: 'zh-Hant' }}>{children}</LocaleContext.Provider>;
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used within LocaleProvider');
  return value;
}
