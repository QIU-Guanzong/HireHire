'use client';

import { useEffect, useState } from 'react';
import { APP_VERSION } from '@/lib/app-version';

const productionBuild = process.env.NODE_ENV === 'production';

export function BrandVersion() {
  const [mode, setMode] = useState<string | null>(productionBuild ? null : '預覽');
  useEffect(() => {
    // This names the browser's entry point, not a deployment status or access check.
    setMode(productionBuild && window.location.hostname === 'hire.astock.top' && window.location.protocol === 'https:' ? '正式站' : '預覽');
  }, []);
  return <span id="brand-version" className="brand-version">
    <span>v{APP_VERSION}</span><span className="brand-version-mode">{mode ?? '\u00a0'}</span>
  </span>;
}
