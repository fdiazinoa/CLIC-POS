
import React, { useState, useEffect, useMemo } from 'react';
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
  LedgerConcept,
  DocumentSeries,
  Room,
  Table
} from './types';
import {
  DEFAULT_ROLES,
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
import { calculateZReportStats } from './utils/analytics';
import { applyPromotions, hasProductPromotion } from './utils/promotionEngine';
import { ZReportRecoveryService } from './services/recovery/ZReportRecoveryService';

// Component Imports
import LoginScreen from './components/LoginScreen';
import ErrorBoundary from './components/ErrorBoundary';
import POSInterface from './components/POSInterface';
import Settings from './components/Settings';
import CustomerManagement from './components/CustomerManagement';
import TicketHistory from './components/TicketHistory';
import FinanceDashboard from './components/FinanceDashboard';
import ZReportDashboard from './components/ZReportDashboard';
import SupplyChainManager from './components/SupplyChainManager';
import VerticalSelector from './components/VerticalSelector';
import SetupWizard from './components/SetupWizard';
import FranchiseDashboard from './components/FranchiseDashboard';
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
import KioskPayment from './components/kiosk/KioskPayment';
import PriceCheckerDisplay from './components/price-checker/PriceCheckerDisplay';
import InventoryHome from './components/inventory/InventoryHome';
import InventoryCount from './components/inventory/InventoryCount';
import InventoryTracking from './components/InventoryTracking';
import KitchenDisplay from './components/kds/KitchenDisplay';


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

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
};

