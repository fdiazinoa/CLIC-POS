
import React, { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon, X, CreditCard, Receipt,
  Monitor, Users, Truck, ShieldCheck, FileText,
  Globe, Database, Activity, Mail, Coins, Grid,
  Cpu, HardDrive, Smartphone, Cloud, Lock, Package, Building2,
  Printer, ArrowRightLeft, ShieldAlert, ListChecks, History, Tag, Percent, Award, Wallet, RefreshCw, Layers, ChefHat, UserCircle, BarChart3, Calendar, MessageCircle, Map as MapIcon, MapPin, PlugZap
} from 'lucide-react';
import {
  BusinessConfig,
  User,
  RoleDefinition,
  Transaction,
  Product,
  Warehouse,
  StockTransfer,
  Supplier,
  Customer,
  PurchaseOrder,
  Reception,
  AnalyticsCategory,
  InventoryLedgerEntry,
  AttendanceLog,
  ProductStock,
  InventoryCountSession,
  CashMovement,
  ZReport,
  Collection,
  Room
} from '../types';

// Component Imports
import AgendaManager from './AgendaManager';
import SpacesManager from './SpacesManager';
import WarehouseManager from './WarehouseManager';
import CatalogManager from './CatalogManager';
import TerminalSettings from './TerminalSettings';
import HardwareSettings from './HardwareSettings';
import CurrencySettings from './CurrencySettings';
import ReceiptDesigner from './ReceiptDesigner';
import EmailSettings from './EmailSettings';
import TipsSettings from './TipsSettings';
import DataSecurityHub from './DataSecurityHub';
import AuditLogViewer from './AuditLogViewer';
import TeamHub from './TeamHub';
import PaymentSettings from './PaymentSettings';
import IntegrationSettings from './IntegrationSettings';
import DocumentSettings from './DocumentSettings';
import TaxSettings from './TaxSettings';
import PromotionBuilder from './PromotionBuilder';
import { ImportWizard } from './ImportWizard/ImportWizard';
import LoyaltySettings from './LoyaltySettings';
import WalletIntegrations from './WalletIntegrations';
import SyncSettings from './SyncSettings';
import ProductionAreaManager from './ProductionAreaManager';
import LabelDesigner from './LabelDesigner';
import CustomerManagement from './CustomerManagement';
import ReportDashboard from './ReportDashboard';
import ReportViewer from './ReportViewer';
import SourcingIntelligence from './SourcingIntelligence';
import CompanySettings from './CompanySettings';
import { getInventorySnapshotAtDate, getLeadTimePerformance, getABCRanking, getHRPerformance } from './AnalyticsLogic';


interface SettingsProps {
  config: BusinessConfig;
  users: User[];
  currentUser: User | null;
  roles: RoleDefinition[];
  transactions: Transaction[];
  products: Product[];
  warehouses: Warehouse[];
  suppliers?: Supplier[];
  customers?: Customer[];
  collections?: Collection[];
  onUpdateCollections?: (collections: Collection[]) => void;
  purchaseOrders?: PurchaseOrder[];
  receptions?: Reception[];
  parkedTickets?: any[];
  transfers?: StockTransfer[];
  internalSequences?: any[];
  onUpdateTransfers?: (transfers: StockTransfer[]) => void;
  onUpdateSequences?: (sequences: any[]) => void;
  onUpdateConfig: (newConfig: BusinessConfig, restart?: boolean) => void;
  onUpdateUsers: (users: User[]) => void;
  onUpdateRoles: (roles: RoleDefinition[]) => void;
  onUpdateProducts: (products: Product[]) => void;
  onUpdateWarehouses: (warehouses: Warehouse[]) => void;
  onUpdateCustomers?: (customers: Customer[]) => void;
  onRepairLegacyReceivables?: () => Promise<{
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
  }>;
  onAdjustStock: (adjustments: { productId: string; quantity: number }[]) => void;
  onOpenZReport: () => void;
  onOpenSupplyChain: () => void;
  onOpenFranchise: () => void;
  onOpenTableDesigner: () => void;
  onClose: () => void;
  isAdminMode?: boolean;
  currentDeviceId?: string;
  terminalId?: string;
  initialView?: SettingsView;
  initialData?: any;
  rooms: Room[];
  onUpdateRooms?: (rooms: Room[]) => void;
}

