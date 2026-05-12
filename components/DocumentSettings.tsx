
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { BusinessConfig, DocumentSeries, FiscalAllocation, FiscalDocumentCode, FiscalRangeDGII, LocalFiscalBuffer, Transaction } from '../types';
import {
   FileText, Receipt, RotateCcw, FileSpreadsheet,
   Edit2, Check, X, AlertTriangle, ShieldAlert,
   ArrowRight, ArrowRightLeft, ArrowUpRight, Hash, Type, Landmark, Calendar,
   ShieldCheck, AlertOctagon, Plus, Trash2, ChevronRight,
   Save, AlignLeft, BarChart3, Activity, PieChart, ShoppingBag, Box
   , Eye, EyeOff
} from 'lucide-react';
import { db } from '../utils/db';
import { seriesSyncService } from '../services/sync/SeriesSyncService';
import { syncManager } from '../services/sync/SyncManager';
import { DEFAULT_DOCUMENT_SERIES } from '../constants';
import {
   deleteLocalFiscalCredential as deleteLocalFiscalCredentialRequest,
   deleteSupabaseFiscalCredential as deleteSupabaseFiscalCredentialRequest,
   FiscalCredentialMetaResponse,
   getFiscalCredentialMetadata,
   saveLocalFiscalCredential,
   saveSupabaseFiscalCredential,
   testFiscalProviderConnection
} from '../services/fiscal/fiscalService';
import {
   FISCAL_DOCUMENT_LABELS,
   getFiscalReserveAlert,
   getFiscalComplianceConfig,
   SUPPORTED_FISCAL_CODES
} from '../utils/fiscal/fiscalHelpers';

interface DocumentSettingsProps {
   onClose: () => void;
   config?: BusinessConfig | null;
   terminalId?: string;
   currentDeviceId?: string;
}

const DOCUMENT_TYPE_ORDER = [
   'TICKET', 'REFUND', 'VOID',
   'TRANSFER', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'PURCHASE', 'PRODUCTION',
   'CASH_IN', 'CASH_OUT', 'CASH_DEPOSIT', 'CASH_WITHDRAWAL',
   'Z_REPORT', 'X_REPORT',
   'RECEIVABLE', 'PAYABLE', 'PAYMENT_IN', 'PAYMENT_OUT'
] as const;

const DOCUMENT_TYPE_SET = new Set<string>(DOCUMENT_TYPE_ORDER as readonly string[]);
const NCF_TYPES: FiscalDocumentCode[] = SUPPORTED_FISCAL_CODES;

const DOCUMENT_TYPE_CONFIG: Record<string, { label: string; icon: React.ComponentType<any>; color: string }> = {
   // Ventas
   TICKET: { label: 'Tickets de Venta', icon: Receipt, color: 'blue' },
   REFUND: { label: 'Devoluciones / Abonos', icon: RotateCcw, color: 'orange' },
   VOID: { label: 'Anulaciones', icon: X, color: 'red' },

   // Inventario
   TRANSFER: { label: 'Traspasos', icon: ArrowRightLeft, color: 'purple' },
   ADJUSTMENT_IN: { label: 'Ajustes Positivos', icon: Plus, color: 'green' },
   ADJUSTMENT_OUT: { label: 'Ajustes Negativos', icon: Trash2, color: 'red' },
   PURCHASE: { label: 'Compras', icon: ShoppingBag, color: 'indigo' },
   PRODUCTION: { label: 'Producción', icon: Box, color: 'cyan' },

   // Efectivo
   CASH_IN: { label: 'Entradas de Efectivo', icon: ArrowRight, color: 'emerald' },
   CASH_OUT: { label: 'Salidas de Efectivo', icon: ArrowRight, color: 'rose' },
   CASH_DEPOSIT: { label: 'Depósitos Bancarios', icon: Landmark, color: 'teal' },
   CASH_WITHDRAWAL: { label: 'Retiros', icon: Landmark, color: 'amber' },

   // Cierres
   Z_REPORT: { label: 'Cierres de Caja (Z)', icon: Save, color: 'slate' },
   X_REPORT: { label: 'Cortes Parciales (X)', icon: FileText, color: 'gray' },

   // Cuentas
   RECEIVABLE: { label: 'Cuentas por Cobrar', icon: ArrowUpRight, color: 'sky' },
   PAYABLE: { label: 'Cuentas por Pagar', icon: ArrowUpRight, color: 'violet' },
   PAYMENT_IN: { label: 'Cobros Recibidos', icon: Check, color: 'lime' },
   PAYMENT_OUT: { label: 'Pagos Realizados', icon: Check, color: 'fuchsia' }
};

const normalizeDocumentType = (value: unknown): string => {
   if (typeof value !== 'string') return '';
   return value.trim().toUpperCase().replace(/[\s-]+/g, '_');
};

const inferDocumentType = (series: any): string => {
   const explicitType = normalizeDocumentType(series?.documentType);
   if (DOCUMENT_TYPE_SET.has(explicitType)) return explicitType;

   const typeFromId = normalizeDocumentType(series?.id);
   if (DOCUMENT_TYPE_SET.has(typeFromId)) return typeFromId;

   const prefix = String(series?.prefix || '').trim().toUpperCase();
   if (prefix.startsWith('TCK')) return 'TICKET';
   if (prefix.startsWith('NC') || prefix.startsWith('REF')) return 'REFUND';
   if (prefix.startsWith('TR')) return 'TRANSFER';
   if (prefix.startsWith('VOID')) return 'VOID';
   if (prefix.startsWith('RCB') || prefix.startsWith('COB')) return 'PAYMENT_IN';
   if (prefix.startsWith('PAG')) return 'PAYMENT_OUT';

   return explicitType || typeFromId || 'TICKET';
};

const normalizeSequence = (raw: any): DocumentSeries | null => {
   if (!raw || typeof raw !== 'object') return null;

   const documentType = inferDocumentType(raw);
   const fallback = DEFAULT_DOCUMENT_SERIES.find(s =>
      normalizeDocumentType(s.documentType) === documentType ||
      normalizeDocumentType(s.id) === documentType
   );

   const prefix = String(raw.prefix || fallback?.prefix || 'DOC').trim().toUpperCase();
   const safeId = String(raw.id || `${documentType}_${prefix}`).trim();
   if (!safeId) return null;

   const nextNumberRaw = Number(raw.nextNumber);
   const paddingRaw = Number(raw.padding);

   return {
      id: safeId,
      documentType: documentType as DocumentSeries['documentType'],
      name: String(raw.name || fallback?.name || `Serie ${documentType}`).trim(),
      description: String(raw.description || fallback?.description || 'Documento interno.').trim(),
      prefix: prefix || 'DOC',
      nextNumber: Number.isFinite(nextNumberRaw) && nextNumberRaw > 0 ? Math.floor(nextNumberRaw) : (fallback?.nextNumber || 1),
      padding: Number.isFinite(paddingRaw) && paddingRaw >= 0 ? Math.floor(paddingRaw) : (fallback?.padding ?? 6),
      icon: String(raw.icon || fallback?.icon || 'FileText'),
      color: String(raw.color || fallback?.color || 'blue'),
      businessUnit: typeof raw.businessUnit === 'string' ? raw.businessUnit : undefined
   };
};

const normalizeSequenceCollection = (rows: any[]): DocumentSeries[] => {
   const map = new Map<string, DocumentSeries>();
   for (const row of Array.isArray(rows) ? rows : []) {
      const normalized = normalizeSequence(row);
      if (!normalized) continue;
      const existing = map.get(normalized.id);
      if (!existing) {
         map.set(normalized.id, normalized);
         continue;
      }
      map.set(normalized.id, {
         ...existing,
         ...normalized,
         nextNumber: Math.max(existing.nextNumber || 1, normalized.nextNumber || 1)
      });
   }
   return Array.from(map.values());
};

const extractConfig = (raw: any): BusinessConfig | null => {
   if (!raw) return null;
   if (Array.isArray(raw)) {
      const current = raw.find((c: any) => c?.id === 'current');
      return (current || raw[0] || null) as BusinessConfig | null;
   }
   if (typeof raw === 'object') return raw as BusinessConfig;
   return null;
};

const pickRicherConfig = (primary?: BusinessConfig | null, secondary?: BusinessConfig | null): BusinessConfig | null => {
   const left = primary && typeof primary === 'object' ? primary : null;
   const right = secondary && typeof secondary === 'object' ? secondary : null;

   if (left && !right) return left;
   if (right && !left) return right;
   if (!left && !right) return null;

   const score = (config?: BusinessConfig | null) => {
      if (!config) return 0;
      let total = 0;
      if (config.companyInfo?.name) total += 3;
      if (config.companyInfo?.rnc) total += 4;
      if (config.currencySymbol) total += 1;
      if (Array.isArray(config.tariffs) && config.tariffs.length > 0) total += 2;
      if (Array.isArray(config.productGroups) && config.productGroups.length > 0) total += 2;
      if (Array.isArray(config.seasons) && config.seasons.length > 0) total += 2;
      const fiscal = config.fiscalCompliance;
      if (fiscal?.mode) total += 2;
      if (fiscal?.defaultProvider && fiscal.defaultProvider !== 'NONE') total += 5;
      if (Array.isArray(fiscal?.providers) && fiscal.providers.length > 0) {
         total += fiscal.providers.reduce((acc, provider) => acc + (provider.credentialKey ? 3 : 0) + (provider.environment !== undefined ? 1 : 0), 0);
      }
      return total;
   };

   return score(right) > score(left) ? right : left;
};

const buildRecoveredFiscalRanges = (transactions: Transaction[]): FiscalRangeDGII[] => {
   const maxUsedByType: Record<FiscalDocumentCode, number> = {
      B01: 0,
      B02: 0,
      B04: 0,
      B14: 0,
      B15: 0,
      E31: 0,
      E32: 0,
      E34: 0,
      E44: 0,
      E45: 0
   };

   for (const tx of Array.isArray(transactions) ? transactions : []) {
      if (!tx?.ncfType || !NCF_TYPES.includes(tx.ncfType)) continue;
      const ncf = String(tx.ncf || '').trim().toUpperCase();
      const numericPart = ncf.startsWith(tx.ncfType) ? ncf.slice(tx.ncfType.length) : '';
      const num = Number(numericPart);
      if (Number.isFinite(num) && num > maxUsedByType[tx.ncfType]) {
         maxUsedByType[tx.ncfType] = num;
      }
   }

   return NCF_TYPES.map((type) => {
      const maxUsed = maxUsedByType[type] || 0;
      return {
         id: `fr-recovered-${type}`,
         type,
         prefix: type,
         startNumber: 1,
         endNumber: Math.max(10000, maxUsed + 1000),
         currentGlobal: maxUsed,
         expiryDate: '2030-12-31',
         isActive: true
      };
   });
};

