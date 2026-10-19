import { useEffect, useRef, useState } from 'react';
import type { BusinessConfig } from '../../types';
import { LargeMasterSyncV3KioskCatalog, V3KioskPaymentAttempt } from '../../services/sync/LargeMasterSyncV3KioskCatalog';
import { subscribeLargeMasterSyncV3CatalogUpdates } from '../../services/sync/LargeMasterSyncV3CatalogUpdates';

export function useLargeMasterSyncV3Kiosk(enabled: boolean, config: BusinessConfig, terminalId: string) {
  const latest = useRef({ config, terminalId });
  latest.current = { config, terminalId };
  const [catalog, setCatalog] = useState<LargeMasterSyncV3KioskCatalog>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const payment = useRef(new V3KioskPaymentAttempt()).current;
  useEffect(() => {
    if (!enabled) return;
    return subscribeLargeMasterSyncV3CatalogUpdates(() => {
      catalog?.dispose();
      setRevision(value => value + 1);
    }, true);
  }, [enabled, catalog]);
  useEffect(() => {
    if (!enabled) { payment.resetCompleted(); return; }
    let current = true;
    let opened: LargeMasterSyncV3KioskCatalog | undefined;
    setCatalog(undefined);
    setError('');
    void LargeMasterSyncV3KioskCatalog.open(() => latest.current).then(result => {
      opened = result;
      if (current) setCatalog(result); else result.dispose();
    }).catch(reason => { if (current) setError(String(reason.message || reason)); });
    return () => { current = false; opened?.dispose(); };
  }, [enabled, config, terminalId, revision]);
  return { catalog, error, payment };
}
