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
      || (path === '/api/mesas/desbloquear' && code === 'TABLE_EDIT_LOCK_OWNERSHIP_MISMATCH')
      || (path === '/api/mesas/liberar' && (
        code === 'TABLE_RELEASE_ORDER_MISMATCH'
        || code === 'TABLE_RELEASE_HAS_REMAINING_ACCOUNTS'
      ));
  }
  if (method.toUpperCase() !== 'PUT') return false;
  if (path === '/api/mesas/parked-tickets') {
    return code === 'TABLE_EDIT_LOCK_REQUIRED'
      || code === 'PARKED_TICKETS_BASE_REVISION_STALE'
      || code === 'PARKED_TICKETS_BASE_REVISION_AHEAD';
  }
  return code === 'TABLE_EDIT_LOCK_REQUIRED' && /^\/api\/tables\/[^/]+$/.test(path);
};