type SettingsView = 'HOME' | 'CATALOG' | 'WAREHOUSES' | 'PAYMENTS' | 'INTEGRATIONS' | 'COMPANY' | 'RECEIPT' | 'TERMINALS' | 'TEAM' | 'HARDWARE' | 'SECURITY' | 'LOGS' | 'EXCHANGE' | 'EMAIL' | 'TIPS' | 'DOCUMENTS' | 'TAXES' | 'PROMOTIONS' | 'IMPORT_EXPORT' | 'LOYALTY' | 'WALLET_KEYS' | 'SYNC' | 'LAYOUT' | 'PRODUCTION_AREAS' | 'LABELS' | 'CUSTOMERS' | 'REPORTS' | 'AGENDA' | 'SPACES';

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

const Settings: React.FC<SettingsProps> = (props) => {
  const [currentView, setCurrentView] = useState<SettingsView>(props.initialView || 'HOME');
  const [isRepairingReceivables, setIsRepairingReceivables] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<AnalyticsCategory | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<InventoryLedgerEntry[]>([]);
  const [attendanceLogs, setAttendanceLogs] = useState<AttendanceLog[]>([]);
  const [inventoryStocks, setInventoryStocks] = useState<ProductStock[]>([]);
  const [inventoryCounts, setInventoryCounts] = useState<InventoryCountSession[]>([]);
  const [customerTransactions, setCustomerTransactions] = useState<Transaction[]>(props.transactions || []);
  const [operationsTransactions, setOperationsTransactions] = useState<Transaction[]>([]);
  const [operationsCashMovements, setOperationsCashMovements] = useState<CashMovement[]>([]);
  const [operationsZReports, setOperationsZReports] = useState<ZReport[]>([]);
  const [fiscalTransactions, setFiscalTransactions] = useState<Transaction[]>(props.transactions || []);
  const [fiscalTransactionHistory, setFiscalTransactionHistory] = useState<Transaction[]>([]);
  const [fiscalPurchaseOrders, setFiscalPurchaseOrders] = useState<PurchaseOrder[]>(props.purchaseOrders || []);
  const [fiscalReceptions, setFiscalReceptions] = useState<Reception[]>(props.receptions || []);
  const [fiscalSuppliers, setFiscalSuppliers] = useState<Supplier[]>(props.suppliers || []);
  const usesPageScroll = currentView === 'HOME' || currentView === 'TERMINALS' || currentView === 'TAXES';

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverflowY = document.body.style.overflowY;
    const previousBodyHeight = document.body.style.height;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlOverflowY = document.documentElement.style.overflowY;
    const previousHtmlHeight = document.documentElement.style.height;
    const bodyHadOverflowHiddenClass = document.body.classList.contains('overflow-hidden');

    document.body.style.overflow = 'auto';
    document.body.style.overflowY = 'auto';
    document.body.style.height = '100%';
    document.documentElement.style.overflow = 'auto';
    document.documentElement.style.overflowY = 'auto';
    document.documentElement.style.height = '100%';

    if (bodyHadOverflowHiddenClass) {
      document.body.classList.remove('overflow-hidden');
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overflowY = previousBodyOverflowY;
      document.body.style.height = previousBodyHeight;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.overflowY = previousHtmlOverflowY;
      document.documentElement.style.height = previousHtmlHeight;

      if (bodyHadOverflowHiddenClass) {
        document.body.classList.add('overflow-hidden');
      }
    };
  }, []);


  const hasPermission = (permission: string): boolean => {
    // ADMIN MODE OVERRIDE
    if (props.isAdminMode) return true;

    if (!props.currentUser) return false;
    const userRole = props.roles.find(r => r.id === props.currentUser?.role);
    if (!userRole) return false;
    // Admin always has access? Or explicit 'ALL' permission?
    if (userRole.permissions.includes('ALL')) return true;
    return userRole.permissions.includes(permission as any);
  };

  const handleRepairLegacyReceivables = async () => {
    if (!props.onRepairLegacyReceivables) {
      alert('La herramienta de reparación no está disponible en esta terminal.');
      return;
    }

    const confirmed = window.confirm(
      'Esto recalculará saldos pendientes CxC/deudas y recuperará Notas de Crédito faltantes desde movimientos de wallet.\n\n¿Desea continuar?'
    );
    if (!confirmed) return;

    setIsRepairingReceivables(true);
    try {
      const result: ReceivableRepairSummary = await props.onRepairLegacyReceivables();
      if (result.scannedTransactions === 0 && result.repairedCreditNotes === 0) {
        alert(
          'No se encontraron facturas ni notas de crédito wallet para reparar.\n\n' +
          'No se aplicaron cambios.'
        );
        return;
      }

      const repairedList = result.transactionIds.length > 0
        ? `\nTickets reparados: ${result.transactionIds.join(', ')}`
        : '';
      const repairedCreditNotesList = result.creditNoteIds.length > 0
        ? `\nNC recuperadas: ${result.creditNoteIds.join(', ')}`
        : '';

      alert(
        `Reparación CxC completada.\n\n` +
        `Facturas revisadas: ${result.scannedTransactions}\n` +
        `Mov. wallet revisados: ${result.scannedWalletMovements}\n` +
        `Facturas reparadas: ${result.repairedTransactions}\n` +
        `NC recuperadas: ${result.repairedCreditNotes}\n` +
        `Clientes ajustados: ${result.customersWithDebtChanges}\n` +
        `Pendiente antes: ${props.config.currencySymbol}${result.totalPendingBefore.toLocaleString()}\n` +
        `Pendiente después: ${props.config.currencySymbol}${result.totalPendingAfter.toLocaleString()}` +
        repairedList +
        repairedCreditNotesList
      );
    } catch (error) {
      console.error('Receivable repair failed:', error);
      alert('No se pudo completar la reparación de CxC. Revise consola e intente nuevamente.');
    } finally {
      setIsRepairingReceivables(false);
    }
  };

  const renderContent = () => {
    switch (currentView) {
      case 'IMPORT_EXPORT':
        return (
          <ImportWizard
            config={props.config}
            products={props.products}
            customers={props.customers || []}
            suppliers={props.suppliers || []}
            warehouses={props.warehouses}
            onClose={() => setCurrentView('HOME')}
            onUpdateConfig={props.onUpdateConfig}
            onUpdateProducts={async (p) => props.onUpdateProducts(p)}
            onUpdateCustomers={async (c) => { /* Implement customer update in App.tsx first */ }}
            onUpdateSuppliers={async (s) => { /* Implement supplier update */ }}
            onUpdateWarehouses={async (w) => props.onUpdateWarehouses(w)}
          />
        );

      case 'WALLET_KEYS':
        return (
          <WalletIntegrations
            config={props.config}
            onUpdateConfig={(newConfig) => props.onUpdateConfig(newConfig)}
          />
        );

      case 'CATALOG':
        return (
          <CatalogManager
            products={props.products}
            config={props.config}
            warehouses={props.warehouses}
            transactions={props.transactions}
            currentUser={props.currentUser}
            roles={props.roles}
            onUpdateProducts={props.onUpdateProducts}
            onUpdateConfig={props.onUpdateConfig}
            onClose={() => setCurrentView('HOME')}
            isAdminMode={props.isAdminMode}
            terminalId={props.terminalId}
            initialProductId={props.initialData?.productId}
            initialTab={props.initialData?.tab}
            transfers={props.transfers}
            purchaseOrders={props.purchaseOrders}
            suppliers={props.suppliers}
            rooms={props.rooms}
            onUpdateRooms={props.onUpdateRooms || (() => { })}
          />
        );

      case 'WAREHOUSES':
        return (
          <WarehouseManager
            warehouses={props.warehouses}
            products={props.products}
            transfers={props.transfers || []}
            suppliers={props.suppliers || []}
            purchaseOrders={props.purchaseOrders || []}
            parkedTickets={props.parkedTickets || []}
            config={props.config}
            terminalId={props.terminalId}
            currentUser={props.currentUser}
            roles={props.roles}
            internalSequences={props.internalSequences || []}
            onUpdateWarehouses={props.onUpdateWarehouses}
            onUpdateProducts={props.onUpdateProducts}
            onUpdateTransfers={props.onUpdateTransfers || (() => { })}
            onUpdateSequences={props.onUpdateSequences || (() => { })}
            onAdjustStock={props.onAdjustStock}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'PAYMENTS':
        return (
          <PaymentSettings
            config={props.config}
            onUpdateConfig={props.onUpdateConfig}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'INTEGRATIONS':
        return (
          <IntegrationSettings
            config={props.config}
            onUpdateConfig={props.onUpdateConfig}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'EXCHANGE':
        return (
          <CurrencySettings
            config={props.config}
            onUpdateConfig={props.onUpdateConfig}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'COMPANY':
        return (
          <CompanySettings
            config={props.config}
            onUpdateConfig={(newConfig) => props.onUpdateConfig(newConfig)}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'DOCUMENTS':
        return (
          <DocumentSettings
            onClose={() => setCurrentView('HOME')}
            config={props.config}
            terminalId={props.terminalId}
            currentDeviceId={props.currentDeviceId}
          />
        );

      case 'TAXES':
        return (
          <TaxSettings
            config={props.config}
            products={props.products}
            onUpdateConfig={props.onUpdateConfig}
            onUpdateProducts={props.onUpdateProducts}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'TERMINALS':
        return (
          <TerminalSettings
            config={props.config}
            onUpdateConfig={props.onUpdateConfig}
            onClose={() => setCurrentView('HOME')}
            products={props.products}
            warehouses={props.warehouses}
            isAdminMode={props.isAdminMode}
            currentDeviceId={props.currentDeviceId}
          />
        );

      case 'HARDWARE':
        return (
          <HardwareSettings
            config={props.config}
            products={props.products}
            onUpdateConfig={props.onUpdateConfig}
            onClose={() => setCurrentView('HOME')}
            terminalId={props.terminalId}
          />
        );

      case 'TIPS':
        return (
          <TipsSettings
            config={props.config}
            onUpdateConfig={props.onUpdateConfig}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'TEAM':
        return (
          <TeamHub
            users={props.users}
            roles={props.roles}
            onUpdateUsers={props.onUpdateUsers}
            onUpdateRoles={props.onUpdateRoles}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'PROMOTIONS':
        return (
          <PromotionBuilder
            config={props.config}
            products={props.products}
            transactions={props.transactions}
            onUpdateConfig={props.onUpdateConfig}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'LOYALTY':
        return (
          <LoyaltySettings
            config={props.config}
            onUpdateConfig={props.onUpdateConfig}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'RECEIPT':
        return (
          <div className="relative h-full">
            <button
              onClick={() => setCurrentView('HOME')}
              className="absolute top-4 right-4 z-50 p-2 bg-white rounded-full shadow-md hover:bg-gray-100"
            >
              <X size={24} />
            </button>
            <ReceiptDesigner
              config={props.config}
              onUpdateConfig={props.onUpdateConfig}
            />
          </div>
        );

      case 'EMAIL':
        return (
          <div className="relative h-full">
            <EmailSettings
              onSave={(emailConfig) => console.log('Email config saved locally', emailConfig)}
              onBack={() => setCurrentView('HOME')}
            />
          </div>
        );

      case 'SECURITY':
        return (
          <DataSecurityHub
            onClose={() => setCurrentView('HOME')}
            terminalId={props.terminalId || 'LOCAL'}
            config={props.config}
          />
        );

      case 'PRODUCTION_AREAS':
        return (
          <div className="relative h-full">
            <button
              onClick={() => setCurrentView('HOME')}
              className="absolute top-4 right-4 z-50 p-2 bg-white rounded-full shadow-md hover:bg-gray-100"
            >
              <X size={24} />
            </button>
            <ProductionAreaManager
              terminals={props.config.terminals}
            />
          </div>
        );

      case 'LABELS':
        return (
          <LabelDesigner
            config={props.config}
            onUpdateConfig={(newConfig) => props.onUpdateConfig(newConfig)}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'SYNC':
        return (
          <SyncSettings
            config={props.config}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'CUSTOMERS':
        return (
          <CustomerManagement
            customers={props.customers || []}
            config={props.config}
            rooms={props.rooms}
            users={props.users}
            currentUser={props.currentUser || props.users[0] || { id: 'sys', name: 'System', pin: '0000', role: 'admin' }}
            terminalId={props.terminalId || 'T1'}
            collections={props.collections || []}
            onUpdateCollections={(cols) => props.onUpdateCollections?.(cols)}
            onAddCustomer={(customer) => {
              const updated = [...(props.customers || []), customer];
              props.onUpdateCustomers?.(updated);
            }}
            onUpdateCustomer={(customer) => {
              const updated = (props.customers || []).map(c => c.id === customer.id ? customer : c);
              props.onUpdateCustomers?.(updated);
            }}
            onDeleteCustomer={(id) => {
              const updated = (props.customers || []).filter(c => c.id !== id);
              props.onUpdateCustomers?.(updated);
            }}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'AGENDA':
        return (
          <AgendaManager
            config={props.config}
            currentUser={props.currentUser!}
            customers={props.customers || []}
            rooms={props.rooms}
            users={props.users}
            warehouses={props.warehouses}
            onUpdateRooms={props.onUpdateRooms}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'SPACES':
        return (
          <SpacesManager
            rooms={props.rooms}
            warehouses={props.warehouses}
            onUpdateRooms={props.onUpdateRooms || (() => { })}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'REPORTS':
        if (selectedCategory) {
          let reportData: any[] = [];
          if (selectedCategory === 'INVENTORY') {
            reportData = getInventorySnapshotAtDate(props.products, ledgerEntries, new Date().toISOString());
          } else if (selectedCategory === 'CUSTOMERS') {
            reportData = [];
          } else if (selectedCategory === 'SOURCING') {
            reportData = getLeadTimePerformance(props.purchaseOrders || [], props.receptions || [], props.suppliers || []);
          } else if (selectedCategory === 'CATALOG') {
            reportData = getABCRanking(props.products, props.transactions);
          } else if (selectedCategory === 'OPERATIONS') {
            reportData = [];
          } else if (selectedCategory === 'HR') {
            reportData = getHRPerformance(attendanceLogs);
          } else if (selectedCategory === 'FISCAL') {
            reportData = [...fiscalTransactions, ...fiscalTransactionHistory].map(tx => ({
              id: tx.id,
              ncf: tx.ncf || 'Sin NCF',
              ticketNo: tx.displayId || tx.id,
              ncfType: tx.ncfType || '-',
              terminalId: tx.terminalId || '-',
              status: tx.status || '-',
              total: tx.total,
              date: tx.date
            }));
          } else {
            // Other
            reportData = props.transactions.map(tx => ({
              id: tx.id,
              name: tx.ncf || 'Sin NCF',
              total: tx.total,
              date: tx.date
            }));
          }

          if (selectedCategory === 'SOURCING') {
            return (
              <SourcingIntelligence
                purchaseOrders={props.purchaseOrders || []}
                receptions={props.receptions || []}
                suppliers={props.suppliers || []}
                products={props.products}
                config={props.config}
                onBack={() => setSelectedCategory(null)}
              />
            );
          }

          return (
            <ReportViewer
              category={selectedCategory}
              config={props.config}
              data={reportData}
              inventoryContext={selectedCategory === 'INVENTORY' ? {
                products: props.products,
                warehouses: props.warehouses,
                suppliers: props.suppliers || [],
                productStocks: inventoryStocks,
                inventoryLedger: ledgerEntries,
                inventoryCounts
              } : undefined}
              customerContext={selectedCategory === 'CUSTOMERS' ? {
                customers: props.customers || [],
                transactions: customerTransactions,
                warehouses: props.warehouses
              } : undefined}
              operationsContext={selectedCategory === 'OPERATIONS' ? {
                transactions: operationsTransactions,
                cashMovements: operationsCashMovements,
                zReports: operationsZReports
              } : undefined}
              fiscalContext={selectedCategory === 'FISCAL' ? {
                transactions: fiscalTransactions,
                transactionHistory: fiscalTransactionHistory,
                purchaseOrders: fiscalPurchaseOrders,
                receptions: fiscalReceptions,
                suppliers: fiscalSuppliers
              } : undefined}
              onBack={() => setSelectedCategory(null)}
            />
          );
        }
        return (
          <ReportDashboard
            onSelectCategory={(cat) => {
              setSelectedCategory(cat);
              if (cat === 'INVENTORY') {
                import('../utils/db').then(async ({ db }) => {
                  const [entries, stocks, counts] = await Promise.all([
                    db.get('inventoryLedger' as any),
                    db.get('productStocks' as any),
                    db.get('inventoryCounts' as any)
                  ]);
                  setLedgerEntries((entries as InventoryLedgerEntry[]) || []);
                  setInventoryStocks((stocks as ProductStock[]) || []);
                  setInventoryCounts((counts as InventoryCountSession[]) || []);
                }).catch(console.error);
              }
              if (cat === 'OPERATIONS') {
                import('../utils/db').then(async ({ db }) => {
                  const [activeTransactions, historyTransactions, movements, reports] = await Promise.all([
                    db.get('transactions' as any),
                    db.get('transactionHistory' as any),
                    db.get('cashMovements' as any),
                    db.get('zReports' as any)
                  ]);

                  const mergedTransactions = [
                    ...((activeTransactions as Transaction[]) || []),
                    ...((historyTransactions as Transaction[]) || [])
                  ];

                  setOperationsTransactions(mergedTransactions);
                  setOperationsCashMovements((movements as CashMovement[]) || []);
                  setOperationsZReports((reports as ZReport[]) || []);
                }).catch(console.error);
              }
              if (cat === 'CUSTOMERS') {
                import('../utils/db').then(async ({ db }) => {
                  const [activeTransactions, historyTransactions] = await Promise.all([
                    db.get('transactions' as any),
                    db.get('transactionHistory' as any)
                  ]);

                  const mergedById = new Map<string, Transaction>();
                  const merged = [
                    ...((activeTransactions as Transaction[]) || []),
                    ...((historyTransactions as Transaction[]) || [])
                  ];

                  merged.forEach(tx => {
                    if (!tx || !tx.id) return;
                    mergedById.set(tx.id, tx);
                  });

                  const scopedTransactions = mergedById.size > 0
                    ? Array.from(mergedById.values())
                    : (props.transactions || []);
                  setCustomerTransactions(scopedTransactions);
                }).catch(() => {
                  setCustomerTransactions(props.transactions || []);
                });
              }
              if (cat === 'FISCAL') {
                import('../utils/db').then(async ({ db }) => {
                  const [activeTransactions, historyTransactions, purchaseOrders, receptions, suppliers] = await Promise.all([
                    db.get('transactions' as any),
                    db.get('transactionHistory' as any),
                    db.get('purchaseOrders' as any),
                    db.get('receptions' as any),
                    db.get('suppliers' as any)
                  ]);

                  setFiscalTransactions((activeTransactions as Transaction[]) || []);
                  setFiscalTransactionHistory((historyTransactions as Transaction[]) || []);
                  setFiscalPurchaseOrders((purchaseOrders as PurchaseOrder[]) || []);
                  setFiscalReceptions((receptions as Reception[]) || []);
                  setFiscalSuppliers((suppliers as Supplier[]) || []);
                }).catch(console.error);
              }
              if (cat === 'HR' && attendanceLogs.length === 0) {
                import('../utils/db').then(({ db }) => {
                  db.get('attendance_logs' as any).then(entries => setAttendanceLogs(entries as AttendanceLog[]));
                });
              }
            }}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'LOGS':

        return (
          <div className="relative h-full">
            <button
              onClick={() => setCurrentView('HOME')}
              className="absolute top-4 right-4 z-50 p-2 bg-white rounded-full shadow-md hover:bg-gray-100"
            >
              <X size={24} />
            </button>
            <AuditLogViewer
              config={props.config}
              users={props.users}
            />
          </div>
        );

      default:
        return (
          <div
            className="max-w-7xl mx-auto w-full p-4 md:p-8 pb-24 md:pb-16 animate-in fade-in"
            style={{ flex: '1 1 auto', minHeight: '100%' }}
          >
            {/* ADMIN MODE BANNER */}
            {props.isAdminMode && (
              <div className="mb-6 p-4 bg-red-100 border border-red-200 rounded-xl flex items-center gap-3 animate-pulse shadow-sm">
                <ShieldCheck size={24} className="text-red-600" />
                <div>
                  <h3 className="text-red-800 font-black text-lg">MODO ADMINISTRADOR ACTIVO</h3>
                  <p className="text-red-700 text-sm">Se han desbloqueado todas las opciones temporalmente.</p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-4 md:flex-row md:justify-between md:items-center mb-8">
              <div>
                <h1 className="text-3xl font-black text-gray-800">Configuración</h1>
                <p className="text-gray-500 mt-1">Administra todos los aspectos de tu negocio.</p>
              </div>
              <button onClick={props.onClose} className="self-end md:self-auto p-3 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">
                <X size={24} className="text-gray-600" />
              </button>
            </div>

            <div className="space-y-12">
              <section>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-2">Inventario y Catálogo</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <SettingsCard
                    icon={ChefHat}
                    label="Centros de Producción"
                    description="Ruteo: Cocina, Barra, Monitor"
                    color="bg-orange-600"
                    onClick={() => setCurrentView('PRODUCTION_AREAS')}
                    locked={!hasPermission('SETTINGS_ACCESS')}
                  />
                  <SettingsCard
                    icon={Package}
                    label="Artículos y Tarifas"
                    description="Catálogo, Precios, Variantes"
                    color="bg-blue-600"
                    onClick={() => setCurrentView('CATALOG')}
                    locked={!hasPermission('CATALOG_VIEW') && !hasPermission('CATALOG_MANAGE')}
                  />
                  <SettingsCard
                    icon={Building2}
                    label="Almacenes"
                    description="Ubicaciones, Traspasos, Stock"
                    color="bg-purple-600"
                    onClick={() => setCurrentView('WAREHOUSES')}
                    locked={!hasPermission('INVENTORY_VIEW') && !hasPermission('INVENTORY_TRANSFER')}
                  />
                  <SettingsCard
                    icon={Database}
                    label="Importar / Exportar"
                    description="Carga Masiva de Datos"
                    color="bg-cyan-600"
                    onClick={() => setCurrentView('IMPORT_EXPORT')}
                    locked={!hasPermission('CATALOG_MANAGE')}
                  />
                  <SettingsCard
                    icon={Truck}
                    label="Proveedores"
                    description="Compras y Abastecimiento"
                    color="bg-emerald-500"
                    onClick={props.onOpenSupplyChain}
                    locked={!hasPermission('SUPPLY_CHAIN_ORDER')}
                  />
                </div>
              </section>

              <section>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-2">Finanzas y Legal</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <SettingsCard icon={Building2} label="Empresa" description="RNC, Nombre y Contacto Legal" color="bg-blue-700" onClick={() => setCurrentView('COMPANY')} locked={!hasPermission('SETTINGS_ACCESS')} />
                  <SettingsCard icon={CreditCard} label="Métodos de Pago" description="Pasarelas, Tarjetas, QR" color="bg-indigo-500" onClick={() => setCurrentView('PAYMENTS')} locked={!hasPermission('SETTINGS_ACCESS')} />
                  <SettingsCard icon={PlugZap} label="Integraciones" description="AZUL, CardNet y adquirentes" color="bg-sky-600" onClick={() => setCurrentView('INTEGRATIONS')} locked={!hasPermission('SETTINGS_ACCESS')} />
                  <SettingsCard icon={ArrowRightLeft} label="Divisas y Cambio" description="Multi-moneda y Tasas" color="bg-teal-500" onClick={() => setCurrentView('EXCHANGE')} locked={!hasPermission('SETTINGS_ACCESS')} />
                  <SettingsCard icon={Percent} label="Impuestos" description="ITBIS, Exentos y Cargos" color="bg-emerald-500" onClick={() => setCurrentView('TAXES')} locked={!hasPermission('SETTINGS_TAXES')} />
                  <SettingsCard icon={Lock} label="Cierre de Caja" description="Corte Z y Auditoría Fiscal" color="bg-slate-900" onClick={props.onOpenZReport} locked={!hasPermission('POS_CLOSE_Z')} />
                  <SettingsCard icon={FileText} label="Documentos" description="Series, NCF, Prefijos" color="bg-blue-400" onClick={() => setCurrentView('DOCUMENTS')} locked={!hasPermission('SETTINGS_TAXES')} />
                </div>
              </section>

              <section>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-2">Configuración Local</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <SettingsCard icon={Monitor} label="Terminales POS" description="Perfiles de Caja, Inventario" color="bg-blue-500" onClick={() => setCurrentView('TERMINALS')} locked={!hasPermission('SETTINGS_HARDWARE')} />
                  <SettingsCard icon={Grid} label="Diseñador de Mesas" description="Plano, Salas y Distribución" color="bg-slate-700" onClick={props.onOpenTableDesigner} locked={!hasPermission('CATALOG_MANAGE')} />
                  <SettingsCard icon={Printer} label="Hardware" description="Impresoras, Balanzas, VFD" color="bg-gray-700" onClick={() => setCurrentView('HARDWARE')} locked={!hasPermission('SETTINGS_HARDWARE')} />
                  <SettingsCard icon={Tag} label="Diseño de Etiquetas" description="Plantillas Artículo y Góndola" color="bg-emerald-600" onClick={() => setCurrentView('LABELS')} locked={!hasPermission('SETTINGS_ACCESS')} />
                  <SettingsCard icon={Coins} label="Propinas" description="Cargos por Servicio y Tips" color="bg-yellow-500" onClick={() => setCurrentView('TIPS')} locked={!hasPermission('SETTINGS_ACCESS')} />
                </div>
              </section>

              <section>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-2">Equipo y Marketing</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <SettingsCard icon={Users} label="Equipo y Roles" description="Usuarios, Turnos, Permisos" color="bg-pink-500" onClick={() => setCurrentView('TEAM')} locked={!hasPermission('SETTINGS_USERS')} />
                  <SettingsCard icon={UserCircle} label="Clientes" description="Directorio, Histórico, Fiscal" color="bg-teal-600" onClick={() => setCurrentView('CUSTOMERS')} locked={!hasPermission('CUSTOMER_MANAGE')} />
                  <SettingsCard icon={Award} label="Programa de Lealtad" description="Puntos, Canjes y Reglas" color="bg-purple-500" onClick={() => setCurrentView('LOYALTY')} locked={!hasPermission('SETTINGS_ACCESS')} />
                  <SettingsCard icon={Percent} label="Promociones" description="Descuentos, 2x1 y Temporadas" color="bg-rose-500" onClick={() => setCurrentView('PROMOTIONS')} locked={!hasPermission('CATALOG_MANAGE')} />
                  <SettingsCard icon={Receipt} label="Diseño de Ticket" description="Logo, Cabecera y Pie" color="bg-rose-600" onClick={() => setCurrentView('RECEIPT')} locked={!hasPermission('SETTINGS_ACCESS')} />
                  <SettingsCard icon={Mail} label="E-mail" description="Factura Digital" color="bg-sky-500" onClick={() => setCurrentView('EMAIL')} locked={!hasPermission('SETTINGS_ACCESS')} />
                  <SettingsCard icon={Wallet} label="Wallet Keys" description="Apple & Google Pay" color="bg-slate-800" onClick={() => setCurrentView('WALLET_KEYS')} locked={!hasPermission('SETTINGS_ACCESS')} />
                  <SettingsCard
                    icon={Calendar}
                    label="Agenda & Reservas"
                    description="CRM, Citas y Salones"
                    color="bg-sky-600"
                    onClick={() => setCurrentView('AGENDA')}
                    locked={!hasPermission('CUSTOMER_MANAGE')}
                  />
                </div>
              </section>

              <section>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-2">Sistema y Auditoría</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <SettingsCard
                    icon={ListChecks}
                    label={isRepairingReceivables ? "Reparando CxC..." : "Recalcular Deudas CxC"}
                    description={isRepairingReceivables ? "Procesando facturas legacy..." : "Repara pendientes legacy y ajusta deuda por cliente"}
                    color="bg-amber-600"
                    onClick={handleRepairLegacyReceivables}
                    locked={!hasPermission('SETTINGS_ACCESS') || isRepairingReceivables}
                  />
                  <SettingsCard icon={RefreshCw} label="Sincronización" description="Estado de Red y Réplicas" color="bg-indigo-600" onClick={() => setCurrentView('SYNC')} locked={!hasPermission('SETTINGS_ACCESS')} />
                  <SettingsCard icon={ShieldAlert} label="Seguridad y Datos" description="Backups y Modo Kiosco" color="bg-red-600" onClick={() => setCurrentView('SECURITY')} locked={!hasPermission('SETTINGS_ACCESS')} />
                  <SettingsCard icon={History} label="Traza de Auditoría" description="Logs de Operaciones" color="bg-orange-500" onClick={() => setCurrentView('LOGS')} locked={!hasPermission('AUDIT_LOG_VIEW')} />
                  <SettingsCard icon={BarChart3} label="Informes y Analítica" description="BI, Snapshots y KPIs" color="bg-blue-700" onClick={() => setCurrentView('REPORTS')} locked={!hasPermission('REPORTS_VIEW_SALES')} />
                </div>
              </section>

            </div>
          </div>
        );
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 bg-gray-50 flex min-h-0 flex-col ${usesPageScroll ? '' : 'overflow-hidden'}`}
      style={usesPageScroll
        ? {
            overflowY: 'scroll',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-y'
          }
        : undefined}
    >
      <div
        className={usesPageScroll ? 'min-h-[100dvh] flex flex-1 flex-col' : 'flex min-h-0 flex-1 flex-col'}
        style={usesPageScroll ? { minHeight: '100dvh' } : undefined}
      >
        {renderContent()}
      </div>
    </div>
  );
};

const SettingsCard: React.FC<{ icon: any; label: string; description: string; color: string; onClick: () => void; locked?: boolean }> = ({ icon: Icon, label, description, color, onClick, locked }) => (
  <button
    onClick={locked ? undefined : onClick}
    className={`flex flex-col items-start p-6 bg-white rounded-3xl shadow-sm border border-slate-100 transition-all text-left group h-full relative overflow-hidden ${locked ? 'opacity-60 cursor-not-allowed grayscale' : 'hover:shadow-xl hover:border-blue-200 hover:-translate-y-1 active:scale-95'}`}
    style={{ touchAction: 'pan-y' }}
  >
    {locked && (
      <div className="absolute inset-0 bg-gray-50/50 z-10 flex items-center justify-center">
        <Lock size={32} className="text-gray-400" />
      </div>
    )}
    <div className={`p-4 rounded-2xl text-white mb-5 shadow-lg transition-transform group-hover:scale-110 ${color}`}>
      <Icon size={26} strokeWidth={2.5} />
    </div>
    <h3 className="font-bold text-lg text-slate-800 group-hover:text-blue-600 transition-colors leading-tight mb-1">{label}</h3>
    <p className="text-sm text-slate-400 leading-snug">{description}</p>
  </button>
);

export default Settings;
