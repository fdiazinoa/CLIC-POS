import { markSettingsReturnQa, markSettingsReturnV3Failure, measureSettingsReturnQa } from '../settingsReturnQaTrace';
import { TERMINAL_SESSION_RENEWED_EVENT } from '../services/sync/OperationalTerminalConfig';
import { resolveVariantSalesPrice } from '../utils/variantSalesPrice';
import { v3OperationalConfigContext } from '../services/sync/LargeMasterSyncV3OperationalConfigScope';
import {readV3CompletedReservation} from '../services/sync/LargeMasterSyncV3FinancialCommit';
import {restoreV3ReservationReference,expireV3Reservation} from '../services/sync/LargeMasterSyncV3ReservationRecovery';
import { claimV3DirectTicket, readV3DirectWaitingTickets, updateV3DirectTicket } from '../services/sync/LargeMasterSyncV3DirectTicketSource';
import { assertWeightedCodeInput } from '../utils/weightedProduct';
import { subscribeLargeMasterSyncV3CatalogUpdates } from '../services/sync/LargeMasterSyncV3CatalogUpdates';
import { v3ErpStockDisplay, v3ErpStockDisplayScope } from '../services/sync/LargeMasterSyncV3ErpStockDisplay';
import type { V3OperationalCategory } from '../services/sync/LargeMasterSyncV3Categories';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import POSInterface, { type POSInterfaceProps, type V3OperationalPOSBoundary } from './POSInterface';
import { planV3CartReanchor } from '../services/sync/LargeMasterSyncV3CartReanchor';
import type { BusinessConfig, Product } from '../types';
import { acquireLargeMasterSyncV3ConfigContext, type LargeMasterSyncV3OperationalSession } from '../services/sync/LargeMasterSyncV3OperationalSession';
import type { LargeMasterSyncV3OperationalCatalog, V3ArticleDiagnostic } from '../services/sync/LargeMasterSyncV3OperationalCatalog';
import { reconcileV3TariffSelection, v3TariffContextKey, isV3TariffContextCurrent,
  type V3TariffSelection } from '../services/sync/LargeMasterSyncV3TariffSelection';

