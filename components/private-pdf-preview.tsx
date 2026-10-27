"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PrivatePdfError, privatePdfRequest } from '@/lib/private-pdf-request';
import './private-pdf-preview.css';

export type PdfPreviewRequest = {
  url: string;
  mode: 'client' | 'full';
  targets: string[];
  scopeLabel: string;
  fallbackFilename: string;
};
type PreviewBase = { id: number; contextKey: string; request: PdfPreviewRequest; requestKey: string };
type PreviewState = PreviewBase & (
  { phase: 'loading' } |
  { phase: 'error'; message: string; retryable: boolean } |
  { phase: 'ready'; blob: Blob; url: string; filename: string; recordCount?: number }
);

function requestUrl(request: PdfPreviewRequest) {
  const url = new URL(request.url, window.location.origin);
  if (url.origin !== window.location.origin || !['/api/admin/export', '/api/admin/matches/export'].includes(url.pathname)) throw new Error('未能取得PDF檔案，請重試。');
  if ((url.searchParams.get('mode') || 'client') !== request.mode) throw new Error('PDF版本已更改，請重新預覽。');
  return url.href;
}
function pdfFilename(disposition: string | null, request: PdfPreviewRequest) {
  const supplied = disposition?.match(/filename="?([^";]+)"?/i)?.[1]?.trim();
  return (supplied || request.fallbackFilename || `jiahe-${request.mode}.pdf`).replace(/[\u0000-\u001f\u007f/\\]/g, '_');
}

