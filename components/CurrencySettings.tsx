import React, { useState, useEffect } from 'react';
import {
  ArrowRightLeft, Globe, RefreshCw, Calculator,
  Check, X, TrendingUp, DollarSign, ArrowRight, Save,
  Crown, Plus, Search
} from 'lucide-react';
import { CurrencyConfig, BusinessConfig, CurrencyRateSchedule, User } from '../types';
import { apiSyncAdapter } from '../services/sync/ApiSyncAdapter';
import { syncPolicy } from '../services/sync/SyncProfile';
import {
  getLocalCurrencyAudit,
  getLocalCurrencySchedules,
  recordCurrencyChanges,
  scheduleLocalCurrencyRate,
} from '../services/currency/CurrencyService';

interface CurrencySettingsProps {
  config?: BusinessConfig;
  onUpdateConfig?: (newConfig: BusinessConfig) => void;
  currentUser?: User | null;
  terminalId?: string;
  onClose: () => void;
}

const FLAGS: Record<string, string> = {
  'USD': '🇺🇸',
  'EUR': '🇪🇺',
  'MXN': '🇲🇽',
  'COP': '🇨🇴',
  'DOP': '🇩🇴',
  'GBP': '🇬🇧',
  'BTC': '₿',
  'CAD': '🇨🇦',
  'BRL': '🇧🇷'
};

const COMMON_CURRENCIES = [
  { code: 'USD', name: 'Dólar Estadounidense', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'MXN', name: 'Peso Mexicano', symbol: '$' },
  { code: 'COP', name: 'Peso Colombiano', symbol: '$' },
  { code: 'GBP', name: 'Libra Esterlina', symbol: '£' },
  { code: 'CAD', name: 'Dólar Canadiense', symbol: '$' },
  { code: 'BRL', name: 'Real Brasileño', symbol: 'R$' },
];