/** Real POS, with a bounded native read boundary; never mounts a legacy fallback. */
const LargeMasterSyncV3OperationalPOS: React.FC<POSInterfaceProps & { settingsSuspended?: boolean }> = ({ settingsSuspended, ...props }) => {
  const [session, setSession] = useState<LargeMasterSyncV3OperationalSession>();
  const [projected, setProjected] = useState<BusinessConfig>();
  const [visible, setVisible] = useState<Product[]>([]);
  const [cache, setCache] = useState<Product[]>([]);
  const [categories, setCategories] = useState<V3OperationalCategory[]>([]);
  const [error, setError] = useState('');
  const [articleDiagnostics, setArticleDiagnostics] = useState<V3ArticleDiagnostic[]>([]);
  const catalog = useRef<LargeMasterSyncV3OperationalCatalog>();
  const querySequence = useRef(0);
  const contextSequence = useRef(0);
  const lastQuery = useRef<{ query: string; categoryId: string | null; categoryKeys?: { ids: readonly string[]; aliases: readonly string[] } }>({ query: '', categoryId: null });
  const [inventoryRevision, setInventoryRevision] = useState(0);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [selection, setSelection] = useState<V3TariffSelection>();
  const wasSettingsSuspended = useRef(false);
  const suspended = Boolean(settingsSuspended);
  const presentation = useMemo(() => ({ suspended, resumed: !suspended && wasSettingsSuspended.current }), [suspended]);
  const latestPresentation = useRef(presentation);
  latestPresentation.current = presentation;
  const [validatedPresentation, setValidatedPresentation] = useState<typeof presentation>();
  const [readyPresentation, setReadyPresentation] = useState<typeof presentation>();
  const resumePending = presentation.resumed && validatedPresentation !== presentation;
  useEffect(() => {
    const enteringSettings = !wasSettingsSuspended.current && presentation.suspended;
    wasSettingsSuspended.current = presentation.suspended;
    if (enteringSettings) {
      ++querySequence.current;
      lastQuery.current = { query: '', categoryId: null };
      setVisible([]);
      setArticleDiagnostics([]);
      setSelection(undefined);
    }
    if (!resumePending) return;

    const reopen = () => {
      markSettingsReturnQa('v3.trigger.resumeReopen');
      ++contextSequence.current;
      ++querySequence.current;
      catalog.current = undefined;
      setCatalogRevision(previous => previous + 1);
    };
    if (error || !session || !catalog.current) {
      if (error) reopen();
      setValidatedPresentation(presentation);
      return;
    }

    let current = true;
    const sequence = contextSequence.current;
    // Settings can refresh the stored runtime without publishing a catalog event.
    void (async () => {
      try {
        await measureSettingsReturnQa('v3.resume.assertCurrent', () => session.assertCurrent());
        session.assertSetupIdentity();
      } catch (error) {
        markSettingsReturnV3Failure('resume', error);
        if (current && latestPresentation.current === presentation && contextSequence.current === sequence) reopen();
      }
      if (current && latestPresentation.current === presentation) setValidatedPresentation(presentation);
    })();
    return () => { current = false; };
  }, [presentation, resumePending, session, error]);
  useEffect(() => subscribeLargeMasterSyncV3CatalogUpdates(() => {
    markSettingsReturnQa('v3.trigger.catalogPublished');
    ++contextSequence.current; ++querySequence.current; catalog.current = undefined;
    setCatalogRevision(previous => previous + 1);
  }, true), []);
  useEffect(() => {
    const renew = (event?: Event) => {
      if (latestPresentation.current.suspended || !session?.needsSessionRenewal()) return;
      markSettingsReturnQa(event ? 'v3.trigger.terminalSessionRenewed' : 'v3.trigger.renewalDetected');
      ++contextSequence.current;
      ++querySequence.current;
      catalog.current = undefined;
      setCatalogRevision(previous => previous + 1);
    };
    window.addEventListener(TERMINAL_SESSION_RENEWED_EVENT, renew);
    // A renewal can finish while the initial catalog is still opening.
    renew();
    return () => window.removeEventListener(TERMINAL_SESSION_RENEWED_EVENT, renew);
  }, [session]);
  const latestProps = useRef(props);
  latestProps.current = props;
  const terminal = props.config.terminals.find(row => row.id === props.activeTerminalId);
  const warehouseId = terminal?.config.inventoryScope?.defaultSalesWarehouseId || '';
  const authority = { terminalId: props.activeTerminalId || '', warehouseId,
    defaultTariffId: terminal?.config.pricing?.defaultTariffId || '',
    allowedTariffIds: terminal?.config.pricing?.allowedTariffIds || [] };
  const authorityKey = v3TariffContextKey(authority);
  let reconciled: V3TariffSelection | undefined;
  let authorityError = '';
  try { reconciled = reconcileV3TariffSelection(selection, authority, props.cart.length > 0); }
  catch (reason) { authorityError = String((reason as Error).message || reason); }
  const tariffId = reconciled?.tariffId || '';
  let configScope = '';
  try { configScope = v3OperationalConfigContext(props.config, { localTerminalId: props.activeTerminalId || '' }).key; }
  catch (reason) { authorityError = String((reason as Error).message || reason); }
  const wantedContextKey = JSON.stringify([authorityKey, tariffId, configScope]);
  const observedContextKey = useRef(wantedContextKey);
  useEffect(() => {
    if (observedContextKey.current !== wantedContextKey) {
      markSettingsReturnQa('v3.trigger.contextKeyChanged');
      observedContextKey.current = wantedContextKey;
    }
  }, [wantedContextKey]);
  const latestContextKey = useRef(wantedContextKey);
  latestContextKey.current = authorityError ? '' : wantedContextKey;
  const [loadedContextKey, setLoadedContextKey] = useState('');
  const acquisition = useRef<{ config: BusinessConfig; key: string; phase: 'pending' | 'failed' | 'ready' }>();
  const [configRetryRevision, setConfigRetryRevision] = useState(0);

  useEffect(() => {
    const attempt = acquisition.current;
    if (!attempt || attempt.phase === 'ready' || attempt.config === props.config
      || attempt.key !== wantedContextKey || authorityError) return;
    // A deferred config publication can replace props without changing its scope.
    // Retire only the unfinished/failed read; a ready presentation-only update stays live.
    ++contextSequence.current; ++querySequence.current; catalog.current = undefined;
    markSettingsReturnQa('v3.trigger.configPublished');
    setConfigRetryRevision(previous => previous + 1);
  }, [props.config, wantedContextKey, authorityError]);

  useEffect(() => {
    if (!authorityError && reconciled && JSON.stringify(selection) !== JSON.stringify(reconciled)) setSelection(reconciled);
  }, [authorityKey, tariffId, authorityError, selection]);

  useEffect(() => {
    let current = true;
    const context = ++contextSequence.current;
    const attempt = { config: latestProps.current.config, key: wantedContextKey, phase: 'pending' as 'pending' | 'failed' | 'ready' };
    acquisition.current = attempt;
    const currentAttempt = () => current && acquisition.current === attempt
      && attempt.config === latestProps.current.config
      && isV3TariffContextCurrent(wantedContextKey, latestContextKey.current, context, contextSequence.current);
    catalog.current = undefined;
    setError('');
    setArticleDiagnostics([]);
    ++querySequence.current;
    void (async () => {
      if (authorityError) throw new Error(authorityError);
      if (!warehouseId || !tariffId) throw new Error('SYNC_V3_CONFIGURED_TARIFF_WAREHOUSE_REQUIRED');
      const ready = await measureSettingsReturnQa('v3.acquireContext', () => acquireLargeMasterSyncV3ConfigContext(attempt.config, latestProps.current.activeTerminalId || ''));
      if (!currentAttempt()) return;
      const [config, source] = await Promise.all([ready.projectConfig(attempt.config), ready.catalog(tariffId, warehouseId)]);
      const categoryMetadata = await source.categories();
      if (!currentAttempt()) return;
      if (!config.tariffs.some(row => row.id === tariffId)) throw new Error('SYNC_V3_TARIFF_UNAVAILABLE');
      attempt.phase = 'ready';
      catalog.current = source;
      setCategories(categoryMetadata);
      setSession(ready);
      setProjected(config);
      setVisible([]);
      setCache([]);
      setLoadedContextKey(wantedContextKey);
    })().catch(reason => {
      markSettingsReturnV3Failure('acquire', reason);
      if (!currentAttempt()) return;
      attempt.phase = 'failed';
      setError(String(reason.message || reason));
    });
    return () => { current = false; ++contextSequence.current; ++querySequence.current; };
  }, [props.activeTerminalId, warehouseId, tariffId, authorityKey, authorityError, configScope, catalogRevision, configRetryRevision]);

  const effectiveConfig = useMemo(() => projected ? {
    ...(loadedContextKey === wantedContextKey && !authorityError ? props.config : projected),
    tariffs: projected.tariffs, taxes: projected.taxes, taxRate: projected.taxRate } : undefined,
  [props.config, projected, loadedContextKey, wantedContextKey, authorityError]);

  const remember = useCallback((rows: Product[]) => {
    setCache(previous => {
      const retained = new Set(latestProps.current.cart.map(row => row.id));
      const merged = new Map(previous.filter(row => retained.has(row.id)).map(row => [row.id, row]));
      rows.forEach(row => merged.set(row.id, row));
      return [...merged.values()];
    });
  }, []);

  const boundary = useMemo<V3OperationalPOSBoundary | undefined>(() => {
    if (suspended || resumePending || !session || !projected || !catalog.current || loadedContextKey !== wantedContextKey || authorityError) return undefined;
    const pinnedSource = catalog.current;
    const pinnedContext = contextSequence.current;
    const isCurrent = () => presentation === latestPresentation.current && pinnedContext === contextSequence.current
      && pinnedSource === catalog.current && latestContextKey.current === wantedContextKey;
    const assertContext = () => {
      if (presentation !== latestPresentation.current || pinnedContext !== contextSequence.current || pinnedSource !== catalog.current) throw new Error('SYNC_V3_UI_CONTEXT_CHANGED');
      if (latestContextKey.current !== wantedContextKey) throw new Error('SYNC_V3_UI_CONTEXT_CHANGED');
    };
    return {
    tariffId,
    liveInventory: pinnedSource.liveInventory,
    categories,
    search: async (query, categoryId, categoryKeys) => {
      // Retired reads cannot change catalog state or surface stale errors.
      if (!isCurrent()) return;
      assertContext();
      const sequence = ++querySequence.current;
      const context = contextSequence.current;
      const source = catalog.current;
      if (!source) throw new Error('SYNC_V3_UI_CONTEXT_CHANGED');
      lastQuery.current = { query, categoryId, categoryKeys };
      try {
      await session.assertCurrent();
      let diagnostics: V3ArticleDiagnostic[] = [];
      const items = await source.search(query, query.trim() ? null : (categoryKeys || categoryId), 60, rows => { diagnostics = rows; });
      const rows = await session.withStocks(items.map(item => item.product), warehouseId);
      if (sequence !== querySequence.current || context !== contextSequence.current) return;
      if (!isCurrent()) return;
      remember(rows);
      setVisible(rows);
      setArticleDiagnostics(diagnostics);
      } catch (reason) {
        if (sequence !== querySequence.current || !isCurrent()) return;
        throw reason;
      }
    },
    resolveCode: async raw => {
      assertContext();
      const context = contextSequence.current;
      const source = catalog.current;
      if (!source) throw new Error('SYNC_V3_UI_CONTEXT_CHANGED');
      const multiplied = /^(\d+(?:\.\d+)?)\*(.+)$/.exec(raw.trim());
      const quantity = multiplied ? Number(multiplied[1]) : 1;
      const code = multiplied ? multiplied[2].trim() : raw.trim();
      await session.assertCurrent();
      const match = await source.findBarcode(code, true);
      if (!match) return null;
      const product = await session.withStock(match.item.product, warehouseId);
      if (context !== contextSequence.current || source !== catalog.current) throw new Error('SYNC_V3_UI_CONTEXT_CHANGED');
      assertContext();
      assertWeightedCodeInput(product, raw);
      remember([product]);
      return { product, quantity, price: resolveVariantSalesPrice(match.variant, product.price),
        modifiers: match.variant ? Object.values(match.variant.attributeValues || {}).map(String) : [], selectedVariant: match.variant || undefined,
        variantInfo: match.variant ? Object.entries(match.variant.attributeValues || {}).map(([key, value]) => `${key}: ${value}`).join(' · ') : undefined };
    },
    reanchor: async lines => {
      assertContext();
      const source = catalog.current;
      if (!source || !lines.length) return null;
      const authority = new Map<string, import('../types').V3SaleAuthorityStamp | null>();
      for (const line of lines) {
        if (authority.has(line.id)) continue;
        const item = await source.get(line.id);
        authority.set(line.id, item ? item.authority : null);
      }
      assertContext();
      const outcome = planV3CartReanchor(lines, line => authority.get(line.id) ?? null, String((session as any).binding || ''), warehouseId);
      if (!outcome.changed) return null;
      void Promise.all([...new Set(lines.map(line => line.id))].map(async id => {
        const item = await source.get(id);
        return item ? session.withStock(item.product, warehouseId) : null;
      })).then(rows => { if (isCurrent()) remember(rows.filter((row): row is NonNullable<typeof row> => row !== null)); }).catch(() => undefined);
      return outcome.lines;
    },
    validate: async (lines, reference, addTrace) => {
      assertContext();
      await session.validate({ ...latestProps.current.config, tariffs: projected.tariffs,
        taxes: projected.taxes, taxRate: projected.taxRate }, lines, tariffId, warehouseId, 'SALE', undefined, reference, false, undefined, addTrace);
      assertContext();
    },
    completedReservation: async (source,lines,customerId) => { assertContext(); const transaction = await readV3CompletedReservation({reservationId:source.id,claimId:`reservation:${source.id}`,expectedSource:source,lines,customerId}); assertContext(); return transaction; },
    expireReservation: async id => { assertContext(); const expired = await expireV3Reservation(id); assertContext(); return expired; },
    restoreReservation: async id => { assertContext(); const recovery = await restoreV3ReservationReference(id,warehouseId); assertContext(); remember(recovery.products); return recovery; },
    restoreRetainedTicket: async (id, assertAuthorized) => { assertContext(); const restoration = await claimV3DirectTicket(id, assertAuthorized); assertContext(); return restoration; },
    updateRetainedTicket: async (id,ticket) => { assertContext(); await updateV3DirectTicket(id,ticket); assertContext(); },
    waitingTickets: async tickets => { assertContext(); const result = await readV3DirectWaitingTickets(tickets); assertContext(); return result; },
    changeTariff: id => {
      assertContext();
      if (latestProps.current.cart.length) throw new Error('SYNC_V3_TARIFF_CHANGE_CART_NOT_EMPTY');
      if (!authority.allowedTariffIds.includes(id) || !projected.tariffs.some(row => row.id === id)) throw new Error('SYNC_V3_TARIFF_UNAVAILABLE');
      if (id === tariffId) { setSelection({ ...authority, tariffId: id, mode: 'manual' }); return; }
      ++contextSequence.current;
      latestContextKey.current = '';
      setSelection({ ...authority, tariffId: id, mode: 'manual' });
    },
  }; }, [session, projected, tariffId, warehouseId, categories, remember, loadedContextKey, wantedContextKey, authorityError, presentation, catalogRevision, resumePending]);

  useEffect(() => {
    if (!boundary || !props.cart.length) return;
    let current = true;
    const expectedContext = wantedContextKey;
    const expectedSequence = contextSequence.current;
    const source = catalog.current;
    const currentRead = () => current && presentation === latestPresentation.current
      && expectedSequence === contextSequence.current && source === catalog.current && latestContextKey.current === expectedContext;
    void Promise.all([...new Set(props.cart.map(row => row.id))].map(async id => {
      const item = await source!.get(id);
      return item ? session!.withStock(item.product, warehouseId) : null;
    })).then(rows => { if (currentRead()) remember(rows.filter((row): row is Product => row !== null)); })
      .catch(reason => { if (currentRead()) setError(String(reason.message || reason)); });
    return () => { current = false; };
  }, [boundary, props.cart, remember, session, warehouseId, inventoryRevision, presentation]);

  useEffect(() => {
    const refresh = () => {
      ++querySequence.current;
      setInventoryRevision(previous => previous + 1);
      if (boundary) void boundary.search(lastQuery.current.query, lastQuery.current.categoryId, lastQuery.current.categoryKeys)
        .catch(reason => { if (presentation === latestPresentation.current && boundary === lastBoundary.current && latestContextKey.current === wantedContextKey && catalog.current) setError(String(reason.message || reason)); });
    };
    window.addEventListener('v3InventoryUpdated', refresh);
    return () => window.removeEventListener('v3InventoryUpdated', refresh);
  }, [boundary, presentation]);

  const failure = authorityError || error;
  const erpStockScope = useMemo(() => {
    const tenantId = terminal?.config.erpBinding?.tenantId;
    if (!boundary || failure || !session || !terminal || !tenantId) return undefined;
    return v3ErpStockDisplayScope(terminal, tenantId, session.binding, session.ready.runtime.version);
  }, [boundary, failure, session, terminal]);
  useEffect(() => {
    if (!erpStockScope) return;
    let current = true;
    void v3ErpStockDisplay.hydrate(erpStockScope).then(loaded => {
      if (current && loaded) window.dispatchEvent(new CustomEvent('v3ErpStockDisplayUpdated'));
    });
    return () => { current = false; };
  }, [erpStockScope]);
  const readCartItemErpAvailableStock = useMemo(() => {
    if (!erpStockScope) return undefined;
    const sequence = contextSequence.current;
    return (itemId: string) => presentation === latestPresentation.current && sequence === contextSequence.current
      && latestContextKey.current === wantedContextKey
      ? v3ErpStockDisplay.read(erpStockScope, itemId)?.balance : undefined;
  }, [erpStockScope, wantedContextKey, presentation]);
  const completingSettingsReturn = presentation.resumed && readyPresentation !== presentation;
  const checkingRetainedCatalog = completingSettingsReturn && !boundary && Boolean(projected) && !failure;
  useEffect(() => {
    if (completingSettingsReturn && boundary && !failure) {
      markSettingsReturnQa('v3.salesReady');
      setReadyPresentation(presentation);
    }
  }, [completingSettingsReturn, boundary, failure, presentation]);

  // Keep the mounted POS (including retained-ticket/reservation/payment state) across renewal.
  // A distinct rejecting boundary also retires the child's queued and in-flight old actions.
  const lastBoundary = useRef<V3OperationalPOSBoundary>();
  if (boundary) lastBoundary.current = boundary;
  const blockedBoundary = useMemo<V3OperationalPOSBoundary>(() => {
    const reject = () => { throw new Error('SYNC_V3_UI_CONTEXT_CHANGED'); };
    const rejectAsync = async () => reject();
    return { tariffId: lastBoundary.current?.tariffId || tariffId,
      categories: lastBoundary.current?.categories || categories,
      // Read searches wait for the replacement boundary; mutations still reject.
      search: async () => {}, resolveCode: rejectAsync, validate: rejectAsync, changeTariff: reject,
      completedReservation: rejectAsync, expireReservation: rejectAsync, restoreReservation: rejectAsync,
      restoreRetainedTicket: rejectAsync, updateRetainedTicket: rejectAsync, waitingTickets: rejectAsync };
  }, [wantedContextKey, authorityError, error, boundary]);
  if (suspended) return null;
  const notice = failure ? <div role="alert" className="p-6 text-red-700">
    <p>Candidato V3 detenido: {failure}</p>
    <button type="button" onClick={() => props.onOpenSettings()} className="mt-4 rounded bg-blue-600 px-4 py-2 text-white">
      Abrir ajustes
    </button>
  </div> : !boundary ? <div role="status" className="p-6">
    {checkingRetainedCatalog ? 'Verificando catálogo e inventario…' : 'Preparando catálogo V3 e inventario del dispositivo vinculado…'}
  </div> : null;
  if (!projected || (completingSettingsReturn && (!boundary || failure))) return notice;
  return <>{notice}<POSInterface {...props} config={effectiveConfig!} products={cache} productPrices={[]}
    v3Operational={failure ? blockedBoundary : boundary || blockedBoundary} catalogSearchProducts={visible}
    readCartItemErpAvailableStock={readCartItemErpAvailableStock}
    catalogArticleDiagnostics={articleDiagnostics}
    onUpdateProducts={() => { throw new Error('SYNC_V3_LOCAL_CATALOG_EDIT_UNSUPPORTED'); }}
    onUpdateConfig={next => props.onUpdateConfig({ ...next, taxes: props.config.taxes,
      tariffs: props.config.tariffs, taxRate: props.config.taxRate })} /></>;
};

export default LargeMasterSyncV3OperationalPOS;
