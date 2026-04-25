
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { Layout } from 'lucide-react';
import {
  User,
  RoleDefinition,
  BusinessConfig,
  Transaction,
  Customer,
  Product,
  CashMovement,
  PurchaseOrder,
  Supplier,
  PurchaseOrderItem,
  CartItem,
  ViewState,
  Tariff,
  Warehouse,
  ParkedTicket,
  StockTransfer,
  ZReport,
  DeviceRole,
  Reception,
  ProductStock,
  InventoryCountSession,
  LedgerConcept,
  DocumentSeries,
  Room,
  Table,
  Collection,
  PaymentEntry,
  RefundProcessingOptions,
  PaymentMethodDefinition
} from './types';
import {
  DEFAULT_ROLES,
  DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS,
  DEFAULT_LABEL_TEMPLATES,
  FOOD_PRODUCTS,
  RETAIL_PRODUCTS,
  getInitialConfig
} from './constants';
import { parseScaleBarcode } from './utils/barcodeParser';
import { useKioskMode } from './hooks/useKioskMode';
import { useBarcodeScanner } from './hooks/useBarcodeScanner';
import { db } from './utils/db'; // Import Local DB
import { dbAdapter } from './services/db'; // Import Adapter for Healthcheck
import { syncManager } from './services/sync/SyncManager';
import { apiSyncAdapter } from './services/sync/ApiSyncAdapter';
import { backgroundSyncManager } from './services/sync/BackgroundSyncManager';
import { productImageCacheService } from './services/sync/ProductImageCacheService';
import { calculateZReportStats } from './utils/analytics';
import { applyPromotions, hasProductPromotion } from './utils/promotionEngine';
import { calculateTransactionTaxSummary } from './utils/taxSummary';
import { calculateTransactionFiscalSummary } from './utils/fiscalBreakdown';
import { extractTerminalOperationalDocumentState } from './utils/terminalConfigSnapshot';
import { resolveDocumentAssignmentId } from './utils/documentSeriesIdentity';
import { ZReportRecoveryService } from './services/recovery/ZReportRecoveryService';

// Component Imports
import ModernLoginScreen from './components/ModernLoginScreen';
import LoginScreen from './components/LoginScreen';
import ErrorBoundary from './components/ErrorBoundary';
import POSInterface from './components/POSInterface';
import AgendaManager from './components/AgendaManager';
import Settings from './components/Settings';
import CustomerManagement from './components/CustomerManagement';
import TicketHistory from './components/TicketHistory';
import FinanceDashboard from './components/FinanceDashboard';
import ZReportDashboard from './components/ZReportDashboard';
import SupplyChainManager from './components/SupplyChainManager';
import VerticalSelector from './components/VerticalSelector';
import SetupWizard from './components/SetupWizard';
import ActivationScreen from './components/ActivationScreen';
import FranchiseDashboard from './components/FranchiseDashboard';
import TerminalModeSelector from './components/TerminalModeSelector';
import TerminalBindingScreen from './components/TerminalBindingScreen';
import CustomerVisor from './components/CustomerVisor';
import { visorSync } from './utils/visorSync';

// Layout imports
import StandardPOSLayout from './components/layouts/StandardPOSLayout';
import SelfCheckoutLayout from './components/layouts/SelfCheckoutLayout';
import PriceCheckerLayout from './components/layouts/PriceCheckerLayout';
import HandheldLayout from './components/layouts/HandheldLayout';
import KitchenDisplayLayout from './components/layouts/KitchenDisplayLayout';
import TableMap from './components/TableMap';
import TableLayoutDesigner from './components/TableLayoutDesigner';

// View imports for device roles
import KioskWelcome from './components/kiosk/KioskWelcome';
import KioskProductBrowser from './components/kiosk/KioskProductBrowser';
import KioskPayment, { KioskResolvedPaymentMethod } from './components/kiosk/KioskPayment';
import { KioskSecurityProvider, useKioskSecurityContext } from './components/kiosk/KioskContext';
import PriceCheckerDisplay from './components/price-checker/PriceCheckerDisplay';
import InventoryHome from './components/inventory/InventoryHome';
import InventoryCount from './components/inventory/InventoryCount';
import MobileReception from './components/inventory/MobileReception';
import InventoryLabelsMobile from './components/inventory/InventoryLabelsMobile';
import InventoryTracking from './components/InventoryTracking';
import KitchenDisplay from './components/kds/KitchenDisplay';
import InventoryAuditClosure from './components/inventory/InventoryAuditClosure';


import { seriesSyncService } from './services/sync/SeriesSyncService';
import { permissionService } from './services/sync/PermissionService';
import { terminalRouter } from './services/routing/TerminalRouter';
import { authLevelService } from './services/auth/AuthLevelService';
import { transactionService } from './services/transactionService';
import './styles/high-contrast.css';
import { ThemeProvider } from './components/ThemeContext';
import { transactionSyncService } from './services/sync/TransactionSyncService';
import { inventorySyncService } from './services/sync/InventorySyncService';
import { processInventoryDeduction } from './utils/inventoryEngine';
import { useOfflineInventoryCountSync } from './hooks/useOfflineInventoryCountSync';
import { printLabelsFromTemplate } from './utils/labelPrinter';
import { printIntegratedPaymentArtifacts, printPrecuenta, printTicket } from './utils/printer';
import { offlinePrintQueueService } from './services/printer/OfflinePrintQueueService';
import { nativePrintBridge } from './services/printer/NativePrintBridge';
import { persistStandaloneRefundTransaction } from './services/localRefundPersistence';
import { checkLicenseStatus, clearTenantIdentity, resolveTenantId } from './utils/licenseGuard';
import {
  buildMasterUrlCandidates,
  buildMasterUrlFromHost,
  getStoredTenantIdentity,
  publishMasterEndpointToCloud,
  resolveMasterEndpointFromCloud
} from './utils/cloudMasterRegistry';
import {
  clearStoredErpSyncBinding,
  ensureErpSyncLifecycle,
  getLifecycleActivationBlockMessage,
  getLifecycleBlockingMessageFromError,
  isLifecycleActivationBlocked,
  persistStoredErpSyncBinding
} from './utils/erpSyncLifecycle';
import { clearPersistedSupabaseSession, supabase } from './utils/supabase';
import { resolveCustomerImageSrc } from './utils/entityImage';
import { posCatalogDebugElapsedMs, posCatalogDebugLog, posCatalogDebugLogDbRows, posCatalogDebugMatchesRaw, posCatalogDebugNow, posCatalogDebugSummarizeItem } from './utils/posCatalogDebugTrace';
import { buildTerminalConfigRefreshRequest, type TerminalConfigSyncRequestDetail } from './utils/terminalConfigPushScopes';
import {
  canRetryFiscalTransaction,
  getFiscalComplianceConfig,
  getFiscalProviderConfig,
  getProviderEnvironment,
  getDefaultFiscalProvider,
  resolveCreditNoteFiscalCode
} from './utils/fiscal/fiscalHelpers';
import { getFiscalDocumentStatus, issueFiscalDocument } from './services/fiscal/fiscalService';
import { azulMcmService } from './services/payments/AzulMcmService';

type ReceivableRepairSummary = {
  scannedTransactions: number;
  scannedWalletMovements: number;
  repairedTransactions: number;
  repairedCreditNotes: number;
  recalculatedCustomers: number;
  customersWithDebtChanges: number;
  totalPendingBefore: number;
  totalPendingAfter: number;
  transactionIds: string[];
  creditNoteIds: string[];
};

const LICENSE_REFRESH_BASE_MS = 60_000;
const TIMER_JITTER_MIN_MS = 3_000;
const TIMER_JITTER_MAX_MS = 5_000;

const getTimerJitterMs = (): number => (
  TIMER_JITTER_MIN_MS + Math.floor(Math.random() * (TIMER_JITTER_MAX_MS - TIMER_JITTER_MIN_MS + 1))
);

const resolveSetupTenantId = (): string => {
  const candidates = [
    localStorage.getItem('active_tenant_id'),
    localStorage.getItem('clic_tenant_id'),
  ];

  return candidates.map((value) => (value || '').trim()).find(Boolean) || 'default-tenant';
};

const normalizeSetupBaseUrl = (value?: string | null): string | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `${window.location.protocol}//${raw}`;

  try {
    const url = new URL(withProtocol);
    return url
      .toString()
      .replace(/\/api\/sync\/?$/i, '')
      .replace(/\/api\/?$/i, '')
      .replace(/\/+$/, '');
  } catch {
    return null;
  }
};

const resolveSetupErpBaseUrl = (): string | null => {
  const env = (import.meta as any).env || {};
  const candidates = [
    localStorage.getItem('CLIC_ERP_BASE_URL'),
    localStorage.getItem('erp_base_url'),
    env.VITE_ERP_BASE_URL,
    env.VITE_ERP_SYNC_API_URL,
    env.VITE_SYNC_API_URL,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeSetupBaseUrl(candidate);
    if (normalized) return normalized;
  }

  return null;
};

const persistSetupErpBaseUrls = (value?: string | null) => {
  const normalized = normalizeSetupBaseUrl(value);
  if (!normalized) return;

  localStorage.setItem('CLIC_ERP_BASE_URL', normalized);
  localStorage.setItem('erp_base_url', normalized);
  localStorage.setItem('CLIC_ERP_SYNC_URL', `${normalized}/api/sync`);
};

const resolveFriendlyTerminalName = (terminal: any): string => {
  const candidates = [
    terminal?.config?.terminalName,
    terminal?.config?.erpBinding?.terminalName,
    terminal?.name,
    terminal?.config?.stationNumber,
    terminal?.config?.erpBinding?.stationNumber,
    terminal?.config?.erpTerminalId,
    terminal?.id,
  ];

  return candidates
    .map((value) => String(value || '').trim())
    .find(Boolean) || 'Terminal';
};

const resolvePreferredTerminalForDevice = (
  terminals: any[],
  deviceId: string,
  options?: {
    activeTerminalId?: string | null;
    bindingTerminalId?: string | null;
    bindingLocalTerminalId?: string | null;
  }
) => {
  const candidates = terminals.filter((terminal) => terminal?.config?.currentDeviceId === deviceId);
  if (candidates.length === 0) return null;

  const activeTerminalId = String(options?.activeTerminalId || '').trim();
  const bindingTerminalId = String(options?.bindingTerminalId || '').trim();
  const bindingLocalTerminalId = String(options?.bindingLocalTerminalId || '').trim();

  const scoreTerminal = (terminal: any) => {
    let score = 0;
    const localId = String(terminal?.id || '').trim();
    const erpTerminalId = String(terminal?.config?.erpTerminalId || '').trim();
    const terminalName = String(terminal?.config?.terminalName || '').trim();
    const stationNumber = String(terminal?.config?.stationNumber || '').trim();

    if (activeTerminalId && (localId === activeTerminalId || erpTerminalId === activeTerminalId)) score += 100;
    if (bindingLocalTerminalId && localId === bindingLocalTerminalId) score += 80;
    if (bindingTerminalId && erpTerminalId === bindingTerminalId) score += 70;
    if (terminalName) score += 20;
    if (stationNumber) score += 10;
    if (erpTerminalId) score += 8;

    return score;
  };

  return [...candidates].sort((left, right) => scoreTerminal(right) - scoreTerminal(left))[0] || candidates[0];
};

const clearDuplicateDeviceAssignments = (
  config: BusinessConfig,
  deviceId: string,
  options?: {
    activeTerminalId?: string | null;
    bindingTerminalId?: string | null;
    bindingLocalTerminalId?: string | null;
  }
): { config: BusinessConfig; changed: boolean; preferredTerminalId: string | null } => {
  if (!Array.isArray(config.terminals) || !deviceId) {
    return { config, changed: false, preferredTerminalId: null };
  }

  const preferred = resolvePreferredTerminalForDevice(config.terminals, deviceId, options);
  if (!preferred) {
    return { config, changed: false, preferredTerminalId: null };
  }

  let changed = false;
  const nextTerminals = config.terminals.map((terminal) => {
    if (terminal?.config?.currentDeviceId !== deviceId) {
      return terminal;
    }

    if (terminal.id === preferred.id) {
      return terminal;
    }

    changed = true;
    return {
      ...terminal,
      config: {
        ...terminal.config,
        currentDeviceId: undefined,
      },
    };
  });

  if (!changed) {
    return { config, changed: false, preferredTerminalId: preferred.id || null };
  }

  return {
    config: {
      ...config,
      terminals: nextTerminals,
    },
    changed: true,
    preferredTerminalId: preferred.id || null,
  };
};

const resolvePersistedBusinessConfig = (rawConfig: unknown): BusinessConfig | null => {
  if (!rawConfig) return null;

  if (Array.isArray(rawConfig)) {
    const candidate =
      rawConfig.find((entry: any) => entry?.id === 'current')
      || rawConfig.find((entry: any) => entry?.id !== '_db_initialized' && entry?.id !== 'config_metadata')
      || rawConfig[0];

    return candidate && !Array.isArray(candidate) && Array.isArray(candidate.terminals)
      ? candidate as BusinessConfig
      : null;
  }

  return !Array.isArray(rawConfig) && Array.isArray((rawConfig as BusinessConfig).terminals)
    ? rawConfig as BusinessConfig
    : null;
};

const normalizeTerminalDocumentAssignments = (
  sourceConfig: BusinessConfig | null | undefined
): { config: BusinessConfig | null | undefined; changed: boolean } => {
  if (!sourceConfig || Array.isArray(sourceConfig) || !Array.isArray(sourceConfig.terminals)) {
    return { config: sourceConfig, changed: false };
  }

  let changed = false;
  const terminals = sourceConfig.terminals.map((terminal) => {
    const currentAssignments = terminal.config?.documentAssignments || {};
    const availableSeries = Array.isArray(terminal.config?.documentSeries) ? terminal.config.documentSeries : [];
    const nextAssignments = Object.entries(DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS).reduce<Record<string, string>>(
      (acc, [key, value]) => {
        const resolvedId = resolveDocumentAssignmentId(
          key,
          availableSeries,
          currentAssignments[key as keyof typeof DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS] || value
        );
        acc[key] = resolvedId || value;
        return acc;
      },
      { ...currentAssignments }
    );

    const assignmentsChanged = Object.entries(DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS).some(
      ([key, value]) => currentAssignments[key as keyof typeof DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS] !== value
    );

    const resolvedAssignmentsChanged = Object.entries(nextAssignments).some(
      ([key, value]) => currentAssignments[key as keyof typeof DEFAULT_TERMINAL_DOCUMENT_ASSIGNMENTS] !== value
    );

    if (!assignmentsChanged && !resolvedAssignmentsChanged) {
      return terminal;
    }

    changed = true;
    return {
      ...terminal,
      config: {
        ...terminal.config,
        documentAssignments: nextAssignments
      }
    };
  });

  return {
    config: changed ? { ...sourceConfig, terminals } : sourceConfig,
    changed
  };
};

const createRuntimeId = (prefix: string): string => {
  const hasRandomUuid =
    typeof globalThis !== 'undefined' &&
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function';

  if (hasRandomUuid) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const CREDIT_PAYMENT_METHODS = new Set(['CREDIT', 'CREDITO', 'PENDIENTE']);
const SETUP_WIZARD_COMPLETED_KEY = 'clic_pos_setup_wizard_completed';
const SETUP_FLOW_STAGE_KEY = 'clic_pos_setup_flow_stage';
const SETUP_FLOW_VERSION_KEY = 'clic_pos_setup_flow_version';
const TERMINAL_SETUP_MODE_KEY = 'clic_pos_terminal_setup_mode';
const TERMINAL_SETUP_PENDING_KEY = 'clic_pos_terminal_setup_pending';
const TERMINAL_CONFIG_RESTART_NOTICE_KEY = 'clic_pos_terminal_config_restart_notice';
const SETUP_FLOW_VERSION = '2';
const buildRuntimeMasterUrl = () => buildMasterUrlFromHost(window.location.hostname);
const isNativeAndroidRuntime = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
const normalizeMasterHost = (value: string | null | undefined) =>
  (value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');

type TerminalSetupMode = 'SERVER_LOCAL' | 'SERVER_ERP' | 'CLIENT';
type TerminalIntegrationMode = 'LOCAL_ONLY' | 'ERP_DIRECT';

type TerminalConfigRestartNotice = {
  receivedAt: string;
  eventId?: string | null;
  terminalId?: string | null;
};

const readTerminalConfigRestartNotice = (): TerminalConfigRestartNotice | null => {
  const raw = localStorage.getItem(TERMINAL_CONFIG_RESTART_NOTICE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      receivedAt: typeof parsed.receivedAt === 'string' ? parsed.receivedAt : new Date().toISOString(),
      eventId: typeof parsed.eventId === 'string' ? parsed.eventId : null,
      terminalId: typeof parsed.terminalId === 'string' ? parsed.terminalId : null,
    };
  } catch {
    return null;
  }
};

const getStoredTerminalSetupMode = (): TerminalSetupMode | null => {
  const storedMode = localStorage.getItem(TERMINAL_SETUP_MODE_KEY);
  if (storedMode === 'SERVER_LOCAL' || storedMode === 'SERVER_ERP' || storedMode === 'CLIENT') {
    return storedMode;
  }

  if (storedMode === 'SERVER') return 'SERVER_LOCAL';
  if (storedMode === 'CLIENT') return 'CLIENT';
  return null;
};

const getTerminalSetupIntegrationMode = (setupMode: TerminalSetupMode | null): TerminalIntegrationMode => {
  return setupMode === 'SERVER_ERP' ? 'ERP_DIRECT' : 'LOCAL_ONLY';
};

const getTerminalBindingMode = (setupMode: TerminalSetupMode | null): 'MASTER' | 'SLAVE' => {
  return setupMode === 'CLIENT' ? 'SLAVE' : 'MASTER';
};

const hasPendingTerminalSetup = (): boolean => localStorage.getItem(TERMINAL_SETUP_PENDING_KEY) === '1';

const buildConfigSyncUrl = (): string | null => {
  const masterHost = normalizeMasterHost(localStorage.getItem('pos_master_ip'));
  const isLoopbackMaster = masterHost === 'localhost' || masterHost === '127.0.0.1';

  if (masterHost && !isLoopbackMaster) {
    const baseUrl = buildMasterUrlFromHost(masterHost);
    return baseUrl ? `${baseUrl}/api/config` : null;
  }

  if (isNativeAndroidRuntime()) {
    return null;
  }

  return `${buildRuntimeMasterUrl()}/api/config`;
};

const resolveReachableMasterBinding = async (host: string): Promise<{ host: string; baseUrl: string } | null> => {
  const normalizedHost = normalizeMasterHost(host);
  if (!normalizedHost) return null;

  for (const baseUrl of buildMasterUrlCandidates(normalizedHost)) {
    try {
      const response = await fetch(`${baseUrl}/api/sync/ping`);
      if (!response.ok) continue;

      return {
        host: new URL(baseUrl).hostname,
        baseUrl,
      };
    } catch {
      // try next candidate
    }
  }

  return {
    host: normalizedHost,
    baseUrl: buildMasterUrlFromHost(normalizedHost),
  };
};

const isSeedSetupBusinessConfig = (config: BusinessConfig | null | undefined): boolean => {
  if (!config?.companyInfo) return false;

  return (
    config.companyInfo.name === 'CLIC POS DEMO' &&
    config.companyInfo.rnc === '131-12345-1' &&
    config.companyInfo.phone === '809-555-POS1' &&
    config.companyInfo.address === 'Av. Principal #1, Santo Domingo'
  );
};

const normalizePaymentMethod = (method: unknown): string => {
  if (typeof method !== 'string') return '';
  return method
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
};

const toPositiveNumber = (value: unknown): number => {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num;
};

const resolveKioskPaymentMethods = (config: BusinessConfig): KioskResolvedPaymentMethod[] => {
  const enabledMethods = (config.paymentMethods || [])
    .filter((method: PaymentMethodDefinition) => method.isEnabled)
    .filter((method: PaymentMethodDefinition) => !['CREDIT', 'ADVANCE', 'STORE_CREDIT'].includes(String(method.type || '').toUpperCase()));

  if (enabledMethods.length === 0) {
    return [
      { key: 'CARD', id: 'CARD', type: 'CARD', label: 'Tarjeta', iconName: 'CreditCard' },
      { key: 'CASH', id: 'CASH', type: 'CASH', label: 'Efectivo', iconName: 'Banknote' },
    ];
  }

  return enabledMethods.map((method) => ({
    key: method.id || `${method.type}-${method.name}`,
    id: method.id || method.type,
    type: method.type,
    label: method.name,
    iconName: method.icon,
    integrationProvider: method.integration !== 'NONE' ? method.integration : undefined,
    integrationMode: method.integrationMode || 'MANUAL',
  }));
};

const createKioskGatewayOrderNumber = (): string => {
  const base = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
  return base.slice(-8);
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <KioskSecurityProvider>
        <AppContent />
      </KioskSecurityProvider>
    </ThemeProvider>
  );
};