export function usePrivatePdfPreview(contextKey: string): {
  open: (request: PdfPreviewRequest, trigger: HTMLElement) => Promise<void>;
  close: () => void;
  busy: boolean;
  active: boolean;
  dialog: ReactNode;
} {
  const [state, setState] = useState<PreviewState | null>(null);
  const [acknowledged, setAcknowledged] = useState(false), [downloadBusy, setDownloadBusy] = useState(false);
  const headingId = useId(), summaryId = useId(), checkboxId = useId();
  const stateRef = useRef<PreviewState | null>(null), contextRef = useRef(contextKey), mountedRef = useRef(true);
  const sequenceRef = useRef(0), controllerRef = useRef<AbortController | null>(null), promiseRef = useRef<Promise<void> | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null), closeButtonRef = useRef<HTMLButtonElement>(null), triggerRef = useRef<HTMLElement | null>(null);
  const previewUrlRef = useRef<string | null>(null), downloadUrlsRef = useRef(new Map<string, number>());
  const focusFrameRef = useRef<number | null>(null);
  const acknowledgedRef = useRef(false), downloadLockRef = useRef(false), lockTimerRef = useRef<number | null>(null);
  // Publish only committed context, never a speculative render. The visible
  // state below still hides an old document immediately when context changes.
  useLayoutEffect(() => { contextRef.current = contextKey; }, [contextKey]);

  const publish = useCallback((next: PreviewState) => {
    stateRef.current = next;
    if (mountedRef.current) setState(next);
  }, []);
  const clearPreview = useCallback((restoreFocus: boolean) => {
    sequenceRef.current += 1;
    controllerRef.current?.abort(); controllerRef.current = null; promiseRef.current = null;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null; stateRef.current = null;
    acknowledgedRef.current = false; downloadLockRef.current = false;
    if (lockTimerRef.current !== null) window.clearTimeout(lockTimerRef.current);
    lockTimerRef.current = null;
    if (dialogRef.current?.open) dialogRef.current.close();
    const trigger = triggerRef.current; triggerRef.current = null;
    if (mountedRef.current) { setState(null); setAcknowledged(false); setDownloadBusy(false); }
    if (focusFrameRef.current !== null) window.cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = restoreFocus && trigger ? window.requestAnimationFrame(() => {
      focusFrameRef.current = null;
      if (mountedRef.current && !stateRef.current && trigger.isConnected && !trigger.closest('[inert]') && !trigger.matches(':disabled')) trigger.focus({ preventScroll: true });
    }) : null;
    // Download URLs have their own lifetime so closing the preview does not
    // revoke a file which the browser has just started saving.
  }, []);
  const close = useCallback(() => clearPreview(true), [clearPreview]);

  useEffect(() => {
    mountedRef.current = true;
    const downloadUrls = downloadUrlsRef.current;
    return () => {
      mountedRef.current = false; clearPreview(false);
      downloadUrls.forEach((timer, url) => { window.clearTimeout(timer); URL.revokeObjectURL(url); });
      downloadUrls.clear();
    };
  }, [clearPreview]);
  useEffect(() => {
    if (stateRef.current && stateRef.current.contextKey !== contextKey) clearPreview(true);
  }, [contextKey, clearPreview]);

  const open = useCallback(async (request: PdfPreviewRequest, trigger: HTMLElement) => {
    const snapshot = { ...request, targets: [...request.targets] }, capturedContext = contextRef.current;
    const requestKey = JSON.stringify(snapshot), previous = stateRef.current;
    if (previous?.phase === 'loading' && previous.contextKey === capturedContext && previous.requestKey === requestKey) {
      await promiseRef.current; return;
    }
    clearPreview(false); triggerRef.current = trigger;
    const id = sequenceRef.current, controller = new AbortController(); controllerRef.current = controller;
    const base: PreviewBase = { id, contextKey: capturedContext, request: snapshot, requestKey };
    const current = () => mountedRef.current && !controller.signal.aborted && sequenceRef.current === id && contextRef.current === capturedContext;
    publish({ ...base, phase: 'loading' });
    const pending = (async () => {
      try {
        const { response, blob } = await privatePdfRequest(requestUrl(snapshot), controller.signal);
        if (!current()) return;
        const url = URL.createObjectURL(blob); previewUrlRef.current = url;
        const count = Number(response.headers.get('X-Export-Records'));
        publish({ ...base, phase: 'ready', blob, url, filename: pdfFilename(response.headers.get('Content-Disposition'), snapshot), ...(Number.isInteger(count) && count > 0 ? { recordCount: count } : {}) });
      } catch (error) {
        if (current()) publish({ ...base, phase: 'error', message: error instanceof Error ? error.message : '未能取得PDF檔案，請重試。', retryable: !(error instanceof PrivatePdfError && [401, 403].includes(error.status)) });
      } finally {
        if (sequenceRef.current === id) { controllerRef.current = null; promiseRef.current = null; }
      }
    })();
    promiseRef.current = pending;
    await pending;
  }, [clearPreview, publish]);

  // A changed context removes the old document during render, before the
  // cleanup effect can run or an earlier response can finish.
  const visible = state?.contextKey === contextKey ? state : null;
  const visibleId = visible?.id;
  useEffect(() => {
    if (visibleId === undefined || !dialogRef.current) return;
    const originalOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = 'hidden';
    if (!dialogRef.current.open) dialogRef.current.showModal();
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => { window.document.body.style.overflow = originalOverflow; };
  }, [visibleId]);

  const download = () => {
    const document = stateRef.current;
    if (document?.phase !== 'ready' || document.contextKey !== contextRef.current || !acknowledgedRef.current || downloadLockRef.current) return;
    downloadLockRef.current = true; setDownloadBusy(true);
    const url = URL.createObjectURL(document.blob);
    const timer = window.setTimeout(() => { URL.revokeObjectURL(url); downloadUrlsRef.current.delete(url); }, 30_000);
    downloadUrlsRef.current.set(url, timer);
    const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = document.filename;
    window.document.body.appendChild(anchor); anchor.click(); anchor.remove();
    lockTimerRef.current = window.setTimeout(() => {
      downloadLockRef.current = false; lockTimerRef.current = null;
      if (mountedRef.current) setDownloadBusy(false);
    }, 1200);
  };

  const dialog: ReactNode = visible ? <dialog ref={dialogRef} className="private-pdf-preview" role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={summaryId}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
    onKeyDownCapture={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
    <div className="private-pdf-preview-header"><h2 id={headingId}>PDF交付前預覽</h2><button ref={closeButtonRef} type="button" className="private-pdf-preview-close" aria-label="關閉PDF預覽" onClick={close}><span aria-hidden="true">×</span></button></div>
    <div className="private-pdf-preview-body">
      <div id={summaryId} className="private-pdf-preview-summary">
        <p className="private-pdf-preview-mode">{visible.request.mode === 'client' ? '客戶配對版' : '後台完整資料'}</p>
        <p>{visible.request.scopeLabel}</p>
        <ul aria-label="本份PDF對象">{visible.request.targets.map((target, index) => <li key={index}>{target}</li>)}</ul>
      </div>
      {visible.phase === 'loading' && <p className="private-pdf-preview-state" role="status">正在產生PDF…</p>}
      {visible.phase === 'error' && <div className="private-pdf-preview-state" role="alert"><p>{visible.message}</p>{visible.retryable ? <button type="button" className="private-pdf-preview-button secondary" onClick={() => { closeButtonRef.current?.focus(); void open(visible.request, triggerRef.current || closeButtonRef.current!); }}>重試產生PDF</button> : <p>請關閉預覽並重新確認管理帳戶。</p>}</div>}
      {visible.phase === 'ready' && <>
        <p className="private-pdf-preview-ready" role="status">PDF已產生，核對版本、對象及內容後再下載。</p>
        <p className="private-pdf-preview-filename">{visible.filename}{visible.recordCount ? ` · 共${visible.recordCount}份資料` : ''}</p>
        <div className="private-pdf-preview-frame"><iframe src={visible.url} title="PDF內容預覽" /></div>
        <div className="private-pdf-preview-actions">
          <a href={visible.url} target="_blank" rel="noopener noreferrer">在新分頁查看PDF</a>
          <label htmlFor={checkboxId}><input id={checkboxId} type="checkbox" checked={acknowledged} onChange={event => { acknowledgedRef.current = event.target.checked; setAcknowledged(event.target.checked); }}/><span>已核對版本及對象</span></label>
          <button type="button" className="private-pdf-preview-button" disabled={!acknowledged || downloadBusy} onClick={download}>下載已核對PDF</button>
        </div>
      </>}
    </div>
  </dialog> : null;
  return { open, close, busy: visible?.phase === 'loading', active: visible !== null, dialog };
}
