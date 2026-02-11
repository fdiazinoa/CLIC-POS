import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList, Database, FileText, Lock } from 'lucide-react';
import { BusinessConfig, InventoryAuditLog, InventorySnapshot, InventorySnapshotItem, Product, RoleDefinition, User, Warehouse } from '../../types';
import { db } from '../../utils/db';

interface InventoryAuditClosureProps {
  warehouses: Warehouse[];
  products: Product[];
  config: BusinessConfig;
  currentUser: User | null;
  roles: RoleDefinition[];
  terminalId?: string;
}

type AuditFilter = 'ALL' | 'DIFF' | 'UNCNT';

type AuditRow = {
  productId: string;
  productName: string;
  category?: string;
  systemQty: number;
  physicalQty?: number;
  diffQty?: number;
};

const LIMBO_DAYS = 30;

const InventoryAuditClosure: React.FC<InventoryAuditClosureProps> = ({
  warehouses,
  products,
  config,
  currentUser,
  roles
}) => {
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>(warehouses[0]?.id || '');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [auditFilter, setAuditFilter] = useState<AuditFilter>('ALL');
  const [auditCounts, setAuditCounts] = useState<Record<string, string>>({});
  const [auditLogs, setAuditLogs] = useState<InventoryAuditLog[]>([]);
  const [snapshots, setSnapshots] = useState<InventorySnapshot[]>([]);
  const [isApplying, setIsApplying] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [showReopen, setShowReopen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [avgCostByProduct, setAvgCostByProduct] = useState<Map<string, number>>(new Map());

  const isAdmin = useMemo(() => {
    if (!currentUser) return false;
    const role = roles.find(r => r.id === currentUser.role);
    if (!role) return false;
    if (role.permissions?.includes('ALL')) return true;
    return role.name?.toUpperCase() === 'ADMIN';
  }, [currentUser, roles]);

  useEffect(() => {
    const load = async () => {
      const storedLogs = await db.get('inventoryAuditLogs') as InventoryAuditLog[] || [];
      const storedSnapshots = await db.get('inventorySnapshots') as InventorySnapshot[] || [];
      setAuditLogs(storedLogs);
      setSnapshots(storedSnapshots);
    };
    load();
  }, []);

  useEffect(() => {
    if (!selectedWarehouseId && config?.inventoryScope?.defaultSalesWarehouseId) {
      setSelectedWarehouseId(config.inventoryScope.defaultSalesWarehouseId);
    }
  }, [config?.inventoryScope?.defaultSalesWarehouseId, selectedWarehouseId]);

  useEffect(() => {
    const loadCosts = async () => {
      const entries = await db.get('inventoryLedger') as any[] || [];
      const byKey: Record<string, number> = {};
      entries
        .filter(e => !selectedWarehouseId || e.warehouseId === selectedWarehouseId)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .forEach(e => {
          byKey[`${e.productId}|${e.warehouseId}`] = e.balanceAvgCost || e.unitCost || 0;
        });

      const map = new Map<string, number>();
      products.forEach(p => {
        const key = `${p.id}|${selectedWarehouseId}`;
        const cost = byKey[key] ?? p.cost ?? 0;
        map.set(p.id, cost);
      });
      setAvgCostByProduct(map);
    };
    loadCosts();
  }, [products, selectedWarehouseId]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (selectedCategory !== 'ALL' && p.category !== selectedCategory) return false;
      if (!selectedWarehouseId) return false;
      if (p.activeInWarehouses && !p.activeInWarehouses.includes(selectedWarehouseId)) return false;
      return true;
    });
  }, [products, selectedCategory, selectedWarehouseId]);

  const auditRows: AuditRow[] = useMemo(() => {
    return filteredProducts.map(p => {
      const systemQty = p.stockBalances?.[selectedWarehouseId] ?? p.stock ?? 0;
      const raw = auditCounts[p.id];
      const physicalQty = raw === undefined || raw === '' ? undefined : Number(raw);
      const diffQty = physicalQty === undefined ? undefined : physicalQty - systemQty;
      return {
        productId: p.id,
        productName: p.name,
        category: p.category,
        systemQty,
        physicalQty,
        diffQty
      };
    });
  }, [filteredProducts, auditCounts, selectedWarehouseId]);

  const latestAuditSessionId = useMemo(() => {
    const forWarehouse = auditLogs.filter(l => l.warehouseId === selectedWarehouseId && l.action === 'COUNT');
    if (forWarehouse.length === 0) return null;
    const latest = [...forWarehouse].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    return latest.sessionId;
  }, [auditLogs, selectedWarehouseId]);

  const kpi = useMemo(() => {
    const rows = auditRows;
    const totalValue = rows.reduce((sum, r) => {
      const cost = avgCostByProduct.get(r.productId) || 0;
      return sum + (r.systemQty * cost);
    }, 0);

    const counted = rows.filter(r => r.physicalQty !== undefined);
    const totalSystem = counted.reduce((sum, r) => sum + r.systemQty, 0);
    const totalAbsDiff = counted.reduce((sum, r) => sum + Math.abs(r.diffQty || 0), 0);
    const eri = totalSystem > 0 ? Math.max(0, 1 - (totalAbsDiff / totalSystem)) * 100 : 0;

    const sessionLogs = latestAuditSessionId
      ? auditLogs.filter(l => l.sessionId === latestAuditSessionId && l.action === 'COUNT')
      : [];

    const shortage = sessionLogs.reduce((sum, l) => {
      if ((l.diffQty || 0) < 0) return sum + Math.abs(l.diffQty || 0) * (avgCostByProduct.get(l.productId || '') || 0);
      return sum;
    }, 0);
    const surplus = sessionLogs.reduce((sum, l) => {
      if ((l.diffQty || 0) > 0) return sum + (l.diffQty || 0) * (avgCostByProduct.get(l.productId || '') || 0);
      return sum;
    }, 0);

    const cutoff = new Date(Date.now() - LIMBO_DAYS * 24 * 60 * 60 * 1000);
    const latestByProduct = new Map<string, string>();
    auditLogs.filter(l => l.action === 'COUNT' && l.warehouseId === selectedWarehouseId).forEach(l => {
      if (!l.productId) return;
      const prev = latestByProduct.get(l.productId);
      if (!prev || new Date(l.createdAt) > new Date(prev)) latestByProduct.set(l.productId, l.createdAt);
    });
    const limbo = filteredProducts.filter(p => {
      const last = latestByProduct.get(p.id);
      if (!last) return true;
      return new Date(last) < cutoff;
    }).length;

    return { totalValue, eri, shortage, surplus, limbo };
  }, [auditRows, avgCostByProduct, auditLogs, latestAuditSessionId, filteredProducts, selectedWarehouseId]);

  const filteredAuditRows = useMemo(() => {
    if (auditFilter === 'ALL') return auditRows;
    if (auditFilter === 'UNCNT') return auditRows.filter(r => r.physicalQty === undefined);
    return auditRows.filter(r => r.physicalQty !== undefined && (r.diffQty || 0) !== 0);
  }, [auditRows, auditFilter]);

  const lastClosed = useMemo(() => {
    const closed = snapshots.filter(s => s.status === 'CLOSED');
    if (closed.length === 0) return null;
    return closed.sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime())[0];
  }, [snapshots]);

  const handleApplyAudit = async () => {
    if (!selectedWarehouseId) return;
    setIsApplying(true);
    setStatusMessage(null);

    try {
      const sessionId = `AUD-${Date.now()}`;
      const now = new Date().toISOString();
      const logs: InventoryAuditLog[] = [];

      for (const row of auditRows) {
        if (row.physicalQty === undefined) continue;
        const diff = row.diffQty || 0;
        const log: InventoryAuditLog = {
          id: `AUDLOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          sessionId,
          warehouseId: selectedWarehouseId,
          productId: row.productId,
          productName: row.productName,
          category: row.category,
          systemQty: row.systemQty,
          countedQty: row.physicalQty,
          diffQty: diff,
          action: 'COUNT',
          createdAt: now,
          createdBy: currentUser?.id,
          createdByName: currentUser?.name
        };
        logs.push(log);

        if (diff !== 0) {
          const concept = diff > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA';
          await db.recordInventoryMovement(
            selectedWarehouseId,
            row.productId,
            concept,
            `AUDIT-${sessionId}`,
            diff,
            avgCostByProduct.get(row.productId) || 0,
            currentUser?.id || 'LOCAL'
          );
        }
      }

      const storedLogs = await db.get('inventoryAuditLogs') as InventoryAuditLog[] || [];
      await db.save('inventoryAuditLogs' as any, [...storedLogs, ...logs]);
      setAuditLogs(prev => [...prev, ...logs]);

      setAuditCounts({});
      setStatusMessage('Ajustes aplicados y kardex actualizado.');
    } catch (error: any) {
      setStatusMessage(error.message || 'Error aplicando auditoría.');
    } finally {
      setIsApplying(false);
    }
  };

  const handleCloseInventory = async () => {
    if (!selectedWarehouseId) return;
    setIsClosing(true);
    setStatusMessage(null);

    try {
      const now = new Date().toISOString();
      const label = `Cierre - ${new Date().toLocaleDateString()}`;

      const items: InventorySnapshotItem[] = filteredProducts.map(p => {
        const qty = p.stockBalances?.[selectedWarehouseId] ?? p.stock ?? 0;
        const avgCost = avgCostByProduct.get(p.id) || 0;
        const value = qty * avgCost;
        return {
          productId: p.id,
          productName: p.name,
          category: p.category,
          warehouseId: selectedWarehouseId,
          qty,
          avgCost,
          value
        };
      });

      const snapshot: InventorySnapshot = {
        id: `SNAP-${Date.now()}`,
        label,
        warehouseId: selectedWarehouseId,
        categoryId: selectedCategory === 'ALL' ? undefined : selectedCategory,
        createdAt: now,
        closedAt: now,
        status: 'CLOSED',
        createdBy: currentUser?.id,
        createdByName: currentUser?.name,
        items,
        totalValue: items.reduce((sum, i) => sum + i.value, 0)
      };

      const stored = await db.get('inventorySnapshots') as InventorySnapshot[] || [];
      await db.save('inventorySnapshots' as any, [...stored, snapshot]);
      setSnapshots(prev => [...prev, snapshot]);

      const log: InventoryAuditLog = {
        id: `AUDLOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sessionId: snapshot.id,
        warehouseId: selectedWarehouseId,
        action: 'CLOSE',
        createdAt: now,
        createdBy: currentUser?.id,
        createdByName: currentUser?.name,
        reason: `Cierre contable ${label}`
      };
      const storedLogs = await db.get('inventoryAuditLogs') as InventoryAuditLog[] || [];
      await db.save('inventoryAuditLogs' as any, [...storedLogs, log]);
      setAuditLogs(prev => [...prev, log]);

      setStatusMessage('Cierre de inventario generado y bloqueos activados.');
    } catch (error: any) {
      setStatusMessage(error.message || 'Error creando cierre.');
    } finally {
      setIsClosing(false);
    }
  };

  const handleReopen = async () => {
    if (!isAdmin || !lastClosed) return;
    if (!reopenReason.trim()) {
      setStatusMessage('Indica un motivo para reabrir.');
      return;
    }

    const now = new Date().toISOString();
    const updated = snapshots.map(s => {
      if (s.id !== lastClosed.id) return s;
      return {
        ...s,
        status: 'REOPENED',
        reopenedAt: now,
        reopenedBy: currentUser?.id,
        reopenedByName: currentUser?.name,
        reopenReason
      };
    });

    await db.save('inventorySnapshots' as any, updated);
    setSnapshots(updated);

    const log: InventoryAuditLog = {
      id: `AUDLOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sessionId: lastClosed.id,
      warehouseId: lastClosed.warehouseId,
      action: 'REOPEN',
      createdAt: now,
      createdBy: currentUser?.id,
      createdByName: currentUser?.name,
      reason: reopenReason
    };
    const storedLogs = await db.get('inventoryAuditLogs') as InventoryAuditLog[] || [];
    await db.save('inventoryAuditLogs' as any, [...storedLogs, log]);
    setAuditLogs(prev => [...prev, log]);

    setShowReopen(false);
    setReopenReason('');
    setStatusMessage('Periodo reabierto. Se permite registrar movimientos.');
  };


  const exportSnapshot = (snapshot: InventorySnapshot) => {
    const headers = ['productId', 'productName', 'category', 'warehouseId', 'qty', 'avgCost', 'value'];
    const rows = snapshot.items.map(i => [i.productId, i.productName, i.category || '', i.warehouseId, i.qty, i.avgCost, i.value]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${snapshot.label.replace(/\s+/g, '_')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] gap-4 pb-4">
      {/* 1. Header & Controls - Fixed Height */}
      <div className="flex-none flex flex-col gap-4">
        {/* Selectors */}
        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col md:flex-row gap-4 items-center">
          <div className="flex-1 w-full">
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Almacén</label>
            <select
              value={selectedWarehouseId}
              onChange={(e) => setSelectedWarehouseId(e.target.value)}
              className="w-full p-2 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-700 outline-none text-sm"
            >
              <option value="">-- Seleccionar --</option>
              {warehouses.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 w-full">
            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Categoría</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full p-2 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-700 outline-none text-sm"
            >
              <option value="ALL">Todas</option>
              {Array.from(new Set(products.map(p => p.category).filter(Boolean)))
                .map(cat => <option key={cat} value={cat as string}>{cat}</option>)}
            </select>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-2 text-gray-500 mb-1">
              <Database size={14} />
              <span className="text-[10px] font-bold uppercase truncate">Valor Total</span>
            </div>
            <div className="text-lg font-black text-gray-900">${kpi.totalValue.toFixed(2)}</div>
          </div>
          <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-2 text-gray-500 mb-1">
              <CheckCircle2 size={14} />
              <span className="text-[10px] font-bold uppercase truncate">ERI (Exactitud)</span>
            </div>
            <div className="text-lg font-black text-emerald-600">{kpi.eri.toFixed(2)}%</div>
          </div>
          <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-2 text-gray-500 mb-1">
              <AlertTriangle size={14} />
              <span className="text-[10px] font-bold uppercase truncate">Discrepancia</span>
            </div>
            <div className="text-sm font-bold truncate">
              <span className="text-red-600">-${kpi.shortage.toFixed(2)}</span>
              <span className="text-gray-300 mx-1">|</span>
              <span className="text-blue-600">+${kpi.surplus.toFixed(2)}</span>
            </div>
          </div>
          <div className="bg-white p-3 rounded-2xl border border-gray-100 shadow-sm">
            <div className="flex items-center gap-2 text-gray-500 mb-1">
              <ClipboardList size={14} />
              <span className="text-[10px] font-bold uppercase truncate">En Limbo</span>
            </div>
            <div className="text-lg font-black text-gray-900">{kpi.limbo}</div>
          </div>
        </div>
      </div>

      {statusMessage && (
        <div className="flex-none bg-amber-50 border border-amber-200 text-amber-700 text-xs font-bold rounded-xl p-2 text-center animate-in fade-in slide-in-from-top-2">
          {statusMessage}
        </div>
      )}

      {/* 2. Audit Table Area - Flex Grow & Scrollable */}
      <div className="flex-1 min-h-0 bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col overflow-hidden">
        {/* Table Header Controls */}
        <div className="flex-none p-4 bg-white border-b border-gray-100 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
              <ClipboardList className="text-indigo-600" size={18} />
              Auditoría
            </h3>
            <p className="text-[10px] text-gray-400 font-bold uppercase hidden sm:block">Conteos físicos</p>
          </div>
          <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-100">
            <button
              onClick={() => setAuditFilter('ALL')}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-colors ${auditFilter === 'ALL' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
            >
              Todos
            </button>
            <button
              onClick={() => setAuditFilter('DIFF')}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-colors ${auditFilter === 'DIFF' ? 'bg-amber-100 text-amber-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
            >
              Diferencias
            </button>
            <button
              onClick={() => setAuditFilter('UNCNT')}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-lg transition-colors ${auditFilter === 'UNCNT' ? 'bg-blue-100 text-blue-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
            >
              Faltantes
            </button>
          </div>
        </div>

        {/* Scrollable Table Container */}
        <div className="flex-1 overflow-auto bg-gray-50/30">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-white shadow-sm z-10">
              <tr className="text-left text-[10px] text-gray-400 uppercase font-bold tracking-wider">
                <th className="py-3 px-4 bg-gray-50/50">Artículo</th>
                <th className="py-3 px-2 text-right bg-gray-50/50 w-24">Sistema</th>
                <th className="py-3 px-2 text-right bg-gray-50/50 w-32">Físico</th>
                <th className="py-3 px-2 text-right bg-gray-50/50 w-24">Dif</th>
                <th className="py-3 px-4 text-center bg-gray-50/50 w-24">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filteredAuditRows.map(row => {
                const status = row.physicalQty === undefined
                  ? 'PENDIENTE'
                  : (row.diffQty || 0) === 0 ? 'OK' : 'AJUSTE';
                return (
                  <tr key={row.productId} className="hover:bg-gray-50 transition-colors group">
                    <td className="py-3 px-4">
                      <div className="font-bold text-gray-800 text-xs sm:text-sm">{row.productName}</div>
                      <div className="text-[10px] text-gray-400">{row.category || 'Sin Categoría'}</div>
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-gray-600 text-xs">{row.systemQty}</td>
                    <td className="py-3 px-2 text-right">
                      <input
                        type="number"
                        value={auditCounts[row.productId] ?? ''}
                        onChange={(e) => setAuditCounts(prev => ({ ...prev, [row.productId]: e.target.value }))}
                        className="w-full p-1.5 bg-gray-50 border border-gray-200 rounded-lg text-right font-bold text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                        placeholder="-"
                      />
                    </td>
                    <td className={`py-3 px-2 text-right font-bold text-xs ${row.diffQty === undefined ? 'text-gray-300' : (row.diffQty || 0) < 0 ? 'text-red-600' : (row.diffQty || 0) > 0 ? 'text-blue-600' : 'text-emerald-600'}`}>
                      {row.diffQty === undefined ? '--' : row.diffQty > 0 ? `+${row.diffQty}` : row.diffQty}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${status === 'OK' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : status === 'AJUSTE' ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-gray-50 text-gray-400 border-gray-100'}`}>
                        {status === 'OK' && <CheckCircle2 size={10} className="mr-1" />}
                        {status === 'AJUSTE' && <AlertTriangle size={10} className="mr-1" />}
                        {status}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {filteredAuditRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-400 text-sm">
                    No hay artículos para mostrar con los filtros actuales.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer Actions */}
        <div className="flex-none p-3 border-t border-gray-100 bg-gray-50/50 flex justify-end">
          <button
            onClick={handleApplyAudit}
            disabled={isApplying || !selectedWarehouseId}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-bold text-xs shadow-sm shadow-emerald-200 hover:bg-emerald-700 disabled:opacity-50 disabled:shadow-none transition-all active:scale-95 flex items-center gap-2"
          >
            {isApplying ? (
              <>Applying...</>
            ) : (
              <>
                <CheckCircle2 size={14} /> Aplicar Ajustes
              </>
            )}
          </button>
        </div>
      </div>

      {/* 3. Bottom Actions Panel - Fixed Height */}
      <div className="flex-none grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Close Inventory Card */}
        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${lastClosed?.status === 'CLOSED' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-400'}`}>
              <Lock size={20} />
            </div>
            <div>
              <h3 className="text-sm font-black text-gray-900">Cierre de Periodo</h3>
              {lastClosed ? (
                <p className="text-[10px] text-gray-500 font-bold">
                  Último: {new Date(lastClosed.closedAt).toLocaleDateString()}
                </p>
              ) : (
                <p className="text-[10px] text-gray-400">Sin cierres previos</p>
              )}
            </div>
          </div>
          <button
            onClick={handleCloseInventory}
            disabled={!selectedWarehouseId || isClosing}
            className="px-4 py-2 bg-gray-900 text-white rounded-xl font-bold text-xs shadow-lg shadow-gray-200 hover:bg-black disabled:opacity-50 transition-all flex items-center gap-2"
          >
            {isClosing ? '...' : 'Ejecutar Cierre'}
          </button>
        </div>

        {/* Historical Reports Card / Reopen */}
        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-center">
          {isAdmin && lastClosed && lastClosed.status === 'CLOSED' ? (
            !showReopen ? (
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-500 uppercase">Administración</span>
                <button
                  onClick={() => setShowReopen(true)}
                  className="px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-100 rounded-lg font-bold text-[10px] hover:bg-amber-100 transition-colors"
                >
                  Reabrir Periodo
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  placeholder="Motivo..."
                  className="flex-1 p-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs"
                  autoFocus
                />
                <button onClick={handleReopen} className="p-1.5 bg-red-600 text-white rounded-lg"><CheckCircle2 size={14} /></button>
                <button onClick={() => setShowReopen(false)} className="p-1.5 bg-gray-200 text-gray-600 rounded-lg"><AlertTriangle size={14} /></button>
              </div>
            )
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-400 uppercase">Historial</span>
              <span className="text-xs font-bold text-gray-800">{snapshots.length} Cierres</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default InventoryAuditClosure;
