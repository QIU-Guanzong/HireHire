export class PrivatePdfError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

// No total-duration cap: wait at most 60s for headers, then renew that idle
// window only when a nonempty body chunk arrives (including an error body).
// Older transports without a readable stream cannot expose progress; their
// single body-read promise retains a bounded 60s wait rather than hanging.
// The caller owns its signal; canceling this operation never cancels its parent.
// Race explicitly so even a transport/body reader that ignores abort cannot keep
// the preview busy forever. Late work has no UI or object-URL side effects.
export async function privatePdfRequest(url: string, caller: AbortSignal): Promise<{ response: Response; blob: Blob }> {
  caller.throwIfAborted();
  const controller = new AbortController();
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let interrupt!: (reason: unknown) => void;
  const interrupted = new Promise<never>((_, reject) => { interrupt = reject; });
  const stop = (reason: unknown) => {
    if (controller.signal.aborted) return;
    controller.abort(reason); interrupt(reason);
    // A canceled read must not retain a locked reader or keep a custom stream
    // pulling after the UI has closed. Never wait for a broken cancel promise.
    if (reader) void reader.cancel(reason).catch(() => {});
  };
  const progress = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stop(new PrivatePdfError('產生PDF逾時，請重試。', response?.status || 0)), 60_000);
  };
  const readBlob = async (received: Response): Promise<Blob> => {
    if (!received.body?.getReader) return received.blob();
    reader = received.body.getReader();
    const chunks: BlobPart[] = [];
    while (true) {
      const { done, value } = await reader.read();
      controller.signal.throwIfAborted();
      if (done) break;
      if (value.byteLength) {
        chunks.push(new Uint8Array(value));
        progress();
      }
    }
    return new Blob(chunks, { type: received.headers.get('Content-Type') || '' });
  };
  const onAbort = () => stop(caller.reason);
  caller.addEventListener('abort', onAbort, { once: true });
  progress();
  try {
    const operation = (async () => {
      response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      controller.signal.throwIfAborted();
      progress();
      if (!response.ok) {
        const body: unknown = await (response.body?.getReader
          ? readBlob(response).then(blob => blob.text()).then(text => JSON.parse(text))
          : response.json()).catch(() => null);
        controller.signal.throwIfAborted();
        const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error
          ? body.error : '未能取得PDF檔案，請重試。';
        throw new PrivatePdfError(message, response.status);
      }
      if (!/^application\/pdf(?:;|$)/i.test(response.headers.get('Content-Type')?.trim() || '')) throw new PrivatePdfError('未能取得PDF檔案，請重試。');
      const blob = await readBlob(response);
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
    reader?.releaseLock();
  }
}
