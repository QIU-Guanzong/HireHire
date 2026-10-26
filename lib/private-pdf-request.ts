export class PrivatePdfError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

// One deadline covers headers, error JSON, PDF bytes and the signature check.
// The caller owns its signal; canceling this operation never cancels its parent.
// Race explicitly so even a transport/body reader that ignores abort cannot keep
// the preview busy forever. Late work has no UI or object-URL side effects.
export async function privatePdfRequest(url: string, caller: AbortSignal): Promise<{ response: Response; blob: Blob }> {
  caller.throwIfAborted();
  const controller = new AbortController();
  let response: Response | undefined;
  let interrupt!: (reason: unknown) => void;
  const interrupted = new Promise<never>((_, reject) => { interrupt = reject; });
  const stop = (reason: unknown) => { controller.abort(reason); interrupt(reason); };
  const onAbort = () => stop(caller.reason);
  caller.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => stop(new PrivatePdfError('產生PDF逾時，請重試。', response?.status || 0)), 60_000);
  try {
    const operation = (async () => {
      response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      controller.signal.throwIfAborted();
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        controller.signal.throwIfAborted();
        const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error
          ? body.error : '未能取得PDF檔案，請重試。';
        throw new PrivatePdfError(message, response.status);
      }
      if (!/^application\/pdf(?:;|$)/i.test(response.headers.get('Content-Type')?.trim() || '')) throw new PrivatePdfError('未能取得PDF檔案，請重試。');
      const blob = await response.blob();
      controller.signal.throwIfAborted();
      const signature = await blob.slice(0, 5).text();
      controller.signal.throwIfAborted();
      if (!blob.size || signature !== '%PDF-') throw new PrivatePdfError('未能取得PDF檔案，請重試。');
      return { response, blob };
    })();
    return await Promise.race([operation, interrupted]);
  } finally {
    clearTimeout(timer);
    caller.removeEventListener('abort', onAbort);
  }
}
