/** The Android Master rejects these requests before changing restaurant state. */
export const isSafeTableLockRejection = (
  url: string,
  method: string,
  status: number,
  data: unknown,
): boolean => {
  if (status !== 409) return false;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const code = (data as Record<string, unknown>).code;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  if (method.toUpperCase() === 'POST') {
    return (path === '/api/mesas/bloquear' && code === 'TABLE_EDIT_LOCKED')
      || (path === '/api/mesas/desbloquear' && code === 'TABLE_EDIT_LOCK_OWNERSHIP_MISMATCH');
  }
  return method.toUpperCase() === 'PUT'
    && code === 'TABLE_EDIT_LOCK_REQUIRED'
    && (path === '/api/mesas/parked-tickets' || /^\/api\/tables\/[^/]+$/.test(path));
};
