import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import POSInterface, { type POSInterfaceProps, type V3OperationalPOSBoundary } from './POSInterface';
import type { BusinessConfig, Product } from '../types';
import { getLargeMasterSyncV3OperationalSession, type LargeMasterSyncV3OperationalSession } from '../services/sync/LargeMasterSyncV3OperationalSession';
import type { LargeMasterSyncV3OperationalCatalog } from '../services/sync/LargeMasterSyncV3OperationalCatalog';

/** Real POS, with a bounded native read boundary; never mounts a legacy fallback. */
const LargeMasterSyncV3OperationalPOS: React.FC<POSInterfaceProps> = props => {
  const [session, setSession] = useState<LargeMasterSyncV3OperationalSession>();
  const [projected, setProjected] = useState<BusinessConfig>();
  const [visible, setVisible] = useState<Product[]>([]);
  const [cache, setCache] = useState<Product[]>([]);
  const [error, setError] = useState('');
  const catalog = useRef<LargeMasterSyncV3OperationalCatalog>();
  const querySequence = useRef(0);
  const contextSequence = useRef(0);
  const lastQuery = useRef<{ query: string; categoryId: string | null }>({ query: '', categoryId: null });
  const [inventoryRevision, setInventoryRevision] = useState(0);
  const latestProps = useRef(props);
  latestProps.current = props;
  const terminal = props.config.terminals.find(row => row.id === props.activeTerminalId);
  const warehouseId = terminal?.config.inventoryScope?.defaultSalesWarehouseId || '';
  const [tariffId, setTariffId] = useState(terminal?.config.pricing?.defaultTariffId || '');
  const previousScope = useRef({ terminalId: props.activeTerminalId, warehouseId });

  useEffect(() => {
    if (previousScope.current.terminalId !== props.activeTerminalId) {
      setTariffId(terminal?.config.pricing?.defaultTariffId || '');
    }
  }, [props.activeTerminalId, terminal?.config.pricing?.defaultTariffId]);

  useEffect(() => {
    let current = true;
    const context = ++contextSequence.current;
    catalog.current = undefined;
    setProjected(undefined);
    setError('');
    ++querySequence.current;
    void (async () => {
      if (latestProps.current.cart.length && (previousScope.current.terminalId !== props.activeTerminalId
        || previousScope.current.warehouseId !== warehouseId)) throw new Error('SYNC_V3_CART_CONTEXT_CHANGED');
      previousScope.current = { terminalId: props.activeTerminalId, warehouseId };
      if (!warehouseId || !tariffId) throw new Error('SYNC_V3_CONFIGURED_TARIFF_WAREHOUSE_REQUIRED');
      const ready = await getLargeMasterSyncV3OperationalSession();
      const [config, source] = await Promise.all([ready.projectConfig(latestProps.current.config), ready.catalog(tariffId, warehouseId)]);
      if (!current || context !== contextSequence.current) return;
      catalog.current = source;
      setSession(ready);
      setProjected(config);
      setVisible([]);
      setCache([]);
    })().catch(reason => { if (current) setError(String(reason.message || reason)); });
    return () => { current = false; ++contextSequence.current; ++querySequence.current; };
  }, [props.activeTerminalId, warehouseId, tariffId]);

  const effectiveConfig = useMemo(() => projected ? { ...props.config,
    tariffs: projected.tariffs, taxes: projected.taxes, taxRate: projected.taxRate } : undefined,
  [props.config, projected]);

  const remember = useCallback((rows: Product[]) => {
    setCache(previous => {
      const retained = new Set(latestProps.current.cart.map(row => row.id));
      const merged = new Map(previous.filter(row => retained.has(row.id)).map(row => [row.id, row]));
      rows.forEach(row => merged.set(row.id, row));
      return [...merged.values()];
    });
  }, []);

  const boundary = useMemo<V3OperationalPOSBoundary | undefined>(() => {
    if (!session || !projected || !catalog.current) return undefined;
    const pinnedSource = catalog.current;
    const pinnedContext = contextSequence.current;
    const assertContext = () => {
      if (pinnedContext !== contextSequence.current || pinnedSource !== catalog.current) throw new Error('SYNC_V3_UI_CONTEXT_CHANGED');
    };
    return {
    tariffId,
    search: async (query, categoryId) => {
      assertContext();
      const sequence = ++querySequence.current;
      const context = contextSequence.current;
      const source = catalog.current;
      if (!source) throw new Error('SYNC_V3_UI_CONTEXT_CHANGED');
      lastQuery.current = { query, categoryId };
      await session.assertCurrent();
      const items = await source.search(query, categoryId, 60);
      const rows = await session.withStocks(items.map(item => item.product), warehouseId);
      if (sequence !== querySequence.current || context !== contextSequence.current) return;
      remember(rows);
      setVisible(rows);
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
      remember([product]);
      return { product, quantity, price: match.variant?.price ?? product.price,
        modifiers: [], selectedVariant: match.variant || undefined,
        variantInfo: match.variant ? Object.entries(match.variant.attributeValues || {}).map(([key, value]) => `${key}: ${value}`).join(' · ') : undefined };
    },
    validate: async lines => {
      assertContext();
      await session.validate({ ...latestProps.current.config, tariffs: projected.tariffs,
        taxes: projected.taxes, taxRate: projected.taxRate }, lines, tariffId, warehouseId);
      assertContext();
    },
    changeTariff: id => {
      if (latestProps.current.cart.length) throw new Error('SYNC_V3_TARIFF_CHANGE_CART_NOT_EMPTY');
      if (!projected.tariffs.some(row => row.id === id)) throw new Error('SYNC_V3_TARIFF_UNAVAILABLE');
      if (id === tariffId) return;
      ++contextSequence.current;
      setTariffId(id);
    },
  }; }, [session, projected, tariffId, warehouseId, remember]);

  useEffect(() => {
    if (!boundary || !props.cart.length) return;
    let current = true;
    void Promise.all([...new Set(props.cart.map(row => row.id))].map(async id => {
      const item = await catalog.current!.get(id);
      return item ? session!.withStock(item.product, warehouseId) : null;
    })).then(rows => { if (current) remember(rows.filter((row): row is Product => row !== null)); })
      .catch(reason => { if (current) setError(String(reason.message || reason)); });
    return () => { current = false; };
  }, [boundary, props.cart, remember, session, warehouseId, inventoryRevision]);

  useEffect(() => {
    const refresh = () => {
      ++querySequence.current;
      setInventoryRevision(previous => previous + 1);
      if (boundary) void boundary.search(lastQuery.current.query, lastQuery.current.categoryId)
        .catch(reason => setError(String(reason.message || reason)));
    };
    window.addEventListener('v3InventoryUpdated', refresh);
    return () => window.removeEventListener('v3InventoryUpdated', refresh);
  }, [boundary]);

  if (error) return <div role="alert" className="p-6 text-red-700">Candidato V3 detenido: {error}</div>;
  if (!projected || !boundary) return <div role="status" className="p-6">Preparando catálogo V3 e inventario del dispositivo vinculado…</div>;
  return <POSInterface {...props} config={effectiveConfig!} products={cache} productPrices={[]}
    v3Operational={boundary} catalogSearchProducts={visible}
    onUpdateProducts={() => { throw new Error('SYNC_V3_LOCAL_CATALOG_EDIT_UNSUPPORTED'); }}
    onUpdateConfig={next => props.onUpdateConfig({ ...next, taxes: props.config.taxes,
      tariffs: props.config.tariffs, taxRate: props.config.taxRate })} />;
};

export default LargeMasterSyncV3OperationalPOS;