const AppContent: React.FC = () => {
  // --- GLOBAL STATE ---
  const [activeTable, setActiveTable] = useState<Table | null>(null); // New state for selected table context
  const [currentView, setCurrentView] = useState<ViewState>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('view') === 'VISOR' ? 'VISOR' : 'LOGIN';
  });
  const [restoringHistory, setRestoringHistory] = useState(false);
  const [config, setConfig] = useState<BusinessConfig>(() => getInitialConfig('Supermercado' as any));
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // --- SECURITY & DEVICE HANDSHAKE ---
  const [deviceId, setDeviceId] = useState<string>('');
  const [isDataLoaded, setIsDataLoaded] = useState<boolean>(false);
  const [initialConnError, setInitialConnError] = useState<string | null>(null);
  const [failedMasterIp, setFailedMasterIp] = useState<string>('');

  // Helper: Get current terminal configuration
  const getCurrentTerminal = React.useCallback(() => {
    return (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
  }, [config.terminals, deviceId]);

  // Helper: Get current device role
  const getCurrentDeviceRole = React.useCallback((): DeviceRole => {
    const terminal = getCurrentTerminal();
    return terminal?.config?.deviceRole?.role || DeviceRole.STANDARD_POS;
  }, [getCurrentTerminal]);

  // --- DATA STORES ---
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>(DEFAULT_ROLES);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [parkedTickets, setParkedTickets] = useState<ParkedTicket[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [internalSequences, setInternalSequences] = useState<any[]>([]);
  const [receptions, setReceptions] = useState<Reception[]>([]);
  const [productStocks, setProductStocks] = useState<ProductStock[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string>('');
  const [activeRoomId2, setActiveRoomId2] = useState<string>(''); // For backward compatibility if needed
  const [supplierProductPrices, setSupplierProductPrices] = useState<any[]>([]);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [settingsInitialView, setSettingsInitialView] = useState<string | undefined>();
  const [settingsInitialData, setSettingsInitialData] = useState<any>();
  const [viewData, setViewData] = useState<any>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const fetchTables = async () => {
    try {
      const res = await fetch('/api/mesas');
      if (res.ok) {
        const data = await res.json();
        setTables(data);
      }
    } catch (e) {
      console.error("Failed to fetch tables:", e);
    }
  };

  useKioskMode(getCurrentDeviceRole() === DeviceRole.SELF_CHECKOUT);
  useBarcodeScanner({
    onScan: (barcode) => {
      window.dispatchEvent(new CustomEvent('barcodeScanned', { detail: { barcode } }));
    }
  });

  useEffect(() => {
    // Detect if we should start in Visor Mode (HDMI Display)
    const params = new URLSearchParams(window.location.search);
    const forcedView = params.get('view');
    if (forcedView === 'VISOR') {
      console.log("📺 VISOR MODE DETECTED: Initialization bypass.");
      setCurrentView('VISOR');
    }
  }, []);

  const handleViewChange = (view: ViewState, data?: any) => {
    console.log(`🚀 View Change: ${currentView} -> ${view}`, data);
    setViewData(data);
    setCurrentView(view);
  };

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
    const loadData = async () => {
      console.log('🚀 loadData started');
      try {
        console.log('⏳ Calling db.init()...');
        const data = await db.init();
        console.log('✅ db.init() returned:', data ? Object.keys(data) : 'null');

        let currentConfig = data.config;
        const masterIp = localStorage.getItem('pos_master_ip');

        if (masterIp) {
          console.log("🔄 Slave Mode: Fetching latest config from Master...");
          try {
            const currentProtocol = window.location.protocol;
            const targetUrl = `${currentProtocol}//${masterIp}:3001/api/config`;

            const res = await fetch(targetUrl);
            if (res.ok) {
              const fetchedConfig = await res.json();
              if (fetchedConfig && fetchedConfig.terminals) {
                console.log("✅ Config fetched from Master. Saving to local DB...");
                await db.save('config', fetchedConfig);
                currentConfig = fetchedConfig;
              }
            }
          } catch (e) {
            console.error("❌ Failed to fetch config from Master:", e);
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
          // 1. Cargar persistencia - PRIORITIZE currentConfig (which might be from Master)
          const finalConfig = (currentConfig && !Array.isArray(currentConfig) && Object.keys(currentConfig).length > 0) ? currentConfig : config;

          setConfig({
            ...config,
            ...finalConfig,
            campaigns: (data.campaigns && data.campaigns.length > 0) ? data.campaigns : (finalConfig.campaigns || config.campaigns || []),
            coupons: (data.coupons && data.coupons.length > 0) ? data.coupons : (finalConfig.coupons || config.coupons || [])
          });

          setUsers(data.users || []);
          setCustomers(data.customers || []);
          setTransactions(data.transactions || []);
          setProducts(data.products || []);
          setWarehouses(data.warehouses || []);
          setCashMovements(data.cashMovements || []);
          setPurchaseOrders(data.purchaseOrders || []);
          setSuppliers(data.suppliers || []);
          setParkedTickets(Array.isArray(data.parkedTickets) ? data.parkedTickets : []);
          setTransfers(data.transfers || []);
          setInternalSequences(data.internalSequences || []);
          setReceptions(data.receptions || []);
          setProductStocks(data.productStocks || []);
          setRooms(data.rooms || []);
          setTables(data.tables || []);
          if (data.rooms && data.rooms.length > 0) setActiveRoomId(data.rooms[0].id);
          setSupplierProductPrices(data.supplierProductPrices || []);

          // 1.5 Repair sequences
          try {
            const repairResult = await transactionService.repairSequences();
            if (repairResult.fixed.length > 0) {
              console.log("🔧 Sequences repaired on startup:", repairResult.details);
              // RELOAD sequences into state to reflect repairs
              const repairedSequences = await db.get('internalSequences');
              setInternalSequences(repairedSequences || []);
            }
          } catch (error) {
            console.error('Error repairing sequences:', error);
          }

          // 2. Gestión de Identidad de Dispositivo
          let storedDeviceId = localStorage.getItem('pos_device_id');
          if (!storedDeviceId) {
            storedDeviceId = 'DEV-' + Math.random().toString(36).substring(2, 10).toUpperCase();
            localStorage.setItem('pos_device_id', storedDeviceId);
          }
          setDeviceId(storedDeviceId);

          // 3. Verificación de Vinculación - USE finalConfig (Master prioritized)
          const terminals = finalConfig.terminals || [];
          const pairedTerminal = terminals.find(
            (t: any) => t.config?.currentDeviceId === storedDeviceId
          );

          // CRITICAL FIX: Check URL params directly here as well to avoid closure staleness
          const isVisorMode = new URLSearchParams(window.location.search).get('view') === 'VISOR';

          if (!pairedTerminal && !isVisorMode && currentView !== 'VISOR') {
            setCurrentView('DEVICE_UNAUTHORIZED');
          }

          // 4. Initialize Sync Manager
          if (pairedTerminal) {
            if (pairedTerminal.config.isPrimaryNode === false && pairedTerminal.config.governedByMaster) {
              console.log(`🛡️ Master Governance active for ${pairedTerminal.id}. Enforcing Master config.`);
              // We already have finalConfig from Master if IP was set, but we re-enforce the terminals part
            }

            await syncManager.initialize(finalConfig, pairedTerminal.id);

            if (pairedTerminal.config.isPrimaryNode === false) {
              syncManager.startAutoSync(30000);
              console.log('🔄 Auto-sync enabled for slave terminal');
            }

            permissionService.initialize(finalConfig, pairedTerminal.id);
            authLevelService.init(finalConfig, pairedTerminal.id);
            terminalRouter.init(finalConfig, pairedTerminal.id, pairedTerminal.config.deviceRole || null);

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
                const updatedTransactions = await db.get('transactions') as Transaction[];
                setTransactions(updatedTransactions);
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

            // RECOVERY: Check for lost Z-Reports (due to schema issues)
            // This will reconstruct them from transaction history
            await ZReportRecoveryService.recoverOrphanedReports();

            console.log('🎉 Setting isDataLoaded = true');
            setIsDataLoaded(true);
          } else {
            console.warn('⚠️ No paired terminal found. Waiting for pairing...');
            // Still load to allow access to pairing screen
            setIsDataLoaded(true);
          }
        } else {
          // First run or no data
          console.log('INFO: No data found, setting isDataLoaded = true for setup');
          setIsDataLoaded(true);
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

    if (config.vertical === 'RESTAURANT' || usesTables) {
      fetchTables();
      const interval = setInterval(fetchTables, 10000); // Poll every 10s
      return () => clearInterval(interval);
    }
  }, [config.vertical, config.terminals, deviceId]);

  useEffect(() => {
    // --- SYNC EVENT LISTENERS (For Slave Terminals) ---
    const handleSyncUpdate = async (event: Event) => {
      const collection = event.type.replace('Updated', '');
      console.log(`🔔 App: Sync update received for ${collection}. Refreshing state...`);

      const freshData = await db.get(collection as any);
      if (!freshData) return;

      switch (collection) {
        case 'products': setProducts(freshData as Product[]); break;
        case 'customers': setCustomers(freshData as Customer[]); break;
        case 'suppliers': setSuppliers(freshData as Supplier[]); break;
        case 'internalSequences': /* No state for this, used directly from DB */ break;
        case 'transactions': setTransactions(freshData as Transaction[]); break;
        case 'productStocks':
          setProductStocks(freshData as ProductStock[]);
          // CRITICAL: When detailed stocks change, we should also refresh products 
          // because they contain the aggregated stockBalances
          const freshProducts = await db.get('products') as Product[];
          setProducts(freshProducts);
          break;
      }
    };

    const syncEvents = ['productsUpdated', 'customersUpdated', 'suppliersUpdated', 'internalSequencesUpdated', 'transactionsUpdated', 'productStocksUpdated', 'tablesUpdated'];
    syncEvents.forEach(e => window.addEventListener(e, handleSyncUpdate));

    return () => {
      syncEvents.forEach(e => window.removeEventListener(e, handleSyncUpdate));
    };
  }, []);

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

  const handlePairTerminal = async (terminalId: string) => {
    const newTerminals = (config.terminals || []).map(t => {
      // Desvincular este dispositivo de cualquier otra terminal donde estuviera
      if (t.config.currentDeviceId === deviceId) {
        return { ...t, config: { ...t.config, currentDeviceId: undefined } };
      }
      // Vincular a la terminal seleccionada
      if (t.id === terminalId) {
        return {
          ...t,
          config: {
            ...t.config,
            currentDeviceId: deviceId,
            lastPairingDate: new Date().toISOString()
          }
        };
      }
      return t;
    });

    const updatedConfig = { ...config, terminals: newTerminals };
    setConfig(updatedConfig);
    await db.save('config', updatedConfig);

    // SYNC BINDING TO MASTER (If Slave)
    const masterIp = localStorage.getItem('pos_master_ip');
    if (masterIp) {
      console.log(`📤 Slave Binding: Pushing updated config to Master at ${masterIp}...`);
      try {
        const currentProtocol = window.location.protocol;
        const targetUrl = `${currentProtocol}//${masterIp}:3001/api/config`;

        await fetch(targetUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedConfig)
        });
        console.log("✅ Binding synced to Master.");
      } catch (e) {
        console.error("❌ Failed to sync binding to Master:", e);
        // Non-blocking error, we continue with local setup
      }
    }

    // If it's a slave terminal, restore history
    const isSlave = (newTerminals || []).find(t => t.id === terminalId)?.config?.isPrimaryNode === false;
    if (isSlave) {
      setRestoringHistory(true);
      try {
        // Re-initialize sync manager with new config
        await syncManager.initialize(updatedConfig, terminalId);
        await syncManager.restoreHistory(terminalId);

        // CRITICAL: Force full catalog sync to ensure sequences are loaded immediately
        // restoreHistory only pulls operational data (txns, z-reports), but we need sequences too.
        console.log('🔄 Forcing full catalog sync to restore sequences...');
        await syncManager.syncAllCatalogs();

        // Reload data from DB after restoration
        const freshData = await db.init();
        setTransactions(freshData.transactions);
        setProducts(freshData.products);
        setCashMovements(freshData.cashMovements);
      } catch (error) {
        console.error('Failed to restore history:', error);
        alert('No se pudo restaurar el historial desde la Maestra. El equipo funcionará, pero sin datos previos.');
      } finally {
        setRestoringHistory(false);
      }
    } else {
      // CRITICAL: Even if not a slave (Master mode), we MUST re-initialize services
      // with the new terminal ID and updated config, otherwise they stay uninitialized.
      console.log("🛠️ Re-initializing services for Master/Local terminal...");
      permissionService.initialize(updatedConfig, terminalId);
      await syncManager.initialize(updatedConfig, terminalId);
    }

    setCurrentView('LOGIN');
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

    // REAL SYNC: Push to json-server on the same host (via proxy to avoid Mixed Content)
    // We use the current protocol/port because the frontend proxies /api to the backend
    const currentProtocol = window.location.protocol;
    const serverUrl = `${currentProtocol}//${window.location.hostname}:3001/api/config`;

    console.log(`Attempting to sync to: ${serverUrl}`);

    try {
      const res = await fetch(serverUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });

      if (res.ok) {
        console.log("Sync success: Config pushed to server.");
      } else {
        const errorText = await res.text();
        console.error("Sync failed:", res.status, res.statusText, errorText);
        alert(`Error al sincronizar: El servidor respondió ${res.status}\nDetalle: ${errorText}`);
      }
    } catch (e) {
      console.warn("Could not sync config to local server", e);
      alert(`Error de conexión con ${serverUrl}. Asegúrate de que 'npm run server' esté corriendo.`);
    }
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

  const handleTransactionComplete = async (txn: Transaction) => {
    // Add sync status
    txn.syncStatus = 'PENDING';

    // Save transaction locally (Optimized: Append only)
    const newTransactions = [...transactions, txn];
    setTransactions(newTransactions);
    await db.saveDocument('transactions', txn);

    // Trigger background sync
    backgroundSyncManager.triggerSync().catch(console.error);

    // Update inventory locally (simple stock tracking) AND Record Ledger
    const defaultWarehouseId = config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId || 'wh_central';

    // Get current terminal ID
    const currentTerminal = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
    const terminalId = currentTerminal?.id || 'T1';

    txn.terminalId = terminalId;

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
      for (const entry of ledgerEntries) {
        await db.saveDocument('inventoryLedger', entry);
      }
    }

    // Refresh products to reflect changes made by recordInventoryMovement
    const refreshedDb = await db.init();
    setProducts(refreshedDb.products || []);

    // --- CRITICAL: Increment Document Series Sequence in Internal Sequences ---
    // This is the global source of truth for sequences, synced with Settings.
    const seriesId = txn.seriesId;
    if (seriesId && internalSequences) {
      const seriesIndex = internalSequences.findIndex(s => s.id === seriesId);

      if (seriesIndex !== undefined && seriesIndex >= 0) {
        // Create a deep copy
        const updatedSequences = [...internalSequences];

        // Increment
        updatedSequences[seriesIndex].nextNumber++;

        // Update State
        setInternalSequences(updatedSequences);

        // Persist local first
        await db.save('internalSequences', updatedSequences);

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

        console.log(`✅ Sequence ${seriesId} incremented to ${updatedSequences[seriesIndex].nextNumber}`);
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

  const handleSaveFloorPlan = async (newRooms: Room[], newTables: Table[]) => {
    console.log('💾 Saving Floor Plan:', { rooms: newRooms.length, tables: newTables.length });

    // 1. Save Rooms (Overwrite is fine for config)
    await db.save('rooms', newRooms);
    setRooms(newRooms);

    // 2. Save Tables (Merge operational state AND Delete removed tables)
    // First, fetch all existing tables from DB to identify deletions
    const existingDbTables = await db.get('tables') as Table[] || [];
    const newTableIds = new Set(newTables.map(t => t.id));

    // Identify tables to delete (present in DB but not in new layout)
    const tablesToDelete = existingDbTables.filter(t => !newTableIds.has(t.id));

    if (tablesToDelete.length > 0) {
      console.log(`🗑️ Pruning ${tablesToDelete.length} removed tables from DB...`);
      for (const t of tablesToDelete) {
        await db.deleteDocument('tables', t.id);
      }
    }

    // Save Tables (Merge operational state)
    const mergedTables = newTables.map(newT => {
      const existing = tables.find(t => t.id === newT.id);
      return {
        ...newT,
        // Operational fields usually not present in newT if it came from Designer state only,
        // but Designer state initialized from 'tables' prop which has them.
        // However, if 'setTables' updates local state in Designer and loses keys, we restore them here.
        status: existing?.status || newT.status || 'FREE',
        currentOrderId: existing?.currentOrderId || newT.currentOrderId,
        currentOrderTotal: existing?.currentOrderTotal || newT.currentOrderTotal,
        timeSeated: existing?.timeSeated || newT.timeSeated,
        waiterName: existing?.waiterName || newT.waiterName
      };
    });

    await db.save('tables', mergedTables);
    setTables(mergedTables);
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

    console.log(`📊 Z-Report: Starting closure for terminal ${terminalId} (Device: ${deviceId})`);


    // 2. Identify Transactions for closure
    // STRICT MODE: Only include transactions explicitly tagged with this terminalId.
    // Untagged transactions must be handled via Admin Recovery tools, not automatically included here.
    const terminalTransactions = transactions.filter(t => t.terminalId === terminalId);
    const terminalCashMovements = cashMovements.filter(m => m.terminalId === terminalId);

    console.log(`🔒 Shift Segregation: Found ${terminalTransactions.length} txns and ${terminalCashMovements.length} cash movements for ${terminalId}`);

    // 3. Totals and Stats (Prioritize Dashboard-confirmed values)
    const totalsByMethod = terminalTransactions.flatMap(t => t?.payments || []).reduce((acc: Record<string, number>, p) => {
      if (p && p.method) {
        acc[p.method] = (acc[p.method] || 0) + p.amount;
      }
      return acc;
    }, {});

    const totalSales = terminalTransactions.reduce((acc, t) => acc + t.total, 0);

    const cashSalesNet = terminalTransactions.reduce((acc, t) => {
      const cashPay = (t.payments || []).find(p => p.method === 'CASH');
      if (!cashPay) return acc;
      const otherPayments = (t.payments || []).filter(p => p.method !== 'CASH').reduce((sum, p) => sum + p.amount, 0);
      const cashNeeded = Math.max(0, t.total - otherPayments);
      return acc + cashNeeded;
    }, 0);

    const stats = calculateZReportStats(terminalTransactions);
    const transactionCount = terminalTransactions.length;

    // 4. Create and Save Z-Report
    const existingReports = await db.get('zReports') as ZReport[];
    const nextSeqNum = (existingReports.length + 1).toString().padStart(6, '0');
    const sequenceNumber = `Z-${nextSeqNum}`;

    const newZReport: ZReport = {
      id: `ZR-${Date.now()}`,
      terminalId,
      sequenceNumber,
      openedAt: terminalTransactions.length > 0 ? terminalTransactions[0].date : new Date().toISOString(),
      closedAt: new Date().toISOString(),
      closedByUserId: currentUser?.id || 'sys',
      closedByUserName: currentUser?.name || 'System',
      baseCurrency: config.currencySymbol,
      totalsByMethod,
      totalSales, // Explicitly use the transaction total sum
      cashSales: cashSalesNet, // Use the net cash sales
      cashIn: terminalCashMovements.filter(m => m.type === 'IN').reduce((acc, m) => acc + m.amount, 0),
      cashOut: terminalCashMovements.filter(m => m.type === 'OUT').reduce((acc, m) => acc + m.amount, 0),
      cashExpected: reportData?.expectedCashByCurrency || {}, // Keep this for multi-currency compatibility if needed
      cashCounted: reportData?.cashCountedByCurrency || {},
      cashDiscrepancy: reportData?.cashDiscrepancyByCurrency || {},
      transactionCount,
      notes,
      stats,
      syncStatus: 'PENDING' as const
    };

    console.log("💾 Saving Z-Report:", newZReport);
    await db.saveDocument('zReports', newZReport);
    await syncManager.pushZReport(newZReport);

    // 5. Build lookup set for IDs that were actually closed to prevent data loss
    const closedTxnIds = new Set(terminalTransactions.map(t => t.id));
    const closedMoveIds = new Set(terminalCashMovements.map(m => m.id));

    // 6. Archive locally
    console.log(`🗄️ Archiving ${terminalTransactions.length} transactions to history...`);
    for (const tx of terminalTransactions) {
      await db.saveDocument('transactionHistory', { ...tx, zReportId: newZReport.id });
      // NEW: Explicitly delete from active table to avoid orphans
      await db.deleteDocument('transactions', tx.id);
    }

    // 7. Update states by removing ONLY what was closed
    const remainingTransactions = transactions.filter(t => !closedTxnIds.has(t.id));
    const remainingCashMovements = cashMovements.filter(m => !closedMoveIds.has(m.id));

    setTransactions(remainingTransactions);
    setCashMovements(remainingCashMovements);

    // Note: We don't strictly need db.save('transactions', ...) anymore because we deleted them one by one, 
    // but we keep it for other non-terminal-specific items if they existed (unlikely here).
    // Actually, save() as "Replace" is now robust via NetworkAdapter fix.
    await db.save('transactions', remainingTransactions);
    await db.save('cashMovements', remainingCashMovements);

    // 8. Global Reset
    console.log(`⚙️ Sending Global Reset for Terminal ${terminalId} to Master...`);
    await syncManager.resetTerminalData(terminalId);

    setCurrentView('POS');
    backgroundSyncManager.triggerSync().catch(console.error);
  };

  // --- VIEW RENDERING LOGIC ---
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

  const renderView = () => {
    switch (currentView) {
      case 'DEVICE_UNAUTHORIZED':
        return (
          <TerminalBindingScreen
            config={config}
            deviceId={deviceId}
            adminUsers={users.filter(u => u.role?.toUpperCase() === 'ADMIN' || u.role?.toUpperCase() === 'ADMINISTRADOR')}
            onPair={handlePairTerminal}
            onConfigUpdate={handleConfigUpdate}
            onUsersUpdate={handleUsersUpdate}
            initialError={initialConnError}
            initialMasterIp={failedMasterIp}
          />
        );

      case 'LOGIN':
        return (
          <LoginScreen
            config={(config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.config || config.terminals?.[0]?.config as any}
            availableUsers={users}
            subVertical={config.subVertical}
            onLogin={(u) => {
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
            }}
          />
        );



      case 'TABLE_MAP':
        return (
          <div className="h-screen flex flex-col bg-slate-50">
            <div className="bg-white border-b p-4 flex justify-between items-center z-20 shrink-0 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-900 text-white rounded-lg shadow-lg">
                  <Layout size={20} />
                </div>
                <h2 className="font-black text-slate-800 tracking-tight uppercase text-sm">Mapa de Mesas</h2>
              </div>
              <button
                onClick={() => setCurrentView('POS')}
                className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold transition-all flex items-center gap-2 border border-slate-200"
              >
                Cerrar
              </button>
            </div>
            <div className="flex-1 overflow-hidden relative">
              <TableMap
                rooms={rooms}
                currentRoomId={activeRoomId}
                tables={tables}
                onTableClick={async (table) => {
                  console.log('Mesa seleccionada:', table.name);
                  setActiveTable(table);

                  // If table has an order, try to load it
                  if (table.currentOrderId) {
                    // The order might be in transactions or parkedTiles. 
                    // In restaurant mode, we usually keep them 'ABIERTA'.
                    const found = (transactions || []).find(t => t.id === table.currentOrderId);
                    if (found && found.items) {
                      setCart(found.items);
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
                isRestaurantMode={config.vertical === 'RESTAURANT' || config.vertical === 'RETAIL'}
              />
            </div>
          </div>
        );

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
                  const newRooms = rooms.map(r => r.id === updatedRoom.id ? updatedRoom : r);
                  setRooms(newRooms);
                  handleSaveFloorPlan(newRooms, tables);
                }}
              />

            </div>
          </div>
        );

      case 'POS':
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
            onUpdateCart={setCart}
            selectedCustomer={selectedCustomer}
            onSelectCustomer={setSelectedCustomer}
            parkedTickets={parkedTickets}
            onUpdateParkedTickets={async (pt) => {
              const validArray = Array.isArray(pt) ? pt : [];
              setParkedTickets(validArray);
              await db.save('parkedTickets', validArray);
            }}
            onLogout={() => { setCurrentUser(null); setCurrentView('LOGIN'); }}
            onOpenSettings={(view, data) => {
              setSettingsInitialView(view);
              setSettingsInitialData(data);
              setCurrentView('SETTINGS');
            }}
            onOpenCustomers={() => setCurrentView('CUSTOMERS')}
            onOpenHistory={() => setCurrentView('HISTORY')}
            onOpenFinance={() => handleViewChange('FINANCE')}
            onOpenInventoryTracking={(productId) => handleViewChange('TRACKING', { productId })}
            onOpenTableMap={() => handleViewChange('TABLE_MAP')}
            onTransactionComplete={handleTransactionComplete}
            activeTable={activeTable}
            onClearActiveTable={() => setActiveTable(null)}
            onAddCustomer={async (c) => {
              const updated = [...customers, c];
              setCustomers(updated);
              await db.save('customers', updated);
              syncManager.broadcastChange('customers', c, 'CREATE').catch(console.error);
            }}
            onUpdateConfig={handleConfigUpdate}
            onKioskPay={() => handleViewChange('KIOSK_PAYMENT' as any)}
            activeTerminalId={(config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.id || 'T1'}
          />
        );

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
            internalSequences={internalSequences}
            onUpdateTransfers={async (t) => { setTransfers(t); await db.save('transfers', t); }}
            onUpdateSequences={async (s) => { setInternalSequences(s); await db.save('internalSequences', s); }}
            onUpdateConfig={handleConfigUpdate}
            onUpdateUsers={async (u) => { setUsers(u); await db.save('users', u); }}
            onUpdateRoles={async (r) => { setRoles(r); await db.save('roles', r); }}
            onUpdateProducts={async (p) => { setProducts(p); await db.save('products', p); }}
            onUpdateWarehouses={async (w) => { setWarehouses(w); await db.save('warehouses', w); }}
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
            onDeleteCustomer={async (id) => {
              const updated = customers.filter(cust => cust.id !== id);
              setCustomers(updated);
              await db.save('customers', updated);
              syncManager.broadcastChange('customers', { id }, 'DELETE').catch(console.error);
            }}
            onSelect={(c) => { setSelectedCustomer(c); setCurrentView('POS'); }}
            onClose={() => setCurrentView('POS')}
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
            onUpdateConfig={handleConfigUpdate}
            onClose={() => setCurrentView('POS')}
            onRefundTransaction={async (tx, items, reason) => {
              // 1. Calculate totals for the refund
              const itemsToRefund = items && items.length > 0 ? items : tx.items;
              const refundSubtotalRaw = itemsToRefund.reduce((acc, item) => acc + (item.price * item.quantity), 0);

              // Respect the original tax inclusion setting
              const refundTotal = tx.isTaxIncluded
                ? refundSubtotalRaw
                : refundSubtotalRaw * (1 + (config.taxRate || 0));

              // Check if it's a full refund
              const isFullRefund = itemsToRefund.length === tx.items.length;
              const newStatus = isFullRefund ? 'REFUNDED' : 'PARTIAL_REFUND';

              // ... (sequences logic remains same) ...
              const sequences = await db.get('internalSequences') as DocumentSeries[];
              const refundSeries = sequences.find(s => s.id === 'REFUND');
              let displayId = '';
              if (refundSeries) {
                displayId = `${refundSeries.prefix}${refundSeries.nextNumber.toString().padStart(refundSeries.padding, '0')}`;
                refundSeries.nextNumber++;
                await db.save('internalSequences', sequences);
              }

              // 3. Generate Fiscal Sequence (B04)
              const currentTerminalId = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.id || 'T1';
              const ncf = await db.getNextNCF('B04', currentTerminalId);

              // 4. Create the Credit Note Transaction
              const creditNote: Transaction = {
                id: crypto.randomUUID(),
                displayId: displayId,
                documentType: 'REFUND',
                date: new Date().toISOString(),
                items: itemsToRefund.map(it => ({ ...it, quantity: it.quantity })),
                total: refundTotal,
                payments: [{ method: 'STORE_CREDIT', amount: refundTotal, date: new Date().toISOString() }],
                userId: currentUser?.id || 'system',
                userName: currentUser?.name || 'System',
                terminalId: currentTerminalId,
                status: 'COMPLETED',
                customerId: tx.customerId,
                customerName: tx.customerName || 'Cliente Mostrador',
                ncf: ncf || undefined,
                ncfType: 'B04',
                affectedNCF: tx.ncf || undefined, // NCF de la factura afectada
                affectedInvoiceNumber: tx.displayId || tx.id, // No. de factura afectada
                originalTransactionId: tx.id,
                refundReason: reason,
                isTaxIncluded: tx.isTaxIncluded,
                syncStatus: 'PENDING'
              };

              // 5. Update the Parent Transaction status and link the Credit Note
              const updatedTxns = transactions.map(t => {
                if (t.id === tx.id) {
                  const related = t.relatedTransactions || [];
                  return {
                    ...t,
                    status: newStatus as any,
                    relatedTransactions: Array.from(new Set([...related, creditNote.id])),
                    syncStatus: 'PENDING' as const
                  };
                }
                return t;
              });

              // 6. Save both the updated parent and the new credit note
              const finalizedTransactions = [...updatedTxns, creditNote];
              setTransactions(finalizedTransactions);
              await db.save('transactions', finalizedTransactions);

              // 7. Trigger background sync
              backgroundSyncManager.triggerSync().catch(console.error);

              // 8. Record Inventory Movement (Return = Entry)
              const defaultWarehouseId = config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId || 'wh_central';

              for (const item of itemsToRefund) {
                await db.recordInventoryMovement(
                  defaultWarehouseId,
                  item.id,
                  'DEVOLUCION',
                  displayId || tx.displayId || tx.id,
                  item.quantity, // Positive for returns (Entry)
                  item.price,
                  currentTerminalId
                );
              }

              // Refresh products to show updated stock
              const refreshedDb = await db.init();
              setProducts(refreshedDb.products || []);

              setCurrentView('POS');
            }}
          />
        );

      case 'FINANCE':
        {
          // Filter for current terminal ONLY (Fix for X-Report showing other terminals' data)
          const currentTerminalId = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.id || 'T1';
          const terminalTransactions = transactions.filter(t => t.terminalId === currentTerminalId && !t.zReportId);
          const terminalMovements = cashMovements.filter(m => m.terminalId === currentTerminalId);

          return (
            <FinanceDashboard
              transactions={terminalTransactions}
              cashMovements={terminalMovements}
              config={config}
              currentUser={currentUser}
              roles={roles}
              onRegisterMovement={handleRegisterMovement}
              onOpenZReport={() => setCurrentView('Z_REPORT')}
              onClose={() => setCurrentView('POS')}
            />
          );
        }

      case 'Z_REPORT':
        return (
          <ZReportDashboard
            transactions={transactions}
            cashMovements={cashMovements}
            config={config}
            userName={currentUser?.name || ''}
            currentUser={currentUser}
            roles={roles}
            onConfirmClose={handleZReport}
            terminalId={getCurrentTerminal()?.id}
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
              const newReception: Reception = {
                id: `REC-${Date.now()}`,
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
            onStartShopping={() => handleViewChange('KIOSK_BROWSER')}
            storeName={config.companyInfo?.name}
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
              setCart([]);
              handleViewChange('KIOSK_WELCOME');
            }}
            config={config}
            terminalId={getCurrentTerminal()?.id || 'T1'}
          />
        );

      case 'KIOSK_PAYMENT':
        return (
          <KioskPayment
            cart={cart}
            onBack={() => handleViewChange('KIOSK_BROWSER')}
            onPaymentComplete={async (method) => {
              console.log(`Payment completed with ${method}`);

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

              // Get assigned sequence
              const seriesId = activeConfig.documentAssignments?.['TICKET'];
              if (!seriesId) {
                alert("Error: No hay secuencia de TICKET asignada a esta terminal.");
                return;
              }

              try {
                // Create Transaction
                const txn = await transactionService.createTransaction({
                  documentType: 'TICKET',
                  seriesId: seriesId,
                  date: new Date().toISOString(),
                  items: cart,
                  total: total,
                  payments: [{
                    method: method,
                    amount: total,
                    currency: config.currencySymbol
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

                // Clear cart and return
                setCart([]);
                handleViewChange('KIOSK_WELCOME');
              } catch (error) {
                console.error("Error creating kiosk transaction:", error);
                alert("Error al guardar la transacción. Por favor intente de nuevo.");
              }
            }}
            onCancel={() => {
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
            onSave={(counts) => {
              const now = new Date().toISOString();
              const sessionId = `COUNT-${Date.now()}`;
              const session = {
                id: sessionId,
                warehouseId: viewData?.warehouseId || '',
                warehouseName: viewData?.warehouseName,
                createdAt: now,
                createdBy: currentUser?.id,
                createdByName: currentUser?.name,
                items: counts.map((c: any) => ({
                  productId: c.productId,
                  productName: c.productName,
                  category: (products.find(p => p.id === c.productId)?.category) || undefined,
                  systemQty: c.expectedQty,
                  countedQty: c.countedQty,
                  difference: c.difference
                }))
              };
              db.saveDocument('inventoryCounts' as any, session).then(() => {
                alert(`Conteo guardado: ${counts.length} productos`);
                handleViewChange('INVENTORY_HOME');
              }).catch((err) => {
                console.error('Error saving inventory count session:', err);
                alert('Error guardando el conteo.');
              });
            }}
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

  return (
    <ErrorBoundary componentName="App Root">
      <div className="fixed inset-0 w-full h-full overflow-hidden bg-gray-50 flex flex-col font-sans select-none text-gray-900">
        {renderWithLayout()}
      </div>
    </ErrorBoundary>
  );
};

export default App;
