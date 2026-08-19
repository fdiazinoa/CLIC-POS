export const assertOperationalAcknowledgement = (
  payload: any,
  documentId: string,
  operation: string,
): void => {
  if (!payload) return;
  const results = Array.isArray(payload.results) ? payload.results : [];
  const explicitFailure = payload.success === false
    || payload.ok === false
    || Number(payload.failed || 0) > 0
    || Number(payload.applyFailedCount || 0) > 0
    || (Array.isArray(payload.errors) && payload.errors.length > 0)
    || results.some((result: any) => (
      result?.success === false
      || ['FAILED', 'ERROR', 'REJECTED'].includes(String(result?.status || '').toUpperCase())
    ));
  if (explicitFailure) {
    const reason = payload.message || payload.error || payload.errors?.[0]?.message || JSON.stringify(payload).slice(0, 600);
    throw new Error(`${operation}_ACK_FAILED: ${reason}`);
  }

  const processedIds = Array.isArray(payload.processedIds) ? payload.processedIds.map(String) : [];
  if (processedIds.length > 0 && !processedIds.includes(String(documentId))) {
    throw new Error(`${operation}_ACK_MISSING: ERP no confirmó ${documentId}`);
  }
};