const CurrencySettings: React.FC<CurrencySettingsProps> = ({ config, onUpdateConfig, currentUser, terminalId, onClose }) => {
  const initialCurrencies = Array.isArray(config?.currencies) ? config.currencies : [];

  const [currencies, setCurrencies] = useState<CurrencyConfig[]>(initialCurrencies);
  const [selectedCode, setSelectedCode] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [testAmount, setTestAmount] = useState<string>('100');
  const [showAuditHistory, setShowAuditHistory] = useState(false);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [scheduledRate, setScheduledRate] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [schedules, setSchedules] = useState<CurrencyRateSchedule[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const baseCurrency = currencies.find(c => c.isBase) || currencies[0] || {
    code: '',
    name: 'Sin moneda configurada',
    symbol: '',
    rate: 1,
    isEnabled: false,
    isBase: true,
  };

  useEffect(() => {
    if (!selectedCode || !currencies.find(c => c.code === selectedCode)) {
      setSelectedCode(baseCurrency.code);
    }
  }, [currencies, selectedCode, baseCurrency]);

  useEffect(() => {
    void getLocalCurrencySchedules().then(setSchedules).catch(console.error);
  }, []);

  const activeCurrency = currencies.find(c => c.code === selectedCode) || baseCurrency;

  const handleRateChange = (val: string) => {
    const newRate = parseFloat(val);
    if (isNaN(newRate) || newRate < 0) return;
    setCurrencies(prev => prev.map(c => c.code === activeCurrency.code ? { ...c, rate: newRate } : c));
  };

  const handleSetAsBase = async (targetCode: string) => {
    if (!await clicConfirm(`¿Cambiar moneda base a ${targetCode}? Esto reseteará su tasa a 1.00.`)) return;
    setCurrencies(prev => prev.map(c => {
      if (c.code === targetCode) return { ...c, isBase: true, rate: 1, isEnabled: true };
      if (c.isBase) return { ...c, isBase: false };
      return c;
    }));
    setSelectedCode(targetCode);
  };

  const handleAddCurrency = (curr: typeof COMMON_CURRENCIES[0]) => {
    if (currencies.find(c => c.code === curr.code)) {
      alert("Esta moneda ya está configurada.");
      return;
    }
    const newConfig: CurrencyConfig = {
      code: curr.code,
      name: curr.name,
      symbol: curr.symbol,
      rate: 0,
      isEnabled: true,
      isBase: false
    };
    setCurrencies([...currencies, newConfig]);
    setSelectedCode(curr.code);
    setShowAddModal(false);
  };

  const handleFetchRate = async () => {
    setIsSyncing(true);
    try {
      const response = await fetch(
        `/api/currencies/fetch-rate/${activeCurrency.code}?baseCurrency=${baseCurrency.code}`
      );
      const data = await response.json();

      if (data.success) {
        const spread = activeCurrency.autoSync?.spread || 0;
        const finalRate = data.marketRate + spread;

        setCurrencies(prev => prev.map(c =>
          c.code === activeCurrency.code
            ? {
              ...c,
              rate: finalRate,
              buyRate: c.useDualRates ? finalRate : undefined,
              autoSync: c.autoSync ? { ...c.autoSync, lastSync: new Date().toISOString() } : undefined
            }
            : c
        ));
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error: any) {
      alert(`Error al obtener tasa: ${error.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleToggleDualRates = (enabled: boolean) => {
    setCurrencies(prev => prev.map(c =>
      c.code === activeCurrency.code
        ? {
          ...c,
          useDualRates: enabled,
          buyRate: enabled ? c.rate : undefined,
          sellRate: enabled ? c.rate : undefined
        }
        : c
    ));
  };

  const handleBuyRateChange = (val: string) => {
    const newRate = parseFloat(val);
    if (isNaN(newRate) || newRate < 0) return;
    setCurrencies(prev => prev.map(c =>
      c.code === activeCurrency.code ? { ...c, buyRate: newRate, rate: newRate } : c
    ));
  };

  const handleSellRateChange = (val: string) => {
    const newRate = parseFloat(val);
    if (isNaN(newRate) || newRate < 0) return;
    setCurrencies(prev => prev.map(c =>
      c.code === activeCurrency.code ? { ...c, sellRate: newRate } : c
    ));
  };

  const handleToggleAutoSync = (enabled: boolean) => {
    setCurrencies(prev => prev.map(c =>
      c.code === activeCurrency.code
        ? {
          ...c,
          autoSync: enabled
            ? {
              enabled: true,
              spread: 0,
              scheduleTime: '08:00',
              source: 'exchangerate-api.com'
            }
            : undefined
        }
        : c
    ));
  };

  const handleSpreadChange = (spread: number) => {
    setCurrencies(prev => prev.map(c =>
      c.code === activeCurrency.code && c.autoSync
        ? { ...c, autoSync: { ...c.autoSync, spread } }
        : c
    ));
  };

  const handleScheduleTimeChange = (time: string) => {
    setCurrencies(prev => prev.map(c =>
      c.code === activeCurrency.code && c.autoSync
        ? { ...c, autoSync: { ...c.autoSync, scheduleTime: time } }
        : c
    ));
  };

  const handleToggleForceBaseChange = (enabled: boolean) => {
    setCurrencies(prev => prev.map(c =>
      c.code === activeCurrency.code
        ? {
          ...c,
          changePolicy: {
            ...c.changePolicy,
            forceBaseChange: enabled,
            roundingRule: c.changePolicy?.roundingRule || 'NONE'
          } as any
        }
        : c
    ));
  };

  const handleRoundingRuleChange = (rule: 'NONE' | 'NEAREST' | 'TO_99') => {
    setCurrencies(prev => prev.map(c =>
      c.code === activeCurrency.code
        ? {
          ...c,
          changePolicy: {
            ...c.changePolicy,
            roundingRule: rule,
            forceBaseChange: c.changePolicy?.forceBaseChange || false
          } as any
        }
        : c
    ));
  };

  const handleToggleShowOnTicket = (show: boolean) => {
    setCurrencies(prev => prev.map(c =>
      c.code === activeCurrency.code
        ? { ...c, showExchangeRateOnTicket: show }
        : c
    ));
  };

  const handleLoadAuditHistory = async () => {
    setLoadingAudit(true);
    setShowAuditHistory(true);
    try {
      const data = syncPolicy.targetKind() === 'ERP_ACTIVE'
        ? await apiSyncAdapter.getCurrencyAudit(activeCurrency.code)
        : await getLocalCurrencyAudit(activeCurrency.code);
      setAuditLogs(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error loading audit history:', error);
      setAuditLogs([]);
    } finally {
      setLoadingAudit(false);
    }
  };

  const actor = currentUser || { id: 'system', name: 'Sistema', pin: '', role: 'system' };

  const handleScheduleRate = async () => {
    const rate = Number(scheduledRate);
    const executeAt = new Date(scheduledAt);
    if (!activeCurrency.code || activeCurrency.isBase || !Number.isFinite(rate) || rate <= 0) {
      alert('Seleccione una moneda secundaria e indique una tasa mayor que cero.');
      return;
    }
    if (!scheduledAt || Number.isNaN(executeAt.getTime()) || executeAt.getTime() <= Date.now()) {
      alert('La fecha y hora programadas deben estar en el futuro.');
      return;
    }
    try {
      const payload = {
        id: `currency-schedule-${activeCurrency.code}-${Date.now()}`,
        currencyCode: activeCurrency.code,
        rate,
        executeAt: executeAt.toISOString(),
        createdBy: actor.id,
        createdByName: actor.name,
        terminalId,
      };
      if (syncPolicy.targetKind() === 'ERP_ACTIVE') {
        await apiSyncAdapter.scheduleCurrencyRate(payload);
      } else {
        await scheduleLocalCurrencyRate(payload);
        setSchedules(await getLocalCurrencySchedules());
      }
      setScheduledRate('');
      setScheduledAt('');
      alert('Cambio de tasa programado correctamente.');
    } catch (error: any) {
      alert(`No se pudo programar la tasa: ${error?.message || 'error desconocido'}`);
    }
  };

  const handleSave = async () => {
    if (config && onUpdateConfig) {
      if (currencies.length === 0) {
        alert("No hay monedas configuradas. En POS+ERP las monedas deben venir desde ERP.");
        return;
      }
      setIsSaving(true);
      try {
        const now = new Date().toISOString();
        const stampedCurrencies = currencies.map(currency => ({
          ...currency,
          lastModified: now,
          lastModifiedBy: actor.name,
        }));
        if (syncPolicy.targetKind() === 'ERP_ACTIVE') {
          await apiSyncAdapter.saveCurrencies(stampedCurrencies, {
            userId: actor.id,
            userName: actor.name,
            terminalId,
          });
        }
        await recordCurrencyChanges(initialCurrencies, stampedCurrencies, actor, terminalId, syncPolicy.targetKind() === 'ERP_ACTIVE' ? 'ERP' : 'MANUAL');
        await Promise.resolve(onUpdateConfig({ ...config, currencies: stampedCurrencies, currencySymbol: baseCurrency.symbol }));
        alert("Configuración guardada y auditada.");
        onClose();
      } catch (error: any) {
        alert(`No se pudo guardar la configuración: ${error?.message || 'error desconocido'}`);
      } finally {
        setIsSaving(false);
      }
    }
  };

  // Calculadora mejorada con redondeo
  const calculateConversion = (amount: number, currency: CurrencyConfig): number => {
    const rateToUse = currency.useDualRates ? (currency.buyRate ?? currency.rate) : currency.rate;
    let result = amount * rateToUse;

    const roundingRule = currency.changePolicy?.roundingRule || 'NONE';
    switch (roundingRule) {
      case 'NEAREST':
        result = Math.round(result);
        break;
      case 'TO_99':
        result = Math.floor(result) + 0.99;
        break;
      case 'NONE':
      default:
        break;
    }

    return result;
  };

  const calcResult = calculateConversion(parseFloat(testAmount) || 0, activeCurrency);

  return (
    <div className="flex flex-col h-full bg-gray-50 animate-in fade-in slide-in-from-right-10 duration-300">
      <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
            <ArrowRightLeft className="text-emerald-600" /> Control de Cambio
          </h1>
          <p className="text-sm text-gray-500">Gestión de tasas, divisas aceptadas y conversión.</p>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400"><X size={24} /></button>
      </div>

      <div className="flex-1 overflow-hidden p-8">
        <div className="max-w-6xl mx-auto h-full flex flex-col lg:flex-row gap-8">
          <div className="w-full lg:w-1/3 flex flex-col gap-4 overflow-hidden">
            <div className="bg-slate-900 text-white p-6 rounded-3xl shadow-lg relative overflow-hidden shrink-0">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-10 -mt-10 blur-2xl"></div>
              <div className="relative z-10">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1"><Crown size={14} className="text-yellow-500" /> Moneda Base</p>
                <div className="flex items-center gap-4">
                  <div className="text-5xl">{FLAGS[baseCurrency.code] || '🏳️'}</div>
                  <div><h2 className="text-3xl font-black">{baseCurrency.code}</h2><p className="text-slate-400 font-medium">{baseCurrency.name}</p></div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between mt-2 px-2 shrink-0">
              <h3 className="text-sm font-bold text-gray-500 uppercase">Divisas Aceptadas</h3>
              <button
                onClick={handleLoadAuditHistory}
                className="text-xs font-bold text-emerald-600 hover:underline flex items-center gap-1"
              >
                <TrendingUp size={14} /> Histórico
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-2 no-scrollbar">
              {currencies.filter(c => c.isEnabled !== false).map(currency => (
                <div key={currency.code} onClick={() => setSelectedCode(currency.code)} className={`group p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-center justify-between ${selectedCode === currency.code ? 'bg-white border-emerald-500 shadow-md ring-4 ring-emerald-50' : 'bg-white border-transparent hover:border-gray-200'}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{FLAGS[currency.code] || '🏳️'}</span>
                    <div>
                      <p className="font-bold text-gray-800">{currency.code}</p>
                      <p className="text-xs text-gray-400">{currency.name}</p>
                      {currency.isBase && <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-amber-500">Moneda base</p>}
                    </div>
                  </div>
                  <div className="text-right"><p className={`font-mono font-bold ${selectedCode === currency.code ? 'text-emerald-600' : 'text-gray-600'}`}>{currency.rate.toFixed(2)}</p></div>
                </div>
              ))}
              <button onClick={() => setShowAddModal(true)} className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-400 font-bold hover:border-emerald-400 hover:text-emerald-600 transition-colors">
                + Agregar Nueva Moneda
              </button>
            </div>
          </div>

          <div className="flex-1 bg-white rounded-3xl shadow-xl border border-gray-200 flex flex-col overflow-hidden relative">
            <div className="p-8 flex-1 overflow-y-auto no-scrollbar">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <span className="text-6xl">{FLAGS[activeCurrency.code] || '🏳️'}</span>
                  <div><h2 className="text-4xl font-black text-gray-900">{activeCurrency.code}</h2><p className="text-gray-500 font-medium">{activeCurrency.name}</p></div>
                </div>
                <button onClick={handleFetchRate} disabled={isSyncing || activeCurrency.isBase} className="bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 transition-colors disabled:opacity-50">
                  <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />{isSyncing ? 'Sincronizando...' : 'Actualizar de Internet'}
                </button>
              </div>

              <div className="mb-8">
                <label className="block text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Tasa del Día</label>
                <div className="flex items-end gap-4">
                  <div className="flex-1 relative">
                    <span className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-300 text-4xl font-light">1 =</span>
                    <input type="number" value={activeCurrency.rate} onChange={(e) => handleRateChange(e.target.value)} disabled={activeCurrency.isBase} className="w-full bg-gray-50 border-2 border-gray-200 rounded-3xl py-6 pl-24 pr-8 text-5xl font-black text-slate-800 outline-none focus:border-emerald-500 focus:bg-white transition-all text-right disabled:opacity-50" />
                  </div>
                  <div className="pb-6"><span className="text-2xl font-bold text-gray-400">{baseCurrency.code}</span></div>
                </div>
              </div>

              {/* DUAL RATES SECTION */}
              {!activeCurrency.isBase && (
                <div className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <label className="text-sm font-bold text-gray-400 uppercase tracking-widest">
                      Configuración de Tasas
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={activeCurrency.useDualRates || false}
                        onChange={(e) => handleToggleDualRates(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                      <span className="text-xs font-bold text-gray-500">
                        Activar Tasas Duales (Compra/Venta)
                      </span>
                    </label>
                  </div>

                  {activeCurrency.useDualRates ? (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-emerald-600 mb-2 uppercase">
                          Tasa de Recepción (Compra)
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 text-sm">1 =</span>
                          <input
                            type="number"
                            value={activeCurrency.buyRate ?? activeCurrency.rate}
                            onChange={(e) => handleBuyRateChange(e.target.value)}
                            className="flex-1 bg-emerald-50 border-2 border-emerald-200 rounded-xl py-3 px-4 text-2xl font-bold text-emerald-900 outline-none focus:border-emerald-500"
                          />
                          <span className="text-gray-400 font-bold text-sm">{baseCurrency.code}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          Aplicada cuando el cliente paga en POS
                        </p>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-blue-600 mb-2 uppercase">
                          Tasa de Valoración (Venta)
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 text-sm">1 =</span>
                          <input
                            type="number"
                            value={activeCurrency.sellRate ?? activeCurrency.rate}
                            onChange={(e) => handleSellRateChange(e.target.value)}
                            className="flex-1 bg-blue-50 border-2 border-blue-200 rounded-xl py-3 px-4 text-2xl font-bold text-blue-900 outline-none focus:border-blue-500"
                          />
                          <span className="text-gray-400 font-bold text-sm">{baseCurrency.code}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          Para reportes de inventario y costos
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                      <p className="text-sm text-gray-500">
                        Modo de tasa unificada activo. Activa tasas duales para configurar diferentes valores para compra y venta.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* AUTO-SYNC SECTION */}
              {!activeCurrency.isBase && (
                <div className="mb-8 bg-slate-50 rounded-2xl p-6 border border-slate-200">
                  <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <RefreshCw size={18} className="text-slate-600" />
                    Actualización Automática
                  </h4>

                  <div className="space-y-4">
                    <label className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-200 cursor-pointer">
                      <span className="font-bold text-sm text-slate-700">
                        Sincronización Automática
                      </span>
                      <input
                        type="checkbox"
                        checked={activeCurrency.autoSync?.enabled || false}
                        onChange={(e) => handleToggleAutoSync(e.target.checked)}
                        className="w-5 h-5"
                      />
                    </label>

                    {activeCurrency.autoSync?.enabled && (
                      <>
                        <div>
                          <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">
                            Spread / Margen de Ajuste
                          </label>
                          <div className="flex items-center gap-2 bg-white rounded-xl border-2 border-slate-200 p-3">
                            <span className="text-slate-400 text-sm">Tasa de mercado</span>
                            <Plus size={16} className="text-slate-400" />
                            <input
                              type="number"
                              step="0.01"
                              value={activeCurrency.autoSync.spread || 0}
                              onChange={(e) => handleSpreadChange(parseFloat(e.target.value) || 0)}
                              className="flex-1 font-bold text-lg outline-none text-right"
                            />
                            <span className="text-slate-600 font-bold">{baseCurrency.code}</span>
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">
                            Hora de Actualización Automática
                          </label>
                          <input
                            type="time"
                            value={activeCurrency.autoSync.scheduleTime || "08:00"}
                            onChange={(e) => handleScheduleTimeChange(e.target.value)}
                            className="w-full bg-white border-2 border-slate-200 rounded-xl p-3 font-bold text-lg"
                          />
                          <p className="text-xs text-slate-400 mt-1">
                            Hora preferida para proveedores de tasa configurados por ERP.
                          </p>
                        </div>

                        {activeCurrency.autoSync.lastSync && (
                          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                            <p className="text-xs text-emerald-700">
                              <Check size={12} className="inline mr-1" />
                              Última sincronización:{" "}
                              <span className="font-bold">
                                {new Date(activeCurrency.autoSync.lastSync).toLocaleString('es-DO')}
                              </span>
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {!activeCurrency.isBase && (
                <div className="mb-8 bg-indigo-50 rounded-2xl p-6 border border-indigo-200">
                  <h4 className="font-bold text-indigo-900 mb-4 flex items-center gap-2">
                    <Calculator size={18} /> Programar cambio puntual
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <input type="number" min="0" step="0.0001" value={scheduledRate} onChange={event => setScheduledRate(event.target.value)} placeholder="Nueva tasa" className="p-3 rounded-xl border border-indigo-200 bg-white font-bold" />
                    <input type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} className="p-3 rounded-xl border border-indigo-200 bg-white font-bold" />
                    <button onClick={handleScheduleRate} className="p-3 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700">Programar</button>
                  </div>
                  {schedules.filter(schedule => schedule.currencyCode === activeCurrency.code && schedule.status === 'PENDING').map(schedule => (
                    <p key={schedule.id} className="mt-3 text-xs text-indigo-700">
                      Pendiente: {schedule.rate.toFixed(4)} el {new Date(schedule.executeAt).toLocaleString('es-DO')}
                    </p>
                  ))}
                </div>
              )}

              {/* CHANGE POLICIES SECTION */}
              {!activeCurrency.isBase && (
                <div className="mb-8 bg-amber-50 rounded-2xl p-6 border border-amber-200">
                  <h4 className="font-bold text-amber-900 mb-4 flex items-center gap-2">
                    <DollarSign size={18} />
                    Políticas de Vuelto y Redondeo
                  </h4>

                  <div className="space-y-4">
                    <label className="flex items-center justify-between p-3 bg-white rounded-xl border border-amber-200 cursor-pointer">
                      <div>
                        <p className="font-bold text-sm text-amber-900">
                          Forzar Vuelto en {baseCurrency.code}
                        </p>
                        <p className="text-xs text-amber-700">
                          El POS siempre sugerirá el cambio en moneda base
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={activeCurrency.changePolicy?.forceBaseChange || false}
                        onChange={(e) => handleToggleForceBaseChange(e.target.checked)}
                        className="w-5 h-5"
                      />
                    </label>

                    <div>
                      <label className="block text-xs font-bold text-amber-700 mb-2 uppercase">
                        Regla de Redondeo
                      </label>
                      <select
                        value={activeCurrency.changePolicy?.roundingRule || 'NONE'}
                        onChange={(e) => handleRoundingRuleChange(e.target.value as any)}
                        className="w-full bg-white border-2 border-amber-200 rounded-xl p-3 font-bold text-sm"
                      >
                        <option value="NONE">Sin Redondeo (Exacto)</option>
                        <option value="NEAREST">Redondear al Entero Más Cercano</option>
                        <option value="TO_99">Redondear a .99 (Ej: 59.99)</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* TICKET VISIBILITY SECTION */}
              {!activeCurrency.isBase && (
                <div className="mb-8 p-4 bg-indigo-50 rounded-2xl border border-indigo-200 flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-indigo-900 text-sm flex items-center gap-2">
                      <ArrowRight size={16} />
                      Visibilidad en Factura
                    </h4>
                    <p className="text-xs text-indigo-700">
                      Mostrar la tasa de cambio en el ticket impreso
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={activeCurrency.showExchangeRateOnTicket || false}
                    onChange={(e) => handleToggleShowOnTicket(e.target.checked)}
                    className="w-5 h-5"
                  />
                </div>
              )}

              {!activeCurrency.isBase && (
                <div className="mb-8 p-4 bg-yellow-50 border border-yellow-200 rounded-2xl flex items-center justify-between">
                  <div><h4 className="font-bold text-yellow-800 text-sm flex items-center gap-2"><Crown size={16} /> Moneda Principal</h4><p className="text-xs text-yellow-700">Cambiar la base afectará toda la facturación.</p></div>
                  <button onClick={() => handleSetAsBase(activeCurrency.code)} className="bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm">Establecer Base</button>
                </div>
              )}

              <div className="bg-emerald-50 rounded-3xl p-6 border border-emerald-100 mb-4">
                <div className="flex items-center gap-2 mb-4 text-emerald-800"><Calculator size={20} /><span className="font-bold text-sm uppercase">Calculadora</span></div>
                <div className="flex items-center gap-4">
                  <div className="flex-1 bg-white p-3 rounded-xl border border-emerald-200 flex items-center">
                    <span className="text-gray-400 font-bold mr-2">{activeCurrency.symbol}</span>
                    <input type="number" value={testAmount} onChange={(e) => setTestAmount(e.target.value)} className="w-full font-bold text-xl text-gray-800 outline-none" />
                  </div>
                  <ArrowRight size={24} className="text-emerald-400" />
                  <div className="flex-1 bg-emerald-100 p-3 rounded-xl border border-emerald-300 flex items-center justify-between">
                    <span className="text-emerald-700 font-bold mr-2">{baseCurrency.symbol}</span>
                    <span className="font-black text-xl text-emerald-900">{calcResult.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-200 flex justify-end gap-4 shrink-0">
              <button onClick={onClose} className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-200 rounded-xl transition-colors">Cancelar</button>
              <button onClick={handleSave} disabled={isSaving} className="px-8 py-3 bg-emerald-600 text-white font-bold rounded-xl shadow-lg hover:bg-emerald-700 transition-all flex items-center gap-2 disabled:opacity-60"><Save size={20} /> {isSaving ? 'Guardando...' : 'Guardar Cambios'}</button>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL AGREGAR MONEDA */}
      {showAddModal && (
        <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-black text-xl text-gray-800">Agregar Moneda</h3>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-gray-200 rounded-full"><X size={20} /></button>
            </div>
            <div className="p-4 bg-white border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                <input type="text" placeholder="Buscar moneda..." value={addSearch} onChange={(e) => setAddSearch(e.target.value)} className="w-full pl-10 pr-4 py-2.5 bg-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-emerald-200 text-sm" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-white">
              {COMMON_CURRENCIES.filter(c => c.code.toLowerCase().includes(addSearch.toLowerCase()) || c.name.toLowerCase().includes(addSearch.toLowerCase())).map(c => (
                <button key={c.code} onClick={() => handleAddCurrency(c)} className="w-full p-4 rounded-2xl flex items-center justify-between bg-white hover:bg-white border border-gray-200 hover:border-emerald-200 transition-all group">
                  <div className="flex items-center gap-4">
                    <span className="text-3xl">{FLAGS[c.code] || '🏳️'}</span>
                    <div className="text-left">
                      <p className="font-bold text-gray-800 group-hover:text-emerald-700">{c.code}</p>
                      <p className="text-xs text-gray-400">{c.name}</p>
                    </div>
                  </div>
                  <Plus size={20} className="text-gray-300 group-hover:text-emerald-500" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: HISTÓRICO DE AUDITORÍA */}
      {showAuditHistory && (
        <div className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-3xl shadow-2xl max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-black text-2xl text-gray-800 flex items-center gap-2">
                <TrendingUp size={24} className="text-emerald-600" />
                Histórico de Cambios - {activeCurrency.code}
              </h3>
              <button
                onClick={() => setShowAuditHistory(false)}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {loadingAudit ? (
                <div className="text-center py-12">
                  <RefreshCw size={48} className="mx-auto mb-4 text-gray-400 animate-spin" />
                  <p className="font-bold text-gray-500">Cargando histórico...</p>
                </div>
              ) : auditLogs.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <TrendingUp size={48} className="mx-auto mb-4 opacity-20" />
                  <p className="font-bold">No hay historial de cambios para esta moneda</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="bg-gray-50 rounded-2xl p-4 border border-gray-200 flex items-start gap-4"
                    >
                      <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center shrink-0">
                        <RefreshCw size={18} className="text-emerald-600" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <p className="font-bold text-gray-800">
                              {log.field === 'rate' && 'Tasa Unificada'}
                              {log.field === 'buyRate' && 'Tasa de Compra'}
                              {log.field === 'sellRate' && 'Tasa de Venta'}
                            </p>
                            <p className="text-xs text-gray-500">
                              Por: <span className="font-bold">{log.changedByName}</span>
                              {log.terminalId && ` • Terminal: ${log.terminalId}`}
                            </p>
                          </div>
                          <span className="text-xs text-gray-400">
                            {new Date(log.changedAt).toLocaleString('es-DO')}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                          <span className="font-mono text-red-600 line-through">
                            {parseFloat(log.oldValue).toFixed(2)}
                          </span>
                          <ArrowRight size={16} className="text-gray-400" />
                          <span className="font-mono font-bold text-emerald-600">
                            {parseFloat(log.newValue).toFixed(2)}
                          </span>
                          <span className="text-gray-400 font-bold">{baseCurrency.code}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CurrencySettings;