const FISCAL_CREDENTIAL_SOURCE_LABELS: Record<'env' | 'sqlite' | 'supabase', string> = {
   env: 'ENV',
   sqlite: 'SQLite',
   supabase: 'Supabase'
};

const normalizeKey = (value: unknown): string => String(value || '').trim().toUpperCase();

const DocumentSettings: React.FC<DocumentSettingsProps> = ({ onClose, config: configProp, terminalId }) => {
   const [activeSubTab, setActiveSubTab] = useState<'SERIES' | 'FISCAL_POOL'>('SERIES');

   // Data for Series
   const [seriesList, setSeriesList] = useState<DocumentSeries[]>([]);
   const [businessConfig, setBusinessConfig] = useState<BusinessConfig | null>(null);
   const [isSavingFiscalConfig, setIsSavingFiscalConfig] = useState(false);
   const [isTestingProvider, setIsTestingProvider] = useState(false);
   const [isSavingCredential, setIsSavingCredential] = useState(false);
   const [isSavingSupabaseCredential, setIsSavingSupabaseCredential] = useState(false);
   const [isSavingRange, setIsSavingRange] = useState(false);
   const [isDeletingLocalCredential, setIsDeletingLocalCredential] = useState(false);
   const [isDeletingSupabaseCredential, setIsDeletingSupabaseCredential] = useState(false);
   const [fiscalFeedback, setFiscalFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
   const [credentialDraft, setCredentialDraft] = useState('');
   const [credentialLabel, setCredentialLabel] = useState('');
   const [credentialMeta, setCredentialMeta] = useState<FiscalCredentialMetaResponse | null>(null);
   const [showCredentialDraft, setShowCredentialDraft] = useState(false);

   const [editingSeries, setEditingSeries] = useState<DocumentSeries | null>(null);

   // Data for Fiscal Pool & Transactions for Audit
   const [fiscalRanges, setFiscalRanges] = useState<FiscalRangeDGII[]>([]);
   const [fiscalAllocations, setFiscalAllocations] = useState<FiscalAllocation[]>([]);
   const [localFiscalBuffers, setLocalFiscalBuffers] = useState<LocalFiscalBuffer[]>([]);
   const [activeTerminalId, setActiveTerminalId] = useState('');
   const [fiscalRangeDetail, setFiscalRangeDetail] = useState<FiscalRangeDGII | null>(null);

   const [transactions, setTransactions] = useState<Transaction[]>([]);
   const credentialMetaRequestSeq = useRef(0);

   useEffect(() => {
      const loadData = async () => {
         try {
            console.log('📖 DocumentSettings: Loading series data...');
            const [rawSequences, rawFiscalRanges, rawTransactions, rawConfig, rawFiscalAllocations, rawLocalFiscalBuffers] = await Promise.all([
               db.get('internalSequences'),
               db.get('fiscalRanges'),
               db.get('transactions'),
               db.get('config'),
               db.get('fiscalAllocations'),
               db.get('localFiscalBuffer'),
            ]);

            const transactionsList = (Array.isArray(rawTransactions) ? rawTransactions : []) as Transaction[];
            setTransactions(transactionsList);

            const localSeries = normalizeSequenceCollection(rawSequences as any[]);
            const config = pickRicherConfig(extractConfig(rawConfig), configProp) || extractConfig(rawConfig) || configProp || null;
            const terminalSeries = normalizeSequenceCollection(
               (config?.terminals || []).flatMap((terminal: any) =>
                  Array.isArray(terminal?.config?.documentSeries) ? terminal.config.documentSeries : []
               )
            );

            let finalSeries = normalizeSequenceCollection([...localSeries, ...terminalSeries]);
            if (finalSeries.length === 0) {
               finalSeries = normalizeSequenceCollection(DEFAULT_DOCUMENT_SERIES);
            }

            const localSeriesIds = new Set(localSeries.map(s => s.id));
            const shouldPersistRecoveredSeries =
               finalSeries.length > 0 &&
               (
                  localSeries.length === 0 ||
                  finalSeries.some(series => !localSeriesIds.has(series.id))
               );

            if (shouldPersistRecoveredSeries) {
               await db.save('internalSequences', finalSeries);
               console.warn(`🛠️ DocumentSettings: Sincronizadas/recuperadas ${finalSeries.length} series internas.`);
            }

            console.log(`📖 DocumentSettings: Loaded ${finalSeries.length} series after recovery.`);
            setSeriesList(finalSeries);
            setBusinessConfig(config);

            const ranges = (Array.isArray(rawFiscalRanges) ? rawFiscalRanges : []) as FiscalRangeDGII[];
            const allocations = (Array.isArray(rawFiscalAllocations) ? rawFiscalAllocations : []) as FiscalAllocation[];
            const buffers = (Array.isArray(rawLocalFiscalBuffers) ? rawLocalFiscalBuffers : []) as LocalFiscalBuffer[];
            setFiscalAllocations(allocations);
            setLocalFiscalBuffers(buffers);
            setActiveTerminalId(localStorage.getItem('active_terminal_id') || '');
            if (ranges.length > 0) {
               setFiscalRanges(ranges);
            } else {
               const recoveredRanges = buildRecoveredFiscalRanges(transactionsList);
               setFiscalRanges(recoveredRanges);
               await db.save('fiscalRanges', recoveredRanges);
               console.warn('🛠️ DocumentSettings: fiscalRanges estaba vacío. Se regeneraron rangos base por tipo NCF.');
            }
         } catch (error) {
            console.error('❌ DocumentSettings: Failed to load data:', error);
            setSeriesList([]);
            setFiscalRanges([]);
            setFiscalAllocations([]);
            setLocalFiscalBuffers([]);
            setTransactions([]);
            setBusinessConfig(null);
            setActiveTerminalId('');
         }
      };
      loadData();

      // Listen for series updates from other terminals
      const handleSeriesUpdate = () => {
         console.log('🔔 DocumentSettings: Received series update event, reloading...');
         loadData();
         console.log('📥 Series list refreshed from sync');
      };

      window.addEventListener('seriesUpdated', handleSeriesUpdate);
      window.addEventListener('internalSequencesUpdated', handleSeriesUpdate);
      window.addEventListener('fiscalRangesUpdated', handleSeriesUpdate);

      return () => {
         window.removeEventListener('seriesUpdated', handleSeriesUpdate);
         window.removeEventListener('internalSequencesUpdated', handleSeriesUpdate);
         window.removeEventListener('fiscalRangesUpdated', handleSeriesUpdate);
      };
   }, [configProp]);

   const [isAddingRange, setIsAddingRange] = useState(false);
   const [newRange, setNewRange] = useState<Partial<FiscalRangeDGII>>({ type: 'B01', prefix: 'B01', startNumber: 1, endNumber: 1000, expiryDate: '2026-12-31' });
   const fiscalCompliance = useMemo(() => getFiscalComplianceConfig(businessConfig), [businessConfig]);
   const selectedFiscalProviderConfig = useMemo(
      () => fiscalCompliance.providers.find(provider => provider.id === fiscalCompliance.defaultProvider),
      [fiscalCompliance]
   );
   const isDelegatedDigiFactProvider =
      fiscalCompliance.defaultProvider === 'DIGIFACT'
      && selectedFiscalProviderConfig?.deliveryMode === 'DELEGATED_ERP';

   const refreshCredentialMeta = async () => {
      const requestId = ++credentialMetaRequestSeq.current;
      if (!businessConfig || fiscalCompliance.defaultProvider === 'NONE') {
         if (requestId === credentialMetaRequestSeq.current) {
            setCredentialMeta(null);
            setCredentialLabel('');
         }
         return null;
      }

      const meta = await getFiscalCredentialMetadata(
         fiscalCompliance.defaultProvider,
         businessConfig.companyInfo,
         selectedFiscalProviderConfig?.credentialKey
      );
      if (requestId === credentialMetaRequestSeq.current) {
         setCredentialMeta(meta);
         setCredentialLabel(meta.label || '');
      }
      return meta;
   };

   const getCredentialRequestContext = () => {
      if (fiscalCompliance.defaultProvider === 'NONE') {
         setFiscalFeedback({ kind: 'error', message: 'Selecciona un proveedor fiscal antes de administrar credenciales.' });
         return null;
      }

      if (!businessConfig) {
         setFiscalFeedback({ kind: 'error', message: 'Configura primero la empresa antes de administrar credenciales.' });
         return null;
      }

      return {
         providerId: fiscalCompliance.defaultProvider,
         companyInfo: businessConfig.companyInfo,
         credentialKey: selectedFiscalProviderConfig?.credentialKey
      };
   };

   useEffect(() => {
      const loadCredentialMeta = async () => {
         try {
            await refreshCredentialMeta();
         } catch (error) {
            console.error('❌ Error loading fiscal credential metadata:', error);
            setCredentialMeta(null);
            setCredentialLabel('');
         }
      };

      loadCredentialMeta();
   }, [businessConfig, fiscalCompliance.defaultProvider, selectedFiscalProviderConfig?.credentialKey]);

   const resolvedTerminalId = useMemo(() => {
      const direct = String(terminalId || '').trim();
      if (direct) return direct;
      const active = String(activeTerminalId || '').trim();
      if (active) return active;
      return '';
   }, [terminalId, activeTerminalId]);
   const hasLockedLocalCredential = Boolean(credentialMeta?.hasLocalCredential);

   const terminalAllocations = useMemo(() => (
      (Array.isArray(fiscalAllocations) ? fiscalAllocations : []).filter((allocation) =>
         !resolvedTerminalId || normalizeKey(allocation.terminalId) === normalizeKey(resolvedTerminalId)
      )
   ), [fiscalAllocations, resolvedTerminalId]);

   const terminalBuffers = useMemo(() => (
      (Array.isArray(localFiscalBuffers) ? localFiscalBuffers : []).filter((buffer) =>
         !resolvedTerminalId || !buffer?.terminalId || normalizeKey(buffer.terminalId) === normalizeKey(resolvedTerminalId)
      )
   ), [localFiscalBuffers, resolvedTerminalId]);

   const allocationStatsByType = useMemo(() => {
      const stats = new Map<FiscalDocumentCode, {
         allocation: FiscalAllocation;
         buffer: LocalFiscalBuffer | null;
         currentNumber: number;
         consumed: number;
         remaining: number;
      }>();

      terminalAllocations.forEach((allocation) => {
         const buffer = terminalBuffers.find((candidate) => candidate.type === allocation.ncfType) || null;
         const allocationNextNumber = Math.max(
            allocation.reservedStart,
            Number(allocation.nextNumber || allocation.reservedStart)
         );
         const bufferCurrentNumber = Number(buffer?.currentNumber || 0);
         const staleExhaustedBuffer =
            Boolean(buffer) &&
            bufferCurrentNumber > allocation.reservedEnd + 1 &&
            allocationNextNumber <= allocation.reservedEnd;
         const currentNumber = buffer && !staleExhaustedBuffer
            ? Math.max(allocation.reservedStart, bufferCurrentNumber || allocationNextNumber)
            : allocationNextNumber;
         const boundedCurrent = Math.min(currentNumber, allocation.reservedEnd + 1);
         const consumed = Math.max(0, boundedCurrent - allocation.reservedStart);
         const remaining = Math.max(0, allocation.reservedEnd - boundedCurrent + 1);

         stats.set(allocation.ncfType, {
            allocation,
            buffer,
            currentNumber: boundedCurrent,
            consumed,
            remaining,
         });
      });

      return stats;
   }, [terminalAllocations, terminalBuffers]);

   const fiscalRangeDetailRows = useMemo(() => {
      if (!fiscalRangeDetail) return [];
      return (Array.isArray(fiscalAllocations) ? fiscalAllocations : [])
         .filter((allocation) => {
            if (allocation.fiscalRangeId && fiscalRangeDetail.id) {
               return allocation.fiscalRangeId === fiscalRangeDetail.id;
            }
            return allocation.ncfType === fiscalRangeDetail.type;
         })
         .map((allocation) => {
            const buffer = terminalBuffers.find((candidate) =>
               candidate.type === allocation.ncfType &&
               (!candidate.terminalId || normalizeKey(candidate.terminalId) === normalizeKey(allocation.terminalId))
            ) || null;
            const currentNumber = buffer
               ? Math.max(allocation.reservedStart, Number(buffer.currentNumber || allocation.nextNumber || allocation.reservedStart))
               : Math.max(allocation.reservedStart, Number(allocation.nextNumber || allocation.reservedStart));
            const boundedCurrent = Math.min(currentNumber, allocation.reservedEnd + 1);
            const total = Math.max(0, allocation.reservedEnd - allocation.reservedStart + 1);
            const consumed = Math.max(0, boundedCurrent - allocation.reservedStart);
            const remaining = Math.max(0, allocation.reservedEnd - boundedCurrent + 1);
            const prefix = fiscalRangeDetail.prefix || allocation.prefix || allocation.ncfType;

            return {
               allocation,
               prefix,
               currentNumber: boundedCurrent,
               nextLabel: boundedCurrent <= allocation.reservedEnd
                  ? `${prefix}${boundedCurrent.toString().padStart(8, '0')}`
                  : 'Agotado',
               total,
               consumed,
               remaining,
               alert: getFiscalReserveAlert(remaining, total, fiscalCompliance),
            };
         })
         .sort((left, right) => normalizeKey(left.allocation.terminalId).localeCompare(normalizeKey(right.allocation.terminalId)));
   }, [fiscalAllocations, fiscalRangeDetail, fiscalCompliance, terminalBuffers]);

   // --- FISCAL AUDIT LOGIC ---
   const fiscalConsumption = useMemo(() => {
      const stats: Record<FiscalDocumentCode, number> = {
         B01: 0,
         B02: 0,
         B04: 0,
         B14: 0,
         B15: 0,
         E31: 0,
         E32: 0,
         E34: 0,
         E44: 0,
         E45: 0
      };

      if (Array.isArray(transactions)) {
         transactions.forEach(tx => {
            if (tx && tx.ncfType && stats[tx.ncfType] !== undefined) {
               stats[tx.ncfType] = (stats[tx.ncfType] || 0) + 1;
            }
         });
      }

      allocationStatsByType.forEach((details, type) => {
         stats[type] = details.consumed;
      });

      return stats;
   }, [transactions, allocationStatsByType]);

   const extraDocumentTypes = useMemo(() => {
      const extras = new Set<string>();
      for (const series of seriesList) {
         const normalizedType = normalizeDocumentType((series as any)?.documentType);
         if (normalizedType && !DOCUMENT_TYPE_SET.has(normalizedType)) {
            extras.add(normalizedType);
         }
      }
      return Array.from(extras);
   }, [seriesList]);

   const documentTypesToRender = useMemo(
      () => [...DOCUMENT_TYPE_ORDER, ...extraDocumentTypes],
      [extraDocumentTypes]
   );

   const handleAddNewSeries = () => {
      setEditingSeries({
         id: `DOC_${Date.now()}`,
         documentType: 'TICKET',
         name: '',
         description: 'Documento interno personalizado.',
         prefix: 'DOC',
         nextNumber: 1,
         padding: 6,
         icon: 'FileText',
         color: 'blue'
      });
   };

   const handleSaveInternalSeries = async () => {
      if (!editingSeries) return;

      let updated;
      const exists = seriesList.some(s => s.id === editingSeries.id);

      if (exists) {
         updated = seriesList.map(s => s.id === editingSeries.id ? editingSeries : s);
      } else {
         updated = [...seriesList, editingSeries];
      }

      setSeriesList(updated);
      await db.save('internalSequences', updated);

      // Broadcast change to other terminals via SeriesSyncService (Instant)
      await seriesSyncService.broadcastChange(
         exists ? 'UPDATE' : 'CREATE',
         editingSeries
      );

      // Push to SyncManager (Persistent/Manual Sync)
      await syncManager.pushCatalog('internalSequences');

      setEditingSeries(null);
   };

   const handleDeleteSeries = async (id: string) => {
      if (!confirm("¿Desea eliminar este tipo de documento? Las transacciones existentes no se verán afectadas pero no podrá emitir nuevos bajo esta serie.")) return;

      const updated = seriesList.filter(s => s.id !== id);
      setSeriesList(updated);
      await db.save('internalSequences', updated);

      // Broadcast deletion to other terminals
      await seriesSyncService.broadcastChange('DELETE', id);

      // Push to SyncManager (Persistent/Manual Sync)
      await syncManager.pushCatalog('internalSequences');
   };

   const handleSaveRange = async () => {
      if (isSavingRange) return;

      if (!newRange.prefix || !newRange.startNumber || !newRange.endNumber || !newRange.expiryDate) {
         setFiscalFeedback({ kind: 'error', message: 'Completa prefijo, rango y vencimiento antes de guardar la autorización.' });
         return;
      }

      if ((newRange.endNumber || 0) < (newRange.startNumber || 0)) {
         setFiscalFeedback({ kind: 'error', message: 'El número final no puede ser menor que el inicial.' });
         return;
      }

      try {
         setIsSavingRange(true);

         const duplicatedRange = fiscalRanges.find(range =>
            range.type === newRange.type &&
            range.prefix === newRange.prefix &&
            range.startNumber === newRange.startNumber &&
            range.endNumber === newRange.endNumber &&
            range.expiryDate === newRange.expiryDate
         );

         if (duplicatedRange) {
            setFiscalFeedback({ kind: 'error', message: `Ya existe una autorización ${duplicatedRange.type} con ese mismo rango.` });
            return;
         }

         const range: FiscalRangeDGII = {
            ...newRange as FiscalRangeDGII,
            id: `fr-${Date.now()}`,
            currentGlobal: (newRange.startNumber || 1) - 1,
            isActive: true
         };
         const updated = [...fiscalRanges, range];
         setFiscalRanges(updated);
         await db.save('fiscalRanges', updated);
         setIsAddingRange(false);
         setFiscalFeedback({ kind: 'success', message: `Autorizacion ${range.type} guardada localmente.` });

         try {
            await syncManager.pushCatalog('fiscalRanges');
         } catch (error) {
            console.warn('⚠️ DocumentSettings: fiscalRanges sync failed after local save:', error);
            setFiscalFeedback({
               kind: 'error',
               message: `Autorizacion ${range.type} guardada localmente, pero no se pudo sincronizar ahora mismo.`
            });
         }
      } finally {
         setIsSavingRange(false);
      }
   };

   const handleToggleRange = async (id: string) => {
      const updated = fiscalRanges.map(r => r.id === id ? { ...r, isActive: !r.isActive } : r);
      setFiscalRanges(updated);
      await db.save('fiscalRanges', updated);

      // Push to SyncManager (Persistent/Manual Sync)
      await syncManager.pushCatalog('fiscalRanges');
   };

   const handleDeleteRange = async (id: string) => {
      const range = fiscalRanges.find(item => item.id === id);
      if (!range) {
         setFiscalFeedback({ kind: 'error', message: 'No se encontró la autorización seleccionada.' });
         return;
      }

      const consumedCount = Math.max(0, range.currentGlobal - (range.startNumber - 1));
      if (consumedCount > 0) {
         setFiscalFeedback({ kind: 'error', message: `No se puede eliminar ${range.type} porque ya tiene comprobantes consumidos.` });
         return;
      }

      const [rawAllocations, rawBuffers] = await Promise.all([
         db.get('fiscalAllocations'),
         db.get('localFiscalBuffer')
      ]);

      const allocations = (Array.isArray(rawAllocations) ? rawAllocations : []).filter((allocation: any) =>
         allocation?.type === range.type &&
         allocation?.status === 'ACTIVE' &&
         Number(allocation?.rangeStart) <= range.endNumber &&
         Number(allocation?.rangeEnd) >= range.startNumber
      );

      if (allocations.length > 0) {
         setFiscalFeedback({ kind: 'error', message: `No se puede eliminar ${range.type} porque todavía tiene reservas asignadas a terminales.` });
         return;
      }

      const activeBuffers = (Array.isArray(rawBuffers) ? rawBuffers : []).filter((buffer: any) =>
         buffer?.type === range.type &&
         Number(buffer?.currentNumber) <= Number(buffer?.endNumber) &&
         Number(buffer?.currentNumber) <= range.endNumber &&
         Number(buffer?.endNumber) >= range.startNumber
      );

      if (activeBuffers.length > 0) {
         setFiscalFeedback({ kind: 'error', message: `No se puede eliminar ${range.type} porque hay una reserva activa en caja para ese rango.` });
         return;
      }

      if (!window.confirm(`¿Desea eliminar la autorización ${range.type} ${range.prefix}-${range.startNumber} a ${range.endNumber}?`)) {
         return;
      }

      const updated = fiscalRanges.filter(item => item.id !== id);
      setFiscalRanges(updated);
      await db.save('fiscalRanges', updated);
      setFiscalFeedback({ kind: 'success', message: `Autorizacion ${range.type} eliminada localmente.` });

      try {
         await syncManager.pushCatalog('fiscalRanges');
      } catch (error) {
         console.warn('⚠️ DocumentSettings: fiscalRanges sync failed after local delete:', error);
         setFiscalFeedback({
            kind: 'error',
            message: `Autorizacion ${range.type} eliminada localmente, pero no se pudo sincronizar ahora mismo.`
         });
      }
   };

   const updateFiscalCompliance = (updater: (current: NonNullable<BusinessConfig['fiscalCompliance']>) => NonNullable<BusinessConfig['fiscalCompliance']>) => {
      setFiscalFeedback(null);
      setBusinessConfig(prev => {
         if (!prev) return prev;
         const current = getFiscalComplianceConfig(prev);
         return {
            ...prev,
            fiscalCompliance: updater(current)
         };
      });
   };

   const updateSelectedProvider = (patch: Record<string, number | string | boolean | undefined>) => {
      updateFiscalCompliance(current => ({
         ...current,
         providers: current.providers.map(provider =>
            provider.id === current.defaultProvider
               ? { ...provider, ...patch }
               : provider
         )
      }));
   };

   const handleSaveFiscalConfig = async () => {
      if (!businessConfig) return;
      setIsSavingFiscalConfig(true);
      setFiscalFeedback(null);
      try {
         await db.save('config', businessConfig);
         window.dispatchEvent(new CustomEvent('configUpdated', { detail: businessConfig }));
         setFiscalFeedback({ kind: 'success', message: 'Politica fiscal guardada localmente.' });
      } catch (error: any) {
         console.error('❌ Error saving fiscal config:', error);
         setFiscalFeedback({ kind: 'error', message: error?.message || 'No se pudo guardar la política fiscal.' });
      } finally {
         setIsSavingFiscalConfig(false);
      }
   };

   const persistFiscalConfigSnapshot = async () => {
      if (!businessConfig) return;
      await db.save('config', businessConfig);
      window.dispatchEvent(new CustomEvent('configUpdated', { detail: businessConfig }));
   };

   const handleTestProvider = async () => {
      if (fiscalCompliance.defaultProvider === 'NONE') {
         setFiscalFeedback({ kind: 'error', message: 'Selecciona un proveedor fiscal antes de probar la conexión.' });
         return;
      }

      if (isDelegatedDigiFactProvider) {
         setFiscalFeedback({
            kind: 'success',
            message: 'DigiFact se valida desde ERP > Integraciones e-CF. El POS solo delega la emisión al backend ERP y no guarda token local.'
         });
         return;
      }

      setIsTestingProvider(true);
      setFiscalFeedback(null);
      try {
         const provider = fiscalCompliance.providers.find(item => item.id === fiscalCompliance.defaultProvider);
         const environment = provider?.environment ?? 0;
         const result = await testFiscalProviderConnection(
            fiscalCompliance.defaultProvider,
            environment,
            businessConfig?.companyInfo,
            provider?.credentialKey
         );
         setFiscalFeedback({
            kind: result.success ? 'success' : 'error',
            message: result.message || 'Prueba de conexión completada.'
         });
      } catch (error: any) {
         console.error('❌ Error testing fiscal provider:', error);
         setFiscalFeedback({ kind: 'error', message: error?.message || 'No se pudo probar el proveedor fiscal.' });
      } finally {
         setIsTestingProvider(false);
      }
   };

   const handleSaveCredential = async () => {
      const requestContext = getCredentialRequestContext();
      if (!requestContext) return;

      if (requestContext.providerId === 'DIGIFACT' && isDelegatedDigiFactProvider) {
         setFiscalFeedback({ kind: 'error', message: 'DigiFact no guarda token en el POS. Administra la credencial segura desde ERP > Integraciones e-CF.' });
         return;
      }

      if (!credentialDraft.trim()) {
         setFiscalFeedback({ kind: 'error', message: 'Ingresa el Authentication Token del proveedor fiscal.' });
         return;
      }

      setIsSavingCredential(true);
      setFiscalFeedback(null);
      try {
         await persistFiscalConfigSnapshot();
         const response = await saveLocalFiscalCredential(
            requestContext.providerId,
            credentialDraft,
            requestContext.companyInfo,
            requestContext.credentialKey,
            credentialLabel
         );
         if (response.meta) {
            setCredentialMeta(response.meta);
            setCredentialLabel(response.meta.label || credentialLabel);
         } else {
            await refreshCredentialMeta();
         }
         setCredentialDraft('');
         setShowCredentialDraft(false);
         setFiscalFeedback({ kind: 'success', message: response.message || 'Credencial fiscal guardada.' });
      } catch (error: any) {
         console.error('❌ Error saving fiscal credential:', error);
         setFiscalFeedback({ kind: 'error', message: error?.message || 'No se pudo guardar la credencial fiscal.' });
      } finally {
         setIsSavingCredential(false);
      }
   };

   const handleSaveSupabaseCredential = async () => {
      const requestContext = getCredentialRequestContext();
      if (!requestContext) return;

      if (requestContext.providerId === 'DIGIFACT' && isDelegatedDigiFactProvider) {
         setFiscalFeedback({ kind: 'error', message: 'DigiFact no guarda token desde el POS. Administra la credencial segura desde ERP > Integraciones e-CF.' });
         return;
      }

      if (!credentialDraft.trim()) {
         setFiscalFeedback({ kind: 'error', message: 'Ingresa el Authentication Token que deseas enviar a Supabase.' });
         return;
      }

      setIsSavingSupabaseCredential(true);
      setFiscalFeedback(null);
      try {
         await persistFiscalConfigSnapshot();
         const response = await saveSupabaseFiscalCredential(
            requestContext.providerId,
            credentialDraft,
            requestContext.companyInfo,
            requestContext.credentialKey
         );
         if (response.meta) {
            setCredentialMeta(response.meta);
            setCredentialLabel(response.meta.label || credentialLabel);
         } else {
            await refreshCredentialMeta();
         }
         setCredentialDraft('');
         setFiscalFeedback({ kind: 'success', message: response.message || 'Credencial fiscal guardada en Supabase.' });
      } catch (error: any) {
         console.error('❌ Error saving Supabase fiscal credential:', error);
         setFiscalFeedback({ kind: 'error', message: error?.message || 'No se pudo guardar la credencial en Supabase.' });
      } finally {
         setIsSavingSupabaseCredential(false);
      }
   };

   const handleDeleteLocalCredential = async () => {
      const requestContext = getCredentialRequestContext();
      if (!requestContext) return;

      if (requestContext.providerId === 'DIGIFACT' && isDelegatedDigiFactProvider) {
         setFiscalFeedback({ kind: 'error', message: 'DigiFact no usa credenciales locales en el POS.' });
         return;
      }

      if (!credentialMeta?.hasLocalCredential) {
         setFiscalFeedback({ kind: 'error', message: 'No existe una credencial local para eliminar.' });
         return;
      }

      if (!confirm('¿Deseas eliminar la credencial local? Si existe una en Supabase o ENV, esa pasará a ser la fuente activa.')) {
         return;
      }

      setIsDeletingLocalCredential(true);
      setFiscalFeedback(null);
      try {
         const response = await deleteLocalFiscalCredentialRequest(
            requestContext.providerId,
            requestContext.companyInfo,
            requestContext.credentialKey
         );
         if (response.meta) {
            setCredentialMeta(response.meta);
            setCredentialLabel(response.meta.label || '');
         } else {
            await refreshCredentialMeta();
         }
         setFiscalFeedback({ kind: 'success', message: response.message || 'Credencial local eliminada.' });
      } catch (error: any) {
         console.error('❌ Error deleting local fiscal credential:', error);
         setFiscalFeedback({ kind: 'error', message: error?.message || 'No se pudo eliminar la credencial local.' });
      } finally {
         setIsDeletingLocalCredential(false);
      }
   };

   const handleDeleteSupabaseCredential = async () => {
      const requestContext = getCredentialRequestContext();
      if (!requestContext) return;

      if (requestContext.providerId === 'DIGIFACT' && isDelegatedDigiFactProvider) {
         setFiscalFeedback({ kind: 'error', message: 'DigiFact no administra credenciales desde el POS.' });
         return;
      }

      if (!credentialMeta?.hasSupabaseCredential) {
         setFiscalFeedback({ kind: 'error', message: 'No existe una credencial en Supabase para eliminar.' });
         return;
      }

      if (!confirm('¿Deseas eliminar la credencial de Supabase para esta empresa/proveedor?')) {
         return;
      }

      setIsDeletingSupabaseCredential(true);
      setFiscalFeedback(null);
      try {
         const response = await deleteSupabaseFiscalCredentialRequest(
            requestContext.providerId,
            requestContext.companyInfo,
            requestContext.credentialKey
         );
         if (response.meta) {
            setCredentialMeta(response.meta);
            setCredentialLabel(response.meta.label || '');
         } else {
            await refreshCredentialMeta();
         }
         setFiscalFeedback({ kind: 'success', message: response.message || 'Credencial en Supabase eliminada.' });
      } catch (error: any) {
         console.error('❌ Error deleting Supabase fiscal credential:', error);
         setFiscalFeedback({ kind: 'error', message: error?.message || 'No se pudo eliminar la credencial en Supabase.' });
      } finally {
         setIsDeletingSupabaseCredential(false);
      }
   };

   return (
      <div className="flex flex-col h-full bg-gray-50 animate-in fade-in slide-in-from-right-10 duration-300">

         {/* Header */}
         <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center shrink-0">
            <div>
               <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                  <FileText className="text-slate-900" /> Document Center
               </h1>
               <p className="text-sm text-gray-500">Gestión de series y cumplimiento fiscal DGII.</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><X size={24} /></button>
         </div>

         <div className="px-8 py-3 bg-white border-b border-gray-100 flex gap-3 shrink-0">
            <button 
               onClick={() => setActiveSubTab('SERIES')} 
               className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-all flex items-center gap-2 outline-none focus:ring-2 focus:ring-blue-500/20 ${activeSubTab === 'SERIES' ? 'bg-blue-50 text-blue-700 shadow-sm border border-blue-200/60' : 'bg-white text-gray-500 hover:bg-gray-50 border border-gray-200 hover:border-gray-300 hover:text-gray-700'}`}
            >
               <FileText size={18} />
               Secuencias Internas
            </button>
            <button 
               onClick={() => setActiveSubTab('FISCAL_POOL')} 
               className={`px-5 py-2.5 text-sm font-bold rounded-xl transition-all flex items-center gap-2 outline-none focus:ring-2 focus:ring-indigo-500/20 ${activeSubTab === 'FISCAL_POOL' ? 'bg-indigo-50 text-indigo-700 shadow-sm border border-indigo-200/60' : 'bg-white text-gray-500 hover:bg-gray-50 border border-gray-200 hover:border-gray-300 hover:text-gray-700'}`}
            >
               <Landmark size={18} /> 
               Pool Fiscal DGII
            </button>
         </div>

         <div className="flex-1 overflow-hidden p-8">
            <div className="max-w-6xl mx-auto h-full overflow-y-auto custom-scrollbar">

               {activeSubTab === 'SERIES' && (
                  <div className="space-y-6 animate-in slide-in-from-bottom-4">
                     <div className="flex justify-between items-center px-2">
                        <h2 className="text-lg font-bold text-gray-800 uppercase tracking-widest text-xs opacity-50">Secuencias por Tipo</h2>
                        <button
                           onClick={handleAddNewSeries}
                           className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-700 flex items-center gap-2 active:scale-95 transition-all"
                        >
                           <Plus size={20} /> Nueva Serie
                        </button>
                     </div>


                     {/* Group by Document Type */}
                     {documentTypesToRender.map(docType => {
                        const typeSeries = seriesList.filter(s => normalizeDocumentType((s as any).documentType) === docType);

                        // Skip if no series for this type
                        if (typeSeries.length === 0) return null;

                        const config = DOCUMENT_TYPE_CONFIG[docType] || {
                           label: `Tipo ${docType}`,
                           icon: FileText,
                           color: 'slate'
                        };

                        const Icon = config.icon;


                        return (
                           <div key={docType} className="space-y-4">
                              <div className="flex items-center gap-3 px-2">
                                 <div className={`p-2 rounded-lg bg-${config.color}-50 text-${config.color}-600`}>
                                    <Icon size={20} />
                                 </div>
                                 <h3 className="font-bold text-gray-700">{config.label}</h3>
                                 <span className="text-xs text-gray-400">({typeSeries.length} serie{typeSeries.length !== 1 ? 's' : ''})</span>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                 {typeSeries.map((series) => (
                                    <div key={series.id} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-all flex justify-between items-center group">
                                       <div className="flex items-center gap-3">
                                          <div className={`w-10 h-10 bg-${config.color}-50 text-${config.color}-600 rounded-lg flex items-center justify-center font-bold text-xs`}>{series.prefix}</div>
                                          <div>
                                             <h4 className="font-bold text-gray-800 text-sm">{series.name}</h4>
                                             <p className="text-xs text-gray-400">Próximo: <span className="font-mono font-bold text-blue-600">{series.prefix}{series.nextNumber.toString().padStart(series.padding || 1, '0')}</span></p>
                                          </div>
                                       </div>
                                       <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                                          <button
                                             onClick={() => setEditingSeries({ ...series })}
                                             className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                                          >
                                             <Edit2 size={16} />
                                          </button>
                                          <button
                                             onClick={() => handleDeleteSeries(series.id)}
                                             className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg"
                                          >
                                             <Trash2 size={16} />
                                          </button>
                                       </div>
                                    </div>
                                 ))}
                                 {typeSeries.length === 0 && (
                                    <div className="col-span-full py-8 text-center text-gray-400 text-sm italic">No hay series configuradas para este tipo</div>
                                 )}
                              </div>
                           </div>
                        );
                     })}
                  </div>
               )}

               {activeSubTab === 'FISCAL_POOL' && (
                  <div className="space-y-8 animate-in slide-in-from-bottom-4">

                     <section className="bg-white rounded-[2.5rem] border border-gray-200 shadow-sm p-8 space-y-6">
                        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                           <div>
                              <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Modo Fiscal</h3>
                              <p className="text-2xl font-black text-slate-900">Transición Legacy B a e-CF</p>
                              <p className="text-sm text-slate-500 mt-2 max-w-2xl">
                                 Define si esta empresa continúa operando con comprobantes tipo B o si los documentos nuevos deben emitirse como e-CF.
                                 El histórico existente no se altera.
                              </p>
                           </div>
                           <div className="flex gap-3">
                              <button
                                 onClick={handleTestProvider}
                                 disabled={isTestingProvider}
                                 className="px-5 py-3 rounded-2xl border border-slate-200 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                              >
                                 {isTestingProvider ? 'Probando proveedor...' : 'Probar Conexión'}
                              </button>
                              <button
                                 onClick={handleSaveFiscalConfig}
                                 disabled={!businessConfig || isSavingFiscalConfig}
                                 className="px-5 py-3 rounded-2xl bg-slate-900 text-white font-black shadow-lg hover:bg-slate-800 disabled:opacity-60"
                              >
                                 {isSavingFiscalConfig ? 'Guardando...' : 'Guardar Política Fiscal'}
                              </button>
                           </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                           <button
                              onClick={() => updateFiscalCompliance(current => ({ ...current, mode: 'LEGACY_B', defaultProvider: 'NONE' }))}
                              className={`p-6 rounded-[2rem] border-2 transition-all text-left ${fiscalCompliance.mode === 'LEGACY_B' ? 'bg-blue-50 border-blue-500 shadow-md ring-4 ring-blue-50' : 'bg-white border-gray-100 hover:border-blue-200'}`}
                           >
                              <p className="text-xs font-black text-blue-600 uppercase tracking-[0.2em] mb-3">Modo Actual</p>
                              <p className="text-lg font-black text-slate-900 mb-2">Comprobantes Legacy B</p>
                              <p className="text-sm text-slate-500 leading-relaxed">
                                 Mantiene `B01`, `B02` y `B04` para negocios que todavía no han migrado a e-CF.
                              </p>
                           </button>

                           <button
                              onClick={() => updateFiscalCompliance(current => ({
                                 ...current,
                                 mode: 'ECF',
                                 defaultProvider: current.defaultProvider === 'NONE' ? 'POLARIS' : current.defaultProvider
                              }))}
                              className={`p-6 rounded-[2rem] border-2 transition-all text-left ${fiscalCompliance.mode === 'ECF' ? 'bg-emerald-50 border-emerald-500 shadow-md ring-4 ring-emerald-50' : 'bg-white border-gray-100 hover:border-emerald-200'}`}
                           >
                              <p className="text-xs font-black text-emerald-600 uppercase tracking-[0.2em] mb-3">Migración</p>
                              <p className="text-lg font-black text-slate-900 mb-2">Emitir e-CF</p>
                              <p className="text-sm text-slate-500 leading-relaxed">
                                 Los documentos nuevos cambian a `E31`, `E32` y `E34`, manteniendo compatibilidad con el historial ya emitido.
                              </p>
                           </button>
                        </div>

                        {fiscalFeedback && (
                           <div className={`rounded-2xl px-4 py-3 text-sm font-bold ${fiscalFeedback.kind === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                              {fiscalFeedback.message}
                           </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                           <div className="md:col-span-1">
                              <label className="block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Proveedor por Defecto</label>
                              <select
                                 value={fiscalCompliance.defaultProvider}
                                 onChange={(e) => updateFiscalCompliance(current => ({ ...current, defaultProvider: e.target.value as any }))}
                                 className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800"
                              >
                                 {fiscalCompliance.providers.map(provider => (
                                    <option key={provider.id} value={provider.id}>
                                       {provider.displayName} ({provider.id})
                                    </option>
                                 ))}
                              </select>
                           </div>

                           <div className="md:col-span-1">
                              <label className="block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Ambiente del Proveedor</label>
                              <select
                                 value={fiscalCompliance.providers.find(provider => provider.id === fiscalCompliance.defaultProvider)?.environment ?? 0}
                                 onChange={(e) => updateFiscalCompliance(current => ({
                                    ...current,
                                    providers: current.providers.map(provider =>
                                       provider.id === current.defaultProvider
                                          ? { ...provider, environment: Number(e.target.value) as any }
                                          : provider
                                    )
                                 }))}
                                 className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800"
                              >
                                 <option value={0}>Ambiente 0</option>
                                 <option value={1}>Ambiente 1</option>
                                 <option value={2}>Ambiente 2</option>
                                 <option value={3}>Ambiente 3</option>
                              </select>
                           </div>

                           {fiscalCompliance.defaultProvider === 'DIGIFACT' && (
                              <div className="md:col-span-1">
                                 <label className="block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Modo DigiFact</label>
                                 <select
                                    value={selectedFiscalProviderConfig?.deliveryMode || 'LOCAL_DIRECT'}
                                    onChange={(e) => updateSelectedProvider({ deliveryMode: e.target.value as any })}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800"
                                 >
                                    <option value="LOCAL_DIRECT">Token local directo</option>
                                    <option value="DELEGATED_ERP">Delegado al ERP</option>
                                 </select>
                              </div>
                           )}

                           <label className="md:col-span-1 flex items-center gap-3 p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                              <input
                                 type="checkbox"
                                 checked={fiscalCompliance.allowLegacyFallback}
                                 onChange={(e) => updateFiscalCompliance(current => ({ ...current, allowLegacyFallback: e.target.checked }))}
                                 className="w-5 h-5 rounded border-slate-300"
                              />
                              <div>
                                 <p className="text-sm font-black text-slate-900">Permitir fallback a Legacy</p>
                                 <p className="text-xs text-slate-500">Mantiene margen operativo mientras se completa la migración a e-CF.</p>
                              </div>
                           </label>
                        </div>

                        <div className="rounded-[2rem] border border-amber-200 bg-amber-50/70 p-5">
                           <div className="flex items-start justify-between gap-4">
                              <div>
                                 <p className="text-[11px] font-black text-amber-700 uppercase tracking-[0.2em] mb-2">Alertas de reserva fiscal</p>
                                 <h4 className="text-lg font-black text-slate-900">Aviso al cajero por comprobantes bajos</h4>
                                 <p className="mt-1 text-sm font-semibold text-amber-800">
                                    El aviso aparece en ventas cuando el carrito está vacío y se oculta al agregar artículos.
                                 </p>
                              </div>
                              <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600" />
                           </div>

                           <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                              <label>
                                 <span className="block text-[11px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2">Avisar cuando queden</span>
                                 <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={fiscalCompliance.reserveAlert?.quantity ?? 200}
                                    onChange={(e) => updateFiscalCompliance(current => ({
                                       ...current,
                                       reserveAlert: {
                                          ...(current.reserveAlert || {}),
                                          quantity: Math.max(0, Number(e.target.value) || 0)
                                       }
                                    }))}
                                    className="w-full p-4 bg-white border border-amber-200 rounded-2xl font-mono font-black text-slate-800"
                                 />
                                 <p className="mt-2 text-xs font-semibold text-amber-800">Cantidad de comprobantes. Usa 0 para desactivar este criterio.</p>
                              </label>

                              <label>
                                 <span className="block text-[11px] font-black text-slate-500 uppercase tracking-[0.2em] mb-2">O cuando quede menos de (%)</span>
                                 <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={0.1}
                                    value={fiscalCompliance.reserveAlert?.percent ?? 10}
                                    onChange={(e) => updateFiscalCompliance(current => ({
                                       ...current,
                                       reserveAlert: {
                                          ...(current.reserveAlert || {}),
                                          percent: Math.max(0, Math.min(100, Number(e.target.value) || 0))
                                       }
                                    }))}
                                    className="w-full p-4 bg-white border border-amber-200 rounded-2xl font-mono font-black text-slate-800"
                                 />
                                 <p className="mt-2 text-xs font-semibold text-amber-800">Porcentaje del bloque terminal. Usa 0 para desactivar este criterio.</p>
                              </label>
                           </div>
                        </div>

                        {selectedFiscalProviderConfig && fiscalCompliance.defaultProvider !== 'NONE' && (
                           <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                              <div className="md:col-span-4">
                                 <label className="block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Referencia de Credencial</label>
                                 <input
                                    type="text"
                                    value={selectedFiscalProviderConfig.credentialKey || ''}
                                    onChange={(e) => updateSelectedProvider({ credentialKey: e.target.value.toUpperCase() })}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800"
                                    placeholder="Opcional. Si se deja vacío, se usará el RNC de la empresa."
                                 />
                              </div>
                              <div>
                                 <label className="block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Tipo Ingreso</label>
                                 <input
                                    type="number"
                                    min={1}
                                    value={selectedFiscalProviderConfig.tipoIngreso ?? 1}
                                    onChange={(e) => updateSelectedProvider({ tipoIngreso: Number(e.target.value) || 1 })}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800"
                                 />
                              </div>
                              <div>
                                 <label className="block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Unidad Bienes</label>
                                 <input
                                    type="number"
                                    min={1}
                                    value={selectedFiscalProviderConfig.unitCodeGoods ?? 47}
                                    onChange={(e) => updateSelectedProvider({ unitCodeGoods: Number(e.target.value) || 47 })}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800"
                                 />
                              </div>
                              <div>
                                 <label className="block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Unidad Servicios</label>
                                 <input
                                    type="number"
                                    min={1}
                                    value={selectedFiscalProviderConfig.unitCodeServices ?? 43}
                                    onChange={(e) => updateSelectedProvider({ unitCodeServices: Number(e.target.value) || 43 })}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800"
                                 />
                              </div>
                              <div>
                                 <label className="block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Código NC</label>
                                 <input
                                    type="number"
                                    min={1}
                                    value={selectedFiscalProviderConfig.modificationCode ?? 2}
                                    onChange={(e) => updateSelectedProvider({ modificationCode: Number(e.target.value) || 2 })}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800"
                                 />
                              </div>
                              <div className="md:col-span-4 p-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50">
                                 <p className="text-xs font-bold text-slate-600">
                                    Estos defaults técnicos se envían con la venta al proveedor fiscal activo. Más adelante podremos sobrescribirlos por producto si un cliente necesita un catálogo fiscal más fino.
                                 </p>
                              </div>
                              {isDelegatedDigiFactProvider ? (
                                 <div className="md:col-span-4 mt-2 p-5 rounded-[1.75rem] border border-emerald-200 bg-emerald-50 shadow-sm space-y-3">
                                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                                       <div>
                                          <p className="text-[11px] font-black text-emerald-700 uppercase tracking-[0.2em] mb-2">Credencial administrada por ERP</p>
                                          <p className="text-sm font-bold text-emerald-900">
                                             DigiFact se configura en ERP &gt; Integraciones e-CF. El POS no guarda token ni contraseña; solo usa la referencia de credencial y delega la emisión al backend ERP.
                                          </p>
                                       </div>
                                       <div className="px-3 py-2 rounded-2xl bg-white border border-emerald-200 text-emerald-700 text-xs font-black">
                                          Delegado al ERP
                                       </div>
                                    </div>
                                    <p className="text-xs font-bold text-emerald-800">
                                       Referencia activa: <span className="font-mono">{selectedFiscalProviderConfig.credentialKey || businessConfig?.companyInfo?.rnc || 'N/D'}</span>
                                    </p>
                                 </div>
                              ) : (
                                 <div className="md:col-span-4 mt-2 p-5 rounded-[1.75rem] border border-slate-200 bg-white shadow-sm space-y-4">
                                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                                       <div>
                                          <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Credenciales del Proveedor</p>
                                          <p className="text-sm font-bold text-slate-700">
                                             La precedencia activa es <span className="font-mono">SQLite -&gt; Supabase -&gt; ENV</span>. El token nunca vuelve al navegador una vez guardado.
                                          </p>
                                       </div>
                                       {credentialMeta?.hasCredential ? (
                                          <div className="px-3 py-2 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-black">
                                             Activa desde {credentialMeta.source || 'desconocido'}
                                          </div>
                                       ) : (
                                          <div className="px-3 py-2 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 text-xs font-black">
                                             Sin credencial resuelta
                                          </div>
                                       )}
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                       {(['sqlite', 'supabase', 'env'] as const).map(source => {
                                          const isAvailable = credentialMeta?.availableSources?.includes(source);
                                          return (
                                             <span
                                                key={source}
                                                className={`px-3 py-2 rounded-2xl text-[11px] font-black border ${isAvailable ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 text-slate-400 border-slate-200'}`}
                                             >
                                                {FISCAL_CREDENTIAL_SOURCE_LABELS[source]}
                                             </span>
                                          );
                                       })}
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                       <div>
                                          <label className="block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Etiqueta</label>
                                          <input
                                             type="text"
                                             value={credentialLabel}
                                             onChange={(e) => setCredentialLabel(e.target.value)}
                                             className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800"
                                             placeholder="Ej. Proveedor demo Naco"
                                          />
                                       </div>
                                       <div>
                                          <label className="block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Authentication Token</label>
                                          <div className="relative">
                                             <input
                                                type={showCredentialDraft ? 'text' : 'password'}
                                                value={credentialDraft}
                                                onChange={(e) => setCredentialDraft(e.target.value)}
                                                disabled={hasLockedLocalCredential || isSavingCredential}
                                                className={`w-full p-4 pr-14 rounded-2xl font-bold border transition-colors ${
                                                   hasLockedLocalCredential
                                                      ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                                      : 'bg-slate-50 border-slate-200 text-slate-800'
                                                }`}
                                                placeholder={hasLockedLocalCredential ? 'Credencial local activa. Usa Eliminar Local para reemplazarla.' : 'Pega aquí el token del proveedor'}
                                             />
                                             <button
                                                type="button"
                                                disabled={hasLockedLocalCredential}
                                                onClick={() => setShowCredentialDraft((prev) => !prev)}
                                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                aria-label={showCredentialDraft ? 'Ocultar token' : 'Mostrar token'}
                                             >
                                                {showCredentialDraft ? <EyeOff size={18} /> : <Eye size={18} />}
                                             </button>
                                          </div>
                                          {hasLockedLocalCredential && (
                                             <p className="mt-2 text-xs font-bold text-slate-500">
                                                La credencial ya está guardada en SQLite. Usa <span className="font-black">Eliminar Local</span> para ingresar un nuevo token.
                                             </p>
                                          )}
                                       </div>
                                    </div>

                                    {credentialMeta?.supportsSupabaseWrite === false && (
                                       <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-700">
                                          El backend todavía no tiene `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, así que por ahora solo se puede guardar localmente.
                                       </div>
                                    )}

                                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                                       <div className="text-xs text-slate-500 space-y-1">
                                          <p>Clave resuelta: {credentialMeta?.resolvedCredentialKey || selectedFiscalProviderConfig.credentialKey || businessConfig?.companyInfo?.rnc || 'N/D'}</p>
                                          <p>Fuentes detectadas: {credentialMeta?.availableSources?.length ? credentialMeta.availableSources.map(source => FISCAL_CREDENTIAL_SOURCE_LABELS[source]).join(', ') : 'Ninguna'}</p>
                                          <p>Última actualización local: {credentialMeta?.updatedAt ? new Date(credentialMeta.updatedAt).toLocaleString() : 'No registrada localmente'}</p>
                                       </div>
                                       <div className="flex flex-wrap gap-3">
                                          <button
                                             onClick={handleSaveCredential}
                                             disabled={isSavingCredential || hasLockedLocalCredential}
                                             className="px-5 py-3 rounded-2xl bg-emerald-600 text-white font-black shadow-lg hover:bg-emerald-700 disabled:opacity-60"
                                          >
                                             {isSavingCredential ? 'Guardando local...' : hasLockedLocalCredential ? 'Guardado en SQLite' : 'Guardar Local'}
                                          </button>
                                          <button
                                             onClick={handleSaveSupabaseCredential}
                                             disabled={isSavingSupabaseCredential || !credentialMeta?.supportsSupabaseWrite}
                                             className="px-5 py-3 rounded-2xl bg-slate-900 text-white font-black shadow-lg hover:bg-slate-800 disabled:opacity-60"
                                          >
                                             {isSavingSupabaseCredential ? 'Guardando en Supabase...' : 'Guardar en Supabase'}
                                          </button>
                                          <button
                                             onClick={handleDeleteLocalCredential}
                                             disabled={isDeletingLocalCredential || !credentialMeta?.hasLocalCredential}
                                             className="px-5 py-3 rounded-2xl border border-slate-200 font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                                          >
                                             {isDeletingLocalCredential ? 'Eliminando local...' : 'Eliminar Local'}
                                          </button>
                                          <button
                                             onClick={handleDeleteSupabaseCredential}
                                             disabled={isDeletingSupabaseCredential || !credentialMeta?.hasSupabaseCredential}
                                             className="px-5 py-3 rounded-2xl border border-slate-200 font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                                          >
                                             {isDeletingSupabaseCredential ? 'Eliminando Supabase...' : 'Eliminar Supabase'}
                                          </button>
                                       </div>
                                    </div>
                                 </div>
                              )}
                           </div>
                        )}

                     </section>

                     {/* CONSUMPTION DASHBOARD */}
                     <section className="bg-slate-900 rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -mr-10 -mt-10"></div>
                        <div className="relative z-10">
                           <div className="flex justify-between items-end mb-8">
                              <div>
                                 <h3 className="text-xs font-black text-indigo-400 uppercase tracking-[0.2em] mb-2">Auditoría de Consumo Acumulado</h3>
                                 <p className="text-2xl font-black">NCF Consumidos por Tipo</p>
                              </div>
                              <div className="p-3 bg-white/5 rounded-2xl border border-white/10">
                                 <BarChart3 size={24} className="text-indigo-400" />
                              </div>
                           </div>

                           <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                              {SUPPORTED_FISCAL_CODES.map(type => {
                                 const allocationDetails = allocationStatsByType.get(type);
                                 const consumed = fiscalConsumption[type] || 0;
                                 const range = fiscalRanges.find(r => r.type === type);
                                 const totalAuthorized = allocationDetails
                                    ? (allocationDetails.allocation.reservedEnd - allocationDetails.allocation.reservedStart + 1)
                                    : range ? (range.endNumber - range.startNumber + 1) : 0;
                                 const color = type === 'B01' || type === 'E31'
                                    ? 'text-blue-400'
                                    : type === 'B02' || type === 'E32'
                                       ? 'text-emerald-400'
                                       : 'text-purple-400';

                                 const progressPct = totalAuthorized > 0 ? (consumed / totalAuthorized) * 100 : 0;

                                 return (
                                    <div key={type} className="bg-white/5 p-5 rounded-3xl border border-white/5 hover:bg-white/10 transition-colors">
                                       <div className="flex justify-between items-start mb-3">
                                          <span className={`font-black text-sm ${color}`}>{type}</span>
                                          <Activity size={14} className="opacity-30" />
                                       </div>
                                       <p className="text-3xl font-mono font-black leading-none mb-1">{consumed.toLocaleString()}</p>
                                       <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">
                                          {allocationDetails ? 'Consumidos del Bloque' : 'Emitidos Totales'}
                                       </p>
                                       {allocationDetails && (
                                          <div className="mt-3 space-y-1 text-[10px] font-bold text-slate-300">
                                             <p>Bloque {allocationDetails.allocation.reservedStart.toLocaleString()} - {allocationDetails.allocation.reservedEnd.toLocaleString()}</p>
                                             <p>Próximo {allocationDetails.currentNumber <= allocationDetails.allocation.reservedEnd ? allocationDetails.currentNumber.toLocaleString() : 'Agotado'}</p>
                                          </div>
                                       )}
                                       {totalAuthorized > 0 && (
                                          <div className="mt-4">
                                             <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                                                <div
                                                   className={`h-full ${color.replace('text-', 'bg-')}`}
                                                   style={{ width: `${Math.min(progressPct, 100)}%` }}
                                                ></div>
                                             </div>
                                             <p className="text-[9px] text-slate-400 mt-1 font-bold">
                                                {progressPct.toFixed(1)}% {allocationDetails ? 'del bloque terminal' : 'del pool'}
                                             </p>
                                          </div>
                                       )}
                                    </div>
                                 )
                              })}
                           </div>
                        </div>
                     </section>

                     <div className="flex justify-between items-center px-2">
                        <div>
                           <h2 className="text-xl font-bold text-gray-800">Autorizaciones DGII Vigentes</h2>
                           <p className="text-sm text-gray-500">Administra los rangos aprobados en tu oficina virtual.</p>
                        </div>
                        <button onClick={() => setIsAddingRange(true)} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 flex items-center gap-2 active:scale-95 transition-all">
                           <Plus size={20} /> Cargar Nuevo Rango
                        </button>
                     </div>

                     <div className="grid grid-cols-1 gap-4 pb-20">
                        {fiscalRanges.map(range => {
                           const allocationDetails = allocationStatsByType.get(range.type);
                           const rawUsedInCajas = Math.max(0, range.currentGlobal - (range.startNumber - 1));
                           const totalAutorizado = Math.max(0, range.endNumber - range.startNumber + 1);
                           const usedInCajas = totalAutorizado > 0 ? Math.min(rawUsedInCajas, totalAutorizado) : 0;
                           const progress = totalAutorizado > 0 ? Math.min((usedInCajas / totalAutorizado) * 100, 100) : 0;
                           const disponiblesEnServidor = Math.max(0, totalAutorizado - usedInCajas);
                           const canDeleteRange = rawUsedInCajas === 0;
                           const terminalTotal = allocationDetails
                              ? Math.max(0, allocationDetails.allocation.reservedEnd - allocationDetails.allocation.reservedStart + 1)
                              : 0;
                           const terminalReserveAlert = allocationDetails
                              ? getFiscalReserveAlert(allocationDetails.remaining, terminalTotal, fiscalCompliance)
                              : null;

                           return (
                              <div key={range.id} className={`bg-white p-6 rounded-3xl border-2 transition-all ${range.isActive ? 'border-gray-100 shadow-sm' : 'border-dashed border-gray-200 opacity-60'}`}>
                                 <div className="flex flex-col md:flex-row justify-between gap-6 mb-6">
                                    <div className="flex items-center gap-4">
                                       <div className={`p-4 rounded-2xl ${range.isActive ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>
                                          <Landmark size={28} />
                                       </div>
                                          <div>
                                             <div className="flex items-center gap-2">
                                                 <span className="px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-black rounded uppercase">{range.type}</span>
                                                {allocationDetails && (
                                                   <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-black rounded uppercase">Bloque Terminal</span>
                                                )}
                                                 <h3 className="font-black text-gray-800 text-lg">{range.prefix}-XXXXXXX</h3>
                                              </div>
                                          <p className="text-xs text-gray-400 flex items-center gap-1 mt-1"><Calendar size={12} /> Vence: {new Date(range.expiryDate).toLocaleDateString()}</p>
                                       </div>
                                    </div>

                                    <div className="flex-1 md:max-w-md">
                                       <div className="flex justify-between text-xs font-bold text-gray-500 uppercase mb-2">
                                          <span>Distribución a Terminales</span>
                                          <span className="text-indigo-600">{usedInCajas.toLocaleString()} / {totalAutorizado.toLocaleString()}</span>
                                       </div>
                                       <div className="h-3 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
                                          <div className="h-full bg-indigo-600 transition-all duration-1000" style={{ width: `${progress}%` }}></div>
                                       </div>
                                    </div>

                                    <div className="flex items-center gap-3">
                                       <button
                                          onClick={() => handleToggleRange(range.id)}
                                          className={`w-12 h-6 rounded-full relative transition-colors ${range.isActive ? 'bg-green-500' : 'bg-gray-300'}`}
                                       >
                                          <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${range.isActive ? 'left-7' : 'left-1'}`} />
                                       </button>
                                       <button
                                          onClick={() => handleDeleteRange(range.id)}
                                          disabled={!canDeleteRange}
                                          title={canDeleteRange ? 'Eliminar autorización' : 'No se puede eliminar un rango con comprobantes consumidos'}
                                          className={`p-2 transition-colors ${canDeleteRange ? 'text-gray-400 hover:text-red-500' : 'text-gray-200 cursor-not-allowed'}`}
                                       >
                                          <Trash2 size={20} />
                                       </button>
                                    </div>
                                 </div>

                                 <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-100">
                                    <div><p className="text-[10px] text-gray-400 uppercase font-bold">Rango Inicio</p><p className="font-mono font-bold text-gray-700">{range.startNumber}</p></div>
                                    <div><p className="text-[10px] text-gray-400 uppercase font-bold">Rango Fin</p><p className="font-mono font-bold text-gray-700">{range.endNumber}</p></div>
                                    <div>
                                       <p className="text-[10px] text-gray-400 uppercase font-bold">Reserva Restante Pool</p>
                                       <p className={`font-black ${disponiblesEnServidor < (totalAutorizado * 0.1) ? 'text-red-600' : 'text-emerald-600'}`}>
                                          {disponiblesEnServidor.toLocaleString()}
                                       </p>
                                    </div>
                                    <div className="text-right">
                                       <button
                                          onClick={() => setFiscalRangeDetail(range)}
                                          className="text-[10px] font-black text-blue-600 uppercase hover:underline flex items-center gap-1 justify-end"
                                       >
                                          Ver Detalle de Cajas <ChevronRight size={10} />
                                       </button>
                                    </div>
                                 </div>

                                 {allocationDetails && (
                                    <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                                       <div>
                                          <p className="text-[10px] text-emerald-700 uppercase font-bold">Bloque Terminal</p>
                                          <p className="font-mono font-bold text-emerald-900">
                                             {allocationDetails.allocation.reservedStart.toLocaleString()} - {allocationDetails.allocation.reservedEnd.toLocaleString()}
                                          </p>
                                       </div>
                                       <div>
                                          <p className="text-[10px] text-emerald-700 uppercase font-bold">Próximo</p>
                                          <p className="font-mono font-bold text-emerald-900">
                                             {allocationDetails.currentNumber <= allocationDetails.allocation.reservedEnd
                                                ? `${range.prefix}${allocationDetails.currentNumber.toString().padStart(8, '0')}`
                                                : 'Agotado'}
                                          </p>
                                       </div>
                                       <div>
                                          <p className="text-[10px] text-emerald-700 uppercase font-bold">Consumidos Terminal</p>
                                          <p className="font-black text-emerald-900">{allocationDetails.consumed.toLocaleString()}</p>
                                       </div>
                                       <div>
                                          <p className="text-[10px] text-emerald-700 uppercase font-bold">Restantes Terminal</p>
                                          <p className="font-black text-emerald-900">{allocationDetails.remaining.toLocaleString()}</p>
                                       </div>
                                    </div>
                                 )}

                                 {terminalReserveAlert && (
                                    <div className={`mt-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-bold ${
                                       terminalReserveAlert.tone === 'critical'
                                          ? 'border-rose-200 bg-rose-50 text-rose-700'
                                          : 'border-amber-200 bg-amber-50 text-amber-800'
                                    }`}>
                                       <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                                       <span>{terminalReserveAlert.message}</span>
                                    </div>
                                 )}
                              </div>
                           );
                        })}
                     </div>
                  </div>
               )}

            </div>
         </div>

         {/* MODAL DETALLE DE RESERVAS FISCALES */}
         {fiscalRangeDetail && (
            <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
               <div className="bg-white rounded-[2.5rem] w-full max-w-5xl shadow-2xl overflow-hidden animate-in zoom-in-95">
                  <div className="p-6 border-b bg-gray-50 flex justify-between items-start gap-4">
                     <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">Detalle de cajas</p>
                        <h3 className="mt-1 text-2xl font-black text-gray-800">
                           {fiscalRangeDetail.type} · {fiscalRangeDetail.prefix}-XXXXXXX
                        </h3>
                        <p className="mt-1 text-sm font-semibold text-gray-500">
                           Rango base {fiscalRangeDetail.startNumber.toLocaleString()} - {fiscalRangeDetail.endNumber.toLocaleString()} · Vence {new Date(fiscalRangeDetail.expiryDate).toLocaleDateString()}
                        </p>
                     </div>
                     <button onClick={() => setFiscalRangeDetail(null)} className="p-2 hover:bg-gray-200 rounded-full"><X size={20} /></button>
                  </div>

                  <div className="max-h-[70vh] overflow-auto p-6">
                     {fiscalRangeDetailRows.length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
                           <p className="text-lg font-black text-gray-700">No hay reservas terminales para este tipo.</p>
                           <p className="mt-2 text-sm font-semibold text-gray-500">
                              Las reservas se crean desde ERP en Terminales &gt; Lotes Fiscales &gt; Reservar bloque por tipo.
                           </p>
                        </div>
                     ) : (
                        <div className="space-y-3">
                           {fiscalRangeDetailRows.map(({ allocation, nextLabel, total, consumed, remaining, alert }) => (
                              <div key={allocation.id} className="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
                                 <div className="grid gap-4 md:grid-cols-6">
                                    <div>
                                       <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Terminal</p>
                                       <p className="mt-1 font-black text-gray-800">{allocation.terminalId || 'Esta caja'}</p>
                                    </div>
                                    <div>
                                       <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Bloque</p>
                                       <p className="mt-1 font-mono font-black text-gray-800">
                                          {allocation.reservedStart.toLocaleString()} - {allocation.reservedEnd.toLocaleString()}
                                       </p>
                                    </div>
                                    <div>
                                       <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Próximo</p>
                                       <p className="mt-1 font-mono font-black text-emerald-700">{nextLabel}</p>
                                    </div>
                                    <div>
                                       <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Consumidos</p>
                                       <p className="mt-1 font-black text-gray-800">{consumed.toLocaleString()} / {total.toLocaleString()}</p>
                                    </div>
                                    <div>
                                       <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Restantes</p>
                                       <p className={`mt-1 font-black ${alert ? 'text-amber-600' : 'text-emerald-700'}`}>
                                          {remaining.toLocaleString()}
                                       </p>
                                    </div>
                                    <div>
                                       <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Estado</p>
                                       <p className="mt-1 font-black text-gray-800">{allocation.status}</p>
                                    </div>
                                 </div>

                                 {alert && (
                                    <div className={`mt-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-bold ${
                                       alert.tone === 'critical'
                                          ? 'border-rose-200 bg-rose-50 text-rose-700'
                                          : 'border-amber-200 bg-amber-50 text-amber-800'
                                    }`}>
                                       <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                                       <span>{alert.message}</span>
                                    </div>
                                 )}
                              </div>
                           ))}
                        </div>
                     )}
                  </div>
               </div>
            </div>
         )}

         {/* MODAL EDITAR/NUEVA SERIE INTERNA */}
         {editingSeries && (
            <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
               <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95">
                  <div className="p-6 border-b bg-gray-50 flex justify-between items-center">
                     <h3 className="text-xl font-black text-gray-800">{seriesList.some(s => s.id === editingSeries.id) ? 'Editar Secuencia' : 'Nueva Secuencia'}</h3>
                     <button onClick={() => setEditingSeries(null)} className="p-2 hover:bg-gray-200 rounded-full"><X size={20} /></button>
                  </div>
                  <div className="p-8 space-y-6">
                     <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Tipo de Documento</label>
                        <select
                           value={editingSeries.documentType}
                           onChange={e => setEditingSeries({ ...editingSeries, documentType: e.target.value as any })}
                           className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold"
                        >
                           <optgroup label="Ventas">
                              <option value="TICKET">Ticket de Venta</option>
                              <option value="REFUND">Devolución / Abono</option>
                              <option value="VOID">Anulación</option>
                           </optgroup>
                           <optgroup label="Inventario">
                              <option value="TRANSFER">Traspaso entre Almacenes</option>
                              <option value="ADJUSTMENT_IN">Ajuste Positivo</option>
                              <option value="ADJUSTMENT_OUT">Ajuste Negativo</option>
                              <option value="PURCHASE">Compra a Proveedor</option>
                              <option value="PRODUCTION">Producción/Ensamblaje</option>
                           </optgroup>
                           <optgroup label="Efectivo">
                              <option value="CASH_IN">Entrada de Efectivo</option>
                              <option value="CASH_OUT">Salida de Efectivo</option>
                              <option value="CASH_DEPOSIT">Depósito Bancario</option>
                              <option value="CASH_WITHDRAWAL">Retiro de Caja</option>
                           </optgroup>
                           <optgroup label="Cierres">
                              <option value="Z_REPORT">Cierre de Caja (Z)</option>
                              <option value="X_REPORT">Corte Parcial (X)</option>
                           </optgroup>
                           <optgroup label="Cuentas">
                              <option value="RECEIVABLE">Cuenta por Cobrar</option>
                              <option value="PAYABLE">Cuenta por Pagar</option>
                              <option value="PAYMENT_IN">Cobro Recibido</option>
                              <option value="PAYMENT_OUT">Pago Realizado</option>
                           </optgroup>
                        </select>
                     </div>
                     <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Nombre de la Serie</label>
                        <input
                           type="text"
                           value={editingSeries.name}
                           onChange={e => setEditingSeries({ ...editingSeries, name: e.target.value })}
                           placeholder="Ej. Ticket Caja 1"
                           className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold"
                        />
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Prefijo</label>
                           <input
                              type="text"
                              value={editingSeries.prefix}
                              onChange={e => setEditingSeries({ ...editingSeries, prefix: e.target.value.toUpperCase() })}
                              placeholder="Ej. TCK01"
                              className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-mono font-bold"
                           />
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Próximo Número</label>
                           <input
                              type="number"
                              value={editingSeries.nextNumber}
                              onChange={e => setEditingSeries({ ...editingSeries, nextNumber: parseInt(e.target.value) || 1 })}
                              className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-mono font-bold text-blue-600"
                           />
                        </div>
                     </div>
                     <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Unidad de Negocio (Opcional)</label>
                        <input
                           type="text"
                           value={editingSeries.businessUnit || ''}
                           onChange={e => setEditingSeries({ ...editingSeries, businessUnit: e.target.value })}
                           placeholder="Ej. Tienda Norte, Caja Express"
                           className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold"
                        />
                     </div>
                     <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Relleno de ceros (Padding)</label>
                        <select
                           value={editingSeries.padding}
                           onChange={e => setEditingSeries({ ...editingSeries, padding: parseInt(e.target.value) })}
                           className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold"
                        >
                           <option value={0}>Sin ceros</option>
                           <option value={4}>4 dígitos (0001)</option>
                           <option value={6}>6 dígitos (000001)</option>
                           <option value={8}>8 dígitos (00000001)</option>
                        </select>
                     </div>
                  </div>
                  <div className="p-6 bg-gray-50 border-t flex gap-3">
                     <button onClick={() => setEditingSeries(null)} className="flex-1 py-3 text-gray-500 font-bold">Cancelar</button>
                     <button onClick={handleSaveInternalSeries} className="flex-[2] py-3 bg-blue-600 text-white rounded-xl font-black shadow-lg">Confirmar Serie</button>
                  </div>
               </div>
            </div>
         )}

         {/* MODAL AGREGAR RANGO FISCAL */}
         {isAddingRange && (
            <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
               <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95">
                  <div className="p-6 border-b bg-gray-50 flex justify-between items-center">
                     <h3 className="text-xl font-black text-gray-800">Cargar Autorización DGII</h3>
                     <button onClick={() => setIsAddingRange(false)} className="p-2 hover:bg-gray-200 rounded-full"><X size={20} /></button>
                  </div>
                  <div className="p-8 space-y-6">
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Tipo Comprobante</label>
                           <select
                              value={newRange.type}
                              onChange={(e) => setNewRange({ ...newRange, type: e.target.value as any, prefix: e.target.value })}
                              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold"
                           >
                              {SUPPORTED_FISCAL_CODES.map(type => (
                                 <option key={type} value={type}>{FISCAL_DOCUMENT_LABELS[type]} ({type})</option>
                              ))}
                           </select>
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Prefijo</label>
                           <input type="text" value={newRange.prefix} disabled className="w-full p-3 bg-gray-100 border border-gray-200 rounded-xl font-mono text-gray-500" />
                        </div>
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Del número (Inicio)</label>
                           <input type="number" value={newRange.startNumber} onChange={e => setNewRange({ ...newRange, startNumber: parseInt(e.target.value) })} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono font-bold" />
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Al número (Fin)</label>
                           <input type="number" value={newRange.endNumber} onChange={e => setNewRange({ ...newRange, endNumber: parseInt(e.target.value) })} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono font-bold" />
                        </div>
                     </div>
                     <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Vencimiento</label>
                        <input type="date" value={newRange.expiryDate} onChange={e => setNewRange({ ...newRange, expiryDate: e.target.value })} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold" />
                     </div>
                  </div>
                  <div className="p-6 bg-gray-50 border-t flex gap-3">
                      <button onClick={() => setIsAddingRange(false)} className="flex-1 py-3 text-gray-500 font-bold">Cancelar</button>
                     <button
                        onClick={handleSaveRange}
                        disabled={isSavingRange}
                        className={`flex-[2] py-3 rounded-xl font-black shadow-lg transition-all ${isSavingRange ? 'bg-indigo-300 text-white cursor-wait' : 'bg-indigo-600 text-white'}`}
                     >
                        {isSavingRange ? 'Guardando...' : 'Guardar Autorización'}
                     </button>
                  </div>
               </div>
            </div>
         )}

      </div>
   );
};

export default DocumentSettings;