const AppContent: React.FC = () => {
  const { clearSecurityState, setSupervisorPinValidator } = useKioskSecurityContext();
  // --- GLOBAL STATE ---
  const [activeTable, setActiveTable] = useState<Table | null>(null); // New state for selected table context
  /* original code */
  const [currentView, setCurrentView] = useState<ViewState>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('view') === 'VISOR' ? 'VISOR' : 'LOGIN';
  });
  const [scanTargetTicketId, setScanTargetTicketId] = useState<string | null>(null); // NEW: Auto-select ticket from scan
  const [restoringHistory, setRestoringHistory] = useState(false);
  const [config, setConfig] = useState<BusinessConfig>(() => getInitialConfig('Supermercado' as any));
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLandscape, setIsLandscape] = useState(window.innerWidth > window.innerHeight);

  useEffect(() => {
    const handleResize = () => setIsLandscape(window.innerWidth > window.innerHeight);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- SECURITY & DEVICE HANDSHAKE ---
  const [deviceId, setDeviceId] = useState<string>('');
  const [isDataLoaded, setIsDataLoaded] = useState<boolean>(false);
  const [initialConnError, setInitialConnError] = useState<string | null>(null);
  const [failedMasterIp, setFailedMasterIp] = useState<string>('');
  const initLoadStartedRef = useRef(false);
  const forceSyncHandledRef = useRef(false);
  const lockdownHandledRef = useRef(false);
  const [reconnectionStatus, setReconnectionStatus] = useState<'idle' | 'searching' | 'connected' | 'failed'>('idle');
  const [terminalConfigRestartNotice, setTerminalConfigRestartNotice] = useState<TerminalConfigRestartNotice | null>(() => readTerminalConfigRestartNotice());

  // --- SECURITY BOOTSTRAP STATE ---
  const [isSecurityLoaded, setIsSecurityLoaded] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const inactivityTimerRef = useRef<number | null>(null);

  // Security bootstrap logic moved to loadData

  useEffect(() => {
    if (!isNativeAndroidRuntime()) {
      return;
    }

    const installAndroidPrinterShim = (): boolean => {
      const runtimeWindow = window as any;
      if (runtimeWindow.ClicPOSNativePrinter || !runtimeWindow.AndroidPrinter) {
        return Boolean(runtimeWindow.ClicPOSNativePrinter);
      }

      const parseResult = (value: any) => {
        if (!value) {
          return { status: 'error', success: false, printed: false, message: 'Empty native response' };
        }

        if (typeof value === 'string') {
          try {
            return JSON.parse(value);
          } catch (error) {
            return { status: 'error', success: false, printed: false, message: String(value) };
          }
        }

        return value;
      };

      const call = (method: string, payload?: unknown) => {
        if (!runtimeWindow.AndroidPrinter || typeof runtimeWindow.AndroidPrinter[method] !== 'function') {
          return Promise.resolve({ status: 'error', success: false, printed: false, message: `Missing native method: ${method}` });
        }

        const raw = runtimeWindow.AndroidPrinter[method](JSON.stringify(payload || {}));
        return Promise.resolve(parseResult(raw));
      };

      runtimeWindow.ClicPOSNativePrinter = {
        platform: 'android',
        validateDgiiRnc: (payload: unknown) => call('validateDgiiRnc', payload),
        printEscPos: (payload: unknown) => call('printEscPos', payload),
        printEscpos: (payload: unknown) => call('printEscpos', payload),
        printRaw: (payload: unknown) => call('printRaw', payload),
        printHtml: (payload: unknown) => call('printHtml', payload),
        print: (payload: unknown) => call('print', payload),
        discoverPrinters: (payload: unknown) => call('discoverPrinters', payload),
        scanPrinters: (payload: unknown) => call('scanPrinters', payload),
        listPrinters: (payload: unknown) => call('listPrinters', payload),
        pairPrinter: (payload: unknown) => call('pairPrinter', payload),
        connectPrinter: (payload: unknown) => call('connectPrinter', payload),
        bindPrinter: (payload: unknown) => call('bindPrinter', payload),
        getDeviceProfile: () => Promise.resolve(parseResult(runtimeWindow.AndroidPrinter.getDeviceProfile?.())),
        getDeviceInfo: () => Promise.resolve(parseResult(runtimeWindow.AndroidPrinter.getDeviceInfo?.()))
      };

      return true;
    };

    const applyInputRuntimeHints = (target: EventTarget | null) => {
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
        return;
      }

      target.setAttribute('autocomplete', 'off');
      target.setAttribute('autocorrect', 'off');
      target.setAttribute('autocapitalize', 'off');
      target.spellcheck = false;
    };

    const seedExistingInputs = () => {
      document.querySelectorAll('input, textarea').forEach((node) => {
        applyInputRuntimeHints(node);
      });
    };

    const handleFocusIn = (event: FocusEvent) => {
      applyInputRuntimeHints(event.target);
    };

    installAndroidPrinterShim();
    const printerShimPoll = window.setInterval(() => {
      if (installAndroidPrinterShim()) {
        window.clearInterval(printerShimPoll);
      }
    }, 1000);

    seedExistingInputs();
    document.addEventListener('focusin', handleFocusIn, true);

    return () => {
      window.clearInterval(printerShimPoll);
      document.removeEventListener('focusin', handleFocusIn, true);
    };
  }, []);

  useEffect(() => {
    const handleReconnection = (e: CustomEvent) => {
      setReconnectionStatus(e.detail.status);
      if (e.detail.status === 'connected') {
        setTimeout(() => setReconnectionStatus('idle'), 3000);
      }
    };
    window.addEventListener('sync:reconnecting', handleReconnection as any);
    return () => window.removeEventListener('sync:reconnecting', handleReconnection as any);
  }, []);

  useEffect(() => {
    const handleTerminalConfigRestartRequired = (event: Event) => {
      const incomingNotice = (event as CustomEvent<TerminalConfigRestartNotice>)?.detail || readTerminalConfigRestartNotice();
      if (!incomingNotice) return;
      setTerminalConfigRestartNotice(incomingNotice);
    };

    window.addEventListener('terminalConfigRestartRequired', handleTerminalConfigRestartRequired as EventListener);
    return () => {
      window.removeEventListener('terminalConfigRestartRequired', handleTerminalConfigRestartRequired as EventListener);
    };
  }, []);

  useEffect(() => {
    const handleTerminalConfigSyncRequested = async (event: Event) => {
      try {
        const detail = (event as CustomEvent<TerminalConfigSyncRequestDetail>)?.detail || null;
        const refreshedConfig = await syncManager.refreshTerminalResolvedConfig(
          undefined,
          buildTerminalConfigRefreshRequest(detail),
        );
        if (refreshedConfig && !Array.isArray(refreshedConfig) && refreshedConfig.terminals) {
          setConfig(refreshedConfig);
        }

        const refreshedProducts = await db.get('products') as Product[];
        if (Array.isArray(refreshedProducts)) {
          setProducts(refreshedProducts);
        }
      } catch (error) {
        console.warn('⚠️ Failed to apply terminal config refresh requested by ERP outbox:', error);
      }
    };

    window.addEventListener('terminalConfigSyncRequested', handleTerminalConfigSyncRequested as EventListener);
    return () => {
      window.removeEventListener('terminalConfigSyncRequested', handleTerminalConfigSyncRequested as EventListener);
    };
  }, []);

  const dismissTerminalConfigRestartNotice = useCallback(() => {
    localStorage.removeItem(TERMINAL_CONFIG_RESTART_NOTICE_KEY);
    setTerminalConfigRestartNotice(null);
  }, []);

  const restartForTerminalConfigUpdate = useCallback(() => {
    dismissTerminalConfigRestartNotice();
    window.location.reload();
  }, [dismissTerminalConfigRestartNotice]);

  const syncConfigToLocalServer = useCallback(async (
    nextConfig: BusinessConfig,
    options?: { surfaceErrors?: boolean }
  ) => {
    const serverUrl = buildConfigSyncUrl();
    const shouldSurfaceSyncErrors = options?.surfaceErrors ?? !isNativeAndroidRuntime();

    if (!serverUrl) {
      console.log('ℹ️ Skipping remote config sync: native standalone runtime without remote master.');
      return;
    }

    console.log(`Attempting to sync to: ${serverUrl}`);

    try {
      const res = await fetch(serverUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextConfig)
      });

      if (res.ok) {
        console.log('Sync success: Config pushed to server.');
      } else {
        const errorText = await res.text();
        console.error('Sync failed:', res.status, res.statusText, errorText);
        if (shouldSurfaceSyncErrors) {
          alert(`Error al sincronizar: El servidor respondió ${res.status}\nDetalle: ${errorText}`);
        }
      }
    } catch (e) {
      console.warn('Could not sync config to local server', e);
      if (shouldSurfaceSyncErrors) {
        alert(`Error de conexión con ${serverUrl}. Asegúrate de que 'npm run server' esté corriendo.`);
      }
    }
  }, []);

  const triggerLockdown = React.useCallback((message: string) => {
    if (lockdownHandledRef.current) return;
    lockdownHandledRef.current = true;
    setLicenseError(message);
    setIsDataLoaded(true);
    setIsSecurityLoaded(true);
    setCurrentUser(null);
    Object.keys(localStorage)
      .filter((key) => key.startsWith('sb-'))
      .forEach((key) => localStorage.removeItem(key));
    clearPersistedSupabaseSession();
    void supabase.auth.signOut().catch(error => {
      console.warn('Failed to clear Supabase session during lockdown', error);
    });
  }, []);

  // --- REALTIME KILL SWITCH (FALLBACK: SMART POLLING) ---
  useEffect(() => {
    if (!isDataLoaded) return;

    const persistedTenantId = (localStorage.getItem('clic_tenant_id') || '').trim();
    const persistedTenantEmail = (localStorage.getItem('clic_tenant_email') || '').trim().toLowerCase();
    const hasActivationIdentity = Boolean(persistedTenantId && persistedTenantEmail);
    if (!hasActivationIdentity) return;

    let disposed = false;
    let timeoutId: number | null = null;

    const runLicenseCheck = async (fallbackMessage: string) => {
      try {
        const res = await checkLicenseStatus(persistedTenantId, deviceId);
        if (disposed) return;

        if (res.tenantId && res.tenantId !== persistedTenantId) {
          localStorage.setItem('clic_tenant_id', res.tenantId);
        }

        if (!res.isValid) {
          triggerLockdown(res.reason || fallbackMessage);
        }
      } catch {
        // Offline tolerance: avoid false positives on transient connectivity issues.
      }
    };

    void runLicenseCheck('Servicio Suspendido.');

    const scheduleNextLicenseCheck = () => {
      if (disposed) return;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }

      // Jitter: evita que múltiples terminales disparen el chequeo al mismo milisegundo.
      timeoutId = window.setTimeout(async () => {
        await runLicenseCheck('Servicio Suspendido por el Administrador.');
        scheduleNextLicenseCheck();
      }, LICENSE_REFRESH_BASE_MS + getTimerJitterMs());
    };

    scheduleNextLicenseCheck();

    return () => {
      disposed = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isDataLoaded, deviceId, triggerLockdown]);

  // --- AUTO-RETRY ON BOOT ERROR ---
  useEffect(() => {
    if (initialConnError || bootstrapError) {
      const timer = setTimeout(() => {
        window.location.reload();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [initialConnError, bootstrapError]);

  // Helper: Get current terminal configuration
  const getCurrentTerminal = React.useCallback(() => {
    const terminals = config.terminals || [];
    const activeTerminalId =
      localStorage.getItem('active_terminal_id')
      || localStorage.getItem('CLIC_POS_TERMINAL_ID')
      || '';

    const bindingTerminalId = localStorage.getItem('clic_erp_sync_terminal_id') || '';
    const bindingLocalTerminalId = localStorage.getItem('clic_erp_sync_local_terminal_id') || '';

    const byActiveId = activeTerminalId
      ? terminals.find((terminal) =>
          terminal.id === activeTerminalId
          || terminal.config?.erpTerminalId === activeTerminalId
        )
      : null;
    if (byActiveId) return byActiveId;

    const byBinding = resolvePreferredTerminalForDevice(terminals, deviceId, {
      activeTerminalId,
      bindingTerminalId,
      bindingLocalTerminalId,
    });
    if (byBinding) return byBinding;

    if (!activeTerminalId) return undefined;

    return terminals.find((terminal) =>
      terminal.id === activeTerminalId
      || terminal.config?.erpTerminalId === activeTerminalId
    );
  }, [config.terminals, deviceId]);

  useEffect(() => {
    const activeTerminalId = localStorage.getItem('active_terminal_id');
    const bindingTerminalId = localStorage.getItem('clic_erp_sync_terminal_id');
    const bindingLocalTerminalId = localStorage.getItem('clic_erp_sync_local_terminal_id');
    const sanitized = clearDuplicateDeviceAssignments(config, deviceId, {
      activeTerminalId,
      bindingTerminalId,
      bindingLocalTerminalId,
    });

    if (!sanitized.changed) return;

    const nextConfig = sanitized.config;
    setConfig(nextConfig);
    if (sanitized.preferredTerminalId) {
      localStorage.setItem('active_terminal_id', sanitized.preferredTerminalId);
      localStorage.setItem('CLIC_POS_TERMINAL_ID', sanitized.preferredTerminalId);
    }
    void db.save('config', nextConfig).catch((error) => {
      console.warn('Failed to persist duplicate terminal assignment cleanup', error);
    });
  }, [config, deviceId]);

  // Helper: Get current device role
  const getCurrentDeviceRole = React.useCallback((): DeviceRole => {
    const terminal = getCurrentTerminal();
    return terminal?.config?.deviceRole?.role || DeviceRole.STANDARD_POS;
  }, [getCurrentTerminal]);

  const navigateToUserLogin = React.useCallback(() => {
    clearSecurityState();
    setCurrentUser(null);
    setCurrentView('LOGIN');
  }, [clearSecurityState]);

  useEffect(() => {
    const currentTerminal = getCurrentTerminal();
    const autoLogoutMinutes = currentTerminal?.config?.security?.autoLogoutMinutes ?? 0;
    const shouldTrackInactivity =
      Boolean(currentUser) &&
      currentView !== 'LOGIN' &&
      currentView !== 'ACTIVATION' &&
      currentView !== 'WIZARD' &&
      autoLogoutMinutes > 0;

    if (!shouldTrackInactivity) {
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      return;
    }

    const timeoutMs = autoLogoutMinutes * 60 * 1000;
    const resetInactivityTimer = () => {
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current);
      }
      inactivityTimerRef.current = window.setTimeout(() => {
        console.info(`[Security] Auto-logout triggered after ${autoLogoutMinutes} minute(s) of inactivity.`);
        navigateToUserLogin();
      }, timeoutMs);
    };

    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'];
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, resetInactivityTimer, { passive: true });
    });

    resetInactivityTimer();

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, resetInactivityTimer as EventListener);
      });
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
  }, [currentUser, currentView, getCurrentTerminal, navigateToUserLogin]);

  useEffect(() => {
    if (currentView !== 'POS') return;

    const timers = [0, 60, 180, 320].map((delay) =>
      window.setTimeout(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('orientationchange'));
      }, delay)
    );

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [currentView]);

  const getStandalonePrimaryBinding = React.useCallback((sourceConfig: BusinessConfig, targetDeviceId: string) => {
    if (!targetDeviceId) return null;

    const terminals = Array.isArray(sourceConfig?.terminals) ? sourceConfig.terminals : [];
    if (terminals.length === 0) return null;

    const existingBinding = terminals.find(t => t.config?.currentDeviceId === targetDeviceId);
    if (existingBinding) {
      return {
        terminalId: existingBinding.id,
        nextConfig: sourceConfig,
        wasAutoBound: false
      };
    }

    const primaryTerminal = terminals.find(t => t.config?.isPrimaryNode) || terminals[0];
    const occupiedByAnotherDevice = primaryTerminal?.config?.currentDeviceId;
    const setupMode = getStoredTerminalSetupMode();
    const canForceStandaloneRebind =
      !hasPendingTerminalSetup() &&
      setupMode !== 'CLIENT' &&
      setupMode !== 'SERVER_ERP' &&
      !localStorage.getItem('pos_master_ip') &&
      primaryTerminal?.config?.governedByMaster !== true;

    if (
      !primaryTerminal ||
      (occupiedByAnotherDevice &&
        occupiedByAnotherDevice !== targetDeviceId &&
        !canForceStandaloneRebind)
    ) {
      return null;
    }

    const nextConfig: BusinessConfig = {
      ...sourceConfig,
      terminals: terminals.map(terminal => {
        if (terminal.config?.currentDeviceId === targetDeviceId) {
          return {
            ...terminal,
            config: {
              ...terminal.config,
              currentDeviceId: undefined
            }
          };
        }

        if (terminal.id !== primaryTerminal.id) {
          return terminal;
        }

        return {
          ...terminal,
          config: {
            ...terminal.config,
            isPrimaryNode: true,
            currentDeviceId: targetDeviceId,
            lastPairingDate: new Date().toISOString()
          }
        };
      })
    };

    return {
      terminalId: primaryTerminal.id,
      nextConfig,
      wasAutoBound: true
    };
  }, []);

  const activateLocalPrimaryTerminal = React.useCallback(async (sourceConfig: BusinessConfig, targetDeviceId: string) => {
    const standaloneBinding = getStandalonePrimaryBinding(sourceConfig, targetDeviceId);
    if (!standaloneBinding) return null;

    const { nextConfig, terminalId } = standaloneBinding;
    const activeTerminal = (nextConfig.terminals || []).find(t => t.id === terminalId);

    setConfig(nextConfig);
    await db.save('config', nextConfig);

    localStorage.removeItem('pos_master_ip');
    localStorage.setItem('CLIC_POS_MASTER_URL', buildRuntimeMasterUrl());

    permissionService.initialize(nextConfig, terminalId);
    authLevelService.init(nextConfig, terminalId);
    terminalRouter.init(nextConfig, terminalId, activeTerminal?.config?.deviceRole || null);
    await syncManager.initialize(nextConfig, terminalId);

    return standaloneBinding;
  }, [getStandalonePrimaryBinding]);

  const handleVerticalSelection = React.useCallback(async (selectedConfig: BusinessConfig) => {
    clearStoredErpSyncBinding();
    localStorage.removeItem('active_terminal_id');
    localStorage.removeItem('initial_terminal_config');
    localStorage.setItem(TERMINAL_SETUP_PENDING_KEY, '1');
    localStorage.setItem(TERMINAL_SETUP_MODE_KEY, 'SERVER_LOCAL');
    localStorage.setItem(SETUP_FLOW_STAGE_KEY, 'VERTICAL_SELECTED');
    localStorage.setItem(SETUP_FLOW_VERSION_KEY, SETUP_FLOW_VERSION);
    setConfig(selectedConfig);
    await db.save('config', selectedConfig);
    setCurrentView('SETUP');
  }, []);

  const handleTerminalModeSelection = React.useCallback((mode: TerminalSetupMode) => {
    clearStoredErpSyncBinding();
    localStorage.removeItem('active_terminal_id');
    localStorage.removeItem('initial_terminal_config');
    localStorage.setItem(TERMINAL_SETUP_PENDING_KEY, '1');
    localStorage.setItem(TERMINAL_SETUP_MODE_KEY, mode);

    if (mode === 'SERVER_LOCAL') {
      localStorage.removeItem('pos_master_ip');
      localStorage.setItem('CLIC_POS_MASTER_URL', buildRuntimeMasterUrl());
      setCurrentView('VERTICAL_SELECTOR');
      return;
    }

    if (mode === 'SERVER_ERP') {
      localStorage.removeItem('pos_master_ip');
      localStorage.setItem('CLIC_POS_MASTER_URL', buildRuntimeMasterUrl());
      localStorage.removeItem(SETUP_FLOW_STAGE_KEY);
      localStorage.removeItem(SETUP_FLOW_VERSION_KEY);
      setCurrentView('TERMINAL_PAIRING');
      return;
    }

    localStorage.removeItem(SETUP_FLOW_STAGE_KEY);
    localStorage.removeItem(SETUP_FLOW_VERSION_KEY);
    setCurrentView('TERMINAL_PAIRING');
  }, []);

  useEffect(() => {
    const setupPending = hasPendingTerminalSetup();
    const isSetupView =
      currentView === 'ACTIVATION'
      || currentView === 'VERTICAL_SELECTOR'
      || currentView === 'TERMINAL_PAIRING';
    const currentTerminal = getCurrentTerminal();
    const tenantIdentity = getStoredTenantIdentity();

    if (setupPending || isSetupView) return;
    if (!deviceId || !currentTerminal?.id) return;
    if (!tenantIdentity.tenantId && !tenantIdentity.tenantSlug && !tenantIdentity.tenantEmail) return;

    let disposed = false;
    const recoveredErpBaseUrl = resolveSetupErpBaseUrl();

    if (recoveredErpBaseUrl) {
      persistSetupErpBaseUrls(recoveredErpBaseUrl);
    }

    const publishEndpoint = async () => {
      const operationalTerminalId = currentTerminal.config?.stationNumber || currentTerminal.id;
      const terminalName = currentTerminal.config?.terminalName || operationalTerminalId;
      const endpoint = await publishMasterEndpointToCloud({
        deviceId,
        terminalId: operationalTerminalId,
        terminalName,
        isPrimary: currentTerminal.config?.isPrimaryNode !== false,
      });

      if (!disposed && endpoint?.localIp) {
        console.log(`[CLOUD] Terminal ${terminalName} publicada en cloud: ${endpoint.localIp}`);
      }
    };

    const HEARTBEAT_INTERVAL_MS = 120000;
    const MANIFEST_REFRESH_INTERVAL_MS = 300000;
    let lastManifestRefreshAt = 0;
    let heartbeatTimeoutId: number | null = null;

    const syncLifecycle = async (options?: { forceManifestRefresh?: boolean }) => {
      try {
        const operationalTerminalId = currentTerminal.config?.stationNumber || currentTerminal.id;
        const erpTerminalId = currentTerminal.config?.erpTerminalId || operationalTerminalId;
        const terminalName = currentTerminal.config?.terminalName || operationalTerminalId;
        const result = await ensureErpSyncLifecycle({
          deviceId,
          terminalId: erpTerminalId,
          localTerminalId: operationalTerminalId,
          terminalName,
          isPrimary: currentTerminal.config?.isPrimaryNode !== false,
          pendingEvents: 0,
        });

        const blockingActivation = result?.heartbeat?.activation || result?.registered?.activation || result?.bootstrap?.activation;
        if (!disposed && isLifecycleActivationBlocked(blockingActivation)) {
          triggerLockdown(getLifecycleActivationBlockMessage(blockingActivation));
          return;
        }

        if (!disposed && result?.heartbeat?.terminal?.id) {
          console.log(`[ERP SYNC] Terminal ${terminalName} enlazada con ${result.heartbeat.terminal.id}`);
        }

        if (!disposed && (result?.outbox?.applied || 0) > 0) {
          console.log(`[ERP SYNC] ${result.outbox.applied} evento(s) ERP aplicados. El refresh runtime se resuelve por terminalConfigSyncRequested.`);
        }

        const now = Date.now();
        const shouldRefreshManifest = Boolean(options?.forceManifestRefresh)
          || (result?.outbox?.applied || 0) > 0
          || now - lastManifestRefreshAt >= MANIFEST_REFRESH_INTERVAL_MS;

        if (shouldRefreshManifest) {
          const refreshedFromManifest = await syncManager.syncTerminalManifestInBackground(undefined, {
            bootstrapBlocks: Boolean(options?.forceManifestRefresh),
          });
          if (!disposed && refreshedFromManifest && !Array.isArray(refreshedFromManifest) && refreshedFromManifest.terminals) {
            console.log(`[ERP SYNC] ${terminalName} actualizó su estado runtime desde el manifest del ERP.`);
          }
          lastManifestRefreshAt = now;
        }
      } catch (error) {
        const blockingMessage = getLifecycleBlockingMessageFromError(error);
        if (!disposed && blockingMessage) {
          triggerLockdown(blockingMessage);
          return;
        }
        console.warn('[ERP SYNC] lifecycle registration skipped:', error);
      }
    };

    // Boot: publica una sola vez; el diff check del registry evita reescrituras redundantes.
    void publishEndpoint();
    void syncLifecycle({ forceManifestRefresh: true });

    const scheduleNextHeartbeat = () => {
      if (disposed) return;
      if (heartbeatTimeoutId !== null) {
        window.clearTimeout(heartbeatTimeoutId);
      }

      heartbeatTimeoutId = window.setTimeout(async () => {
        if (!disposed && navigator.onLine) {
          // Publish on heartbeat is diff-only: cloudMasterRegistry.ts compara fingerprint e IP antes de escribir.
          void publishEndpoint();
          await syncLifecycle();
        }
        scheduleNextHeartbeat();
      }, HEARTBEAT_INTERVAL_MS + getTimerJitterMs());
    };

    scheduleNextHeartbeat();

    return () => {
      disposed = true;
      if (heartbeatTimeoutId !== null) {
        window.clearTimeout(heartbeatTimeoutId);
      }
    };
  }, [currentView, deviceId, getCurrentTerminal]);

  // --- RECONNECTION BANNER ---
  const renderReconnectionBanner = () => {
    if (reconnectionStatus === 'idle') return null;

    const bannerStyle: React.CSSProperties = {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      padding: '8px',
      textAlign: 'center',
      fontWeight: 'bold',
      boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    };

    if (reconnectionStatus === 'searching') {
      return (
        <div style={{ ...bannerStyle, backgroundColor: '#f59e0b', color: '#fff' }}>
          📡 Buscando servidor Maestro en la red local... (Auto-recuperación)
        </div>
      );
    }

    if (reconnectionStatus === 'connected') {
      return (
        <div style={{ ...bannerStyle, backgroundColor: '#10b981', color: '#fff' }}>
          ✅ Conexión recuperada exitosamente.
        </div>
      );
    }

    if (reconnectionStatus === 'failed') {
      return (
        <div style={{ ...bannerStyle, backgroundColor: '#ef4444', color: '#fff' }}>
          ❌ No se pudo encontrar el servidor Maestro. Por favor revise su conexión.
        </div>
      );
    }
  };

  const renderTerminalConfigRestartBanner = () => {
    if (!terminalConfigRestartNotice) return null;

    const tenantIdentity = getStoredTenantIdentity();
    const restartTargetName =
      config.companyInfo?.name?.trim()
      || tenantIdentity.tenantSlug
      || tenantIdentity.tenantEmail
      || null;
    const currentTerminal = getCurrentTerminal();
    const restartTerminalName =
      currentTerminal?.config?.terminalName
      || currentTerminal?.config?.stationNumber
      || terminalConfigRestartNotice.terminalId
      || null;

    const bannerStyle: React.CSSProperties = {
      position: 'fixed',
      top: reconnectionStatus === 'idle' ? 0 : 44,
      left: 0,
      right: 0,
      zIndex: 9998,
      padding: '10px 16px',
      backgroundColor: '#1e293b',
      color: '#fff',
      boxShadow: '0 2px 8px rgba(15,23,42,0.25)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      flexWrap: 'wrap',
    };

    return (
      <div style={bannerStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800 }}>
            Nueva configuración recibida desde ERP
            {restartTargetName ? ` · ${restartTargetName}` : ''}
          </div>
          <div style={{ fontSize: '13px', opacity: 0.92 }}>
            Reinicia el POS para aplicar por completo cambios de tarifa, catálogo y configuración operativa.
            {restartTerminalName ? ` Terminal ${restartTerminalName}.` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            onClick={dismissTerminalConfigRestartNotice}
            style={{
              padding: '8px 12px',
              borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.08)',
              color: '#fff',
              fontWeight: 700,
            }}
          >
            Entendido
          </button>
          <button
            onClick={restartForTerminalConfigUpdate}
            style={{
              padding: '8px 14px',
              borderRadius: '10px',
              border: 'none',
              background: '#22c55e',
              color: '#052e16',
              fontWeight: 800,
            }}
          >
            Reiniciar ahora
          </button>
        </div>
      </div>
    );
  };

  // --- DATA STORES ---
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>(DEFAULT_ROLES);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [zReports, setZReports] = useState<ZReport[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [parkedTickets, setParkedTickets] = useState<ParkedTicket[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [internalSequences, setInternalSequences] = useState<any[]>([]);
  const [receptions, setReceptions] = useState<Reception[]>([]);
  const [productStocks, setProductStocks] = useState<ProductStock[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string>('');
  const [activeRoomId2, setActiveRoomId2] = useState<string>(''); // For backward compatibility if needed
  const [supplierProductPrices, setSupplierProductPrices] = useState<any[]>([]);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [settingsInitialView, setSettingsInitialView] = useState<string | undefined>();
  const [settingsInitialData, setSettingsInitialData] = useState<any>();
  const [viewData, setViewData] = useState<any>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  useEffect(() => {
    if (!selectedCustomer?.id) return;
    const refreshedCustomer = customers.find(customer => customer.id === selectedCustomer.id);
    if (!refreshedCustomer || refreshedCustomer === selectedCustomer) return;

    const selectedWalletBalance = Number(selectedCustomer.wallet?.balance || 0);
    const refreshedWalletBalance = Number(refreshedCustomer.wallet?.balance || 0);
    const selectedCustomerImage = resolveCustomerImageSrc(selectedCustomer);
    const refreshedCustomerImage = resolveCustomerImageSrc(refreshedCustomer);
    const shouldRefreshSelection =
      refreshedCustomer.name !== selectedCustomer.name ||
      refreshedCustomer.currentDebt !== selectedCustomer.currentDebt ||
      refreshedCustomer.creditLimit !== selectedCustomer.creditLimit ||
      refreshedCustomer.updatedAt !== selectedCustomer.updatedAt ||
      refreshedCustomerImage !== selectedCustomerImage ||
      refreshedWalletBalance !== selectedWalletBalance;

    if (shouldRefreshSelection) {
      setSelectedCustomer(refreshedCustomer);
    }
  }, [customers, selectedCustomer]);

  const normalizeTerminalId = (value?: string | null) => (value || '').trim().toLowerCase();
  const isRestaurantVertical = (value?: string | null) => value === 'RESTAURANT' || value === 'RESTAURANTE';
  const isRestaurantTerminal = (terminal?: any) =>
    isRestaurantVertical(terminal?.config?.operational?.vertical_negocio) || config.vertical === 'RESTAURANT';

  const getLatestZCloseTimestamp = (terminalId: string) => {
    const terminalKey = normalizeTerminalId(terminalId);
    const isDefaultTerminal = terminalKey === 't1';

    return zReports
      .filter(r => normalizeTerminalId(r.terminalId) === terminalKey || (!r.terminalId && isDefaultTerminal))
      .map(r => new Date(r.closedAt).getTime())
      .filter((value) => Number.isFinite(value))
      .reduce((max, value) => value > max ? value : max, 0);
  };

  const getPendingTransactionsForTerminal = (terminalId: string) => {
    const terminalKey = normalizeTerminalId(terminalId);
    const isDefaultTerminal = terminalKey === 't1';
    const latestCloseTs = getLatestZCloseTimestamp(terminalId);

    const pending = transactions.filter(t => {
      const belongsToTerminal = normalizeTerminalId(t.terminalId) === terminalKey || (!t.terminalId && isDefaultTerminal);
      if (!belongsToTerminal) return false;
      if (t.zReportId) return false;

      // Relaxed timestamp check: only filter out if it's significantly before the last close
      // to account for clock drift between terminals.
      const txTime = new Date(t.date).getTime();
      const DRIFT_TOLERANCE_MS = 1000 * 60 * 5; // 5 minutes tolerance
      if (!Number.isFinite(txTime)) return latestCloseTs <= 0;
      return latestCloseTs <= 0 || txTime > (latestCloseTs - DRIFT_TOLERANCE_MS);
    });

    return pending.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  };

  const getPendingCashMovementsForTerminal = (terminalId: string) => {
    const terminalKey = normalizeTerminalId(terminalId);
    const isDefaultTerminal = terminalKey === 't1';
    const latestCloseTs = getLatestZCloseTimestamp(terminalId);

    return cashMovements.filter(m => {
      const belongsToTerminal = normalizeTerminalId(m.terminalId) === terminalKey || (!m.terminalId && isDefaultTerminal);
      if (!belongsToTerminal) return false;

      const moveTime = new Date(m.timestamp).getTime();
      const DRIFT_TOLERANCE_MS = 1000 * 60 * 5; // 5 minutes tolerance
      if (!Number.isFinite(moveTime)) return latestCloseTs <= 0;
      return latestCloseTs <= 0 || moveTime > (latestCloseTs - DRIFT_TOLERANCE_MS);
    });
  };

  const fetchTables = async () => {
    try {
      const terminalId = getCurrentTerminal()?.id;
      const query = terminalId ? `?terminal_id=${encodeURIComponent(terminalId)}` : '';
      const res = await fetch(`/api/mesas${query}`);
      if (res.ok) {
        const data = await res.json();

        // Backward compatibility: some endpoints may return only Table[].
        if (Array.isArray(data)) {
          setTables(data);
          return;
        }

        const nextTables = Array.isArray(data?.tables) ? data.tables : [];
        const nextRooms = Array.isArray(data?.rooms) ? data.rooms : [];

        setTables(nextTables);

        if (nextRooms.length > 0) {
          setRooms(nextRooms);
          setActiveRoomId(prev =>
            prev && nextRooms.some((room: Room) => room.id === prev)
              ? prev
              : (nextRooms[0]?.id || '')
          );
        }
      }
    } catch (e) {
      console.warn("Failed to fetch tables from API, falling back to local DB:", e);
      try {
        const [localRooms, localTables] = await Promise.all([
          db.get('rooms') as Promise<Room[]>,
          db.get('tables') as Promise<Table[]>
        ]);
        const nextRooms = Array.isArray(localRooms) ? localRooms : [];
        const nextTables = Array.isArray(localTables) ? localTables : [];
        setTables(nextTables);
        if (nextRooms.length > 0) {
          setRooms(nextRooms);
          setActiveRoomId(prev =>
            prev && nextRooms.some((room: Room) => room.id === prev)
              ? prev
              : (nextRooms[0]?.id || '')
          );
        }
      } catch (fallbackError) {
        console.error('Failed to load tables from local DB:', fallbackError);
      }
    }
  };

  const openTableForService = useCallback(async (table: Table): Promise<Table | null> => {
    if (!currentUser) return null;

    const nowIso = new Date().toISOString();
    const baseUpdate = {
      ...table,
      status: 'OCCUPIED' as const,
      timeSeated: table.timeSeated || nowIso,
      waiterId: currentUser.id,
      waiterName: currentUser.name
    };

    try {
      const res = await fetch('/api/mesas/abrir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          waiterId: currentUser.id,
          waiterName: currentUser.name
        })
      });

      const data = await res.json();
      if (res.ok && data.status === 'success') {
        const updated = { ...baseUpdate, currentOrderId: data.orden_id };
        setTables(prev => {
          const next = prev.map(t => t.id === updated.id ? updated : t);
          db.save('tables', next).catch(error => console.error('Failed to persist tables:', error));
          return next;
        });
        return updated;
      }

      alert(data?.message || 'Error abriendo mesa');
      return null;
    } catch (error) {
      console.warn('Table service not available, opening table locally:', error);
    }

    const localOrderId = table.currentOrderId || `ORD-${Date.now()}`;
    const updated = { ...baseUpdate, currentOrderId: localOrderId };
    setTables(prev => {
      const next = prev.map(t => t.id === updated.id ? updated : t);
      db.save('tables', next).catch(error => console.error('Failed to persist tables:', error));
      return next;
    });
    return updated;
  }, [currentUser]);

  useKioskMode(getCurrentDeviceRole() === DeviceRole.SELF_CHECKOUT);
  const scannerEnabledViews = currentView === 'POS'
    || currentView === 'HISTORY'
    || currentView === 'KIOSK_BROWSER'
    || currentView === 'KIOSK_WELCOME';

  useBarcodeScanner({
    enabled: scannerEnabledViews,
    onScan: (barcode) => {
      if (currentView === 'KIOSK_WELCOME') {
        clearSecurityState();
        setCurrentView('KIOSK_BROWSER');

        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('barcodeScanned', { detail: { barcode } }));
        }, 0);
        return;
      }

      window.dispatchEvent(new CustomEvent('barcodeScanned', { detail: { barcode } }));
    },
    onTicketScan: currentView === 'POS' || currentView === 'HISTORY'
      ? (ticketId) => {
        console.log(`🎟️ Smart Scan: Opening Ticket History for ${ticketId}`);
        setScanTargetTicketId(ticketId);
        setCurrentView('HISTORY');
      }
      : undefined
  });

  const inventoryCountSync = useOfflineInventoryCountSync({ enabled: isDataLoaded });

  useEffect(() => {
    const status = nativePrintBridge.getContractStatus();
    if (!status.available) {
      console.log('🖨️ Native print bridge not detected (running with web/agent fallback).');
      return;
    }

    console.log('🖨️ Native print bridge detected:', status);
  }, []);

  const flushOfflinePrintQueue = useCallback(async () => {
    if (!isDataLoaded) return;

    try {
      const result = await offlinePrintQueueService.processPendingQueue(config);
      if (result.processed > 0) {
        console.log(`🖨️ Offline print queue processed: ${result.processed} jobs`);
      }
    } catch (error) {
      const message = String((error as any)?.message || error || '');
      if (message.toLowerCase().includes('db not connected')) {
        return;
      }
      console.warn('Offline print queue processing failed:', error);
    }
  }, [config, isDataLoaded]);

  useEffect(() => {
    if (!isDataLoaded) return;

    const wakeQueue = () => {
      flushOfflinePrintQueue().catch(console.error);
    };

    const handleVisibility = () => {
      if (document.hidden) return;
      wakeQueue();
    };

    const intervalId = window.setInterval(wakeQueue, 15000);
    window.addEventListener('online', wakeQueue);
    window.addEventListener('offlinePrintQueueWake', wakeQueue as EventListener);
    document.addEventListener('visibilitychange', handleVisibility);

    wakeQueue();

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('online', wakeQueue);
      window.removeEventListener('offlinePrintQueueWake', wakeQueue as EventListener);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [flushOfflinePrintQueue, isDataLoaded]);

  useEffect(() => {
    const handleAutoPrint = async (event: Event) => {
      const detail = (event as CustomEvent<any>)?.detail || {};
      const rawItems = Array.isArray(detail.items) ? detail.items : [];
      if (!rawItems.length) return;

      const templates = (config.labelTemplates && config.labelTemplates.length > 0)
        ? config.labelTemplates
        : DEFAULT_LABEL_TEMPLATES;
      const template = templates.find(t => t.category === 'ARTICLE') || templates[0];
      if (!template) return;

      const records = rawItems
        .map((item: any) => ({
          productId: String(item.productId || ''),
          productName: String(item.productName || item.productId || 'Producto'),
          sku: item.sku ? String(item.sku) : undefined,
          price: typeof item.price === 'number' ? item.price : undefined,
          copies: Math.max(1, Math.floor(Number(item.quantityReceived ?? item.copies ?? 1)))
        }))
        .filter((record: any) => !!record.productId && record.copies > 0);

      if (!records.length) return;

      try {
        await printLabelsFromTemplate({
          config,
          template,
          records,
          terminalId: detail.terminalId || getCurrentTerminal()?.id,
          referenceId: detail.referenceId || `${detail.source || 'AUTO_LABEL'}-${Date.now()}`
        });
        await flushOfflinePrintQueue();
      } catch (error) {
        console.warn('Auto label print flow failed:', error);
      }
    };

    window.addEventListener('autoPrintLabelRequested', handleAutoPrint as EventListener);
    return () => window.removeEventListener('autoPrintLabelRequested', handleAutoPrint as EventListener);
  }, [config, flushOfflinePrintQueue, getCurrentTerminal]);

  useEffect(() => {
    // Detect if we should start in Visor Mode (HDMI Display)
    const params = new URLSearchParams(window.location.search);
    const forcedView = params.get('view');
    if (forcedView === 'VISOR') {
      console.log("📺 VISOR MODE DETECTED: Initialization bypass.");
      setCurrentView('VISOR');
    }
  }, []);

  useEffect(() => {
    if (!isDataLoaded || forceSyncHandledRef.current) return;

    const params = new URLSearchParams(window.location.search);
    if (params.get('force_sync_tickets') !== '1') return;

    forceSyncHandledRef.current = true;

    const normalizeTerminalId = (value?: string | null) => (value || '').trim().toLowerCase();
    const normalizeFolio = (value?: string | null) => (value || '').trim().toUpperCase();
    const parseFolio = (value?: string | null): { prefix: string; seq: number } | null => {
      const normalized = normalizeFolio(value);
      const match = normalized.match(/^([A-Z]+)(\d+)$/);
      if (!match) return null;
      return { prefix: match[1], seq: Number(match[2]) };
    };

    const cleanupForceParams = () => {
      [
        'force_sync_tickets',
        'terminal',
        'folio_from',
        'folio_to',
        'folios'
      ].forEach((key) => params.delete(key));
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash || ''}`;
      window.history.replaceState({}, '', nextUrl);
    };

    const run = async () => {
      try {
        const terminalFilter = normalizeTerminalId(params.get('terminal'));
        const foliosParam = params.get('folios');
        const fromFolio = parseFolio(params.get('folio_from'));
        const toFolio = parseFolio(params.get('folio_to'));

        const explicitFolios = (foliosParam || '')
          .split(',')
          .map((item) => normalizeFolio(item))
          .filter(Boolean);
        const explicitSet = new Set(explicitFolios);

        const hasRange =
          !!fromFolio &&
          !!toFolio &&
          fromFolio.prefix === toFolio.prefix &&
          fromFolio.seq <= toFolio.seq;

        const allTransactions = await db.get('transactions') as Transaction[] || [];
        if (!Array.isArray(allTransactions) || allTransactions.length === 0) {
          alert('No hay transacciones locales para forzar sincronizacion.');
          return;
        }

        let matched = 0;
        let marked = 0;

        const updatedTransactions = allTransactions.map((tx: any) => {
          const txTerminal = normalizeTerminalId(tx?.terminalId);
          if (terminalFilter && txTerminal !== terminalFilter) return tx;

          const displayId = normalizeFolio(tx?.displayId);
          let shouldMatch = false;

          if (explicitSet.size > 0 && explicitSet.has(displayId)) {
            shouldMatch = true;
          } else if (hasRange && displayId) {
            const parsed = parseFolio(displayId);
            if (parsed && parsed.prefix === fromFolio!.prefix && parsed.seq >= fromFolio!.seq && parsed.seq <= toFolio!.seq) {
              shouldMatch = true;
            }
          }

          if (!shouldMatch) return tx;

          matched++;
          const alreadyPending = tx.syncStatus === 'PENDING' && tx._forceSyncReplay === true;
          if (alreadyPending) return tx;

          marked++;
          return {
            ...tx,
            syncStatus: 'PENDING',
            syncError: 'Forced sync link replay',
            _forceSyncReplay: true
          };
        });

        if (matched === 0) {
          alert('No se encontraron tickets locales que coincidan con el link forzado.');
          return;
        }

        if (marked > 0) {
          await db.save('transactions', updatedTransactions as any);
        }

        await backgroundSyncManager.triggerSync();

        alert(`Forzado aplicado: ${matched} ticket(s) coinciden, ${marked} marcado(s) para reenvio.`);
      } catch (error: any) {
        console.error('Forced ticket sync failed:', error);
        alert(`Error en forzado de tickets: ${error?.message || 'Error desconocido'}`);
      } finally {
        cleanupForceParams();
      }
    };

    run().catch((error) => {
      console.error('Forced ticket sync bootstrap failed:', error);
      cleanupForceParams();
    });
  }, [isDataLoaded]);

  const handleViewChange = (view: ViewState, data?: any) => {
    console.log(`🚀 View Change: ${currentView} -> ${view}`, data);
    let nextData = data;
    if (view === 'INVENTORY_COUNT' && !data?.countSessionId) {
      nextData = { ...(data || {}), countSessionId: `COUNT-${Date.now()}` };
    }
    if (view === 'TABLE_MAP') {
      // Refresh immediately when returning to table map to avoid stale colors.
      fetchTables().catch((error) => console.error('Failed to refresh tables on TABLE_MAP view:', error));
    }
    setViewData(nextData);
    setCurrentView(view);
  };

  const validateSupervisorPin = React.useCallback((pin: string): boolean => {
    const cleanedPin = pin.trim();
    if (!cleanedPin) return false;

    const supervisorCandidate = users.find(user => user.pin === cleanedPin);
    if (!supervisorCandidate) return false;

    const roleId = supervisorCandidate.roleId || supervisorCandidate.role;
    const role = roles.find(r => r.id === roleId);
    if (!role) return false;

    const roleName = role.name.toLowerCase();
    const hasSupervisorPrivileges =
      role.permissions.includes('ALL') ||
      role.permissions.includes('SETTINGS_ACCESS') ||
      roleName.includes('super') ||
      roleName.includes('admin') ||
      roleName.includes('gerente');

    return hasSupervisorPrivileges;
  }, [users, roles]);

  useEffect(() => {
    setSupervisorPinValidator(validateSupervisorPin);
  }, [setSupervisorPinValidator, validateSupervisorPin]);

  // --- EMERGENCY RESCUE MECHANISM ---
  useEffect(() => {
    const handleEmergencyReset = async (e: KeyboardEvent) => {
      // Shortcut: Ctrl + Shift + Alt + U (Unbind)
      if (e.ctrlKey && e.shiftKey && e.altKey && e.code === 'KeyU') {
        if (confirm('🚨 EMERGENCY RESET: This will unbind this terminal and clear local database config. Continue?')) {
          try {
            console.warn("🧺 EMERGENCY UNBIND TRIGGERED");
            localStorage.removeItem('pos_device_id');
            localStorage.removeItem('pos_master_ip');
            localStorage.removeItem('CLIC_POS_MASTER_URL');
            localStorage.removeItem('pos_sync_status');

            // Wipe Local DB Config to avoid stale Slave/Master role mismatch
            await db.deleteDocument('config', 'config' as any);

            alert("Terminal Desvinculada. La aplicación se reiniciará.");
            window.location.reload();
          } catch (err) {
            console.error("Failed to perform emergency reset:", err);
            alert("Error doing reset. Please clear browser cache manually.");
          }
        }
      }
    };

    window.addEventListener('keydown', handleEmergencyReset);
    return () => window.removeEventListener('keydown', handleEmergencyReset);
  }, []);

  // --- INITIAL DATA LOAD ---
  useEffect(() => {
    if (initLoadStartedRef.current) return;
    initLoadStartedRef.current = true;

    const loadData = async () => {
      console.log('🚀 loadData started');
      try {
        console.log('⏳ Calling db.init()...');
        const data = await Promise.race([
          db.init(),
          new Promise<never>((_, reject) => {
            window.setTimeout(() => {
              reject(new Error('Timeout inicializando base local (IndexedDB). Si persiste, cierra otras pestañas de CLIC POS y reintenta.'));
            }, 60000);
          })
        ]);
        console.log('✅ db.init() returned:', data ? Object.keys(data) : 'null');

        // RECOVERY: Run in background so startup never blocks on heavy history stores.
        void ZReportRecoveryService
          .recoverOrphanedReports({ notifyUser: false })
          .catch((recoveryError) => console.warn('⚠️ Startup Z-report recovery skipped:', recoveryError));

        let currentConfig = data.config;
        const normalizedBootConfig = normalizeTerminalDocumentAssignments(currentConfig);
        if (normalizedBootConfig.changed && normalizedBootConfig.config) {
          currentConfig = normalizedBootConfig.config;
          await db.save('config', currentConfig);
        }

        // 2. Gestión de Identidad de Dispositivo (early, used for safe config source selection)
        let storedDeviceId = localStorage.getItem('pos_device_id');
        if (!storedDeviceId) {
          storedDeviceId = 'DEV-' + Math.random().toString(36).substring(2, 10).toUpperCase();
          localStorage.setItem('pos_device_id', storedDeviceId);
        }
        setDeviceId(storedDeviceId);

        const persistedTenantId = (localStorage.getItem('clic_tenant_id') || '').trim();
        const persistedTenantEmail = (localStorage.getItem('clic_tenant_email') || '').trim().toLowerCase();
        const hasActivationIdentity = Boolean(persistedTenantId && persistedTenantEmail);
        if (!hasActivationIdentity) {
          // En primera activacion, forzamos sesion cloud limpia para evitar auto-login heredado.
          clearTenantIdentity();
          localStorage.removeItem(TERMINAL_SETUP_PENDING_KEY);
          localStorage.removeItem(TERMINAL_SETUP_MODE_KEY);
          Object.keys(localStorage)
            .filter((key) => key.startsWith('sb-'))
            .forEach((key) => localStorage.removeItem(key));
          clearPersistedSupabaseSession();
          await supabase.auth.signOut().catch((error) => {
            console.warn('[BOOT] Failed to clear stale Supabase session before activation:', error);
          });

          console.warn('[BOOT] Sistema no activado. Redirigiendo a pantalla de activación...');
          setIsDataLoaded(true);
          setIsSecurityLoaded(true);
          setCurrentView('ACTIVATION');
          return;
        }

        // --- LICENSE / KILL-SWITCH VALIDATION ---
        const license = await checkLicenseStatus(persistedTenantId, storedDeviceId);
        if (!license.isValid) {
          triggerLockdown(license.reason || 'Servicio Suspendido.');
          return;
        }

        // IMPORTANT:
        // Only pull remote config when this device is a SLAVE (or not yet paired locally).
        // If a MASTER keeps stale pos_master_ip, blindly pulling here corrupts local runtime config.
        let masterIp = localStorage.getItem('pos_master_ip');
        const setupWizardCompleted = localStorage.getItem(SETUP_WIZARD_COMPLETED_KEY) === '1';
        const setupFlowStage = localStorage.getItem(SETUP_FLOW_STAGE_KEY);
        const setupFlowVersion = localStorage.getItem(SETUP_FLOW_VERSION_KEY);
        const setupMode = getStoredTerminalSetupMode();
        const terminalSetupPending = hasPendingTerminalSetup();
        const localTerminals = (!Array.isArray(currentConfig) && currentConfig?.terminals) ? currentConfig.terminals : [];
        const localPairedTerminal = (localTerminals || []).find(
          (t: any) => t.config?.currentDeviceId === storedDeviceId
        );
        const isVisorMode = new URLSearchParams(window.location.search).get('view') === 'VISOR';
        const hasStartupTransactions = Array.isArray(data.transactions) && data.transactions.length > 0;
        const shouldResumeSetupWizard =
          terminalSetupPending &&
          setupMode === 'SERVER_LOCAL' &&
          setupFlowStage === 'VERTICAL_SELECTED' &&
          !masterIp &&
          !localPairedTerminal &&
          !isVisorMode;
        const shouldResumeVerticalSelection =
          terminalSetupPending &&
          setupMode === 'SERVER_LOCAL' &&
          !setupWizardCompleted &&
          !setupFlowStage &&
          !masterIp &&
          !localPairedTerminal &&
          !isVisorMode;
        const shouldReplayLegacySetupFlow =
          setupWizardCompleted &&
          setupFlowVersion !== SETUP_FLOW_VERSION &&
          !masterIp &&
          !localPairedTerminal &&
          !isVisorMode &&
          !hasStartupTransactions &&
          isSeedSetupBusinessConfig(currentConfig);
        const shouldChooseTerminalMode =
          terminalSetupPending &&
          !isVisorMode &&
          !setupMode &&
          !localPairedTerminal &&
          !setupWizardCompleted;
        const shouldPairAsServerErp =
          terminalSetupPending &&
          !isVisorMode &&
          setupMode === 'SERVER_ERP' &&
          !localPairedTerminal;
        const shouldPairAsClient =
          terminalSetupPending &&
          !isVisorMode &&
          setupMode === 'CLIENT' &&
          !localPairedTerminal;

        const shouldResolveMasterFromCloud = !masterIp && (
          shouldPairAsClient || localPairedTerminal?.config?.isPrimaryNode === false
        );

        if (shouldResolveMasterFromCloud) {
          const cloudEndpoint = await resolveMasterEndpointFromCloud();
          const discoveredMasterIp = normalizeMasterHost(cloudEndpoint?.localIp || cloudEndpoint?.endpointUrl || '');
          if (discoveredMasterIp) {
            masterIp = discoveredMasterIp;
            console.log(`[BOOT] Master resuelto desde Cloud-Admin: ${discoveredMasterIp}`);
          }
        }

        if (shouldResumeSetupWizard || shouldReplayLegacySetupFlow || shouldResumeVerticalSelection) {
          const resumeView = shouldResumeSetupWizard
            ? 'SETUP'
            : 'VERTICAL_SELECTOR';
          console.log(`[BOOT] Resuming initial setup flow in ${resumeView} mode...`);
          setCurrentView(resumeView);
          setIsDataLoaded(true);
          setIsSecurityLoaded(true);
          return;
        }

        if (shouldChooseTerminalMode) {
          console.log('[BOOT] Activation completed. Waiting for server/client selection...');
          setCurrentView('TERMINAL_MODE_SELECTOR');
          setIsDataLoaded(true);
          setIsSecurityLoaded(true);
          return;
        }

        if (shouldPairAsClient) {
          console.log('[BOOT] Client mode selected. Redirecting to terminal pairing...');
          setCurrentView('TERMINAL_PAIRING');
          setIsDataLoaded(true);
          setIsSecurityLoaded(true);
          return;
        }

        if (shouldPairAsServerErp) {
          console.log('[BOOT] ERP direct mode selected. Redirecting to ERP terminal pairing...');
          setCurrentView('TERMINAL_PAIRING');
          setIsDataLoaded(true);
          setIsSecurityLoaded(true);
          return;
        }

        // --- PAIRING CHECK & REDIRECT ---
        // If no local pairing exists and we have no master IP, we are definitely unpaired.
        // We must bail OUT of the loading sequence to let the user pair.
        if (!localPairedTerminal && setupWizardCompleted) {
          console.warn('[BOOT] Dispositivo no vinculado. Redirigiendo a selección de terminal para evitar autoasignaciones silenciosas...');
          setIsDataLoaded(true); // Stop "Loading CLIC POS..."
          setIsSecurityLoaded(true); // Bypass "Loading Security..."
          setCurrentView('TERMINAL_PAIRING');
          return;
        }

        // --- AGENDA STARTUP CHECK ---
        if (localPairedTerminal?.config?.startWithAgenda && !new URLSearchParams(window.location.search).get('view')) {
          console.log('📅 Startup: Configured to start in AGENDA mode.');
          // We set the view but still allow data loading to proceed
          // Authentication will be handled by the Agenda view or App layout if needed
          setCurrentView('AGENDA');
        }

        const shouldFetchConfigFromMaster = !!masterIp && (
          !localPairedTerminal || localPairedTerminal?.config?.isPrimaryNode === false
        );

        if (masterIp && !shouldFetchConfigFromMaster && localPairedTerminal?.config?.isPrimaryNode) {
          console.warn('⚠️ Stale pos_master_ip detected on MASTER terminal. Clearing slave pointer.');
          localStorage.removeItem('pos_master_ip');
        }

        if (shouldFetchConfigFromMaster) {
          console.log("🔄 Slave Mode: Fetching latest config from Master...");
          const fetchConfigFromMaster = async (host: string) => {
            for (const baseUrl of buildMasterUrlCandidates(host)) {
              const targetUrl = `${baseUrl}/api/config`;
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 3000);

              try {
                const res = await fetch(targetUrl, { signal: controller.signal });
                if (!res.ok) continue;

                const payload = await res.json();
                localStorage.setItem('CLIC_POS_MASTER_URL', baseUrl);
                localStorage.setItem('pos_master_ip', new URL(baseUrl).hostname);
                return payload;
              } finally {
                clearTimeout(timeoutId);
              }
            }

            return null;
          };

          try {
            let fetchedConfig = masterIp ? await fetchConfigFromMaster(masterIp) : null;

            if (!fetchedConfig) {
              const cloudEndpoint = await resolveMasterEndpointFromCloud();
              const refreshedMasterIp = normalizeMasterHost(cloudEndpoint?.localIp || cloudEndpoint?.endpointUrl || '');

              if (refreshedMasterIp && refreshedMasterIp !== masterIp) {
                console.warn(`⚠️ Master IP actualizada desde cloud: ${masterIp || 'N/D'} -> ${refreshedMasterIp}`);
                masterIp = refreshedMasterIp;
                fetchedConfig = await fetchConfigFromMaster(refreshedMasterIp);
              }
            }

            if (fetchedConfig && fetchedConfig.terminals) {
              const normalizedFetchedConfig = normalizeTerminalDocumentAssignments(fetchedConfig);
              const configFromMaster = normalizedFetchedConfig.config;
              if (configFromMaster && !Array.isArray(configFromMaster) && configFromMaster.terminals) {
                console.log("✅ Config fetched from Master. Saving to local DB...");
                await db.save('config', configFromMaster);
                currentConfig = configFromMaster;
              }
            }
          } catch (e: any) {
            console.error("❌ Failed to fetch config from Master (Timeout/Network):", e.name === 'AbortError' ? 'Timeout' : e.message);
          }
        }

        // CLEAN SYNC CACHE if recovering from error
        const lastStatus = localStorage.getItem('pos_sync_status');
        if (lastStatus === 'ERROR') {
          console.warn("⚠️ Detectado reinicio tras error. Forzando Snapshot fresco.");
          localStorage.removeItem('pos_sync_status');
          await dbAdapter.saveCollection('syncMetadata', {} as any);
        }

        // EMERGENCY CLEANUP: Detect if we switched from localhost to IP (or vice versa)
        const currentOrigin = window.location.origin;
        const lastOrigin = localStorage.getItem('pos_last_origin');

        if (lastOrigin && lastOrigin !== currentOrigin) {
          console.warn(`🚨 Origin changed (${lastOrigin} -> ${currentOrigin}). NUKING LOCAL DB.`);
          localStorage.setItem('pos_last_origin', currentOrigin);
          const DB_NAME = 'clic_pos_db_v1';
          try {
            localStorage.removeItem('sync_tokens');
            localStorage.removeItem('connected_terminals');
            const req = indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = () => window.location.reload();
            return;
          } catch (e) {
            console.error("Error clearing DB:", e);
          }
        } else {
          localStorage.setItem('pos_last_origin', currentOrigin);
        }

        if (data) {
          const hydrateDeferredCollections = async () => {
            // Avoid long full scans of transactions during startup for history, 
            // but ALWAYS load active transactions to ensure Monitor X / Finance Dashboard accuracy.
            try {
              console.log('📦 Loading active transactions for session...');
              console.log('📦 Loading active transactions for session...');
              let activeTxns = await db.get('transactions') as Transaction[];

              // --- SELF-HEAL: Commented out to prevent regression ---
              /*
              if (Array.isArray(activeTxns)) {
                // ... (Healing logic disabled)
              }
              */
              // ------------------------------------------------

              if (Array.isArray(activeTxns) && activeTxns.length > 0) {
                setTransactions(activeTxns.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
              } else {
                setTransactions([]);
              }

              const txHistory = await db.get('transactionHistory') as Transaction[];
              if (Array.isArray(txHistory) && txHistory.length > 0) {
                console.log(`📦 Deferred load: transactionHistory=${txHistory.length}`);
              }
            } catch (error) {
              console.info('ℹ️ Deferred hydration partial failure:', error);
            }
          };

          // 1. Cargar persistencia - PRIORITIZE currentConfig (which might be from Master)
          let finalConfig = (currentConfig && !Array.isArray(currentConfig) && Object.keys(currentConfig).length > 0) ? currentConfig : config;

          setConfig({
            ...config,
            ...finalConfig,
            campaigns: (data.campaigns && data.campaigns.length > 0) ? data.campaigns : (finalConfig.campaigns || config.campaigns || []),
            coupons: (data.coupons && data.coupons.length > 0) ? data.coupons : (finalConfig.coupons || config.coupons || [])
          });

          setUsers(data.users || []);
          setRoles(data.roles || DEFAULT_ROLES);
          setCustomers(data.customers || []);
          setTransactions(data.transactions || []);
          setProducts(data.products || []);
          setWarehouses(data.warehouses || []);
          setCashMovements(data.cashMovements || []);
          setZReports(data.zReports || []);
          setPurchaseOrders(data.purchaseOrders || []);
          setSuppliers(data.suppliers || []);
          setParkedTickets(Array.isArray(data.parkedTickets) ? data.parkedTickets : []);
          setTransfers(data.transfers || []);
          setInternalSequences(data.internalSequences || []);
          setReceptions(data.receptions || []);
          setProductStocks(data.productStocks || []);
          setRooms(data.rooms || []);
          setTables(data.tables || []);
          setCollections(data.collections || []);
          if (data.rooms && data.rooms.length > 0) setActiveRoomId(data.rooms[0].id);
          setSupplierProductPrices(data.supplierProductPrices || []);

          // Transactions/history are intentionally deferred in db.init to avoid startup lockups.
          // Delay hydration a bit to reduce contention with startup writes/sync handshakes.
          window.setTimeout(() => {
            void hydrateDeferredCollections();
          }, 2000);

          // 1.5 Sequence repair is intentionally deferred; running it here can block startup
          // when transaction stores are large or locked.

          // 3. Verificación de Vinculación - USE finalConfig (Master prioritized)
          const terminals = finalConfig.terminals || [];
          const pairedTerminal = terminals.find(
            (t: any) => t.config?.currentDeviceId === storedDeviceId
          );

          const shouldRunInitialSetupWizard =
            !setupWizardCompleted &&
            !masterIp &&
            !pairedTerminal &&
            !isVisorMode;

          if (shouldRunInitialSetupWizard) {
            console.log('[BOOT] First installation detected. Launching setup wizard...');
            setCurrentView('VERTICAL_SELECTOR');
            setIsDataLoaded(true);
            setIsSecurityLoaded(true);
            return;
          }

          if (!pairedTerminal && !isVisorMode && currentView !== 'VISOR') {
            setCurrentView('DEVICE_UNAUTHORIZED');
          }

          // 4. Initialize Sync Manager
          if (pairedTerminal) {
            let effectivePairedTerminal = pairedTerminal;

            if (effectivePairedTerminal.config.isPrimaryNode === false && effectivePairedTerminal.config.governedByMaster) {
              console.log(`🛡️ Master Governance active for ${effectivePairedTerminal.id}. Enforcing Master config.`);
              // We already have finalConfig from Master if IP was set, but we re-enforce the terminals part
            }

            await syncManager.initialize(finalConfig, effectivePairedTerminal.id);

            try {
              const refreshedTerminalConfig = await syncManager.refreshTerminalResolvedConfig(undefined, {
                baseConfig: finalConfig,
                dispatchEvent: false,
              });

              if (refreshedTerminalConfig) {
                finalConfig = refreshedTerminalConfig;
                currentConfig = refreshedTerminalConfig;
                setConfig(refreshedTerminalConfig);
                effectivePairedTerminal =
                  (refreshedTerminalConfig.terminals || []).find(
                    (t: any) => t.id === pairedTerminal.id || t.config?.currentDeviceId === storedDeviceId
                  ) || effectivePairedTerminal;
              }
            } catch (refreshError) {
              console.warn('⚠️ Startup terminal snapshot refresh failed. Using last known local config.', refreshError);
            }

            // Auto-heal catalog/config drift on startup.
            // This catches the "2 categories / old products" mixed-state on both master and slaves.
            try {
              const normalizeCategory = (value: any) =>
                typeof value === 'string' ? value.trim().toLowerCase() : '';

              const localProducts = await db.get('products') as Product[];
              const localCount = Array.isArray(localProducts) ? localProducts.length : 0;
              const sellableCategories = new Set(
                (localProducts || [])
                  .filter((p: any) => p && p.is_sellable !== false)
                  .map((p: any) => normalizeCategory(p.category))
                  .filter(Boolean)
              );

              const terminalAllowedCategories = (effectivePairedTerminal.config?.catalog?.allowedCategories || [])
                .map((cat: any) => normalizeCategory(cat))
                .filter(Boolean);
              const matchedAllowedCategoriesCount = terminalAllowedCategories.filter(cat => sellableCategories.has(cat)).length;
              const allowedCoverageRatio = terminalAllowedCategories.length > 0
                ? matchedAllowedCategoriesCount / terminalAllowedCategories.length
                : 1;

              const hasTinyCatalog = localCount > 0 && localCount <= 5;
              const hasCategoryMismatch =
                terminalAllowedCategories.length >= 2 &&
                (matchedAllowedCategoriesCount === 0 || allowedCoverageRatio < 0.5);

              if (hasTinyCatalog || hasCategoryMismatch) {
                console.warn(
                  `⚠️ Catalog drift detected on ${effectivePairedTerminal.id}. ` +
                  `localProducts=${localCount}, sellableCategories=${sellableCategories.size}, allowedCategories=${terminalAllowedCategories.length}, matchedAllowed=${matchedAllowedCategoriesCount}. ` +
                  `Running forcePullAll...`
                );
                await syncManager.forcePullAll();
              }
            } catch (driftCheckError) {
              console.error('❌ Catalog auto-heal check failed:', driftCheckError);
            }

            // Master Re-hydration Step: This ensures state is always up to date with DB 
            // after any async drift fixes or sync initializations.
            try {
              const [dbConfig, dbProducts, dbUsers, dbRoles, dbSequences] = await Promise.all([
                db.get('config') as Promise<any>,
                db.get('products') as Promise<Product[]>,
                db.get('users') as Promise<User[]>,
                db.get('roles') as Promise<RoleDefinition[]>,
                db.get('internalSequences') as Promise<any[]>
              ]);

              // CRITICAL: db.get returns an array from IndexedDB. We must unwrap config.
              let syncedConfig = dbConfig;
              if (Array.isArray(dbConfig)) {
                // CRITICAL: Seeking 'current' config and skipping meta-documents
                syncedConfig = dbConfig.find((c: any) => c.id === 'current') ||
                  dbConfig.find((c: any) => c.id !== '_db_initialized' && c.id !== 'config_metadata') ||
                  dbConfig[0];
              }

              if (syncedConfig && syncedConfig.terminals) {
                console.log('📦 App: Hydrating config from DB:', syncedConfig.id || 'main');
                setConfig(syncedConfig);
              }

              if (Array.isArray(dbProducts) && dbProducts.length > 0) {
                setProducts(dbProducts);
              }
              if (Array.isArray(dbUsers)) setUsers(dbUsers);
              if (Array.isArray(dbRoles)) setRoles(dbRoles);
              if (Array.isArray(dbSequences)) setInternalSequences(dbSequences);
            } catch (rehydrationError) {
              console.warn('⚠️ Post-init rehydration failed:', rehydrationError);
            }

            if (effectivePairedTerminal.config.isPrimaryNode === false) {
              syncManager.startAutoSync(30000);
              console.log('🔄 Auto-sync enabled for slave terminal');
            } else {
              syncManager.startAutoSync(45000);
              console.log('🔄 Auto-sync backup enabled for master terminal');
            }

            permissionService.initialize(finalConfig, effectivePairedTerminal.id);
            authLevelService.init(finalConfig, effectivePairedTerminal.id);
            terminalRouter.init(finalConfig, effectivePairedTerminal.id, effectivePairedTerminal.config.deviceRole || null);

            // --- CRITICAL SECURITY BOOTSTRAP ---
            try {
              // Check if we have users. If not, we must fast-sync before allowing Login
              const localUsers = await db.get('users') as User[];
              if (!Array.isArray(localUsers) || localUsers.length === 0) {
                console.log('🔒 Security Bootstrap: No users found. Starting Fast Sync...');
                await syncManager.fastSyncCoreData();

                const syncedUsers = await db.get('users') as User[];
                if (Array.isArray(syncedUsers) && syncedUsers.length > 0) {
                  setIsSecurityLoaded(true);
                  setUsers(syncedUsers);
                } else {
                  throw new Error('No users received from Master. Check terminal pairing.');
                }
              } else {
                setIsSecurityLoaded(true);
              }
            } catch (bootstrapErr: any) {
              console.error('❌ Security Bootstrap Failed:', bootstrapErr);
              setBootstrapError(bootstrapErr.message || 'Error loading security data.');
            }
            // -----------------------------------

            if (!authLevelService.shouldRequireUserLogin()) {
              const authResult = await authLevelService.authenticateHeadless();
              if (authResult.success) {
                const defaultRoute = authLevelService.getDefaultRoute();
                const routeToViewMap: Record<string, ViewState> = {
                  '/pos': 'POS',
                  '/kiosk/welcome': 'KIOSK_WELCOME',
                  '/checker/scan': 'CHECKER_SCAN',
                  '/inventory/home': 'INVENTORY_HOME',
                  '/kitchen/orders': 'KITCHEN_ORDERS'
                };
                setCurrentView(routeToViewMap[defaultRoute] || 'POS');
              }
            }

            if (permissionService.isMasterTerminal()) {
              transactionSyncService.startTransactionPolling(15000, async (txns) => {
                if (txns.length === 0) return;
                for (const txn of txns) {
                  await transactionSyncService.processReceivedTransaction(txn, async (t) => {
                    await db.saveDocument('transactions', t);
                  });
                }
                await apiSyncAdapter.ackPendingTransactions(txns.map(t => t.id));
                setTransactions(prev => {
                  const merged = new Map<string, Transaction>();
                  (prev || []).forEach(t => merged.set(t.id, t));
                  txns.forEach(t => merged.set(t.id, t));
                  return Array.from(merged.values())
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                });
              });

              inventorySyncService.startInventoryPolling(15000, async (movements) => {
                if (movements.length === 0) return;
                const affectedProducts = new Set<string>();
                const affectedWarehouses = new Set<string>();
                for (const move of movements) {
                  await db.saveDocument('inventoryLedger', move);
                  affectedProducts.add(move.productId);
                  affectedWarehouses.add(move.warehouseId);
                }
                await apiSyncAdapter.ackPendingInventoryMovements(movements.map(m => m.id));
                for (const productId of affectedProducts) {
                  for (const warehouseId of affectedWarehouses) {
                    await db.recalculateProductStock(productId, warehouseId);
                  }
                }
                const updatedProducts = await db.get('products') as Product[];
                setProducts(updatedProducts);
              });
            }

            // NOTE: NetworkSyncService deprecated. SyncManager/ApiSyncAdapter handles sync now.
            backgroundSyncManager.initialize().catch(console.error);

            console.log('🎉 Setting isDataLoaded = true');
            setIsDataLoaded(true);
          } else {
            console.warn('⚠️ No paired terminal found. Waiting for pairing...');
            // Still load to allow access to pairing/unauthorized screens.
            setIsDataLoaded(true);
            setIsSecurityLoaded(true);
          }
        } else {
          // First run or no data
          console.log('INFO: No data found, setting isDataLoaded = true for setup');
          setIsDataLoaded(true);
          setIsSecurityLoaded(true);
        }
      } catch (error: any) {
        console.error('CRITICAL: Failed to load initial data:', error);
        setInitialConnError(error.message || 'Error inicializando base de datos local');
        // We now handle the error display in the loading screen, so we can keep isDataLoaded = false
      }
    };
    loadData();
  }, []); // Dependencies for checking terminal role

  // CRITICAL: Listen for NetworkSyncService completion to refresh users for remote terminals
  useEffect(() => {
    const refreshDataAfterSync = async () => {
      // CRITICAL: Don't try to access DB before it's initialized
      if (!isDataLoaded) return;

      try {
        // Refresh users
        const syncedUsers = await db.get('users') as User[];
        if (syncedUsers && syncedUsers.length > 0 && syncedUsers.length !== users.length) {
          console.log(`🔄 Refreshing users list after sync: ${syncedUsers.length} users found`);
          setUsers(syncedUsers);
        }

        // Refresh products
        const syncedProducts = await db.get('products') as Product[];
        if (syncedProducts && syncedProducts.length > 0 && syncedProducts.length !== products.length) {
          console.log(`🔄 Refreshing products list after sync: ${syncedProducts.length} products found`);
          setProducts(syncedProducts);
        }

        // Refresh warehouses
        const syncedWarehouses = await db.get('warehouses') as Warehouse[];
        if (syncedWarehouses && syncedWarehouses.length > 0 && syncedWarehouses.length !== warehouses.length) {
          console.log(`🔄 Refreshing warehouses list after sync: ${syncedWarehouses.length} warehouses found`);
          setWarehouses(syncedWarehouses);
        }

        // Refresh internal sequences
        const syncedSequences = await db.get('internalSequences') as any[];
        if (syncedSequences && syncedSequences.length > 0 && syncedSequences.length !== internalSequences.length) {
          console.log(`🔄 Refreshing internal sequences after sync: ${syncedSequences.length} items found`);
          setInternalSequences(syncedSequences);
        }
      } catch (error: any) {
        // Silently ignore DB connection errors - they're expected during initialization
        if (!error?.message?.includes('DB not connected')) {
          console.error('Error refreshing data after sync:', error);
        }
      }
    };

    // Poll for data every 5 seconds if we don't have any yet (for remote terminals)
    // Increased from 3s to give NetworkSyncService more time to complete
    const interval = setInterval(() => {
      if (isDataLoaded && (users.length === 0 || products.length === 0 || internalSequences.length === 0)) {
        refreshDataAfterSync();
      }
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, [users.length, products.length, warehouses.length, isDataLoaded]);

  useEffect(() => {
    // Poll tables if in restaurant mode OR retail with tables enabled
    const usesTables = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.config?.operational?.usa_mesas;

    // IMPORTANT: avoid overriding local edits while designing layout
    if ((config.vertical === 'RESTAURANT' || usesTables) && currentView !== 'TABLE_DESIGNER') {
      fetchTables();
      const interval = setInterval(fetchTables, 10000); // Poll every 10s
      return () => clearInterval(interval);
    }
  }, [config.vertical, config.terminals, deviceId, currentView]);

  useEffect(() => {
    // --- SYNC EVENT LISTENERS (For Slave Terminals) ---
    const handleSyncUpdate = async (event: Event) => {
      const startedAt = posCatalogDebugNow();
      const collection = event.type.replace('Updated', '');
      console.log(`🔔 App: Sync update received for ${collection}. Refreshing state...`);

      const freshData = await db.get(collection as any);
      if (!freshData) return;

      switch (collection) {
        case 'products':
          setProducts(freshData as Product[]);
          {
            const matching = Array.isArray(freshData)
              ? (freshData as Record<string, unknown>[])
                  .filter((item) => posCatalogDebugMatchesRaw(item))
                  .map((item) => posCatalogDebugSummarizeItem(item))
              : [];
            if (matching.length > 0) {
              posCatalogDebugLog('App: productsUpdated → setProducts', {
                count: Array.isArray(freshData) ? freshData.length : 0,
                elapsedMs: posCatalogDebugElapsedMs(startedAt),
                matching,
              });
              void posCatalogDebugLogDbRows('App handleSyncUpdate after setProducts');
            }
          }
          break;
        case 'customers': setCustomers(freshData as Customer[]); break;
        case 'suppliers': setSuppliers(freshData as Supplier[]); break;
        case 'purchaseOrders': setPurchaseOrders(Array.isArray(freshData) ? freshData as PurchaseOrder[] : []); break;
        case 'transfers': setTransfers(Array.isArray(freshData) ? freshData as StockTransfer[] : []); break;
        case 'internalSequences': /* No state for this, used directly from DB */ break;
        case 'transactions': setTransactions(Array.isArray(freshData) ? freshData as Transaction[] : []); break;
        case 'cashMovements': setCashMovements(freshData as CashMovement[]); break;
        case 'zReports': setZReports(freshData as ZReport[]); break;
        case 'warehouses': setWarehouses(Array.isArray(freshData) ? freshData as Warehouse[] : []); break;
        case 'productStocks':
          setProductStocks(freshData as ProductStock[]);
          // CRITICAL: When detailed stocks change, we should also refresh products 
          // because they contain the aggregated stockBalances
          const freshProducts = await db.get('products') as Product[];
          setProducts(freshProducts);
          break;
      }
    };

    const syncEvents = ['productsUpdated', 'customersUpdated', 'suppliersUpdated', 'purchaseOrdersUpdated', 'transfersUpdated', 'internalSequencesUpdated', 'transactionsUpdated', 'cashMovementsUpdated', 'zReportsUpdated', 'warehousesUpdated', 'productStocksUpdated', 'tablesUpdated'];
    syncEvents.forEach(e => window.addEventListener(e, handleSyncUpdate));

    return () => {
      syncEvents.forEach(e => window.removeEventListener(e, handleSyncUpdate));
    };
  }, []);

  useEffect(() => {
    const handleConfigUpdated = async (event: Event) => {
      const incomingConfig = (event as CustomEvent<BusinessConfig>)?.detail;
      if (!incomingConfig || Array.isArray(incomingConfig) || !incomingConfig.terminals) return;

      // Detect if we actually need a full sync re-init
      const sanitize = (c: any) => {
        if (!c || typeof c !== 'object') return {};
        const { id, _db_initialized, config_metadata, _id, ...rest } = c;
        return {
          ...rest,
          integrations: Array.isArray(rest.integrations)
            ? rest.integrations.map((integration: any) => {
              if (!integration || typeof integration !== 'object') return integration;
              const { auditEvents, ...integrationRest } = integration;
              return integrationRest;
            })
            : rest.integrations,
        };
      };

      const oldConfigJson = JSON.stringify(sanitize(config));
      const newConfigJson = JSON.stringify(sanitize(incomingConfig));
      const hasSubstantialChanges = oldConfigJson !== newConfigJson;

      if (!hasSubstantialChanges) {
        console.log('🔔 App: configUpdated received but no structural changes detected. Skipping re-init.');
        setConfig(incomingConfig);
        return;
      }

      console.log('🔔 App: configUpdated received. Applying synchronized config...');
      setConfig(incomingConfig);

      const currentTerminal = (incomingConfig.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
      if (!currentTerminal) return;

      try {
        permissionService.initialize(incomingConfig, currentTerminal.id);
        authLevelService.init(incomingConfig, currentTerminal.id);
        terminalRouter.init(incomingConfig, currentTerminal.id, currentTerminal.config.deviceRole || null);
        await syncManager.initialize(incomingConfig, currentTerminal.id);

        // If allowed categories changed but local catalog is stale/partial, force a products refresh.
        const normalizeCategory = (value: any) =>
          typeof value === 'string' ? value.trim().toLowerCase() : '';

        const terminalAllowedCategories = (currentTerminal.config?.catalog?.allowedCategories || [])
          .map((cat: any) => normalizeCategory(cat))
          .filter(Boolean);

        if (terminalAllowedCategories.length >= 2) {
          const localProducts = await db.get('products') as Product[];
          const localCount = Array.isArray(localProducts) ? localProducts.length : 0;
          const sellableCategories = new Set(
            (localProducts || [])
              .filter((p: any) => p && p.is_sellable !== false)
              .map((p: any) => normalizeCategory(p.category))
              .filter(Boolean)
          );

          const matchedAllowedCategoriesCount = terminalAllowedCategories
            .filter(cat => sellableCategories.has(cat))
            .length;
          const allowedCoverageRatio = matchedAllowedCategoriesCount / terminalAllowedCategories.length;
          const hasTinyCatalog = localCount > 0 && localCount <= 5;
          const hasCategoryMismatch = matchedAllowedCategoriesCount === 0 || allowedCoverageRatio < 0.5;

          if (hasTinyCatalog || hasCategoryMismatch) {
            console.warn(
              `⚠️ App: Runtime config drift detected on ${currentTerminal.id}. ` +
              `localProducts=${localCount}, allowed=${terminalAllowedCategories.length}, matched=${matchedAllowedCategoriesCount}. ` +
              `Forcing products pull...`
            );
            await syncManager.pullCatalog('products', true);
            const refreshedProducts = await db.get('products') as Product[];
            if (Array.isArray(refreshedProducts)) {
              setProducts(refreshedProducts);
            }
          }
        }

        await syncConfigToLocalServer(incomingConfig, { surfaceErrors: false });
      } catch (error) {
        console.error('❌ Failed to apply synced config at runtime:', error);
      }
    };

    window.addEventListener('configUpdated', handleConfigUpdated as EventListener);
    return () => {
      window.removeEventListener('configUpdated', handleConfigUpdated as EventListener);
    };
  }, [config, deviceId, syncConfigToLocalServer]);

  // --- GLOBAL KEYBOARD SHORTCUT FOR ADMIN ACCESS ---
  useEffect(() => {
    const handleGlobalKeyboard = (e: KeyboardEvent) => {
      // Ctrl+Alt+A for admin escape hatch (works in kiosk modes)
      if (e.ctrlKey && e.altKey && e.key?.toLowerCase() === 'a') {
        e.preventDefault();
        e.stopPropagation();

        console.log('🔓 GLOBAL Admin shortcut triggered (Ctrl+Alt+A)');

        // Check if we're in a kiosk mode
        const currentTerminal = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
        const role = currentTerminal?.config.deviceRole?.role;

        if (role === DeviceRole.SELF_CHECKOUT ||
          role === DeviceRole.PRICE_CHECKER ||
          role === DeviceRole.KITCHEN_DISPLAY) {
          // Trigger escape hatch
          const pin = prompt('🔐 Ingrese PIN de Administrador:');
          if (pin && authLevelService.validateEscapeHatch(pin)) {
            console.log('✅ PIN correcto - Navegando a Settings');
            setIsAdminMode(true);  // Enable admin mode to prevent auto-redirect
            setCurrentView('SETTINGS');
          } else if (pin) {
            alert('❌ PIN incorrecto');
          }
        } else {
          // Not in kiosk mode, just go to settings directly
          setCurrentView('SETTINGS');
        }
      }
    };

    console.log('✅ Global keyboard shortcut registered (Ctrl+Alt+A)');
    document.addEventListener('keydown', handleGlobalKeyboard, { capture: true });

    return () => {
      console.log('🧹 Global keyboard shortcut removed');
      document.removeEventListener('keydown', handleGlobalKeyboard, { capture: true });
    };
  }, [config, deviceId]); // Dependencies for checking terminal role

  // --- CORE EVENT HANDLERS ---

  const handlePairTerminal = async (
    terminalId: string,
    pairingContext?: string | {
      tenantId?: string;
      erpTerminalId?: string;
      erpBaseUrl?: string;
      terminalName?: string;
      companyId?: string;
      storeId?: string;
      boundConfig?: BusinessConfig;
      boundUsers?: User[];
      masterIp?: string;
      snapshotItems?: Product[];
      snapshotMeta?: {
        fullPullOnPairing?: boolean;
        resolutionError?: unknown;
      };
    },
    options?: { forceTakeover?: boolean }
  ) => {
    setRestoringHistory(true);
    const previousConfig = config;
    const previousUsers = users;
    const previousActiveTerminalId = localStorage.getItem('active_terminal_id');
    const previousTerminalStorageId = localStorage.getItem('CLIC_POS_TERMINAL_ID');
    const previousInitialTerminalConfig = localStorage.getItem('initial_terminal_config');
    try {
      const setupResult = typeof pairingContext === 'object' && pairingContext !== null ? pairingContext : undefined;
      const resolvedMasterIp = typeof pairingContext === 'string' ? pairingContext : setupResult?.masterIp;
      const previouslyAssignedTerminal = (config.terminals || []).find(t => t.id === terminalId);
      const normalizedResolvedMasterIp = normalizeMasterHost(resolvedMasterIp || '');
      const reachableMasterBinding = normalizedResolvedMasterIp
        ? await resolveReachableMasterBinding(normalizedResolvedMasterIp)
        : null;
      const finalResolvedMasterIp = reachableMasterBinding?.host || normalizedResolvedMasterIp;
      const finalResolvedMasterUrl = reachableMasterBinding?.baseUrl || (finalResolvedMasterIp ? buildMasterUrlFromHost(finalResolvedMasterIp) : '');
      const resolvedErpBaseUrl =
        normalizeSetupBaseUrl(setupResult?.erpBaseUrl || null)
        || resolveSetupErpBaseUrl();
      if (!setupResult?.boundConfig) {
        throw new Error('La vinculación debe provenir del backend central de setup. No se recibió configuración enlazada.');
      }
      const updatedConfig = clearDuplicateDeviceAssignments(setupResult.boundConfig, deviceId, {
        activeTerminalId: terminalId,
        bindingTerminalId: setupResult?.erpTerminalId || terminalId,
        bindingLocalTerminalId: terminalId,
      }).config;
      const selectedTerminal = (updatedConfig.terminals || []).find(t => t.id === terminalId);
      const resolvedTerminalName =
        setupResult?.terminalName
        || selectedTerminal?.config?.terminalName
        || selectedTerminal?.config?.stationNumber
        || selectedTerminal?.id
        || terminalId;
      const resolvedErpTerminalId =
        setupResult?.erpTerminalId
        || selectedTerminal?.config?.erpTerminalId
        || terminalId;
      const isSlave = selectedTerminal?.config?.isPrimaryNode === false;
      const wasOccupiedByAnotherDevice =
        !!previouslyAssignedTerminal?.config?.currentDeviceId &&
        previouslyAssignedTerminal.config.currentDeviceId !== deviceId;
      const shouldTakeover = options?.forceTakeover || wasOccupiedByAnotherDevice;
      const configSyncUrl = finalResolvedMasterUrl
        ? `${finalResolvedMasterUrl}/api/config`
        : buildConfigSyncUrl();

      setConfig(updatedConfig);
      await db.save('config', updatedConfig);
      const operationalDocumentState = extractTerminalOperationalDocumentState(updatedConfig, terminalId);
      await db.rehydrateOperationalDocumentState(
        operationalDocumentState.documentSeries,
        operationalDocumentState.fiscalRanges,
        operationalDocumentState.fiscalAllocations,
        operationalDocumentState.terminalId,
      );
      const storedSetupMode = getStoredTerminalSetupMode();
      const nextSetupMode: TerminalSetupMode = isSlave
        ? 'CLIENT'
        : storedSetupMode === 'SERVER_ERP'
          ? 'SERVER_ERP'
          : 'SERVER_LOCAL';
      localStorage.setItem(TERMINAL_SETUP_MODE_KEY, nextSetupMode);
      const resolvedTenantId =
        setupResult?.tenantId || localStorage.getItem('active_tenant_id') || 'default-tenant';
      localStorage.setItem('active_tenant_id', resolvedTenantId);
      if (resolvedTenantId && resolvedTenantId !== 'default-tenant') {
        localStorage.setItem('clic_tenant_id', resolvedTenantId);
      }

      if (Array.isArray(setupResult?.boundUsers)) {
        setUsers(setupResult.boundUsers);
        await db.save('users', setupResult.boundUsers);
      }

      if (isSlave && finalResolvedMasterIp) {
        localStorage.setItem('pos_master_ip', finalResolvedMasterIp);
        localStorage.setItem('CLIC_POS_MASTER_URL', finalResolvedMasterUrl);
      }

      // If user takes control of a MASTER terminal, clear stale slave pointers.
      if (!isSlave) {
        localStorage.removeItem('pos_master_ip');
        const runtimeMasterUrl = buildRuntimeMasterUrl();
        localStorage.setItem('CLIC_POS_MASTER_URL', runtimeMasterUrl);
      }

      // Always persist binding to backend before re-initializing sync.
      // This prevents pulling old config right after takeover.
      if (configSyncUrl) {
        try {
          const res = await fetch(configSyncUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Active-Terminal-Id': terminalId,
              'X-Device-Id': deviceId,
            },
            body: JSON.stringify(updatedConfig)
          });
          if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status} ${detail}`.trim());
          }
          console.log(`✅ Binding synced to backend at ${configSyncUrl}`);
        } catch (e) {
          console.error("❌ Failed to sync binding to backend:", e);
          // We continue; local binding is already saved.
        }
      } else {
        console.log('ℹ️ Native standalone runtime detected. Skipping backend binding sync.');
      }

      void publishMasterEndpointToCloud({
        deviceId,
        terminalId,
        terminalName: resolvedTerminalName,
        isPrimary: !isSlave,
      });

      const shouldRestoreRemoteData = !!finalResolvedMasterIp && (isSlave || shouldTakeover);

      // If we're taking over a previous server or pairing as slave, hydrate from the remote box first.
      if (shouldRestoreRemoteData) {
        try {
          const remoteRestoreConfig: BusinessConfig = {
            ...updatedConfig,
            terminals: (updatedConfig.terminals || []).map((terminal) => {
              if (terminal.id !== terminalId) return terminal;
              return {
                ...terminal,
                config: {
                  ...terminal.config,
                  isPrimaryNode: false
                }
              };
            })
          };

          localStorage.setItem('pos_master_ip', finalResolvedMasterIp);
          localStorage.setItem('CLIC_POS_MASTER_URL', finalResolvedMasterUrl);

          // Re-initialize sync manager with a temporary slave profile to pull history/catalogs
          await syncManager.initialize(remoteRestoreConfig, terminalId);
          await syncManager.restoreHistory(terminalId);

          console.log('🔄 Forcing full catalog sync to restore sequences...');
          await syncManager.syncAllCatalogs();

          // Reload data from DB after restoration
          const freshData = await db.init();
          setTransactions(freshData.transactions);
          setProducts(freshData.products);
          setCashMovements(freshData.cashMovements);
          setZReports(freshData.zReports || []);
        } catch (error) {
          console.error('Failed to restore history:', error);
          alert(shouldTakeover
            ? 'Se tomó control de la terminal, pero no se pudo restaurar la información del equipo anterior. Revisa conectividad cloud/red local.'
            : 'No se pudo restaurar el historial desde la Maestra. El equipo funcionará, pero sin datos previos.');
        }
      }

      // CRITICAL: Re-initialize services with the final terminal role after any restore.
      console.log(`🛠️ Re-initializing services for ${isSlave ? 'Slave' : 'Master'} terminal...`);
      if (!isSlave) {
        localStorage.removeItem('pos_master_ip');
        localStorage.setItem('CLIC_POS_MASTER_URL', buildRuntimeMasterUrl());
      }
      permissionService.initialize(updatedConfig, terminalId);
      await syncManager.initialize(updatedConfig, terminalId);
      const shouldFullPullOnPairing = setupResult?.snapshotMeta?.fullPullOnPairing ?? true;
      if (shouldFullPullOnPairing) {
        await syncManager.fullPull();
      } else {
        if (Array.isArray(setupResult?.snapshotItems) && setupResult.snapshotItems.length > 0) {
          const normalizedSnapshotItems = await productImageCacheService.normalizeIncomingProducts(setupResult.snapshotItems);
          await db.save('products', normalizedSnapshotItems);
          void productImageCacheService.syncSnapshotItems(normalizedSnapshotItems).catch((error) => {
            console.warn('⚠️ Snapshot product image sync failed after pairing:', error);
          });
        }
        await syncManager.refreshTerminalResolvedConfig();
      }

      const persistedConfigAfterSync = resolvePersistedBusinessConfig(await db.get('config') as unknown);
      const postSyncConfig = persistedConfigAfterSync || updatedConfig;

      const refreshedOperationalDocumentState = extractTerminalOperationalDocumentState(postSyncConfig, terminalId);
      await db.rehydrateOperationalDocumentState(
        refreshedOperationalDocumentState.documentSeries,
        refreshedOperationalDocumentState.fiscalRanges,
        refreshedOperationalDocumentState.fiscalAllocations,
        refreshedOperationalDocumentState.terminalId,
      );

      const freshData = await db.init();
      const hydratedConfig = resolvePersistedBusinessConfig(await db.get('config') as unknown) || postSyncConfig;
      flushSync(() => {
        setConfig(hydratedConfig);
        if (Array.isArray(freshData.users)) {
          setUsers(freshData.users);
        }
      });
      if (Array.isArray(freshData.users)) setUsers(freshData.users);
      if (Array.isArray(freshData.roles)) setRoles(freshData.roles);
      if (Array.isArray(freshData.customers)) setCustomers(freshData.customers);
      if (Array.isArray(freshData.transactions)) setTransactions(freshData.transactions);
      if (Array.isArray(freshData.products)) setProducts(freshData.products);
      if (Array.isArray(freshData.warehouses)) setWarehouses(freshData.warehouses);
      if (Array.isArray(freshData.cashMovements)) setCashMovements(freshData.cashMovements);
      if (Array.isArray(freshData.zReports)) setZReports(freshData.zReports);
      if (Array.isArray(freshData.purchaseOrders)) setPurchaseOrders(freshData.purchaseOrders);
      if (Array.isArray(freshData.suppliers)) setSuppliers(freshData.suppliers);
      if (Array.isArray(freshData.parkedTickets)) setParkedTickets(freshData.parkedTickets);
      if (Array.isArray(freshData.transfers)) setTransfers(freshData.transfers);
      if (Array.isArray(freshData.internalSequences)) setInternalSequences(freshData.internalSequences);
      if (Array.isArray(freshData.receptions)) setReceptions(freshData.receptions);
      if (Array.isArray(freshData.productStocks)) setProductStocks(freshData.productStocks);
      if (Array.isArray(freshData.rooms)) setRooms(freshData.rooms);
      if (Array.isArray(freshData.tables)) setTables(freshData.tables);
      if (Array.isArray(freshData.collections)) setCollections(freshData.collections);
      if (Array.isArray(freshData.supplierProductPrices)) setSupplierProductPrices(freshData.supplierProductPrices);

      localStorage.removeItem(TERMINAL_SETUP_PENDING_KEY);
      localStorage.setItem('active_terminal_id', terminalId);
      localStorage.setItem('CLIC_POS_TERMINAL_ID', terminalId);
      localStorage.setItem('initial_terminal_config', JSON.stringify(hydratedConfig));
      if (resolvedErpBaseUrl) {
        persistSetupErpBaseUrls(resolvedErpBaseUrl);
      }
      persistStoredErpSyncBinding({
        tenantId: setupResult?.tenantId || localStorage.getItem('active_tenant_id') || null,
        terminalId: resolvedErpTerminalId,
        localTerminalId: terminalId,
        terminalName: resolvedTerminalName,
        companyId: setupResult?.companyId || null,
        storeId: setupResult?.storeId || null,
      });

      setCurrentView('LOGIN');
    } catch (error) {
      console.error('❌ Failed to take terminal control:', error);
      clearStoredErpSyncBinding();
      localStorage.setItem(TERMINAL_SETUP_PENDING_KEY, '1');
      if (previousActiveTerminalId) {
        localStorage.setItem('active_terminal_id', previousActiveTerminalId);
      } else {
        localStorage.removeItem('active_terminal_id');
      }
      if (previousTerminalStorageId) {
        localStorage.setItem('CLIC_POS_TERMINAL_ID', previousTerminalStorageId);
      } else {
        localStorage.removeItem('CLIC_POS_TERMINAL_ID');
      }
      if (previousInitialTerminalConfig) {
        localStorage.setItem('initial_terminal_config', previousInitialTerminalConfig);
      } else {
        localStorage.removeItem('initial_terminal_config');
      }
      setConfig(previousConfig);
      await db.save('config', previousConfig);
      setUsers(previousUsers);
      await db.save('users', previousUsers);
      alert('No se pudo tomar control de la terminal. Revisa conexión y vuelve a intentar.');
    } finally {
      setRestoringHistory(false);
    }
  };

  const handleSetupWizardComplete = async (finalConfig: BusinessConfig) => {
    try {
      const nextConfig = {
        ...config,
        ...finalConfig
      };
      const effectiveDeviceId = deviceId || localStorage.getItem('pos_device_id') || '';
      const seedMode = nextConfig.metadata?.seedMode;
      if (seedMode === 'BLANK') {
        setCustomers([]);
        setProducts([]);
        setTransactions([]);
        setProductStocks([]);
      }

      localStorage.removeItem(TERMINAL_SETUP_PENDING_KEY);
      localStorage.setItem(TERMINAL_SETUP_MODE_KEY, 'SERVER_LOCAL');
      localStorage.setItem(SETUP_WIZARD_COMPLETED_KEY, '1');
      localStorage.setItem(SETUP_FLOW_STAGE_KEY, 'COMPLETE');
      localStorage.setItem(SETUP_FLOW_VERSION_KEY, SETUP_FLOW_VERSION);

      const setupMode = getStoredTerminalSetupMode();
      if (setupMode === 'SERVER_LOCAL') {
        const binding = await activateLocalPrimaryTerminal(nextConfig, effectiveDeviceId);
        if (binding) {
          localStorage.setItem('active_terminal_id', binding.terminalId);
          localStorage.setItem('CLIC_POS_TERMINAL_ID', binding.terminalId);
          localStorage.setItem('initial_terminal_config', JSON.stringify(binding.nextConfig || nextConfig));
          setCurrentView('LOGIN');
          return;
        }
      }

      setConfig(nextConfig);
      await db.save('config', nextConfig);

      const hasPairedTerminal = (nextConfig.terminals || []).some(
        terminal => terminal.config?.currentDeviceId === effectiveDeviceId
      );

      setCurrentView(hasPairedTerminal ? 'LOGIN' : 'TERMINAL_PAIRING');
    } catch (error) {
      console.error('❌ Failed to complete setup wizard:', error);
      alert('No se pudo guardar la configuración inicial. Intenta nuevamente.');
    }
  };

  const handleConfigUpdate = async (newConfig: BusinessConfig) => {
    console.log("handleConfigUpdate called", newConfig); // Debug log
    setConfig(newConfig);
    await db.save('config', newConfig);

    // Initial Startup Logic for Floor Plan
    const activeTerminal = (newConfig.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
    const tableBehavior = activeTerminal?.config?.tables?.behavior;
    if (tableBehavior === 'SIEMPRE_MOSTRAR' && currentView === 'LOGIN') {
      // Only valid if we are transitioning from login, but handled in renderView or logic
    }

    // Re-initialize services with new config
    const currentTerminal = (newConfig.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
    if (currentTerminal) {
      console.log(`🔄 Re-initializing services for terminal ${currentTerminal.id} after config update...`);
      permissionService.initialize(newConfig, currentTerminal.id);
      authLevelService.init(newConfig, currentTerminal.id);
      terminalRouter.init(newConfig, currentTerminal.id, currentTerminal.config.deviceRole || null);

      // CRITICAL: Re-initialize SyncManager to avoid "Sync configuration missing"
      try {
        await syncManager.initialize(newConfig, currentTerminal.id);
        await backgroundSyncManager.initialize();
      } catch (e) {
        console.error("❌ Failed to re-initialize sync services:", e);
      }
    }

    await syncConfigToLocalServer(newConfig);
  };

  const handleUsersUpdate = async (newUsers: User[]) => {
    console.log(`handleUsersUpdate: Saving ${newUsers.length} users discovered during binding.`);
    setUsers(newUsers);
    // Persist to DB so it survives reload if they get disconnected
    for (const user of newUsers) {
      await db.save('users', user);
    }
  };

  // --- PERSISTENCE HANDLER FOR PARKED TICKETS ---
  const handleUpdateParkedTickets = async (tickets: ParkedTicket[]) => {
    setParkedTickets(tickets);
    // Persist to DB immediately
    await db.save('parkedTickets', tickets); // Uses 'settings' table logic or collection
  };

  const handleParkedOrderSplitFromMap = useCallback(
    async (orderId: string, remainingItems: CartItem[], newTicketItems: CartItem[]) => {
      const sumItems = (items: CartItem[]) =>
        items.reduce((acc, item) => acc + Number(item.price || 0) * Number(item.quantity || 0), 0);
      const source = parkedTickets.find(p => p.id === orderId);
      if (!source) {
        alert('No se encontró la orden en espera.');
        return;
      }
      const others = parkedTickets.filter(t => t.id !== orderId);
      const kept =
        remainingItems.length > 0
          ? [{ ...source, items: remainingItems, total: sumItems(remainingItems) }]
          : [];
      const tableLinked = tables.find(t => t.currentOrderId === orderId);
      const labelBase = tableLinked?.nombre || tableLinked?.name || source.name || 'Mesa';
      const newTicket: ParkedTicket = {
        ...source,
        id: `split-${Date.now()}`,
        name: `${labelBase} - Parte 2`,
        alias: `${labelBase} - Parte 2`,
        items: newTicketItems,
        total: sumItems(newTicketItems),
        timestamp: new Date().toISOString(),
        tableId: tableLinked?.id
      };
      await handleUpdateParkedTickets([...others, ...kept, newTicket]);
      await fetchTables();
    },
    [parkedTickets, tables, fetchTables]
  );

  const handleUpdateActiveTableGuests = async (guests: number) => {
    if (!activeTable) return;
    try {
      const updatedTable = { ...activeTable, guests };
      setActiveTable(updatedTable);
      
      // Update in server
      await fetch(`/api/tables/${activeTable.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guests })
      });
      
      // Update in local state list to avoid jumpy UI on refresh
      setTables(prev => prev.map(t => t.id === activeTable.id ? updatedTable : t));
    } catch (e) {
      console.error("Failed to update guest count:", e);
    }
  };

  const handleRepairLegacyReceivables = useCallback(async (): Promise<ReceivableRepairSummary> => {
    const now = new Date().toISOString();
    const [persistedTransactions, persistedTransactionHistory, persistedCustomers, persistedWallets, persistedWalletTransactions] = await Promise.all([
      db.get('transactions') as Promise<Transaction[] | null>,
      db.get('transactionHistory') as Promise<Transaction[] | null>,
      db.get('customers') as Promise<Customer[] | null>,
      db.get('wallets' as any) as Promise<any[] | null>,
      db.get('wallet_transactions' as any) as Promise<any[] | null>
    ]);

    const activeTransactions = Array.isArray(persistedTransactions) ? persistedTransactions : transactions;
    const historyTransactions = Array.isArray(persistedTransactionHistory) ? persistedTransactionHistory : [];
    const sourceCustomers = Array.isArray(persistedCustomers) ? persistedCustomers : customers;
    const wallets = Array.isArray(persistedWallets) ? persistedWallets : [];
    const walletMovements = Array.isArray(persistedWalletTransactions) ? persistedWalletTransactions : [];

    const inferPendingBalance = (tx: Transaction): number => {
      const paymentEntries = Array.isArray(tx.payments) ? tx.payments : [];
      const creditFromPayments = paymentEntries.reduce((sum: number, payment: any) => {
        const candidates = [
          normalizePaymentMethod(payment?.method),
          normalizePaymentMethod(payment?.methodLabel),
          normalizePaymentMethod(payment?.methodId),
          normalizePaymentMethod(payment?.type)
        ];
        const hasCreditMarker = candidates.some(marker => CREDIT_PAYMENT_METHODS.has(marker));
        if (!hasCreditMarker) return sum;
        return sum + toPositiveNumber(payment?.amount);
      }, 0);

      if (creditFromPayments > 0) return parseFloat(creditFromPayments.toFixed(2));

      const balanceDue = toPositiveNumber(tx.balanceDueAtSale);
      if (balanceDue > 0) return parseFloat(balanceDue.toFixed(2));

      return 0;
    };

    const repairTransactions = (items: Transaction[]) => {
      const repairedIds: string[] = [];
      const updatedItems = items.map((tx) => {
        if (tx.status === 'REFUNDED') return tx;

        const currentPending = toPositiveNumber(tx.pendingBalance);
        if (currentPending > 0) return tx;

        const inferredPending = inferPendingBalance(tx);
        if (inferredPending <= 0) return tx;

        repairedIds.push(tx.id);
        return {
          ...tx,
          pendingBalance: inferredPending,
          balanceDueAtSale: toPositiveNumber(tx.balanceDueAtSale) > 0 ? tx.balanceDueAtSale : inferredPending,
          dueDate: tx.dueDate || new Date(new Date(tx.date).getTime() + (30 * 24 * 60 * 60 * 1000)).toISOString(),
          syncStatus: 'PENDING' as const
        };
      });

      return { repairedIds, updatedItems };
    };

    const activeRepair = repairTransactions(activeTransactions);
    const historyRepair = repairTransactions(historyTransactions);

    const repairedTransactions = [...activeRepair.updatedItems];
    const repairedHistoryTransactions = [...historyRepair.updatedItems];
    const repairedIdSet = new Set([...activeRepair.repairedIds, ...historyRepair.repairedIds]);
    const repairedIds = Array.from(repairedIdSet);

    const normalizeDocId = (value: unknown): string => {
      if (typeof value !== 'string') return '';
      return value.trim().toUpperCase();
    };

    const seenDisplayIds = new Set<string>();
    for (const tx of [...repairedTransactions, ...repairedHistoryTransactions]) {
      const displayId = normalizeDocId(tx.displayId);
      if (displayId) seenDisplayIds.add(displayId);
    }

    const walletById = new Map<string, any>();
    for (const wallet of wallets) {
      if (!wallet?.id) continue;
      walletById.set(String(wallet.id), wallet);
    }

    const customerById = new Map<string, Customer>();
    for (const customer of sourceCustomers) {
      if (!customer?.id) continue;
      customerById.set(customer.id, customer);
    }

    const isRefundDocument = (tx: Transaction): boolean => {
      const docType = typeof tx.documentType === 'string' ? tx.documentType.trim().toUpperCase() : '';
      const ncfType = typeof tx.ncfType === 'string' ? tx.ncfType.trim().toUpperCase() : '';
      const displayId = typeof tx.displayId === 'string' ? tx.displayId.trim().toUpperCase() : '';
      return docType === 'REFUND' || ncfType === 'B04' || displayId.startsWith('NC');
    };

    const toMillis = (value?: string): number => {
      const ts = value ? new Date(value).getTime() : NaN;
      return Number.isFinite(ts) ? ts : 0;
    };

    const salesCandidatesByCustomer = new Map<string, Transaction[]>();
    for (const tx of [...repairedTransactions, ...repairedHistoryTransactions]) {
      const customerId = typeof tx.customerId === 'string' ? tx.customerId.trim() : '';
      if (!customerId) continue;
      if (isRefundDocument(tx)) continue;
      const list = salesCandidatesByCustomer.get(customerId) || [];
      list.push(tx);
      salesCandidatesByCustomer.set(customerId, list);
    }

    const pickAffectedInvoice = (customerId: string, creditNoteAmount: number, movementDate: string): Transaction | null => {
      const candidates = salesCandidatesByCustomer.get(customerId) || [];
      if (candidates.length === 0) return null;

      const movementMs = toMillis(movementDate);
      let best: Transaction | null = null;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const candidate of candidates) {
        let score = 0;
        if (candidate.status === 'PARTIAL_REFUND' || candidate.status === 'REFUNDED') score += 40;
        if (toPositiveNumber(candidate.total) + 0.01 >= creditNoteAmount) score += 12;

        const candidateMs = toMillis(candidate.date);
        const diffMs = movementMs > 0 && candidateMs > 0
          ? Math.abs(candidateMs - movementMs)
          : Number.POSITIVE_INFINITY;
        if (diffMs <= 24 * 60 * 60 * 1000) score += 20;
        else if (diffMs <= 7 * 24 * 60 * 60 * 1000) score += 10;
        else if (diffMs <= 30 * 24 * 60 * 60 * 1000) score += 4;

        if (typeof candidate.ncf === 'string' && candidate.ncf.trim()) score += 5;
        if (typeof candidate.displayId === 'string' && candidate.displayId.trim()) score += 3;

        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
      return best;
    };

    const extractB04NcfFromMovement = (movement: any): string | undefined => {
      const rawCandidates = [
        movement?.ncf,
        movement?.ncfB04,
        movement?.fiscalNcf,
        movement?.b04,
        movement?.metadata?.ncf,
        movement?.meta?.ncf
      ];
      for (const raw of rawCandidates) {
        if (typeof raw !== 'string') continue;
        const candidate = raw.trim().toUpperCase();
        if (candidate.startsWith('B04')) return candidate;
      }
      return undefined;
    };

    const synthesizedCreditNotes: Transaction[] = [];
    const synthesizedIdSet = new Set<string>();
    const enrichedCreditNoteIds = new Set<string>();

    const upsertTxById = (nextTx: Transaction) => {
      const activeIdx = repairedTransactions.findIndex(tx => tx.id === nextTx.id);
      if (activeIdx >= 0) repairedTransactions[activeIdx] = nextTx;
      const historyIdx = repairedHistoryTransactions.findIndex(tx => tx.id === nextTx.id);
      if (historyIdx >= 0) repairedHistoryTransactions[historyIdx] = nextTx;
    };

    const txIdsByDisplayId = new Map<string, string[]>();
    for (const tx of [...repairedTransactions, ...repairedHistoryTransactions]) {
      const key = normalizeDocId(tx.displayId);
      if (!key) continue;
      const list = txIdsByDisplayId.get(key) || [];
      if (!list.includes(tx.id)) list.push(tx.id);
      txIdsByDisplayId.set(key, list);
    }

    let scannedWalletMovements = 0;
    for (const movement of walletMovements) {
      scannedWalletMovements++;

      const refRaw = typeof movement?.referenceId === 'string' ? movement.referenceId.trim() : '';
      const ref = normalizeDocId(refRaw);
      if (!ref.startsWith('NC')) continue;

      const movementAmount = toPositiveNumber(movement?.amount);
      if (movementAmount <= 0) continue;

      const wallet = walletById.get(String(movement?.walletId || ''));
      const customerId = wallet?.customerId ? String(wallet.customerId) : '';
      if (!customerId) continue;

      const parsedMovementDate = typeof movement?.createdAt === 'string' ? new Date(movement.createdAt).getTime() : NaN;
      const movementDate = Number.isFinite(parsedMovementDate) ? String(movement.createdAt) : now;
      const roundedAmount = parseFloat(movementAmount.toFixed(2));
      const displayId = refRaw || ref;
      const inferredB04Ncf = extractB04NcfFromMovement(movement);
      const affectedSale = pickAffectedInvoice(customerId, roundedAmount, movementDate);
      const inferredAffectedInvoice = (affectedSale?.displayId || affectedSale?.id || '').toString().trim();
      const inferredAffectedNCF = (affectedSale?.ncf || '').toString().trim();

      if (seenDisplayIds.has(ref)) {
        const existingIds = txIdsByDisplayId.get(ref) || [];
        for (const existingId of existingIds) {
          const existing = repairedTransactions.find(tx => tx.id === existingId)
            || repairedHistoryTransactions.find(tx => tx.id === existingId);
          if (!existing) continue;
          if (!isRefundDocument(existing)) continue;

          const patch: Partial<Transaction> = {};
          if ((!existing.ncf || !existing.ncf.trim()) && inferredB04Ncf) patch.ncf = inferredB04Ncf;
          if ((!existing.affectedInvoiceNumber || !existing.affectedInvoiceNumber.trim()) && inferredAffectedInvoice) {
            patch.affectedInvoiceNumber = inferredAffectedInvoice;
          }
          if ((!existing.affectedNCF || !existing.affectedNCF.trim()) && inferredAffectedNCF) {
            patch.affectedNCF = inferredAffectedNCF;
          }
          if (!existing.originalTransactionId && affectedSale?.id) patch.originalTransactionId = affectedSale.id;

          if (Object.keys(patch).length <= 0) continue;

          const patchedTx: Transaction = {
            ...existing,
            ...patch,
            syncStatus: 'PENDING'
          };
          upsertTxById(patchedTx);
          await db.saveDocument('transactions', patchedTx);
          await db.saveDocument('transactionHistory', patchedTx);
          enrichedCreditNoteIds.add(patchedTx.displayId || patchedTx.id);
        }
        continue;
      }

      const owner = customerById.get(customerId);
      const rawMovementId = movement?.id !== undefined && movement?.id !== null
        ? String(movement.id).trim()
        : `${customerId}-${ref}`;
      const synthesizedId = `WLT-NC-${rawMovementId}-${customerId}`.replace(/[^a-zA-Z0-9_.:-]/g, '_');
      if (synthesizedIdSet.has(synthesizedId)) continue;

      const syntheticCreditNote: Transaction = {
        id: synthesizedId,
        displayId,
        documentType: 'REFUND',
        date: movementDate,
        items: [],
        total: roundedAmount,
        payments: [{ method: 'STORE_CREDIT', amount: roundedAmount }],
        userId: 'SYSTEM',
        userName: 'Sistema',
        terminalId: 'N/A',
        status: 'REFUNDED',
        customerId,
        customerName: owner?.name,
        ncf: inferredB04Ncf,
        ncfType: 'B04',
        affectedInvoiceNumber: inferredAffectedInvoice || undefined,
        affectedNCF: inferredAffectedNCF || undefined,
        originalTransactionId: affectedSale?.id,
        refundReason: 'NC recuperada desde wallet',
        syncStatus: 'PENDING'
      };

      synthesizedCreditNotes.push(syntheticCreditNote);
      synthesizedIdSet.add(synthesizedId);
      seenDisplayIds.add(ref);
      txIdsByDisplayId.set(ref, [...(txIdsByDisplayId.get(ref) || []), synthesizedId]);
      repairedTransactions.push(syntheticCreditNote);
      repairedHistoryTransactions.push(syntheticCreditNote);
    }

    const combinedBefore = [...activeTransactions, ...historyTransactions];
    const combinedAfter = [...repairedTransactions, ...repairedHistoryTransactions];

    const totalPendingBefore = parseFloat(combinedBefore
      .reduce((sum, tx) => sum + toPositiveNumber(tx.pendingBalance), 0)
      .toFixed(2));
    const totalPendingAfter = parseFloat(combinedAfter
      .reduce((sum, tx) => sum + toPositiveNumber(tx.pendingBalance), 0)
      .toFixed(2));

    if (activeRepair.repairedIds.length > 0) {
      const activeSet = new Set(activeRepair.repairedIds);
      for (const tx of repairedTransactions) {
        if (!activeSet.has(tx.id)) continue;
        await db.saveDocument('transactions', tx);
      }
    }

    if (historyRepair.repairedIds.length > 0) {
      const historySet = new Set(historyRepair.repairedIds);
      for (const tx of repairedHistoryTransactions) {
        if (!historySet.has(tx.id)) continue;
        await db.saveDocument('transactionHistory', tx);
      }
    }

    if (synthesizedCreditNotes.length > 0) {
      for (const note of synthesizedCreditNotes) {
        await db.saveDocument('transactions', note);
        await db.saveDocument('transactionHistory', note);
      }
    }

    const dedupedForDebt = new Map<string, Transaction>();
    for (const tx of combinedAfter) {
      if (!tx?.id) continue;
      const existing = dedupedForDebt.get(tx.id);
      if (!existing) {
        dedupedForDebt.set(tx.id, tx);
        continue;
      }

      const existingPending = toPositiveNumber(existing.pendingBalance);
      const nextPending = toPositiveNumber(tx.pendingBalance);
      if (nextPending > existingPending) {
        dedupedForDebt.set(tx.id, tx);
      }
    }

    const effectiveReceivables = Array.from(dedupedForDebt.values());

    const debtByCustomer = new Map<string, number>();
    for (const tx of effectiveReceivables) {
      if (tx.status === 'REFUNDED') continue;
      if (!tx.customerId) continue;
      const pending = toPositiveNumber(tx.pendingBalance);
      if (pending <= 0) continue;
      const previous = debtByCustomer.get(tx.customerId) || 0;
      debtByCustomer.set(tx.customerId, parseFloat((previous + pending).toFixed(2)));
    }

    let changedCustomers = 0;
    const recalculatedCustomers = sourceCustomers.map((customer) => {
      const recalculatedDebt = parseFloat(((debtByCustomer.get(customer.id) || 0)).toFixed(2));
      const currentDebt = parseFloat((toPositiveNumber(customer.currentDebt)).toFixed(2));
      if (Math.abs(currentDebt - recalculatedDebt) < 0.01) return customer;

      changedCustomers++;
      return {
        ...customer,
        currentDebt: recalculatedDebt,
        updatedAt: now
      };
    });

    if (changedCustomers > 0) {
      for (const customer of recalculatedCustomers) {
        const persistedDebt = parseFloat((toPositiveNumber((sourceCustomers.find(c => c.id === customer.id)?.currentDebt))).toFixed(2));
        const nextDebt = parseFloat((toPositiveNumber(customer.currentDebt)).toFixed(2));
        if (Math.abs(persistedDebt - nextDebt) < 0.01) continue;
        await db.saveDocument('customers', customer);
      }
    }

    setTransactions(repairedTransactions);
    if (changedCustomers > 0) {
      setCustomers(recalculatedCustomers);
    }

    backgroundSyncManager.triggerSync().catch(console.error);

    const scannedTransactions = dedupedForDebt.size;
    const repairedCreditNoteIdSet = new Set<string>([
      ...synthesizedCreditNotes.map(note => note.displayId || note.id),
      ...Array.from(enrichedCreditNoteIds)
    ]);
    return {
      scannedTransactions,
      scannedWalletMovements,
      repairedTransactions: repairedIds.length,
      repairedCreditNotes: repairedCreditNoteIdSet.size,
      recalculatedCustomers: recalculatedCustomers.length,
      customersWithDebtChanges: changedCustomers,
      totalPendingBefore,
      totalPendingAfter,
      transactionIds: repairedIds,
      creditNoteIds: Array.from(repairedCreditNoteIdSet)
    };
  }, [customers, transactions]);

  const upsertFiscalTransaction = useCallback(async (nextTransaction: Transaction) => {
    setTransactions(prev => {
      const exists = prev.some(tx => tx.id === nextTransaction.id);
      if (exists) return prev.map(tx => tx.id === nextTransaction.id ? nextTransaction : tx);
      return [nextTransaction, ...prev];
    });
    await db.saveDocument('transactions', nextTransaction);
    try {
      await db.saveDocument('transactionHistory', nextTransaction);
    } catch (historyMirrorError) {
      console.warn('⚠️ Fiscal history mirror update skipped:', historyMirrorError);
    }
  }, []);

  const pollFiscalDocumentStatus = useCallback(async (
    transaction: Transaction,
    providerId: Exclude<Transaction['fiscalProvider'], undefined | 'NONE'>,
    environment: number,
    providerTransactionId: string,
    credentialKey?: string,
    attempt = 1
  ) => {
    try {
      const result = await getFiscalDocumentStatus(
        providerId,
        environment,
        providerTransactionId,
        config.companyInfo,
        credentialKey
      );

      const finalStatus = result.pending ? 'PENDING' : result.success ? 'SYNCED' : 'ERROR';
      const refreshedTransaction: Transaction = {
        ...transaction,
        fiscalSyncStatus: finalStatus,
        fiscalSyncError: result.success ? undefined : result.message,
        fiscalReferenceId: providerTransactionId,
        fiscalResponseMessage: result.message,
        fiscalSyncedAt: result.success && !result.pending ? new Date().toISOString() : transaction.fiscalSyncedAt
      };

      await upsertFiscalTransaction(refreshedTransaction);

      if (result.pending && attempt < 8) {
        window.setTimeout(() => {
          pollFiscalDocumentStatus(
            refreshedTransaction,
            providerId,
            environment,
            providerTransactionId,
            credentialKey,
            attempt + 1
          ).catch(console.error);
        }, attempt < 3 ? 3000 : 5000);
      }
    } catch (error: any) {
      if (attempt >= 8) {
        const failedTransaction: Transaction = {
          ...transaction,
          fiscalSyncStatus: 'ERROR',
          fiscalSyncError: error?.message || 'No se pudo consultar el estado del e-CF.',
          fiscalReferenceId: providerTransactionId,
          fiscalResponseMessage: error?.message || 'No se pudo consultar el estado del e-CF.'
        };
        await upsertFiscalTransaction(failedTransaction);
        return;
      }

      window.setTimeout(() => {
        pollFiscalDocumentStatus(
          transaction,
          providerId,
          environment,
          providerTransactionId,
          credentialKey,
          attempt + 1
        ).catch(console.error);
      }, 5000);
    }
  }, [config.companyInfo, upsertFiscalTransaction]);

  const syncFiscalDocument = useCallback(async (transaction: Transaction) => {
    const providerId = transaction.fiscalProvider;
    const documentCode = transaction.ncfType;
    const electronicNcf = transaction.electronicNcf || transaction.ncf;

    if (!providerId || providerId === 'NONE') return;
    if (!documentCode || !documentCode.startsWith('E')) return;
    if (!electronicNcf) return;

    try {
      const fiscalCompliance = getFiscalComplianceConfig(config);
      const environment = getProviderEnvironment(fiscalCompliance, providerId);
      const providerConfig = getFiscalProviderConfig(fiscalCompliance, providerId);
      const terminalConfig = config.terminals?.find((terminal) => terminal.id === transaction.terminalId)?.config;
      const fiscalSummary = calculateTransactionFiscalSummary(transaction, config, { terminalConfig });
      const baseTransaction: Transaction = {
        ...transaction,
        taxAmount: fiscalSummary.taxTotal,
        netAmount: fiscalSummary.subtotal,
        taxBreakdown: fiscalSummary.taxBreakdown,
        fiscalSyncStatus: 'PENDING',
        fiscalSyncError: undefined
      };

      await upsertFiscalTransaction(baseTransaction);

      const result = await issueFiscalDocument({
        providerId,
        environment,
        companyInfo: config.companyInfo,
        transaction: baseTransaction,
        taxRate: config.taxRate,
        sequenceExpiryDate: new Date(new Date(baseTransaction.date).getFullYear(), 11, 31).toISOString(),
        credentialKey: providerConfig.credentialKey,
        tipoIngreso: providerConfig.tipoIngreso,
        modificationCode: providerConfig.modificationCode,
        unitCodeGoods: providerConfig.unitCodeGoods,
        unitCodeServices: providerConfig.unitCodeServices
      });

      const finalStatus = result.pending ? 'PENDING' : result.success ? 'SYNCED' : 'ERROR';
      const finalizedTransaction: Transaction = {
        ...baseTransaction,
        fiscalSyncStatus: finalStatus,
        fiscalSyncError: result.success ? undefined : result.message,
        fiscalReferenceId: result.providerTransactionId || baseTransaction.fiscalReferenceId,
        fiscalResponseMessage: result.message,
        fiscalSyncedAt: result.success && !result.pending ? new Date().toISOString() : baseTransaction.fiscalSyncedAt
      };

      await upsertFiscalTransaction(finalizedTransaction);

      if (result.pending && result.providerTransactionId) {
        window.setTimeout(() => {
          pollFiscalDocumentStatus(
            finalizedTransaction,
            providerId,
            environment,
            result.providerTransactionId!,
            providerConfig.credentialKey
          ).catch(console.error);
        }, 3000);
      }
    } catch (error: any) {
      console.error('Error during syncFiscalDocument:', error);
      const failedTransaction: Transaction = {
        ...transaction,
        fiscalSyncStatus: 'ERROR',
        fiscalSyncError: error?.message || 'No se pudo inicializar la emisión del comprobante.',
        fiscalResponseMessage: error?.message || 'Error en configuración fiscal.'
      };
      await upsertFiscalTransaction(failedTransaction);
    }
  }, [config, pollFiscalDocumentStatus, upsertFiscalTransaction]);

  const retryFiscalDocument = useCallback(async (transaction: Transaction): Promise<string> => {
    const providerId = transaction.fiscalProvider;
    if (!canRetryFiscalTransaction(transaction) || !providerId || providerId === 'NONE') {
      throw new Error('Solo se pueden reintentar documentos electrónicos pendientes o con error.');
    }

    const fiscalCompliance = getFiscalComplianceConfig(config);
    const environment = getProviderEnvironment(fiscalCompliance, providerId);
    const providerConfig = getFiscalProviderConfig(fiscalCompliance, providerId);
    const shouldPollExistingAttempt = transaction.fiscalSyncStatus === 'PENDING' && Boolean(transaction.fiscalReferenceId);
    const retryingTransaction: Transaction = {
      ...transaction,
      fiscalSyncStatus: 'PENDING',
      fiscalSyncError: undefined,
      fiscalReferenceId: shouldPollExistingAttempt ? transaction.fiscalReferenceId : undefined,
      fiscalResponseMessage: shouldPollExistingAttempt
        ? 'Consultando estado actualizado del e-CF en Polaris...'
        : 'Reintentando envío del e-CF a Polaris...'
    };

    await upsertFiscalTransaction(retryingTransaction);

    if (shouldPollExistingAttempt && transaction.fiscalReferenceId) {
      await pollFiscalDocumentStatus(
        retryingTransaction,
        providerId,
        environment,
        transaction.fiscalReferenceId,
        providerConfig.credentialKey,
        1
      );
      return 'Consulta de estado fiscal iniciada.';
    }

    await syncFiscalDocument(retryingTransaction);
    return 'Reintento de envío fiscal iniciado.';
  }, [config, pollFiscalDocumentStatus, syncFiscalDocument, upsertFiscalTransaction]);

  const handleTransactionComplete = async (txn: Transaction) => {
    // Get current terminal ID before persisting.
    const currentTerminal = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
    const terminalId = currentTerminal?.id || 'T1';
    txn.terminalId = terminalId;

    // Add sync status
    txn.syncStatus = 'PENDING';

    // Save transaction locally (Optimized: Append only)
    const newTransactions = [...transactions, txn];

    setTransactions(newTransactions);
    // setFilteredTransactions(newTransactions); // Assuming this is meant to be here if filtered transactions are used
    await db.saveDocument('transactions', txn);
    syncFiscalDocument(txn).catch(console.error);

    // Trigger background sync
    backgroundSyncManager.triggerSync().catch(console.error);

    // Update inventory locally (simple stock tracking) AND Record Ledger
    const defaultWarehouseId = currentTerminal?.config.inventoryScope?.defaultSalesWarehouseId
      || config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId
      || 'wh_central';

    // Calculate and Record Inventory Deductions (Recursive & UOM Aware)
    for (const item of txn.items) {
      // 1. Traceability Status Update (Mark as SOLD)
      if (item.trackingData && item.trackingData.length > 0) {
        const allTracking = await db.get('inventoryTracking') as any[] || [];
        const updatedTracking = allTracking.map((t: any) => {
          if (item.trackingData?.some((sel: any) => sel.id === t.id)) {
            return { ...t, status: 'SOLD', saleId: txn.id };
          }
          return t;
        });
        await db.save('inventoryTracking', updatedTracking);
      }

      // 2. Process Deduction (Handles Recipes, Yields, and Simple Items)
      const ledgerEntries = await processInventoryDeduction(
        txn.displayId || txn.id,
        item,
        defaultWarehouseId,
        terminalId,
        products // Pass current products list for recipe lookups
      );

      // 3. Save Entries
      // 3. Save Entries
      for (const entry of ledgerEntries) {
        await db.saveDocument('inventoryLedger', entry);
      }

      // 4. Recalculate Stock for affected products immediately
      // This ensures the product document Is updated before we refresh the UI
      const affectedPairs = new Set<string>();
      ledgerEntries.forEach(e => affectedPairs.add(`${e.productId}|${e.warehouseId}`));

      for (const pair of affectedPairs) {
        const [pId, wId] = pair.split('|');
        await db.recalculateProductStock(pId, wId);
      }
    }

    // Refresh products to reflect changes made by recordInventoryMovement
    const refreshedDb = await db.init();
    setProducts(refreshedDb.products || []);

    // TransactionService already increments the emitted series atomically before saving
    // the ticket. Do not increment here again, or POS folios skip and drift.
    const seriesId = txn.seriesId;
    if (seriesId && internalSequences) {
      const persistedSequences = ((await db.get('internalSequences')) as typeof internalSequences) || internalSequences;
      setInternalSequences(persistedSequences);

      // SYNC: Push to Server immediately if Master to prevent overwrite
      if (permissionService.isMasterTerminal()) {
        console.log(`📤 [App.tsx] Pushing updated sequences to Server...`);
        try {
          await syncManager.pushCatalog('internalSequences');
          console.log(`✅ [App.tsx] Sequences pushed to Server.`);
        } catch (e) {
          console.error(`❌ [App.tsx] Failed to push sequences to Server:`, e);
        }
      }
    }

    // --- CRITICAL: Update Customer Debt for Credit Transactions (CxC) ---
    if (txn.pendingBalance && txn.pendingBalance > 0 && txn.customerId) {
      console.log(`💰 Increasing debt for customer ${txn.customerId} by ${txn.pendingBalance}`);
      const customerIndex = customers.findIndex(c => c.id === txn.customerId);
      if (customerIndex !== -1) {
        const updatedCustomers = [...customers];
        const customer = updatedCustomers[customerIndex];
        const newDebt = (customer.currentDebt || 0) + txn.pendingBalance;

        updatedCustomers[customerIndex] = {
          ...customer,
          currentDebt: parseFloat(newDebt.toFixed(2)),
          updatedAt: new Date().toISOString()
        };

        setCustomers(updatedCustomers);
        await db.saveDocument('customers', updatedCustomers[customerIndex]);
        console.log(`✅ Customer debt updated: ${customer.name} -> ${updatedCustomers[customerIndex].currentDebt}`);
      }
    }
  };

  const handleRegisterMovement = async (type: 'IN' | 'OUT', amount: number, reason: string) => {
    const move: CashMovement = {
      id: `CM-${Date.now()}`,
      type, amount, reason,
      timestamp: new Date().toISOString(),
      userId: currentUser?.id || 'sys',
      userName: currentUser?.name || 'System',
      terminalId: getCurrentTerminal()?.id || 'T1',
      syncStatus: 'PENDING' as const
    };
    const updated = [...cashMovements, move];
    setCashMovements(updated);
    await db.saveDocument('cashMovements', move);

    // Trigger background sync
    backgroundSyncManager.triggerSync().catch(console.error);
  };

  const resolveRoomLabel = (room: Pick<Room, 'name' | 'nombre'>): string => {
    const fromName = typeof room.name === 'string' ? room.name.trim() : '';
    const fromNombre = typeof room.nombre === 'string' ? room.nombre.trim() : '';
    return fromName || fromNombre || 'Sala';
  };

  const normalizeRoomForLayout = (room: Room): Room => {
    const label = resolveRoomLabel(room);
    return {
      ...room,
      name: label,
      nombre: label
    };
  };

  const resolveTableLabel = (table: Pick<Table, 'name' | 'nombre' | 'shape'>): string => {
    const fromName = typeof table.name === 'string' ? table.name.trim() : '';
    const fromNombre = typeof table.nombre === 'string' ? table.nombre.trim() : '';
    const fallback = table.shape === 'OBSTACLE' ? 'Muro' : 'Mesa';
    return fromName || fromNombre || fallback;
  };

  const normalizeTableForLayout = (table: Table): Table => {
    const label = resolveTableLabel(table);
    const isObstacle = table.shape === 'OBSTACLE';
    return {
      ...table,
      nombre: label,
      name: label,
      width: table.width || 100,
      height: isObstacle ? (table.height || 20) : (table.height || 100),
      capacity: isObstacle ? (table.capacity || 0) : Math.max(1, table.capacity || 1),
      consumo_minimo_mesa: isObstacle ? 0 : Math.max(0, Number(table.consumo_minimo_mesa || 0)),
      comensales_minimos: isObstacle ? 0 : Math.max(1, Number(table.comensales_minimos || 1))
    };
  };

  const syncFloorPlanToServer = async (roomsPayload: Room[], tablesPayload: Table[]) => {
    const headers = { 'Content-Type': 'application/json' };
    const normalizedRoomsPayload = roomsPayload.map(normalizeRoomForLayout);
    const normalizedTablesPayload = tablesPayload.map(normalizeTableForLayout);

    // Pull current server snapshot to compute deletions safely
    const snapshotRes = await fetch('/api/mesas');
    if (!snapshotRes.ok) {
      throw new Error(`No se pudo leer estado actual de mesas (HTTP ${snapshotRes.status})`);
    }
    const snapshot = await snapshotRes.json();
    const serverRooms: Room[] = Array.isArray(snapshot?.rooms) ? snapshot.rooms : [];
    const serverTables: Table[] = Array.isArray(snapshot?.tables) ? snapshot.tables : [];

    const nextRoomIds = new Set(normalizedRoomsPayload.map(r => r.id));
    const nextTableIds = new Set(normalizedTablesPayload.map(t => t.id));

    // Upsert rooms first
    for (const roomPayload of normalizedRoomsPayload) {
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomPayload.id)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(roomPayload)
      });
      if (!res.ok) {
        throw new Error(`Error guardando sala ${roomPayload.id} (HTTP ${res.status})`);
      }
    }

    // Upsert tables with normalized designer defaults
    for (const tablePayload of normalizedTablesPayload) {
      const res = await fetch(`/api/tables/${encodeURIComponent(tablePayload.id)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(tablePayload)
      });
      if (!res.ok) {
        throw new Error(`Error guardando mesa ${tablePayload.id} (HTTP ${res.status})`);
      }
    }

    // Delete removed tables, then rooms
    const removedTables = serverTables.filter(t => !nextTableIds.has(t.id));
    for (const table of removedTables) {
      const res = await fetch(`/api/tables/${encodeURIComponent(table.id)}`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`Error eliminando mesa ${table.id} (HTTP ${res.status})`);
      }
    }

    const removedRooms = serverRooms.filter(r => !nextRoomIds.has(r.id));
    for (const room of removedRooms) {
      const res = await fetch(`/api/rooms/${encodeURIComponent(room.id)}`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`Error eliminando sala ${room.id} (HTTP ${res.status})`);
      }
    }
  };

  const handleSaveFloorPlan = async (newRooms: Room[], newTables: Table[]) => {
    console.log('💾 Saving Floor Plan:', { rooms: newRooms.length, tables: newTables.length });
    const normalizedRooms = newRooms.map(normalizeRoomForLayout);
    const normalizedTablesInput = newTables.map(normalizeTableForLayout);

    // 1. Save Rooms (Overwrite is fine for config)
    await db.save('rooms', normalizedRooms);
    setRooms(normalizedRooms);

    // 2. Save Tables (Merge operational state AND Delete removed tables)
    // First, fetch all existing tables from DB to identify deletions
    const existingDbTables = await db.get('tables') as Table[] || [];
    const newTableIds = new Set(normalizedTablesInput.map(t => t.id));

    // Identify tables to delete (present in DB but not in new layout)
    const tablesToDelete = existingDbTables.filter(t => !newTableIds.has(t.id));

    if (tablesToDelete.length > 0) {
      console.log(`🗑️ Pruning ${tablesToDelete.length} removed tables from DB...`);
      for (const t of tablesToDelete) {
        await db.deleteDocument('tables', t.id);
      }
    }

    // Save Tables (Merge operational state)
    const mergedTables = normalizedTablesInput.map(newT => {
      const existing = existingDbTables.find(t => t.id === newT.id) || tables.find(t => t.id === newT.id);
      return {
        ...newT,
        // Operational fields usually not present in newT if it came from Designer state only,
        // but Designer state initialized from 'tables' prop which has them.
        // However, if 'setTables' updates local state in Designer and loses keys, we restore them here.
        status: existing?.status || newT.status || 'FREE',
        currentOrderId: existing?.currentOrderId ?? newT.currentOrderId,
        currentOrderTotal: existing?.currentOrderTotal ?? newT.currentOrderTotal,
        timeSeated: existing?.timeSeated ?? newT.timeSeated,
        waiterName: existing?.waiterName ?? newT.waiterName
      };
    });

    await db.save('tables', mergedTables);
    setTables(mergedTables);
    try {
      await syncFloorPlanToServer(normalizedRooms, mergedTables);
      await fetchTables();
      console.log('✅ Floor Plan synced to API server.');
    } catch (error: any) {
      console.error('❌ Floor Plan API sync failed:', error);
      alert(`Layout guardado localmente, pero falló guardado en servidor: ${error?.message || 'Error desconocido'}`);
    }
    console.log('✅ Floor Plan saved to DB with robustness.');
    // Optional: Sync Trigger
    if (syncManager) {
      // syncManager.broadcastChange('tables', null, 'UPDATE').catch(console.error);
    }
  };

  const handleZReport = async (cashCounted: number, notes: string, reportData?: any) => {
    // 1. Robust Terminal ID Discovery
    const currentTerminal = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
    const terminalId = currentTerminal?.id || 'T1';

    try {
      console.log(`📊 Z-Report: Starting closure for terminal ${terminalId} (Device: ${deviceId})`);

      // 2. Identify pending operational data since the last Z of this terminal.
      const terminalKey = normalizeTerminalId(terminalId);
      const isDefaultTerminal = terminalKey === 't1';
      const belongsToCurrentTerminal = (value?: string | null) =>
        normalizeTerminalId(value) === terminalKey || (!value && isDefaultTerminal);

      const pendingTransactions = getPendingTransactionsForTerminal(terminalId);
      const pendingCashMovements = getPendingCashMovementsForTerminal(terminalId);

      const reportTransactionIds = Array.isArray(reportData?.transactionIds)
        ? new Set<string>(reportData.transactionIds.map((id: string) => String(id)))
        : null;
      const reportMovementIds = Array.isArray(reportData?.cashMovementIds)
        ? new Set<string>(reportData.cashMovementIds.map((id: string) => String(id)))
        : null;
      const reportCollectionIds = Array.isArray(reportData?.collectionIds)
        ? new Set<string>(reportData.collectionIds.map((id: string) => String(id)))
        : null;

      const terminalTransactions = reportTransactionIds
        ? transactions
          .filter(t => reportTransactionIds.has(t.id))
          .filter(t => belongsToCurrentTerminal(t.terminalId))
          .filter(t => !t.zReportId)
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        : pendingTransactions;

      const terminalCashMovements = reportMovementIds
        ? cashMovements
          .filter(m => reportMovementIds.has(m.id))
          .filter(m => belongsToCurrentTerminal(m.terminalId))
        : pendingCashMovements;

      const terminalCollections = reportCollectionIds
        ? collections
          .filter(c => reportCollectionIds.has(c.id))
          .filter(c => belongsToCurrentTerminal(c.terminalId))
        : collections.filter(c => belongsToCurrentTerminal(c.terminalId) && !c.zReportId);

      console.log(`🔒 Shift Segregation: Found ${terminalTransactions.length} txns and ${terminalCashMovements.length} cash movements for ${terminalId}`);

      // 3. Totals and Stats from the exact transaction set being archived.
      const totalsByMethod = terminalTransactions.flatMap(t => t?.payments || []).reduce((acc: Record<string, number>, p) => {
        if (p && p.method) {
          acc[p.method] = (acc[p.method] || 0) + p.amount;
        }
        return acc;
      }, {});

      const stats = calculateZReportStats(terminalTransactions, terminalCollections);
      const transactionCount = terminalTransactions.length;
      const declaredCashByCurrency = (reportData?.cashCountedByCurrency || {}) as Record<string, unknown>;
      const expectedCashByCurrencySnapshot = (reportData?.expectedCashByCurrency || {}) as Record<string, unknown>;

      const cashDeclaredTotal: number = Object.values(declaredCashByCurrency).reduce<number>((sum, value) => {
        const parsed = Number(value);
        return sum + (Number.isFinite(parsed) ? parsed : 0);
      }, 0);
      const expectedCashTotal: number = Object.values(expectedCashByCurrencySnapshot).reduce<number>((sum, value) => {
        const parsed = Number(value);
        return sum + (Number.isFinite(parsed) ? parsed : 0);
      }, 0);
      const declaredCardTotal: number = Number(reportData?.declaredCardTotal) || 0;
      const declaredOtherTotal: number = Number(reportData?.declaredOtherTotal) || 0;
      const expectedCardTotal: number = Number(reportData?.expectedCardTotal) || 0;
      const expectedOtherTotal: number = Number(reportData?.expectedOtherTotal) || 0;
      const orderedTicketRefs = terminalTransactions
        .map((transaction) => transaction.displayId || transaction.id)
        .filter(Boolean);
      const firstTicketId = orderedTicketRefs[0] || null;
      const lastTicketId = orderedTicketRefs[orderedTicketRefs.length - 1] || null;
      const openedAtCandidates = [
        ...terminalTransactions.map(t => new Date(t.date).getTime()),
        ...terminalCashMovements.map(m => new Date(m.timestamp).getTime())
      ].filter((value) => Number.isFinite(value)) as number[];
      const openedAt = openedAtCandidates.length > 0
        ? new Date(Math.min(...openedAtCandidates)).toISOString()
        : new Date().toISOString();

      // 4. Create and Save Z-Report
      let sequenceNumber = '';
      let zReportId = `ZR-${Date.now()}`;

      // DOCUMENT SERIES LOGIC
      // Attempt to find an assigned series for Z_REPORT
      const zReportSeriesId = currentTerminal?.config?.documentAssignments?.['Z_REPORT'];
      // Series are stored inside the terminal config
      const terminalSeriesList = currentTerminal?.config?.documentSeries || [];
      const zReportSeries = zReportSeriesId
        ? terminalSeriesList.find(s => s.id === zReportSeriesId)
        : undefined;

      if (zReportSeries) {
        // Use the Series
        const prefix = zReportSeries.prefix || '';
        const num = zReportSeries.nextNumber || 1;
        const padding = zReportSeries.padding || 8;
        sequenceNumber = `${prefix}${num.toString().padStart(padding, '0')}`;

        console.log(`🎫 Generating Z-Report using Series ${zReportSeries.name}: ${sequenceNumber}`);

        // Increment Series locally
        const updatedSeries = {
          ...zReportSeries,
          nextNumber: num + 1
        };

        // Update the list of series for this terminal
        const updatedTerminalSeries = terminalSeriesList.map(s => s.id === zReportSeries.id ? updatedSeries : s);

        // We need to update the global config object to reflect this change inside the specific terminal
        const updatedTerminals = (config.terminals || []).map(t => {
          if (t.id === terminalId) {
            return {
              ...t,
              config: {
                ...t.config,
                documentSeries: updatedTerminalSeries
              }
            };
          }
          return t;
        });

        const updatedConfig = { ...config, terminals: updatedTerminals };

        // Update local state (optimistic)
        setConfig(updatedConfig);

        // Persist to DB
        await db.save('config', updatedConfig);

        // If Master, we should push this update to others?
        // Series updates are critical.
        if (permissionService.isMasterTerminal()) {
          // TODO: Implement specific sync for series if needed, or rely on config sync.
          // For now, simple persistence is key.
        }

      } else {
        // Fallback to legacy Logic
        const existingReports = await db.get('zReports') as ZReport[];
        const nextSeqNum = (existingReports.length + 1).toString().padStart(6, '0');
        sequenceNumber = `Z-${nextSeqNum}`;
      }

      const newZReport: ZReport = {
        id: zReportId,
        terminalId,
        sequenceNumber,
        openedAt,
        closedAt: new Date().toISOString(),
        closedByUserId: currentUser?.id || 'sys',
        closedByUserName: currentUser?.name || 'System',
        baseCurrency: config.currencySymbol,
        totalsByMethod,
        cashExpected: reportData?.expectedCashByCurrency || {},
        cashCounted: reportData?.cashCountedByCurrency || {},
        cashDiscrepancy: reportData?.cashDiscrepancyByCurrency || {},
        cashSales: reportData?.cashSalesTotal || 0,
        cashIn: reportData?.cashIn || 0,
        cashOut: reportData?.cashOut || 0,
        transactionCount,
        notes,
        declared_totals: {
          cash: cashDeclaredTotal,
          card: declaredCardTotal,
          other: declaredOtherTotal,
          total_declared: cashDeclaredTotal + declaredCardTotal + declaredOtherTotal,
        },
        system_totals: {
          expected_cash: expectedCashTotal,
          expected_card: expectedCardTotal,
          expected_other: expectedOtherTotal,
          total_expected: expectedCashTotal + expectedCardTotal + expectedOtherTotal,
          cash_difference: cashDeclaredTotal - expectedCashTotal,
          total_difference:
            (cashDeclaredTotal + declaredCardTotal + declaredOtherTotal)
            - (expectedCashTotal + expectedCardTotal + expectedOtherTotal),
        },
        sync_audit: {
          total_tickets_issued: transactionCount,
          first_ticket_id: firstTicketId,
          last_ticket_id: lastTicketId,
        },
        stats,
        syncStatus: 'PENDING' as const
      };

      console.log("💾 Saving Z-Report:", newZReport);
      await db.saveDocument('zReports', newZReport);
      setZReports(prev => [...prev, newZReport].sort((a, b) => new Date(b.closedAt).getTime() - new Date(a.closedAt).getTime()));

      if (syncManager.isInitialized) {
        try {
          await syncManager.pushZReport(newZReport);
        } catch (e) {
          console.warn('⚠️ [App.tsx] Z-Report push failed (queued):', e);
        }
      } else {
        console.warn('⏳ [App.tsx] SyncManager not ready. Z-Report queued locally.');
      }

      // 5. Build lookup set for IDs that were actually closed to prevent data loss
      const closedTxnIds = new Set(terminalTransactions.map(t => t.id));
      const closedMoveIds = new Set(terminalCashMovements.map(m => m.id));

      // 6. Archive locally
      console.log(`🗄️ Archiving ${terminalTransactions.length} transactions to history...`);
      for (const tx of terminalTransactions) {
        // NEW: Save sequence number for easy display
        await db.saveDocument('transactionHistory', {
          ...tx,
          zReportId: newZReport.id,
          zReportSequence: newZReport.sequenceNumber
        });
        // NEW: Explicitly delete from active table to avoid orphans
        await db.deleteDocument('transactions', tx.id);
      }

      // 7. Update states by removing ONLY what was closed
      const remainingTransactions = transactions.filter(t => !closedTxnIds.has(t.id));
      const remainingCashMovements = cashMovements.filter(m => !closedMoveIds.has(m.id));

      setTransactions(remainingTransactions);
      setCashMovements(remainingCashMovements);
      const remainingCollections = collections.filter(c => !terminalCollections.some(tc => tc.id === c.id));
      setCollections(remainingCollections);

      // Note: We don't strictly need db.save('transactions', ...) anymore because we deleted them one by one, 
      // but we keep it for other non-terminal-specific items if they existed (unlikely here).
      // Actually, save() as "Replace" is now robust via NetworkAdapter fix.
      await db.save('transactions', remainingTransactions);
      await db.save('cashMovements', remainingCashMovements);
      await db.save('collections', remainingCollections);

      // 8. Global Reset (bounded wait to avoid UI freeze)
      console.log(`⚙️ Sending Global Reset for Terminal ${terminalId} to Master...`);
      await Promise.race([
        syncManager.resetTerminalData(terminalId),
        new Promise(resolve => setTimeout(resolve, 8000))
      ]);
    } catch (error) {
      console.error('❌ Z-Report closure failed:', error);
      alert('El cierre terminó con incidencias de sincronización. Se volverá al POS y el reporte quedará en cola para sincronizar.');
    } finally {
      setCurrentView('POS');
      backgroundSyncManager.triggerSync().catch(console.error);
    }
  };

  // --- VIEW RENDERING LOGIC ---
  if (licenseError) {
    return (
      <div className="h-screen w-screen bg-red-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-white p-10 rounded-3xl shadow-2xl border border-red-100 max-w-lg z-50">
          <div className="w-24 h-24 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-3xl font-black text-slate-800 mb-4 tracking-tight">Acceso Bloqueado</h1>
          <p className="text-lg text-slate-600 font-medium mb-8 leading-relaxed">
            {licenseError}
          </p>
          <div className="p-4 bg-slate-50 rounded-xl text-sm font-mono text-slate-500 font-bold border border-slate-200">
            Terminal Token: {deviceId}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="mt-8 w-full py-4 bg-slate-900 hover:bg-black text-white rounded-xl font-bold transition-transform active:scale-95"
          >
            Reintentar Conexión
          </button>
        </div>
      </div>
    );
  }

  if (!isDataLoaded || restoringHistory) {
    if (initialConnError && !restoringHistory) {
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-900 text-white p-8 text-center">
          <div className="bg-red-500/20 p-4 rounded-full mb-4">
            <Layout size={48} className="text-red-500" />
          </div>
          <h2 className="text-xl font-bold mb-2">Error de Inicialización</h2>
          <p className="text-slate-400 mb-6 max-w-md">{initialConnError}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg font-medium transition-colors"
          >
            Reintentar
          </button>
        </div>
      );
    }
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-900 text-white">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-bold tracking-widest uppercase text-xs">
          {restoringHistory ? 'Restaurando Historial desde Maestra...' : 'Cargando CLIC POS OS...'}
        </p>
      </div>
    );
  }

  const handleProcessRefund = async (
    originalTx: Transaction,
    itemsToRefund: CartItem[],
    conditions: Map<string, 'SELLABLE' | 'DAMAGED'>,
    reason: string,
    options: RefundProcessingOptions = {}
  ): Promise<Transaction | null> => {
    console.log("🔄 Procesando Devolución Integral:", { originalTx, items: itemsToRefund.length, reason });

    const normalizedRefundItems = (itemsToRefund || [])
      .map(item => ({
        ...item,
        quantity: Math.abs(Number(item.quantity || 0))
      }))
      .filter(item => item.quantity > 0);

    if (normalizedRefundItems.length === 0) {
      alert('No hay artículos válidos para procesar la devolución.');
      return null;
    }

    // 1. Calculations
    const refundSummary = calculateTransactionTaxSummary(
      itemsToRefund,
      config.taxes || [],
      Boolean(originalTx.isTaxIncluded),
      config.taxRate || 0
    );
    const refundTotal = refundSummary.total;

    // Check if full refund
    const totalOriginalQty = originalTx.items.reduce((acc, i) => acc + Math.abs(Number(i.quantity || 0)), 0);
    const totalRefundedQty = normalizedRefundItems.reduce((acc, i) => acc + Math.abs(Number(i.quantity || 0)), 0);
    const isFullRefund = totalRefundedQty >= totalOriginalQty;
    const newStatus = isFullRefund ? 'REFUNDED' : 'PARTIAL_REFUND';

    const normalizeText = (value?: string | null) => (value || '').trim().toLowerCase();
    const matchedCustomer = originalTx.customerId
      ? customers.find(c => c.id === originalTx.customerId)
      : customers.find(c =>
        normalizeText(c.name) !== '' &&
        normalizeText(c.name) === normalizeText(originalTx.customerName)
      );
    const resolvedCustomerId = originalTx.customerId || matchedCustomer?.id;
    const resolvedCustomerName = originalTx.customerName || matchedCustomer?.name;

    // 2. Resolución fiscal para la nota de crédito
    const currentTerminalId = getCurrentTerminal()?.id || config.terminals?.[0]?.id || 't1';
    const fiscalCompliance = getFiscalComplianceConfig(config);
    const creditNoteFiscalType = resolveCreditNoteFiscalCode(fiscalCompliance.mode);
    let creditNoteNcf: string | undefined;
    try {
      creditNoteNcf = await db.getNextNCF(creditNoteFiscalType, currentTerminalId) || undefined;
    } catch (e) {
      console.warn(`No se pudo generar NCF ${creditNoteFiscalType}:`, e);
    }

    // 3. Document Sequence (Internal Refund Series)
    const sequences = await db.get('internalSequences') as DocumentSeries[];
    const refundSeries = sequences.find(s => s.id === 'REFUND');
    let displayId = `NC-${Date.now().toString().slice(-6)}`;
    if (refundSeries) {
      displayId = `${refundSeries.prefix}${refundSeries.nextNumber.toString().padStart(refundSeries.padding, '0')}`;
      const updatedSequences = sequences.map(s => s.id === 'REFUND' ? { ...s, nextNumber: s.nextNumber + 1 } : s);
      await db.save('internalSequences', updatedSequences);
      setInternalSequences(updatedSequences);
    }

    const refundPayments: PaymentEntry[] = options.refundPayments && options.refundPayments.length > 0
      ? options.refundPayments
      : [{
        id: `refund-${Date.now()}`,
        method: 'STORE_CREDIT',
        methodLabel: 'Nota de crédito',
        amount: refundTotal,
        timestamp: new Date(),
      }];

    // 4. Create Credit Note Record
    const creditNote: Transaction = {
      id: createRuntimeId('NC'),
      displayId: displayId,
      documentType: 'REFUND',
      date: new Date().toISOString(),
      items: normalizedRefundItems,
      total: refundTotal,
      payments: refundPayments,
      userId: currentUser?.id || 'sys',
      userName: currentUser?.name || 'System',
      terminalId: currentTerminalId,
      status: 'REFUNDED',
      customerId: resolvedCustomerId,
      customerName: resolvedCustomerName,
      ncf: creditNoteNcf || undefined,
      ncfType: creditNoteFiscalType,
      legacyNcf: creditNoteFiscalType.startsWith('E') ? undefined : creditNoteNcf || undefined,
      electronicNcf: creditNoteFiscalType.startsWith('E') ? creditNoteNcf || undefined : undefined,
      fiscalMode: fiscalCompliance.mode,
      fiscalProvider: creditNoteFiscalType.startsWith('E') ? getDefaultFiscalProvider(config) : 'NONE',
      taxAmount: refundSummary.taxAmount,
      netAmount: refundSummary.netAmount,
      affectedNCF: originalTx.ncf,
      affectedInvoiceNumber: originalTx.displayId || originalTx.id,
      originalTransactionId: originalTx.id,
      refundReason: reason,
      isTaxIncluded: originalTx.isTaxIncluded,
      syncStatus: 'PENDING'
    };

    // 5. Persist refund, history mirror and Kardex through the standalone helper
    const currentTerminal = getCurrentTerminal();
    const defaultWarehouseId =
      currentTerminal?.config?.inventoryScope?.defaultSalesWarehouseId ||
      (config.terminals || []).find(t => t.id === currentTerminalId)?.config?.inventoryScope?.defaultSalesWarehouseId ||
      config.terminals?.[0]?.config.inventoryScope?.defaultSalesWarehouseId ||
      'wh_central';

    const refundPersistenceResult = await persistStandaloneRefundTransaction(
      creditNote,
      {
        warehouseId: defaultWarehouseId,
        terminalId: currentTerminalId,
        originalTransaction: {
          ...originalTx,
          customerId: resolvedCustomerId,
          customerName: resolvedCustomerName,
          status: newStatus as any
        },
        conditions
      }
    );

    // 6. Financial Update (Customer Account & Wallet)
    if (resolvedCustomerId) {
      const customer = customers.find(c => c.id === resolvedCustomerId);
      if (customer) {
        let remainingRefund = refundTotal;
        let newDebt = customer.currentDebt || 0;

        // Step A: Reduce Debt if original invoice had pending balance
        if (originalTx.pendingBalance && originalTx.pendingBalance > 0 && newDebt > 0) {
          const debtToReduce = Math.min(newDebt, remainingRefund);
          newDebt -= debtToReduce;
          remainingRefund -= debtToReduce;
        }

        // Step B: If there is still a refund amount (Scenario B - pure credit or surplus), add to Wallet
        if (!options.skipWalletDeposit && remainingRefund > 0.01) {
          try {
            await transactionService.applyRefundToWallet(
              resolvedCustomerId,
              remainingRefund,
              displayId
            );

            // Re-fetch wallets to get the updated balance for the customer nested object
            const wallets = await (await import('./utils/db')).db.get('wallets' as any) as any[] || [];
            const updatedWallet = wallets.find(w => w.customerId === resolvedCustomerId);
            if (updatedWallet) {
              customer.wallet = updatedWallet;
            }
          } catch (walletRefundError) {
            console.error('⚠️ Refund wallet update failed after persistence:', walletRefundError);
          }
        }

        const updatedCustomer = { ...customer, currentDebt: newDebt };
        await db.saveDocument('customers', updatedCustomer);
        setCustomers(prev => prev.map(c => c.id === updatedCustomer.id ? updatedCustomer : c));
      }
    }

    // 7. Refresh local state from storage so APK runtime never stays stale in-memory.
    try {
      const [persistedTransactions, freshProducts] = await Promise.all([
        db.get('transactions') as Promise<Transaction[]>,
        db.get('products') as Promise<Product[]>
      ]);

      if (Array.isArray(persistedTransactions)) {
        setTransactions(
          [...persistedTransactions].sort((a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
          )
        );
      } else {
        const updatedOriginalTx = refundPersistenceResult.updatedOriginal || {
          ...originalTx,
          customerId: resolvedCustomerId,
          customerName: resolvedCustomerName,
          status: newStatus as any,
          relatedTransactions: [...(originalTx.relatedTransactions || []), creditNote.id],
          updatedAt: new Date().toISOString(),
          syncStatus: 'PENDING' as const
        };
        const persistedCreditNote = refundPersistenceResult.refund || creditNote;
        setTransactions(prev => {
          const filtered = prev.filter(t => t.id !== updatedOriginalTx.id && t.id !== persistedCreditNote.id);
          return [updatedOriginalTx, ...filtered, persistedCreditNote].sort((a, b) =>
            new Date(b.date).getTime() - new Date(a.date).getTime()
          );
        });
      }

      if (Array.isArray(freshProducts)) {
        setProducts(freshProducts);
      }
    } catch (refreshError) {
      console.warn('⚠️ Refund state refresh fallback:', refreshError);
    }

    const finalizedCreditNote = refundPersistenceResult.refund || creditNote;
    syncFiscalDocument(finalizedCreditNote).catch(console.error);

    let autoPrintNotice = '';
    if (options.autoPrintIntegratedArtifacts) {
      try {
        const printResult = await printIntegratedPaymentArtifacts(finalizedCreditNote, config);
        if (printResult.voucherCopiesFailed.length > 0) {
          autoPrintNotice = `\nImpresión automática pendiente: ${printResult.voucherCopiesFailed.join(', ')}.`;
        }
      } catch (printError) {
        console.error('❌ Refund integrated auto print failed:', printError);
        autoPrintNotice = '\nOcurrió un problema al imprimir automáticamente el voucher y el ticket.';
      }
    }

    // Sync
    backgroundSyncManager.triggerSync().catch(console.error);

    alert(`Devolución procesada correctamente.\nDocumento: ${displayId}\n${creditNoteNcf ? 'NCF: ' + creditNoteNcf : ''}${autoPrintNotice}`);
    return finalizedCreditNote;
  };

  const renderView = () => {
    switch (currentView) {
      case 'ACTIVATION':
        return (
          <ActivationScreen
            onActivationComplete={(tenantData) => {
              void (async () => {
                console.log('✅ Sistema activado para:', tenantData?.name || tenantData?.email || 'tenant');

                const activatedTenantId = String(tenantData?.tenantId || '').trim();
                const activatedErpBaseUrl = resolveSetupErpBaseUrl();
                const resolvedDeviceId = deviceId || localStorage.getItem('pos_device_id') || '';
                const storedSetupMode = getStoredTerminalSetupMode();
                const setupWizardCompleted = localStorage.getItem(SETUP_WIZARD_COMPLETED_KEY) === '1';
                const localTerminals = (!Array.isArray(config) && config?.terminals) ? config.terminals : [];
                const localPairedTerminal = (localTerminals || []).find(
                  (t: any) => t.config?.currentDeviceId === resolvedDeviceId
                );
                const hasKnownTerminalContext = Boolean(
                  storedSetupMode ||
                  setupWizardCompleted ||
                  localPairedTerminal
                );

                if (activatedTenantId) {
                  try {
                    const license = await checkLicenseStatus(activatedTenantId, resolvedDeviceId);
                    if (!license.isValid) {
                      triggerLockdown(license.reason || 'Servicio Suspendido.');
                      return;
                    }
                  } catch (error) {
                    console.warn('[ACTIVATION] License check failed after activation, keeping offline-safe tolerance:', error);
                  }
                }

                if (hasKnownTerminalContext) {
                  console.log('[ACTIVATION] Se detectó una configuración previa. Reanudando flujo operativo...');
                  window.location.reload();
                  return;
                }

                if (activatedTenantId) {
                  localStorage.setItem('active_tenant_id', activatedTenantId);
                }

                if (activatedErpBaseUrl) {
                  persistSetupErpBaseUrls(activatedErpBaseUrl);
                }

                localStorage.removeItem(SETUP_WIZARD_COMPLETED_KEY);
                localStorage.removeItem(SETUP_FLOW_STAGE_KEY);
                localStorage.removeItem(SETUP_FLOW_VERSION_KEY);
                localStorage.removeItem(TERMINAL_SETUP_MODE_KEY);
                localStorage.setItem(TERMINAL_SETUP_PENDING_KEY, '1');
                clearStoredErpSyncBinding();
                setCurrentView('TERMINAL_MODE_SELECTOR');
              })();
            }}
          />
        );

      case 'TERMINAL_MODE_SELECTOR':
        return (
          <TerminalModeSelector
            onSelect={handleTerminalModeSelection}
          />
        );

      case 'VERTICAL_SELECTOR':
        return (
          <VerticalSelector
            onSelect={(selectedConfig) => {
              void handleVerticalSelection(selectedConfig);
            }}
          />
        );

      case 'SETUP':
      case 'WIZARD':
        return (
          <SetupWizard
            initialConfig={config}
            onComplete={handleSetupWizardComplete}
          />
        );

      case 'TERMINAL_PAIRING':
      case 'DEVICE_UNAUTHORIZED':
        return (
          <TerminalBindingScreen
            config={config}
            deviceId={deviceId}
            adminUsers={users}
            tenantId={resolveSetupTenantId()}
            erpBaseUrl={resolveSetupErpBaseUrl() || undefined}
            initialBindingMode={getTerminalBindingMode(getStoredTerminalSetupMode())}
            integrationMode={getTerminalSetupIntegrationMode(getStoredTerminalSetupMode())}
            onPair={handlePairTerminal}
            onConfigUpdate={handleConfigUpdate}
            onUsersUpdate={async (newUsers) => {
              setUsers(newUsers);
              await db.save('users', newUsers);
            }}
            initialMasterIp={localStorage.getItem('pos_master_ip') || ''}
          />
        );

      case 'LOGIN':
        if (!getCurrentTerminal()) {
          const storedInitialConfig = localStorage.getItem('initial_terminal_config');
          const activeTerminalId =
            localStorage.getItem('active_terminal_id')
            || localStorage.getItem('CLIC_POS_TERMINAL_ID')
            || '';

          if (storedInitialConfig && activeTerminalId) {
            try {
              const parsedConfig = JSON.parse(storedInitialConfig) as BusinessConfig;
              const hydratedTerminal = (parsedConfig.terminals || []).find((terminal) =>
                terminal.id === activeTerminalId
                || terminal.config?.currentDeviceId === deviceId
                || terminal.config?.erpTerminalId === activeTerminalId
              );

              if (hydratedTerminal) {
                setConfig(parsedConfig);
                return null;
              }
            } catch (error) {
              console.warn('⚠️ No se pudo rehidratar la terminal desde initial_terminal_config:', error);
            }
          }

          // If we are in LOGIN state but have no terminal config, 
          // we must have failed to load key data. 
          // Redirect to Pairing to attempt recovery/re-pair.
          setCurrentView('TERMINAL_PAIRING');
          return null;
        }
        const loginProps = {
          config: getCurrentTerminal()!.config as any,
          availableUsers: users,
          subVertical: config.subVertical,
          onLogin: (u: User) => {
            setCurrentUser(u);
            const terminal = getCurrentTerminal();
            const role = terminal?.config?.deviceRole?.role || DeviceRole.STANDARD_POS;

            if (role === DeviceRole.HANDHELD_INVENTORY) setCurrentView('INVENTORY_HOME');
            else if (role === DeviceRole.KITCHEN_DISPLAY) setCurrentView('KITCHEN_ORDERS');
            else if (role === DeviceRole.SELF_CHECKOUT) setCurrentView('KIOSK_WELCOME');
            else if (role === DeviceRole.PRICE_CHECKER) setCurrentView('CHECKER_SCAN');
            else {
              // Multi-Vertical Startup Flow
              const pantalla = terminal?.config?.operational?.pantalla_inicio;
              const isRetail = terminal?.config?.ux?.viewMode === 'RETAIL';
              const usaMesas = terminal?.config?.operational?.usa_mesas;

              if (pantalla === 'MAPA_MESAS' && !isRetail && usaMesas) {
                setCurrentView('TABLE_MAP');
              } else {
                setCurrentView('POS');
              }
            }
          }
        };

        return isLandscape ? (
          <ModernLoginScreen {...loginProps} />
        ) : (
          <LoginScreen {...loginProps} />
        );



      case 'TABLE_MAP': {
        const activeRoleId = currentUser?.roleId || currentUser?.role;
        const activeRole = roles.find(role => role.id === activeRoleId);
        const canViewBusinessMetrics = Boolean(
          activeRole &&
          (
            activeRole.permissions.includes('ALL') ||
            activeRole.permissions.includes('REPORTS_VIEW_FINANCIAL') ||
            /admin|gerente|super/i.test(activeRole.name)
          )
        );

        return (
          <div className="h-screen flex flex-col bg-slate-950">
            <div className="border-b border-white/10 p-4 flex justify-between items-center z-20 shrink-0 bg-white/[0.06] backdrop-blur-xl shadow-[0_12px_34px_rgba(2,6,23,0.45)]">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gradient-to-br from-sky-500 to-blue-700 text-white rounded-xl shadow-[0_10px_24px_rgba(2,132,199,0.45)]">
                  <Layout size={20} />
                </div>
                <h2 className="font-black text-slate-100 tracking-tight uppercase text-sm">Mapa de Mesas</h2>
              </div>
              <button
                onClick={() => setCurrentView('POS')}
                className="px-6 py-2 rounded-xl font-bold transition-all flex items-center gap-2 border border-white/15 bg-white/[0.08] backdrop-blur-xl text-slate-100 hover:bg-white/[0.15] active:scale-[0.98]"
              >
                Cerrar
              </button>
            </div>
            <div className="flex-1 overflow-hidden relative">
              <TableMap
                rooms={rooms}
                currentRoomId={activeRoomId}
                tables={tables}
                parkedTickets={parkedTickets}
                onTableClick={async (table) => {
                  console.log('Mesa seleccionada:', table.name);
                  setActiveTable(table);

                  // Cargar ítems solo de ESTA mesa: órdenes abiertas viven en parkedTickets (no heredar carrito previo).
                  if (table.currentOrderId) {
                    const parked = (parkedTickets || []).find(p => p.id === table.currentOrderId);
                    const fromTx = (transactions || []).find(t => t.id === table.currentOrderId);
                    if (parked?.items?.length) {
                      setCart(parked.items);
                    } else if (fromTx?.items?.length) {
                      setCart(fromTx.items);
                    } else {
                      setCart([]);
                    }
                  } else {
                    setCart([]);
                  }

                  setCurrentView('POS');
                }}
                onRefreshTables={fetchTables}
                currencySymbol={config.currencySymbol}
                currentUser={currentUser!}
                isAdmin={currentUser?.role === 'ADMIN'}
                bloqueoMeseros={getCurrentTerminal()?.config?.operational?.bloqueo_meseros}
                isRestaurantMode={isRestaurantTerminal(getCurrentTerminal())}
                onOpenTable={openTableForService}
                canViewBusinessMetrics={canViewBusinessMetrics}
                onPrintPrecheck={async (table) => {
                  if (!table.currentOrderId) return;
                  const order = (parkedTickets || []).find(p => p.id === table.currentOrderId);
                  if (order) {
                    // Pre-calculate totals for printPrecuenta
                    const subtotal = order.items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
                    
                    await printPrecuenta(config, {
                      items: order.items,
                      subtotal: subtotal,
                      discountTotal: 0, // Simplified for now
                      taxTotal: 0,      // Simplified for now
                      finalTotal: order.total || subtotal,
                      table: table,
                      customerName: order.customerName,
                      terminalId: getCurrentTerminal()?.id || 'T1'
                    });
                  } else {
                    alert('No se encontró el pedido activo para esta mesa.');
                  }
                }}
                onParkedOrderSplitResult={handleParkedOrderSplitFromMap}
                onOpenTableLayoutDesigner={() => handleViewChange('TABLE_DESIGNER')}
              />
            </div>
          </div>
        );
      }

      case 'TABLE_DESIGNER':
        return (
          <div className="h-screen flex flex-col bg-slate-50">
            <div className="bg-white border-b p-4 flex justify-between items-center z-20 shrink-0 shadow-sm text-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600 text-white rounded-lg shadow-lg">
                  <Layout size={20} />
                </div>
                <h2 className="font-black tracking-tight uppercase text-sm">Diseñador de Planos</h2>
              </div>
              <button
                onClick={async () => {
                  // Auto-save on exit to prevent data loss
                  await handleSaveFloorPlan(rooms, tables);
                  setSettingsInitialView('LAYOUT');
                  setCurrentView('SETTINGS');
                }}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold transition-all border border-slate-200"
              >
                Guardar y Volver
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <TableLayoutDesigner
                rooms={rooms}
                currentRoomId={activeRoomId || rooms[0]?.id || ''}
                tables={tables}
                onSave={(newTables) => handleSaveFloorPlan(rooms, newTables)}
                onUpdateTables={(newTables) => setTables(newTables)}
                onChangeRoom={(roomId) => setActiveRoomId(roomId)}
                onCreateRoom={(name) => {
                  const newRoom: Room = { id: 'R-' + Date.now(), name, nombre: name }; // Ensure 'nombre' is set for types
                  const updatedRooms = [...rooms, newRoom];
                  setRooms(updatedRooms);
                  handleSaveFloorPlan(updatedRooms, tables);
                }}
                onUpdateRoom={(updatedRoom) => {
                  const normalizedName = (updatedRoom.name || updatedRoom.nombre || '').trim() || 'Sala';
                  const normalizedRoom = { ...updatedRoom, name: normalizedName, nombre: normalizedName };
                  const newRooms = rooms.map(r => r.id === normalizedRoom.id ? normalizedRoom : r);
                  setRooms(newRooms);
                  handleSaveFloorPlan(newRooms, tables);
                }}
              />

            </div>
          </div>
        );

      case 'POS':
        if (!getCurrentTerminal()) {
          setCurrentView('DEVICE_UNAUTHORIZED');
          return null;
        }
        if (!currentUser) { setCurrentView('LOGIN'); return null; }
        return (
          <POSInterface
            config={config}
            currentUser={currentUser}
            roles={roles}
            users={users}
            customers={customers}
            products={products}
            warehouses={warehouses}
            cart={cart}
            transactions={transactions}
            zReports={zReports}
            onUpdateCart={setCart}
            selectedCustomer={selectedCustomer}
            onSelectCustomer={setSelectedCustomer}
            parkedTickets={parkedTickets}
            onUpdateParkedTickets={async (pt) => {
              const validArray = Array.isArray(pt) ? pt : [];
              setParkedTickets(validArray);
              await db.save('parkedTickets', validArray);
            }}
            onLogout={navigateToUserLogin}
            onOpenSettings={(view, data) => {
              setSettingsInitialView(view);
              setSettingsInitialData(data);
              setCurrentView('SETTINGS');
            }}
            onOpenCustomers={() => setCurrentView('CUSTOMERS')}
            onOpenHistory={() => setCurrentView('HISTORY')}
            onOpenFinance={() => handleViewChange('FINANCE')}
            onOpenInventoryTracking={(productId) => handleViewChange('TRACKING', { productId })}
            onOpenAudit={() => handleViewChange('INVENTORY_AUDIT')}
            onOpenTableMap={() => handleViewChange('TABLE_MAP')}
            onOpenAgenda={() => setCurrentView('AGENDA')}
            onTransactionComplete={handleTransactionComplete}
            activeTable={activeTable}
            rooms={rooms}
            onClearActiveTable={() => setActiveTable(null)}
            onAddCustomer={async (c) => {
              const updated = [...customers, c];
              setCustomers(updated);
              await db.save('customers', updated);
              syncManager.broadcastChange('customers', c, 'CREATE').catch(console.error);
            }}
            onUpdateConfig={handleConfigUpdate}
            onKioskPay={() => handleViewChange('KIOSK_PAYMENT' as any)}
            activeTerminalId={getCurrentTerminal()!.id}
            onUpdateActiveTableGuests={handleUpdateActiveTableGuests}
          />
        );

      case 'AGENDA':
        // Redirecting to Settings with Agenda as initial view
        setSettingsInitialView('AGENDA');
        setCurrentView('SETTINGS');
        return null;

      case 'SETTINGS':
        return (
          <Settings
            config={config}
            users={users}
            currentUser={currentUser}
            roles={roles}
            transactions={transactions}
            products={products}
            warehouses={warehouses}
            transfers={transfers}
            internalSequences={internalSequences}
            suppliers={suppliers}
            customers={customers}
            rooms={rooms}
            collections={collections}
            onUpdateCollections={setCollections}
            purchaseOrders={purchaseOrders}
            receptions={receptions}
            parkedTickets={parkedTickets}
            onUpdateTransfers={async (t) => { setTransfers(t); await db.save('transfers', t); }}
            onUpdateSequences={async (s) => { setInternalSequences(s); await db.save('internalSequences', s); }}
            onUpdateConfig={handleConfigUpdate}
            onUpdateUsers={async (u) => { setUsers(u); await db.save('users', u); }}
            onUpdateRoles={async (r) => { setRoles(r); await db.save('roles', r); }}
            onUpdateProducts={async (p) => { setProducts(p); /* db.save('products', p) removed for efficiency */ syncManager.broadcastChange('products', null, 'UPDATE').catch(console.error); }}
            onUpdateWarehouses={async (w) => { setWarehouses(w); await db.save('warehouses', w); }}
            onUpdateCustomers={async (c) => { setCustomers(c); await db.save('customers', c); }}
            onRepairLegacyReceivables={handleRepairLegacyReceivables}
            onAdjustStock={async (adjustments) => {
              const pairedTerminal = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
              const terminalId = pairedTerminal?.id || 'LOCAL';
              const whId = config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId || 'wh_central';
              for (const adj of adjustments) {
                if (adj.quantity !== 0) {
                  const type = adj.quantity > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA';
                  await db.recordInventoryMovement(whId, adj.productId, type, 'AUDITORIA', adj.quantity, undefined, terminalId);
                }
              }
              backgroundSyncManager.triggerSync();
              const freshData = await db.init();
              setProducts(freshData.products);
              const freshStocks = await db.get('productStocks') as ProductStock[] || [];
              setProductStocks(freshStocks);
            }}
            onOpenZReport={() => setCurrentView('Z_REPORT')}
            onOpenSupplyChain={() => setCurrentView('SUPPLY_CHAIN')}
            onOpenFranchise={() => setCurrentView('FRANCHISE_DASHBOARD')}
            onOpenTableDesigner={() => setCurrentView('TABLE_DESIGNER')}
            initialView={settingsInitialView as any}
            initialData={settingsInitialData}
            isAdminMode={isAdminMode}
            terminalId={(config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.id || 'T1'}
            onClose={() => {
              setSettingsInitialView(undefined);
              setSettingsInitialData(undefined);
              setIsAdminMode(false); // Exit admin mode when closing settings

              // Return to appropriate view based on role
              const role = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.config?.deviceRole?.role;
              if (role === DeviceRole.SELF_CHECKOUT) setCurrentView('KIOSK_WELCOME');
              else if (role === DeviceRole.PRICE_CHECKER) setCurrentView('CHECKER_SCAN');
              else if (role === DeviceRole.KITCHEN_DISPLAY) setCurrentView('KITCHEN_ORDERS');
              else if (role === DeviceRole.HANDHELD_INVENTORY) setCurrentView('INVENTORY_HOME');
              else setCurrentView('POS');
            }}
            currentDeviceId={deviceId}
            onUpdateRooms={async (newRooms) => { setRooms(newRooms); await db.save('rooms', newRooms); }}
          />
        );

      case 'SETTINGS_SYNC':
        return (
          <Settings
            config={config}
            users={users}
            currentUser={currentUser}
            roles={roles}
            transactions={transactions}
            products={products}
            warehouses={warehouses}
            transfers={transfers}
            rooms={rooms}
            internalSequences={internalSequences}
            onUpdateTransfers={async (t) => { setTransfers(t); await db.save('transfers', t); }}
            onUpdateSequences={async (s) => { setInternalSequences(s); await db.save('internalSequences', s); }}
            onUpdateConfig={handleConfigUpdate}
            onUpdateUsers={async (u) => { setUsers(u); await db.save('users', u); }}
            onUpdateRoles={async (r) => { setRoles(r); await db.save('roles', r); }}
            onUpdateProducts={async (p) => { setProducts(p); await db.save('products', p); }}
            onUpdateWarehouses={async (w) => { setWarehouses(w); await db.save('warehouses', w); }}
            onUpdateCustomers={async (c) => { setCustomers(c); await db.save('customers', c); }}
            collections={collections}
            onUpdateCollections={setCollections}
            onRepairLegacyReceivables={handleRepairLegacyReceivables}
            onAdjustStock={async (adjustments) => {
              const pairedTerminal = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
              const terminalId = pairedTerminal?.id || 'LOCAL';
              const whId = config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId || 'wh_central';
              for (const adj of adjustments) {
                if (adj.quantity !== 0) {
                  const type = adj.quantity > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA';
                  await db.recordInventoryMovement(whId, adj.productId, type, 'AUDITORIA', adj.quantity, undefined, terminalId);
                }
              }
              backgroundSyncManager.triggerSync();
              const freshData = await db.init();
              setProducts(freshData.products);
              const freshStocks = await db.get('productStocks') as ProductStock[] || [];
              setProductStocks(freshStocks);
            }}
            onOpenZReport={() => setCurrentView('Z_REPORT')}
            onOpenSupplyChain={() => setCurrentView('SUPPLY_CHAIN')}
            onOpenFranchise={() => setCurrentView('FRANCHISE_DASHBOARD')}
            onOpenTableDesigner={() => setCurrentView('TABLE_DESIGNER')}
            isAdminMode={isAdminMode}
            initialView="SYNC"
            onClose={() => {
              setIsAdminMode(false);
              const role = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.config?.deviceRole?.role;
              if (role === DeviceRole.HANDHELD_INVENTORY) setCurrentView('INVENTORY_HOME');
              else setCurrentView('POS');
            }}
            currentDeviceId={deviceId}
            terminalId={(config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.id || 'T1'}
          />
        );

      case 'CUSTOMERS':
        return (
          <CustomerManagement
            customers={customers}
            config={config}
            rooms={rooms}
            users={users}
            collections={collections}
            currentUser={currentUser!}
            terminalId={(config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.id || 'T1'}
            onAddCustomer={async (c) => {
              const updated = [...customers, c];
              setCustomers(updated);
              await db.save('customers', updated);
              syncManager.broadcastChange('customers', c, 'CREATE').catch(console.error);
            }}
            onUpdateCustomer={async (c) => {
              const updated = customers.map(cust => cust.id === c.id ? c : cust);
              setCustomers(updated);
              await db.save('customers', updated);
              syncManager.broadcastChange('customers', c, 'UPDATE').catch(console.error);
            }}
            onUpdateCollections={(cols) => {
              setCollections(cols);
            }}
            onDeleteCustomer={async (id) => {
              const updated = customers.filter(cust => cust.id !== id);
              setCustomers(updated);
              await db.save('customers', updated);
              syncManager.broadcastChange('customers', { id }, 'DELETE').catch(console.error);
            }}
            onSelect={(c) => { setSelectedCustomer(c); setCurrentView('POS'); }}
            onClose={() => setCurrentView('POS')}
            onRetryFiscalDocument={retryFiscalDocument}
          />
        );

      case 'HISTORY':
        return (
          <TicketHistory
            transactions={transactions}
            config={config}
            currentUser={currentUser}
            users={users}
            roles={roles}
            initialSelectedId={scanTargetTicketId}
            onUpdateConfig={handleConfigUpdate}
            onClose={() => {
              setScanTargetTicketId(null); // Clear selection on close
              setCurrentView('POS');
            }}
            onRefundTransaction={async (tx, items, conditions, reason, options) => {
              // Direct call support
              // If conditions is string (legacy call from somewhere else?), handle it. 
              // But TicketHistory calls it with Map.
              // We just pass it through to handleProcessRefund.
              const validConditions = conditions instanceof Map ? conditions : new Map<string, 'SELLABLE' | 'DAMAGED'>();

              // If legacy call passed reason as 3rd arg (and conditions was undefined/string)
              const actualReason = typeof conditions === 'string' ? conditions : reason;

              try {
                return await handleProcessRefund(tx, items || [], validConditions, actualReason, options);
              } catch (refundError: any) {
                console.error('❌ Refund flow failed:', refundError);
                if (options?.settlementMode === 'CARD_VOID') {
                  alert(`AZUL anuló el pago, pero el POS no pudo completar la nota de crédito.\nDetalle: ${refundError?.message || 'Error desconocido'}`);
                } else {
                  alert(`Error procesando devolución: ${refundError?.message || 'Error desconocido'}`);
                }
                throw refundError;
              }
            }}
            onRetryFiscalDocument={retryFiscalDocument}
          />
        );

      case 'FINANCE':
        {
          const financeTerminal = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
          const currentTerminalId = financeTerminal?.id || 'T1';
          const terminalTransactions = getPendingTransactionsForTerminal(currentTerminalId);
          const terminalMovements = getPendingCashMovementsForTerminal(currentTerminalId);
          const allowPartialXReport = financeTerminal?.config?.workflow?.session?.allowPartialXReport !== false;

          return (
            <FinanceDashboard
              transactions={terminalTransactions}
              cashMovements={terminalMovements}
              config={config}
              currentUser={currentUser}
              roles={roles}
              allowPartialXReport={allowPartialXReport}
              onRegisterMovement={handleRegisterMovement}
              onOpenZReport={() => setCurrentView('Z_REPORT')}
              onClose={() => setCurrentView('POS')}
            />
          );
        }

      case 'Z_REPORT':
        {
          const currentTerminalId = getCurrentTerminal()?.id || 'T1';
          const terminalTransactions = getPendingTransactionsForTerminal(currentTerminalId);
          const terminalMovements = getPendingCashMovementsForTerminal(currentTerminalId);

          return (
            <ZReportDashboard
              transactions={terminalTransactions}
              cashMovements={terminalMovements}
              collections={collections}
              config={config}
              userName={currentUser?.name || ''}
              currentUser={currentUser}
              roles={roles}
              onConfirmClose={handleZReport}
              terminalId={currentTerminalId}
              onClose={() => {
                const role = getCurrentDeviceRole();
                if (role === DeviceRole.SELF_CHECKOUT) setCurrentView('KIOSK_WELCOME');
                else if (role === DeviceRole.PRICE_CHECKER) setCurrentView('CHECKER_SCAN');
                else if (role === DeviceRole.KITCHEN_DISPLAY) setCurrentView('KITCHEN_ORDERS');
                else if (role === DeviceRole.HANDHELD_INVENTORY) setCurrentView('INVENTORY_HOME');
                else setCurrentView('POS');
              }}
            />
          );
        }

      case 'SUPPLY_CHAIN':
        return (
          <SupplyChainManager
            products={products}
            suppliers={suppliers}
            purchaseOrders={purchaseOrders}
            receptions={receptions}
            supplierProductPrices={supplierProductPrices}
            config={config}
            onClose={() => setCurrentView('POS')}
            onDeleteSupplier={async (id) => {
              try {
                // Delete from DB first to ensure persistence consistency
                await db.deleteDocument('suppliers', id);
                // Then update state
                setSuppliers(prev => prev.filter(s => s.id !== id));
                // Broadcast change
                syncManager.broadcastChange('suppliers', { id }, 'DELETE').catch(console.error);
              } catch (error) {
                console.error("Failed to delete supplier:", error);
                alert("Error al eliminar el proveedor. Por favor, intente de nuevo.");
              }
            }}
            onCreateOrder={async (o) => { const updated = [...purchaseOrders, o]; setPurchaseOrders(updated); await db.saveDocument('purchaseOrders', o); }}
            onUpdateOrder={async (o) => { const updated = purchaseOrders.map(p => p.id === o.id ? o : p); setPurchaseOrders(updated); await db.saveDocument('purchaseOrders', o); }}
            onReceiveStock={async (items, orderId) => {
              console.log("🚀 APP: onReceiveStock CALLED", { orderId, itemsCount: items.length });

              const pairedTerminal = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
              const terminalId = pairedTerminal?.id || 'LOCAL';
              const whId = config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId || 'wh_central';

              // 1. Record Inventory Movements (Batch)
              const movements: any[] = [];
              for (const item of items) {
                if (item.quantityReceived <= 0) continue;

                if (item.trackingData && item.trackingData.length > 0) {
                  // For tracked items, we record movements per tracking unit (Serial) or per Lot
                  // If there are multiple entries, it's likely serials (qty 1 each)
                  // If there's 1 entry and qty > 1, it's a lot.
                  if (item.trackingData.length === 1 && item.quantityReceived > 1) {
                    // LOT
                    movements.push({
                      warehouseId: whId,
                      productId: item.productId,
                      concept: 'COMPRA' as LedgerConcept,
                      documentRef: orderId || 'OC-REC',
                      qty: item.quantityReceived,
                      movementCost: item.cost,
                      terminalId,
                      variantId: item.variantSku,
                      variantName: item.variantInfo,
                      trackingId: item.trackingData[0].id,
                      trackingCode: item.trackingData[0].trackingCode
                    });
                  } else {
                    // SERIALS (or 1 item with tracing)
                    for (const track of item.trackingData) {
                      movements.push({
                        warehouseId: whId,
                        productId: item.productId,
                        concept: 'COMPRA' as LedgerConcept,
                        documentRef: orderId || 'OC-REC',
                        qty: 1, // Individual serial
                        movementCost: item.cost,
                        terminalId,
                        variantId: item.variantSku,
                        variantName: item.variantInfo,
                        trackingId: track.id,
                        trackingCode: track.trackingCode
                      });
                    }
                  }
                } else {
                  movements.push({
                    warehouseId: whId,
                    productId: item.productId,
                    concept: 'COMPRA' as LedgerConcept,
                    documentRef: orderId || 'OC-REC',
                    qty: item.quantityReceived,
                    movementCost: item.cost,
                    terminalId,
                    variantId: item.variantSku,
                    variantName: item.variantInfo
                  });
                }
              }

              console.log("📦 APP: Calculated movements:", movements.length, movements);

              if (movements.length > 0) {
                console.log("💾 APP: Calling db.recordInventoryMovements...");
                try {
                  await db.recordInventoryMovements(movements);
                  console.log("✅ APP: db.recordInventoryMovements success");
                } catch (e) {
                  console.error("❌ APP: db.recordInventoryMovements FAILED:", e);
                  throw e; // Propagate to UI
                }
              } else {
                console.warn("⚠️ APP: No movements to record (quantityReceived = 0?)");
              }

              // 2. Save Reception Document
              let receptionId = `REC-${Date.now()}`;
              try {
                // Try to get sequence for 'PURCHASE'
                const seriesId = pairedTerminal?.config?.documentAssignments?.['PURCHASE'];
                if (seriesId) {
                  const seqResult = await transactionService.generateTransactionId('PURCHASE' as any, seriesId);
                  receptionId = seqResult.displayId;
                }
              } catch (e) {
                console.warn("⚠️ APP: Failed to generate reception sequence, falling back to REC-Date", e);
              }

              const newReception: Reception = {
                id: receptionId,
                purchaseOrderId: orderId || 'MANUAL',
                date: new Date().toISOString(),
                receivedBy: currentUser?.id || 'sys',
                receivedByUserName: currentUser?.name || 'System',
                items: items.filter(i => i.quantityReceived > 0),
                terminalId,
                syncStatus: 'PENDING',
                updatedAt: new Date().toISOString()
              };

              console.log("📝 APP: Saving new reception document:", newReception.id);
              const updatedReceptions = [...receptions, newReception];
              setReceptions(updatedReceptions);
              await db.saveDocument('receptions', newReception);

              // 2.5 Update Supplier Price Catalog
              try {
                const po = purchaseOrders.find(p => p.id === orderId);
                if (po && po.supplierId && items.length > 0) {
                  console.log(`🏷️ APP: Updating price catalog for supplier ${po.supplierId}...`);
                  const priceUpdates = [];
                  for (const item of items) {
                    if (item.quantityReceived <= 0) continue;

                    const recordId = `${po.supplierId}_${item.productId}`;
                    let existingRecord = await db.getDocument('supplierProductPrices', recordId) as any;

                    if (!existingRecord) {
                      existingRecord = {
                        id: recordId,
                        supplierId: po.supplierId,
                        productId: item.productId,
                        history: []
                      };
                    }

                    const newCost = item.cost || 0;
                    const newHistoryEntry = {
                      date: new Date().toISOString(),
                      cost: newCost,
                      orderId: orderId || 'MANUAL'
                    };

                    const updatedRecord = {
                      ...existingRecord,
                      lastCost: newCost,
                      currency: config.currencySymbol,
                      updatedAt: new Date().toISOString(),
                      history: [...(existingRecord.history || []), newHistoryEntry]
                    };
                    priceUpdates.push(updatedRecord);
                    await db.saveDocument('supplierProductPrices', updatedRecord);
                  }

                  if (priceUpdates.length > 0) {
                    syncManager.broadcastChange('supplierProductPrices', priceUpdates, 'UPDATE').catch(console.error);
                  }
                }
              } catch (e) {
                console.warn("⚠️ APP: Failed to update supplier price catalog:", e);
              }

              // 3. Refresh Products State
              const refreshedProducts = await db.get('products') as Product[] || [];
              setProducts(refreshedProducts);

              if (permissionService.isMasterTerminal()) {
                syncManager.broadcastChange('products', null, 'UPDATE').catch(console.error);
                syncManager.broadcastChange('productStocks', null, 'UPDATE').catch(console.error);
              }

              // Refresh detailed stocks state
              const freshStocks = await db.get('productStocks') as ProductStock[] || [];
              setProductStocks(freshStocks);

              // NEW: Refresh Supplier Prices
              const freshSupplierPrices = await db.get('supplierProductPrices') as any[] || [];
              setSupplierProductPrices(freshSupplierPrices);

              console.log("🏁 APP: onReceiveStock FINISHED");
            }}
            onAdjustStock={async (adjustments) => {
              const pairedTerminal = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
              const terminalId = pairedTerminal?.id || 'LOCAL';
              const whId = config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId || 'wh_central';
              for (const adj of adjustments) {
                if (adj.quantity !== 0) {
                  const type = adj.quantity > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA';
                  // recordInventoryMovement handles adding/subtracting based on signed quantity
                  await db.recordInventoryMovement(whId, adj.productId, type, 'AUDITORIA', adj.quantity, undefined, terminalId);
                }
              }
              backgroundSyncManager.triggerSync();
              const freshData = await db.init();
              setProducts(freshData.products);

              if (permissionService.isMasterTerminal()) {
                syncManager.broadcastChange('products', null, 'UPDATE').catch(console.error);
                syncManager.broadcastChange('productStocks', null, 'UPDATE').catch(console.error);
              }

              // Refresh detailed stocks state
              const freshStocks = await db.get('productStocks') as ProductStock[] || [];
              setProductStocks(freshStocks);

              // backgroundSyncManager.triggerSync already called above
            }}
            onAddSupplier={async (s) => {
              setSuppliers(prev => [...prev, s]);
              await db.saveDocument('suppliers', s);
              syncManager.broadcastChange('suppliers', s, 'CREATE').catch(console.error);
            }}
            onUpdateSupplier={async (s) => {
              setSuppliers(prev => prev.map(sup => sup.id === s.id ? s : sup));
              await db.saveDocument('suppliers', s);
              syncManager.broadcastChange('suppliers', s, 'UPDATE').catch(console.error);
            }}
            onDeleteOrder={async (orderId) => {
              const updated = purchaseOrders.filter(o => o.id !== orderId);
              setPurchaseOrders(updated);
              await db.deleteDocument('purchaseOrders', orderId);
            }}
            onDeleteReception={async (receptionId) => {
              const reception = receptions.find(r => r.id === receptionId);
              if (!reception) return;

              // Validation: Check if stock is sufficient to reverse
              const insufficientStockItems = reception.items.filter(item => {
                const product = products.find(p => p.id === item.productId);
                return !product || (product.stock || 0) < item.quantityReceived;
              });

              if (insufficientStockItems.length > 0) {
                const names = insufficientStockItems.map(i => i.productName).join(', ');
                alert(`No se puede anular la recepción. El inventario de los siguientes productos ya ha sido utilizado o vendido: ${names}`);
                return;
              }

              // Reverse Stock
              let updatedProducts = [...products];
              for (const item of reception.items) {
                const productIndex = updatedProducts.findIndex(p => p.id === item.productId);
                if (productIndex >= 0) {
                  const currentStock = updatedProducts[productIndex].stock || 0;
                  const newStock = currentStock - item.quantityReceived;

                  const updatedProduct = { ...updatedProducts[productIndex], stock: newStock };
                  updatedProducts[productIndex] = updatedProduct;

                  await db.saveDocument('products', updatedProduct);

                  // Record Adjustment
                  await db.recordInventoryMovement(
                    config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId || 'wh_central',
                    item.productId,
                    'AJUSTE_SALIDA', // Correction
                    `VOID-${receptionId}`,
                    -item.quantityReceived,
                    item.cost,
                    getCurrentTerminal()?.id || 'T1',
                    item.variantSku,
                    item.variantInfo
                  );
                }
              }
              setProducts(updatedProducts);

              // Remove Reception
              const updatedReceptions = receptions.filter(r => r.id !== receptionId);
              setReceptions(updatedReceptions);
              await db.deleteDocument('receptions', receptionId);
              alert("Recepción anulada y stock revertido correctamente.");
            }}
          />
        );

      // Inventory Tracking
      case 'TRACKING':
        return <InventoryTracking onClose={() => handleViewChange('POS')} initialProductId={viewData?.productId} />;
      case 'FRANCHISE_DASHBOARD':
        return <FranchiseDashboard onBack={() => setCurrentView('POS')} />;

      // Kiosk / Self-Checkout Views
      case 'KIOSK_WELCOME':
        return (
          <KioskWelcome
            onStartShopping={() => {
              clearSecurityState();
              handleViewChange('KIOSK_BROWSER');
            }}
            storeName={config.companyInfo?.name}
            onAdminAccess={() => {
              const rawPin = prompt('Ingrese PIN de administrador:');
              if (!rawPin) return;

              const pin = rawPin.trim();
              if (authLevelService.validateEscapeHatch(pin)) {
                setIsAdminMode(true);
                setCurrentView('SETTINGS');
              } else {
                alert('PIN incorrecto');
              }
            }}
          />
        );

      case 'KIOSK_BROWSER':
        return (
          <KioskProductBrowser
            products={products}
            cart={cart}
            onAddToCart={(product, quantity = 1) => {
              const existing = cart.find(item => item.id === product.id);
              let newCart;
              if (existing) {
                newCart = cart.map(item =>
                  item.id === product.id
                    ? { ...item, quantity: item.quantity + quantity }
                    : item
                );
              } else {
                newCart = [...cart, { ...product, quantity }];
              }
              const currentTerminalId = getCurrentTerminal()?.id || 'T1';
              setCart(applyPromotions(newCart, config, currentTerminalId));
            }}
            onRemoveFromCart={(productId) => {
              const newCart = cart.filter(item => item.id !== productId);
              const currentTerminalId = getCurrentTerminal()?.id || 'T1';
              setCart(applyPromotions(newCart, config, currentTerminalId));
            }}
            onCheckout={() => handleViewChange('KIOSK_PAYMENT')}
            onCancel={() => {
              clearSecurityState();
              setCart([]);
              handleViewChange('KIOSK_WELCOME');
            }}
            config={config}
            terminalId={getCurrentTerminal()?.id || 'T1'}
            customerConfidenceIndex={selectedCustomer ? 1 : 0.75}
          />
        );

      case 'INVENTORY_AUDIT':
        return (
          <div className="bg-gray-100 h-screen flex flex-col overflow-hidden">
            <div className="bg-white shadow-sm border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10 shrink-0">
              <button
                onClick={() => setCurrentView('INVENTORY_HOME')}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-gray-200"
              >
                ← Volver
              </button>
              <h1 className="text-base font-black text-gray-800">Auditoría de Inventarios</h1>
              <div className="w-20"></div>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              <InventoryAuditClosure
                warehouses={warehouses}
                products={products}
                config={config}
                currentUser={currentUser}
                roles={roles}
                terminalId={getCurrentTerminal()?.id}
              />
            </div>
          </div>
        );

      case 'KIOSK_PAYMENT':
        const kioskPaymentMethods = resolveKioskPaymentMethods(config);
        return (
          <KioskPayment
            cart={cart}
            paymentMethods={kioskPaymentMethods}
            onBack={() => handleViewChange('KIOSK_BROWSER')}
            onPaymentComplete={async (method) => {
              console.log(`Payment completed with ${method.label} (${method.type})`);

              // Get current terminal and config
              const currentTerminal = getCurrentTerminal();
              const activeConfig = currentTerminal?.config;

              if (!activeConfig || !currentUser) {
                console.error("Missing config or user for kiosk transaction");
                setCart([]);
                handleViewChange('KIOSK_WELCOME');
                return;
              }

              // Calculate totals
              const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
              const tax = subtotal * 0.18; // TODO: Use real tax logic from config
              const total = subtotal + tax;
              const baseCurrency = config.currencies?.find(currency => currency.isBase)?.code || 'DOP';
              const configuredMethod = (config.paymentMethods || []).find(paymentMethod => paymentMethod.id === method.id)
                || (config.paymentMethods || []).find(paymentMethod => paymentMethod.type === method.type && paymentMethod.name === method.label)
                || (config.paymentMethods || []).find(paymentMethod => paymentMethod.type === method.type);
              const isIntegratedCard = configuredMethod?.type === 'CARD' && configuredMethod.integrationMode === 'INTEGRATED';
              const assignedIntegration = configuredMethod?.integrationId
                ? config.integrations?.find(integration => integration.id === configuredMethod.integrationId)
                : (configuredMethod?.integration && configuredMethod.integration !== 'NONE'
                    ? config.integrations?.find(integration => integration.provider === configuredMethod.integration)
                    : undefined);

              // Get assigned sequence
              const seriesId = activeConfig.documentAssignments?.['TICKET'];
              if (!seriesId) {
                alert("Error: No hay secuencia de TICKET asignada a esta terminal.");
                return;
              }

              try {
                let gatewayPaymentFields: Partial<PaymentEntry> = {};

                if (isIntegratedCard) {
                  if (!assignedIntegration) {
                    throw new Error(`El medio de pago ${method.label} no tiene una integración válida asignada.`);
                  }

                  if (assignedIntegration.provider !== 'AZUL') {
                    throw new Error(`La integración ${assignedIntegration.provider} todavía no está soportada en self checkout.`);
                  }

                  const gatewayOrderNumber = createKioskGatewayOrderNumber();
                  const azulResponse = await azulMcmService.sale(assignedIntegration, {
                    amount: total,
                    itbis: tax,
                    orderNumber: gatewayOrderNumber,
                    installment: '0',
                  });

                  gatewayPaymentFields = {
                    gatewayProvider: 'AZUL',
                    gatewayIntegrationId: assignedIntegration.id,
                    gatewayTransactionType: 'SALE',
                    gatewayStatus: azulResponse.approved ? 'APPROVED' : 'DECLINED',
                    gatewayResponseCode: azulResponse.responseCode,
                    gatewayResponseMessage: azulResponse.responseMessage,
                    gatewayOrderNumber: azulResponse.orderNumber || gatewayOrderNumber,
                    gatewayProcessedAmount: total,
                    gatewayProcessedTaxAmount: tax,
                    gatewayAuthorizationCode: azulResponse.authorizationCode,
                    gatewayReference: azulResponse.referenceNumber,
                    gatewaySequenceNumber: azulResponse.sequenceNumber,
                    gatewayInvoiceNumber: azulResponse.invoiceNumber,
                    gatewayBatchNumber: azulResponse.batchNumber,
                    gatewayMerchantId: azulResponse.merchantId,
                    gatewayTerminalId: azulResponse.terminalId,
                    gatewayMaskedPan: azulResponse.maskedPan,
                    gatewayCardBrand: azulResponse.cardBrand,
                    gatewayEntryMode: azulResponse.entryMode,
                    gatewayReceiptMerchant: azulResponse.receiptMerchant,
                    gatewayReceiptClient: azulResponse.receiptClient,
                    gatewaySignatureData: azulResponse.signatureData,
                    gatewayRequireSignature: azulResponse.requireSignature,
                    gatewayRawResponse: azulResponse.rawResponse,
                  };
                }

                // Create Transaction
                const txn = await transactionService.createTransaction({
                  documentType: 'TICKET',
                  seriesId: seriesId,
                  date: new Date().toISOString(),
                  items: cart,
                  total: total,
                  payments: [{
                    id: `PAY-${Date.now()}`,
                    method: method.type,
                    methodId: method.id,
                    methodLabel: method.label,
                    methodIcon: method.iconName,
                    amount: total,
                    timestamp: new Date(),
                    currencyCode: baseCurrency,
                    currency: config.currencySymbol,
                    ...gatewayPaymentFields,
                  }],
                  userId: currentUser.id,
                  userName: currentUser.name,
                  terminalId: currentTerminal.id,
                  status: 'COMPLETED',
                  // Kiosk usually doesn't have selected customer, use generic or guest
                  customerName: 'Cliente General',
                  taxAmount: tax,
                  netAmount: subtotal,
                  isTaxIncluded: false // TODO: Check tariff
                });

                // Save and Sync
                await handleTransactionComplete(txn);
                return txn;
              } catch (error) {
                console.error("Error creating kiosk transaction:", error);
                throw new Error("Error al guardar la transacción. Por favor intente de nuevo.");
              }
            }}
            onPrintReceipt={async (transaction) => {
              if (!config) {
                throw new Error('No hay configuración disponible para imprimir.');
              }

              const printed = await printTicket(transaction, config);
              if (!printed) {
                throw new Error('La impresora no respondió. Verifica el módulo de hardware.');
              }
              return printed;
            }}
            onCancel={() => {
              clearSecurityState();
              setCart([]);
              handleViewChange('KIOSK_WELCOME');
            }}
          />
        );

      // Price Checker View
      case 'CHECKER_SCAN':
        return <PriceCheckerDisplay products={products} />;

      // Handheld Inventory Views
      case 'INVENTORY_HOME':
        return (
          <InventoryHome
            onNavigate={handleViewChange}
            userName={currentUser?.name}
            warehouses={warehouses}
          />
        );

      case 'INVENTORY_COUNT':
        return (
          <InventoryCount
            products={products}
            warehouseId={viewData?.warehouseId}
            warehouseName={viewData?.warehouseName}
            onCancel={() => handleViewChange('INVENTORY_HOME')}
            terminalId={getCurrentTerminal()?.id || 'T1'}
            userId={currentUser?.id || 'sys'}
            userName={currentUser?.name || 'System'}
          />
        );

      case 'INVENTORY_RECEPTION':
        return (
          <MobileReception
            products={products}
            suppliers={suppliers}
            purchaseOrders={purchaseOrders}
            transfers={transfers}
            warehouses={warehouses}
            config={config}
            currentUser={currentUser}
            terminalId={getCurrentTerminal()?.id || 'LOCAL'}
            onProcessed={async () => {
              const [freshProducts, freshOrders, freshTransfers, freshReceptions, freshStocks] = await Promise.all([
                db.get('products') as Promise<Product[]>,
                db.get('purchaseOrders') as Promise<PurchaseOrder[]>,
                db.get('transfers') as Promise<StockTransfer[]>,
                db.get('receptions') as Promise<Reception[]>,
                db.get('productStocks') as Promise<ProductStock[]>
              ]);

              setProducts(freshProducts || []);
              setPurchaseOrders(freshOrders || []);
              setTransfers(freshTransfers || []);
              setReceptions(freshReceptions || []);
              setProductStocks(freshStocks || []);

              backgroundSyncManager.triggerSync().catch(console.error);
            }}
            onCancel={() => handleViewChange('INVENTORY_HOME')}
          />
        );

      case 'INVENTORY_LABELS':
        return (
          <InventoryLabelsMobile
            products={products}
            config={config}
            terminalId={getCurrentTerminal()?.id || 'LOCAL'}
            onCancel={() => handleViewChange('INVENTORY_HOME')}
          />
        );

      case 'VISOR':
        return <CustomerVisor />;

      case 'KITCHEN_ORDERS':
        return <KitchenDisplay />;

      default:
        return <div className="h-screen flex items-center justify-center">Vista no implementada.</div>;
    }
  };


  // Render with appropriate layout based on device role
  const renderWithLayout = () => {
    // Escape hatch for activation flow
    if (currentView === 'ACTIVATION') {
      return renderView();
    }

    const role = getCurrentDeviceRole();
    const content = renderView();

    // Handle escape hatch for kiosk modes
    const handleEscapeHatch = () => {
      const rawPin = prompt('Ingrese PIN de administrador:');
      if (!rawPin) return;

      const pin = rawPin.trim();
      if (authLevelService.validateEscapeHatch(pin)) {
        setIsAdminMode(true);
        setCurrentView('SETTINGS');
      } else {
        alert('PIN incorrecto');
      }
    };

    // Handle navigation for handheld
    const handleHandheldNavigate = (view: string, data?: any) => {
      const decision = terminalRouter.beforeNavigate(view, currentView);
      if (decision.allowed) {
        handleViewChange(view as ViewState, data);
      } else {
        alert(decision.message || 'Navegación no permitida');
      }
    };

    switch (role) {
      case DeviceRole.SELF_CHECKOUT:
        return (
          <SelfCheckoutLayout
            onEscapeHatch={handleEscapeHatch}
            onTimeout={() => {
              if (currentView !== 'KIOSK_WELCOME') {
                clearSecurityState();
                setCart([]);
                setCurrentView('KIOSK_WELCOME');
              }
            }}
            timeoutMs={60000} // 60 seconds timeout
          >
            {content}
          </SelfCheckoutLayout>
        );

      case DeviceRole.PRICE_CHECKER:
        return (
          <PriceCheckerLayout onEscapeHatch={handleEscapeHatch}>
            {content}
          </PriceCheckerLayout>
        );

      case DeviceRole.HANDHELD_INVENTORY:
        return (
          <HandheldLayout
            onNavigate={handleHandheldNavigate}
            currentModule={currentView}
          >
            {content}
          </HandheldLayout>
        );

      case DeviceRole.KITCHEN_DISPLAY:
        return (
          <KitchenDisplayLayout onEscapeHatch={handleEscapeHatch}>
            {content}
          </KitchenDisplayLayout>
        );

      case DeviceRole.STANDARD_POS:
      default:
        return (
          <StandardPOSLayout>
            {content}
          </StandardPOSLayout>
        );
    }
  };

  if (!isDataLoaded) {
    if (initialConnError) {
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-red-50 text-red-900 p-8">
          <div className="text-6xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold mb-2">Error de Inicialización</h1>
          <p className="text-lg bg-white p-4 rounded shadow border border-red-200">{initialConnError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-6 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Reintentar
          </button>
        </div>
      );
    }
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50 text-slate-900">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
          <p className="font-bold animate-pulse">Cargando CLIC POS...</p>
        </div>
      </div>
    );
  }

  // --- SECURITY BLOCKER ---
  if (!isSecurityLoaded) {
    if (bootstrapError) {
      return (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-red-50 text-red-900 p-8">
          <div className="text-6xl mb-4">🔐</div>
          <h1 className="text-2xl font-bold mb-2">Error de Seguridad</h1>
          <p className="text-lg bg-white p-4 rounded shadow border border-red-200">{bootstrapError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-6 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Reintentar
          </button>
        </div>
      );
    }
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-50 text-slate-900">
        <div className="w-16 h-16 border-4 border-slate-900 border-t-transparent rounded-full animate-spin mb-4"></div>
        <h2 className="text-xl font-bold animate-pulse">Cargando Seguridad...</h2>
        <p className="text-gray-500 mt-2">Sincronizando usuarios y permisos</p>
      </div>
    );
  }

  const allowsViewportScroll = currentView === 'SETTINGS' || currentView === 'TERMINAL_PAIRING' || currentView === 'LOGIN';

  return (
    <ErrorBoundary componentName="App Root">
      <>
        {renderReconnectionBanner()}
        {renderTerminalConfigRestartBanner()}
        <div
          className={`fixed inset-0 w-full h-full bg-gray-50 flex flex-col font-sans select-none text-gray-900 ${allowsViewportScroll ? '' : 'overflow-hidden'}`}
          style={{
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
            overflowX: 'hidden',
            ...(allowsViewportScroll
              ? {
                  overflowY: 'scroll',
                  WebkitOverflowScrolling: 'touch'
                }
              : {})
          }}
        >
          {renderWithLayout()}
        </div>
      </>
    </ErrorBoundary>
  );
};

export default App;
