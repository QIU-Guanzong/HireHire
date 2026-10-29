// Bound every asynchronous upload stage, including transports/decoders that
// settle late or ignore cancellation. The caller owns the deadline and signal.
export async function photoUploadStage<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }),
      aborted,
    ]);
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}
