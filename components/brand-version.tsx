'use client';

import { useEffect, useState } from 'react';
import { APP_VERSION } from '@/lib/app-version';
import { useLocale } from './locale-provider';
import { releaseLabel, type ReleaseLabel } from '@/lib/release-label';

export function BrandVersion() {
  const { locale } = useLocale();
  const [status, setStatus] = useState<ReleaseLabel | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    // Runtime channel also works through an authorized local management tunnel.
    // It is a deployment label, never an authorization or availability check.
    void fetch('/api/live', { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Release status unavailable');
      const body: unknown = await response.json();
      if (!controller.signal.aborted) setStatus(releaseLabel(body));
    }).catch(() => { if (!controller.signal.aborted) setStatus(releaseLabel(null)); });
    return () => controller.abort();
  }, []);
  const labels = locale === 'en' ? { preview: 'Preview', candidate: 'Candidate', live: 'Live', unknown: 'Unknown' }
    : { preview: '預覽', candidate: '候選', live: '正式站', unknown: '未知' };
  const sourceText = status?.sourceCommit ? `${locale === 'en' ? 'Source' : '源碼'} ${status.sourceCommit.slice(0, 7)}`
    : locale === 'en' ? 'Source unknown' : '來源未知';
  return <span id="brand-version" className="brand-version">
    <span>v{APP_VERSION}</span><span className="brand-version-mode">{status ? labels[status.mode] : locale === 'en' ? 'Checking' : '查核中'}</span>
    <span className="brand-version-source" title={status?.sourceCommit ? `Source: ${status.sourceCommit}\nTree: ${status.sourceTree}` : undefined}>{sourceText}</span>
  </span>;
}
