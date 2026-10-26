import { unwrapAdminRecordResponse, validAdminResponse } from './admin-response';

export class AdminApiError extends Error {
  constructor(message: string, public status: number, public fields?: Record<string, string>) { super(message); }
}

// Bound both response headers and JSON consumption. Do not retry writes: the
// server may have committed before the transport failed, so callers retain drafts
// and their original optimistic version until the operator confirms the result.
export async function adminRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const caller = init?.signal;
  if (caller?.aborted) throw caller.reason;
  const controller = new AbortController();
  const writing = !['GET', 'HEAD'].includes((init?.method || 'GET').toUpperCase());
  let response: Response | undefined;
  const failure = (timeout = false) => new AdminApiError(
    response && !response.ok ? '暫時未能處理，請重試。' : writing
      ? '未能確認是否已儲存。修改仍在本頁，請勿關閉；請核對最新資料後再儲存。'
      : timeout ? '讀取逾時，請重試。' : '未能讀取有效資料，請重試。',
    response && !response.ok ? response.status : 0,
  );
  let interrupt!: (reason: unknown) => void;
  const interrupted = new Promise<never>((_, reject) => { interrupt = reject; });
  const stop = (reason: unknown) => { controller.abort(reason); interrupt(reason); };
  const onAbort = () => stop(caller?.reason);
  caller?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => stop(failure(true)), 20_000);
  try {
    const operation = (async () => {
      response = await fetch(url, { cache: 'no-store', ...init, signal: controller.signal });
      controller.signal.throwIfAborted();
      let body: unknown;
      try { body = await response.json(); }
      catch { controller.signal.throwIfAborted(); throw failure(); }
      controller.signal.throwIfAborted();
      const object = body !== null && typeof body === 'object' && !Array.isArray(body)
        ? body as Record<string, unknown> : null;
      if (!response.ok) {
        const fields = object?.fields;
        throw new AdminApiError(
          typeof object?.error === 'string' && object.error ? object.error : '暫時未能處理，請重試。',
          response.status,
          fields && typeof fields === 'object' && !Array.isArray(fields)
            && Object.values(fields).every(value => typeof value === 'string') ? fields as Record<string, string> : undefined,
        );
      }
      if (!object || !validAdminResponse(url, (init?.method || 'GET').toUpperCase(), object)) throw failure();
      return (/^\/api\/admin\/records\/[^/?]+(?:\?|$)/.test(url) ? unwrapAdminRecordResponse(body) : body) as T;
    })();
    return await Promise.race([operation, interrupted]);
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof AdminApiError) throw error;
    throw failure();
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener('abort', onAbort);
  }
}
