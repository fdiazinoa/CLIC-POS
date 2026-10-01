/** The Android Master rejects these requests before changing restaurant state. */
export const isSafeTableLockRejection = (
  url: string,
  method: string,
  status: number,
  data: unknown,
): boolean => {
  if (method.toUpperCase() !== 'PUT' || status !== 409) return false;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if ((data as Record<string, unknown>).code !== 'TABLE_EDIT_LOCK_REQUIRED') return false;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  return path === '/api/mesas/parked-tickets' || /^\/api\/tables\/[^/]+$/.test(path);
};
