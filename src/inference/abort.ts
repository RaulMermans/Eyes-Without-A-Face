/**
 * Settle with `promise`, or reject as soon as `signal` aborts.
 *
 * Firebase AI 3.0.0's Chrome adapter does not pass the request's AbortSignal
 * to `LanguageModel.prompt()`, so a hung on-device prompt would never reject
 * and the configured timeout would be ignored (Sprint 5 finding). Racing the
 * signal makes the timeout effective. The abandoned prompt may keep running
 * inside Chrome until its session is destroyed; its result is discarded.
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
