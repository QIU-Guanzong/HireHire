'use client';

import { useEffect, useState } from 'react';
import { APP_VERSION } from '@/lib/app-version';
import { useLocale } from './locale-provider';

const productionBuild = process.env.NODE_ENV === 'production';

export function BrandVersion() {
  const { locale } = useLocale();
  const [mode, setMode] = useState<string | null>(productionBuild ? null : locale === 'en' ? 'Preview' : '預覽');
  useEffect(() => { if (!productionBuild) setMode(locale === 'en' ? 'Preview' : '預覽'); }, [locale]);
  useEffect(() => {
    const controller = new AbortController();
    // Runtime channel also works through an authorized local management tunnel.
    // It is a deployment label, never an authorization or availability check.
    void fetch('/api/live', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const body = await response.json() as { releaseChannel?: unknown };
      if (body.releaseChannel === 'production' || body.releaseChannel === 'preview') setMode(body.releaseChannel === 'production' ? locale === 'en' ? 'Live' : '正式站' : locale === 'en' ? 'Preview' : '預覽');
    }).catch(() => {});
    return () => controller.abort();
  }, [locale]);
  return <span id="brand-version" className="brand-version">
    <span>v{APP_VERSION}</span><span className="brand-version-mode">{mode ?? '\u00a0'}</span>
  </span>;
}
