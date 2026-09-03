/** Keep the deadline active until the response body has been consumed, too. */
export async function fetchAndReadWithTimeout<T>(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  read: (response: Response) => Promise<T>,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('TERMINAL_CONFIG_REQUEST_TIMEOUT'));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetcher(url, { ...init, signal: controller.signal }).then(read),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
