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
    <div className="flex flex-col gap-6">
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex flex-col md:flex-row gap-4 items-center">
        <div className="flex-1">
          <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Almacén</label>
          <select
            value={selectedWarehouseId}
            onChange={(e) => setSelectedWarehouseId(e.target.value)}
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-700 outline-none"
          >
            <option value="">-- Seleccionar --</option>
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Categoría</label>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-700 outline-none"
          >
            <option value="ALL">Todas</option>
            {Array.from(new Set(products.map(p => p.category).filter(Boolean)))
              .map(cat => <option key={cat} value={cat as string}>{cat}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 text-gray-500">
            <Database size={18} />
            <span className="text-xs font-bold uppercase">Valor Total Inventario</span>
          </div>
          <div className="text-2xl font-black text-gray-900 mt-2">${kpi.totalValue.toFixed(2)}</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 text-gray-500">
            <CheckCircle2 size={18} />
            <span className="text-xs font-bold uppercase">ERI (Exactitud)</span>
          </div>
          <div className="text-2xl font-black text-emerald-600 mt-2">{kpi.eri.toFixed(2)}%</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 text-gray-500">
            <AlertTriangle size={18} />
            <span className="text-xs font-bold uppercase">Discrepancia Monetaria</span>
          </div>
          <div className="mt-2 text-sm font-bold">
            <span className="text-red-600">- ${kpi.shortage.toFixed(2)}</span>
            <span className="text-gray-300 mx-2">|</span>
            <span className="text-blue-600">+ ${kpi.surplus.toFixed(2)}</span>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3 text-gray-500">
            <ClipboardList size={18} />
            <span className="text-xs font-bold uppercase">Artículos en Limbo</span>
          </div>
          <div className="text-2xl font-black text-gray-900 mt-2">{kpi.limbo}</div>
        </div>
      </div>

      {statusMessage && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm font-bold rounded-xl p-3">
          {statusMessage}
        </div>
      )}

      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-black text-gray-900">Auditoría de Inventario</h3>
            <p className="text-xs text-gray-400 font-bold uppercase">Conteos físicos y ajustes automáticos</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAuditFilter('ALL')}
              className={`px-3 py-2 text-xs font-bold rounded-xl border ${auditFilter === 'ALL' ? 'bg-gray-900 text-white border-gray-900' : 'bg-gray-50 text-gray-500 border-gray-200'}`}
            >
              Todos
            </button>
            <button
              onClick={() => setAuditFilter('DIFF')}
              className={`px-3 py-2 text-xs font-bold rounded-xl border ${auditFilter === 'DIFF' ? 'bg-amber-500 text-white border-amber-500' : 'bg-gray-50 text-gray-500 border-gray-200'}`}
            >
              Solo con diferencias
            </button>
            <button
              onClick={() => setAuditFilter('UNCNT')}
              className={`px-3 py-2 text-xs font-bold rounded-xl border ${auditFilter === 'UNCNT' ? 'bg-blue-500 text-white border-blue-500' : 'bg-gray-50 text-gray-500 border-gray-200'}`}
            >
              No contados
            </button>
          </div>
        </div>

        <div className="overflow-auto max-h-[480px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-xs text-gray-400 uppercase">
                <th className="py-2">Artículo</th>
                <th className="py-2 text-right">Stock Sistema</th>
                <th className="py-2 text-right">Stock Físico</th>
                <th className="py-2 text-right">Diferencia</th>
                <th className="py-2 text-center">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filteredAuditRows.map(row => {
                const status = row.physicalQty === undefined
                  ? 'NO CONTADO'
                  : (row.diffQty || 0) === 0 ? 'OK' : 'AJUSTE';
                return (
                  <tr key={row.productId} className="border-b border-gray-100">
                    <td className="py-2 font-bold text-gray-800">{row.productName}</td>
                    <td className="py-2 text-right font-mono text-gray-600">{row.systemQty}</td>
                    <td className="py-2 text-right">
                      <input
                        type="number"
                        value={auditCounts[row.productId] ?? ''}
                        onChange={(e) => setAuditCounts(prev => ({ ...prev, [row.productId]: e.target.value }))}
                        className="w-28 p-2 bg-gray-50 border border-gray-200 rounded-xl text-right font-bold"
                      />
                    </td>
                    <td className={`py-2 text-right font-bold ${row.diffQty === undefined ? 'text-gray-300' : (row.diffQty || 0) < 0 ? 'text-red-600' : 'text-blue-600'}`}>
                      {row.diffQty === undefined ? '--' : row.diffQty}
                    </td>
                    <td className="py-2 text-center">
                      <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${status === 'OK' ? 'bg-emerald-100 text-emerald-700' : status === 'AJUSTE' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                        {status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end mt-4">
          <button
            onClick={handleApplyAudit}
            disabled={isApplying || !selectedWarehouseId}
            className="px-5 py-3 bg-emerald-600 text-white rounded-xl font-bold shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {isApplying ? 'Aplicando...' : 'Aplicar Ajustes de Auditoría'}
          </button>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-black text-gray-900">Cierre de Inventario</h3>
            <p className="text-xs text-gray-400 font-bold uppercase">Snapshot contable y bloqueo de movimientos</p>
          </div>
          <button
            onClick={handleCloseInventory}
            disabled={!selectedWarehouseId || isClosing}
            className="px-5 py-3 bg-gray-900 text-white rounded-xl font-bold shadow-sm hover:bg-black disabled:opacity-50 flex items-center gap-2"
          >
            <Lock size={16} /> {isClosing ? 'Cerrando...' : 'Ejecutar Cierre'}
          </button>
        </div>

        {lastClosed && (
          <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-gray-200">
            <p className="text-xs font-bold text-gray-500 uppercase">Último Cierre</p>
            <p className="text-sm font-bold text-gray-800">{lastClosed.label} — {new Date(lastClosed.closedAt).toLocaleString()}</p>
            <p className="text-xs text-gray-400">Bloqueo activo hasta esa fecha</p>
          </div>
        )}

        {isAdmin && lastClosed && lastClosed.status === 'CLOSED' && (
          <div className="mt-4">
            {!showReopen ? (
              <button
                onClick={() => setShowReopen(true)}
                className="px-4 py-2 bg-amber-500 text-white rounded-xl font-bold shadow-sm hover:bg-amber-600"
              >
                Reabrir Periodo
              </button>
            ) : (
              <div className="flex flex-col md:flex-row gap-3">
                <input
                  value={reopenReason}
                  onChange={(e) => setReopenReason(e.target.value)}
                  placeholder="Motivo de reapertura"
                  className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold"
                />
                <button
                  onClick={handleReopen}
                  className="px-4 py-2 bg-red-600 text-white rounded-xl font-bold shadow-sm hover:bg-red-700"
                >
                  Confirmar Reapertura
                </button>
                <button
                  onClick={() => { setShowReopen(false); setReopenReason(''); }}
                  className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl font-bold"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <FileText size={18} className="text-gray-500" />
          <h3 className="text-lg font-black text-gray-900">Reportes Históricos</h3>
        </div>

        <div className="space-y-3">
          {snapshots.length === 0 && (
            <div className="text-sm text-gray-400">No hay cierres registrados.</div>
          )}
          {snapshots
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map(s => (
              <div key={s.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
                <div>
                  <p className="text-sm font-bold text-gray-800">{s.label}</p>
                  <p className="text-xs text-gray-400">{new Date(s.closedAt).toLocaleString()} — ${s.totalValue.toFixed(2)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => exportSnapshot(s)}
                    className="px-3 py-2 bg-blue-600 text-white rounded-xl font-bold text-xs"
                  >
                    Exportar CSV
                  </button>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default InventoryAuditClosure;
