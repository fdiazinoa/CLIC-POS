
import React, { useState, useEffect, useMemo } from 'react';
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
  LedgerConcept
} from './types';
import {
  DEFAULT_ROLES,
  FOOD_PRODUCTS,
  RETAIL_PRODUCTS,
  getInitialConfig
} from './constants';
import { db } from './utils/db'; // Import Local DB
import { dbAdapter } from './services/db'; // Import Adapter for Healthcheck
import { syncManager } from './services/sync/SyncManager';
import { backgroundSyncManager } from './services/sync/BackgroundSyncManager';
import { calculateZReportStats } from './utils/analytics';
import { applyPromotions, hasProductPromotion } from './utils/promotionEngine';

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

// Layout imports
import StandardPOSLayout from './components/layouts/StandardPOSLayout';
import SelfCheckoutLayout from './components/layouts/SelfCheckoutLayout';
import PriceCheckerLayout from './components/layouts/PriceCheckerLayout';
import HandheldLayout from './components/layouts/HandheldLayout';
import KitchenDisplayLayout from './components/layouts/KitchenDisplayLayout';

// View imports for device roles
import KioskWelcome from './components/kiosk/KioskWelcome';
import KioskProductBrowser from './components/kiosk/KioskProductBrowser';
import KioskPayment from './components/kiosk/KioskPayment';
import PriceCheckerDisplay from './components/price-checker/PriceCheckerDisplay';
import InventoryHome from './components/inventory/InventoryHome';
import InventoryCount from './components/inventory/InventoryCount';


import { networkSyncService } from './services/sync/NetworkSyncService';
import { seriesSyncService } from './services/sync/SeriesSyncService';
import { permissionService } from './services/sync/PermissionService';
import { terminalRouter } from './services/routing/TerminalRouter';
import { authLevelService } from './services/auth/AuthLevelService';
import { transactionService } from './services/transactionService';
import { transactionSyncService } from './services/sync/TransactionSyncService';
import { inventorySyncService } from './services/sync/InventorySyncService';

const App: React.FC = () => {
  // --- GLOBAL STATE ---
  const [currentView, setCurrentView] = useState<ViewState>('LOGIN');
  const [restoringHistory, setRestoringHistory] = useState(false);
  const [config, setConfig] = useState<BusinessConfig>(() => getInitialConfig('Supermercado' as any));
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  // --- SECURITY & DEVICE HANDSHAKE ---
  const [deviceId, setDeviceId] = useState<string>('');
  const [isDataLoaded, setIsDataLoaded] = useState<boolean>(false);

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
  const [receptions, setReceptions] = useState<Reception[]>([]);
  const [productStocks, setProductStocks] = useState<ProductStock[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isAdminMode, setIsAdminMode] = useState(false); // Temporary admin elevation

  // --- NAVIGATION GUARD ---
  /**
   * Guarded view change handler that uses terminal router to validate navigation
   */
  const handleViewChange = (targetView: ViewState) => {
    // If terminal router is not initialized, allow navigation (backward compatibility)
    if (!terminalRouter.isInitialized()) {
      setCurrentView(targetView);
      return;
    }

    // Check if navigation is allowed
    const decision = terminalRouter.beforeNavigate(targetView, currentView);

    if (decision.allowed) {
      setCurrentView(targetView);
    } else {
      // Navigation blocked
      console.warn(`🚫 Navigation blocked: ${currentView} → ${targetView}`, decision.message);

      if (decision.message) {
        alert(decision.message);
      }

      // If there's a redirect suggestion, apply it
      if (decision.redirect) {
        setCurrentView(decision.redirect as ViewState);
      }
    }
  };

  // Update currentUser in terminal router when it changes
  useEffect(() => {
    if (terminalRouter.isInitialized()) {
      terminalRouter.setCurrentUser(currentUser);
    }
  }, [currentUser]);

  // --- INITIAL DATA LOAD & DEVICE CHECK ---
  useEffect(() => {
    const loadData = async () => {
      try {
        // Initialize network sync service early
        networkSyncService.init();

        // 0. VALIDACIÓN INICIAL DE RED (Slave Mode)
        // Check if we are configured as Slave but missing IP
        const isSlaveConfig = localStorage.getItem('pos_master_ip'); // Presence implies slave intent
        if (!isSlaveConfig && !localStorage.getItem('pos_device_id')) {
          // First run, or reset.
          // If we are not Master (no local DB seeded yet), we might need config.
          // But let's assume if no IP, we might be Master OR unconfigured Slave.
          // The user said: "Si no la tiene, debe mostrar un modal".
          // We can force a check here.
        }

        if (isSlaveConfig) {
          console.log("🔍 Verifying Master Connection...");
          const isHealthy = await (dbAdapter as any).checkHealth(); // Cast because interface might not have it yet

          if (!isHealthy) {
            console.error("❌ Master Unreachable. Aborting startup to prevent 404 floods.");
            alert("⚠️ No se puede conectar con la Caja Maestra. Verifique la red o la IP.");
            setCurrentView('DEVICE_UNAUTHORIZED'); // Redirect to config
            return;
          }

          // RECOVERY: If we have Master IP but no local config (e.g. after DB nuke), fetch it!
          const localConfig = await db.get('config');
          const hasTerminals = localConfig && localConfig.terminals && localConfig.terminals.length > 0;

          if (!hasTerminals) {
            console.log("⚠️ Slave Config Recovery: Fetching config from Master...");
            try {
              const protocol = window.location.protocol;
              const port = window.location.port || (protocol === 'https:' ? '443' : '80');
              const targetUrl = `${protocol}//${isSlaveConfig}:${port}/api/config`;

              const res = await fetch(targetUrl);
              if (res.ok) {
                const fetchedConfig = await res.json();
                if (fetchedConfig && fetchedConfig.terminals) {
                  console.log("✅ Config recovered from Master. Saving to local DB...");
                  await db.save('config', fetchedConfig);
                  setConfig(fetchedConfig); // Update state immediately
                }
              }
            } catch (e) {
              console.error("❌ Failed to recover config from Master:", e);
            }
          }

          // CLEAN SYNC CACHE if recovering from error
          const lastStatus = localStorage.getItem('pos_sync_status');
          if (lastStatus === 'ERROR') {
            console.warn("⚠️ Detectado reinicio tras error. Forzando Snapshot fresco.");
            localStorage.removeItem('pos_sync_status');
            // Force full pull logic is handled by NetworkSyncService if we clear metadata
            // But we can also do it here manually if needed.
            // NetworkSyncService hard-reset logic (IP change) covers one case.
            // This covers the "Same IP but previous crash" case.
            await dbAdapter.saveCollection('syncMetadata', {} as any);
          }
        }

        // EMERGENCY CLEANUP: Detect if we switched from localhost to IP (or vice versa)
        const currentOrigin = window.location.origin;
        const lastOrigin = localStorage.getItem('pos_last_origin');

        if (lastOrigin && lastOrigin !== currentOrigin) {
          console.warn(`🚨 Origin changed (${lastOrigin} -> ${currentOrigin}). NUKING LOCAL DB.`);
          localStorage.setItem('pos_last_origin', currentOrigin);

          // Delete IndexedDB and Reload
          const DB_NAME = 'clic_pos_db_v1'; // From utils/db.ts
          // Also delete any other potential DBs if known, or just the main one

          // We need to close connections first? dbAdapter might be open.
          // But we are at the start of loadData, db.init() is called next.
          // Let's try to delete before db.init()

          try {
            // Clear localStorage keys related to sync state
            localStorage.removeItem('sync_tokens');
            localStorage.removeItem('connected_terminals');
            // Keep pos_master_ip and pos_device_id

            const req = indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = () => {
              console.log("💥 Database deleted successfully.");
              window.location.reload();
            };
            req.onerror = () => {
              console.error("❌ Failed to delete database.");
              // Proceed anyway?
            };
            req.onblocked = () => {
              console.warn("⚠️ Database delete blocked. Reloading to force close.");
              window.location.reload();
            };
            return; // Stop execution to wait for reload
          } catch (e) {
            console.error("Error clearing DB:", e);
          }
        } else {
          localStorage.setItem('pos_last_origin', currentOrigin);
        }

        const data = await db.init();
        if (data) {
          // 1. Cargar persistencia
          const loadedConfig = (data.config && !Array.isArray(data.config) && Object.keys(data.config).length > 0) ? data.config : config;
          setConfig({
            ...config, // Start with initial config
            ...loadedConfig, // Overwrite with loaded config
            campaigns: (data.campaigns && data.campaigns.length > 0) ? data.campaigns : (loadedConfig.campaigns || config.campaigns || []),
            coupons: (data.coupons && data.coupons.length > 0) ? data.coupons : (loadedConfig.coupons || config.coupons || [])
          });
          setUsers(data.users || []);
          setCustomers(data.customers || []);
          setTransactions(data.transactions || []);
          setProducts(data.products || []);
          setWarehouses(data.warehouses || []);
          setCashMovements(data.cashMovements || []);
          setPurchaseOrders(data.purchaseOrders || []);
          setSuppliers(data.suppliers || []);
          setParkedTickets(data.parkedTickets || []);
          setTransfers(data.transfers || []);
          setReceptions(data.receptions || []);
          setProductStocks(data.productStocks || []);

          // 1.5 Repair sequences (ensure counters are correct)
          try {
            await transactionService.repairSequences();
          } catch (error) {
            console.error('Error repairing sequences:', error);
          }

          // 2. Gestión de Identidad de Dispositivo (Persistente)
          let storedDeviceId = localStorage.getItem('pos_device_id');
          if (!storedDeviceId) {
            storedDeviceId = 'DEV-' + Math.random().toString(36).substring(2, 10).toUpperCase();
            localStorage.setItem('pos_device_id', storedDeviceId);
          }
          setDeviceId(storedDeviceId);

          // 3. Verificación de Vinculación
          const terminals = loadedConfig.terminals || [];
          const isDevicePaired = terminals.some(
            (t: any) => t.config?.currentDeviceId === storedDeviceId
          );

          if (!isDevicePaired) {
            setCurrentView('DEVICE_UNAUTHORIZED');
          }

          // 4. Initialize Sync Manager
          const pairedTerminal = terminals.find(
            (t: any) => t.config?.currentDeviceId === storedDeviceId
          );
          if (pairedTerminal) {
            // MASTER GOVERNANCE: If this is a slave and is governed by master, 
            // ensure we use the config defined in the global terminals array
            if (pairedTerminal.config.isPrimaryNode === false && pairedTerminal.config.governedByMaster) {
              console.log(`🛡️ Master Governance active for ${pairedTerminal.id}. Enforcing Master config.`);
              // Update local config state with the one from the global terminals array
              // This ensures that assignments and other settings match the Master's intent
              setConfig(prev => ({
                ...prev,
                terminals: data.config.terminals
              }));
            }

            await syncManager.initialize(data.config, pairedTerminal.id);
            networkSyncService.setTerminalId(pairedTerminal.id);

            // Start auto-sync for slave terminals (every 30 seconds)
            if (pairedTerminal.config.isPrimaryNode === false) {
              syncManager.startAutoSync(30000);
              console.log('🔄 Auto-sync enabled for slave terminal');
            }

            // 5. Initialize Terminal Router and Auth Level Service
            permissionService.initialize(data.config, pairedTerminal.id);
            authLevelService.init(data.config, pairedTerminal.id);
            terminalRouter.init(data.config, pairedTerminal.id, pairedTerminal.config.deviceRole || null);

            console.log(`🎯 Terminal Role: ${authLevelService.getRoleLabel()}`);
            console.log(`🔐 Auth Level: ${authLevelService.shouldRequireUserLogin() ? 'User Required' : 'Headless'}`);

            // 6. Auto-authenticate headless terminals
            if (!authLevelService.shouldRequireUserLogin()) {
              const authResult = await authLevelService.authenticateHeadless();
              if (authResult.success) {
                // Redirect to default route for this role
                const defaultRoute = authLevelService.getDefaultRoute();
                console.log(`✅ Headless auth successful, routing to: ${defaultRoute}`);

                // Map route to ViewState (temporary until we fully migrate to React Router)
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

            // 7. Start polling for pending items if Master
            if (permissionService.isMasterTerminal()) {
              console.log('📡 Master Terminal: Starting polling for pending items...');
              transactionSyncService.startTransactionPolling(15000, async (txns) => {
                if (txns.length === 0) return;
                console.log(`📡 Processing ${txns.length} pulled transactions...`);

                for (const txn of txns) {
                  await transactionSyncService.processReceivedTransaction(txn, async (t) => {
                    await db.saveDocument('transactions', t);
                  });
                }

                // Refresh state once
                const updatedTransactions = await db.get('transactions') as Transaction[];
                setTransactions(updatedTransactions);

                window.dispatchEvent(new CustomEvent('transactionSynced', {
                  detail: { transactions: txns }
                }));
              });

              inventorySyncService.startInventoryPolling(15000, async (movements) => {
                if (movements.length === 0) return;

                console.log(`📥 Processing ${movements.length} pulled inventory movements...`);

                const affectedProducts = new Set<string>();
                const affectedWarehouses = new Set<string>();

                for (const move of movements) {
                  await db.saveDocument('inventoryLedger', move);
                  affectedProducts.add(move.productId);
                  affectedWarehouses.add(move.warehouseId);
                }

                // Recalculate stock for all affected combinations
                for (const productId of affectedProducts) {
                  for (const warehouseId of affectedWarehouses) {
                    await db.recalculateProductStock(productId, warehouseId);
                  }
                }

                // Refresh products in state once
                const updatedProducts = await db.get('products') as Product[];
                setProducts(updatedProducts);

                // Refresh transactions in state (in case any were pulled)
                const updatedTransactions = await db.get('transactions') as Transaction[];
                setTransactions(updatedTransactions);

                // Dispatch event for UI refresh (e.g. Kardex in ProductForm)
                window.dispatchEvent(new CustomEvent('ledgerSynced', {
                  detail: { movements }
                }));

                console.log('✅ Batch processing complete.');
              });
            }
          }

          setIsDataLoaded(true);
        }
      } catch (error) {
        console.error('CRITICAL: Failed to load initial data:', error);
        setIsDataLoaded(true); // Still set to true to allow app to render with initial state
      }
    };
    loadData();

    // Start Sync Worker
    backgroundSyncManager.initialize().catch(console.error);

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

    const syncEvents = ['productsUpdated', 'customersUpdated', 'suppliersUpdated', 'internalSequencesUpdated', 'transactionsUpdated', 'productStocksUpdated'];
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
        const protocol = window.location.protocol;
        const port = window.location.port || (protocol === 'https:' ? '443' : '80');
        // We hit the Master's API directly. 
        // NOTE: If Master is on a different IP, we must use that IP, not localhost.
        // The 'masterIp' variable holds the IP.
        // We assume Master API is on port 3001 (backend) or proxied via 3000 (frontend).
        // Let's try the frontend proxy port first (usually same as current if we are on same network/setup)
        // OR better: Use the IP we have.

        // If we are a slave, 'masterIp' is the IP of the Master.
        // We should try to hit the Master's API.
        // If Master is serving frontend on 3000 and backend on 3001:
        // We can try 3000/api/config (proxied) or 3001/api/config (direct).
        // Direct 3001 might have CORS issues if not configured, but server/index.ts has CORS enabled.

        const targetUrl = `http://${masterIp}:3001/api/config`; // Direct to backend

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
    }

    setCurrentView('LOGIN');
  };

  const handleConfigUpdate = async (newConfig: BusinessConfig) => {
    console.log("handleConfigUpdate called", newConfig); // Debug log
    setConfig(newConfig);
    await db.save('config', newConfig);

    // Re-initialize services with new config
    const currentTerminal = (newConfig.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
    if (currentTerminal) {
      permissionService.initialize(newConfig, currentTerminal.id);
      authLevelService.init(newConfig, currentTerminal.id);
      terminalRouter.init(newConfig, currentTerminal.id, currentTerminal.config.deviceRole || null);
    }

    // REAL SYNC: Push to json-server on the same host (via proxy to avoid Mixed Content)
    // We use the current protocol/port because the frontend proxies /api to the backend
    const protocol = window.location.protocol;
    const port = window.location.port || (protocol === 'https:' ? '443' : '80');
    const serverUrl = `${protocol}//${window.location.hostname}:${port}/api/config`;

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
    const currentTerminalId = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.id || 'T1';

    for (const item of txn.items) {
      const entry = await db.recordInventoryMovement(
        defaultWarehouseId,
        item.id, // CartItem extends Product, so item.id is the productId
        'VENTA',
        txn.displayId || txn.id,
        -item.quantity, // Negative for sales
        item.price, // Use price as cost proxy if cost not available, or fetch product cost
        txn.terminalId || currentTerminalId
      );

      if (entry) {
        // No need to push individually anymore, BackgroundSyncManager handles it
        // await syncManager.pushInventoryMovement(entry);
      }
    }

    // Refresh products to reflect changes made by recordInventoryMovement
    const refreshedDb = await db.init();
    setProducts(refreshedDb.products || []);
  };

  const handleRegisterMovement = async (type: 'IN' | 'OUT', amount: number, reason: string) => {
    const move: CashMovement = {
      id: `CM-${Date.now()}`,
      type, amount, reason,
      timestamp: new Date().toISOString(),
      userId: currentUser?.id || 'sys',
      userName: currentUser?.name || 'System',
      syncStatus: 'PENDING' as const
    };
    const updated = [...cashMovements, move];
    setCashMovements(updated);
    await db.saveDocument('cashMovements', move);

    // Trigger background sync
    backgroundSyncManager.triggerSync().catch(console.error);
  };

  const handleZReport = async (cashCounted: number, notes: string, reportData?: any) => {
    // 1. Calculate Totals by Method
    const totalsByMethod = transactions.flatMap(t => t?.payments || []).reduce((acc: Record<string, number>, p) => {
      if (p && p.method) {
        acc[p.method] = (acc[p.method] || 0) + p.amount;
      }
      return acc;
    }, {});

    // 2. Get Next Sequence Number
    const existingReports = await db.get('zReports') as ZReport[];
    const nextSeqNum = (existingReports.length + 1).toString().padStart(6, '0');
    const sequenceNumber = `Z-${nextSeqNum}`;

    // 3. Create ZReport Object
    const newZReport: ZReport = {
      id: `ZR-${Date.now()}`,
      terminalId: (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.id || (config.terminals || [])[0]?.id || 'TERM-01',
      sequenceNumber,
      openedAt: transactions.length > 0 ? transactions[0].date : new Date().toISOString(), // Approximation
      closedAt: new Date().toISOString(),
      closedByUserId: currentUser?.id || 'sys',
      closedByUserName: currentUser?.name || 'System',

      baseCurrency: config.currencySymbol,
      totalsByMethod,

      // Data from Dashboard (Multi-currency)
      cashExpected: reportData?.expectedCashByCurrency || {},
      cashCounted: reportData?.cashCountedByCurrency || {},
      cashDiscrepancy: reportData?.cashDiscrepancyByCurrency || {},

      cashSales: reportData?.cashSalesTotal || 0,
      cashIn: reportData?.cashIn || 0,
      cashOut: reportData?.cashOut || 0,

      transactionCount: transactions.length,
      notes,

      // Analytics
      stats: calculateZReportStats(transactions),
      syncStatus: 'PENDING' as const
    };

    console.log("💾 Saving Z-Report:", newZReport);

    // 4. Save to DB (Optimized: Append only)
    await db.saveDocument('zReports', newZReport);

    // 5. Sync to Master/Server immediately
    await syncManager.pushZReport(newZReport);

    // 6. Archive Transactions locally (Move to History)
    const closedTransactions = transactions.map(t => ({ ...t, zReportId: newZReport.id }));
    // We use saveDocument for each to append to history efficiently
    // But wait, saveDocument appends to the collection.
    // We need to iterate.
    // Or better: Use saveCollection for history if it's not too big? No, saveDocument is safer.
    // Actually, let's just use a loop for now, or maybe we can optimize later.
    // Given the previous fix, we should use saveDocument to avoid overwriting if history is huge.
    // But iterating 1000 txns might be slow.
    // However, for a single Z-Report, it's acceptable.

    // OPTIMIZATION: We can use the new server-side append if available, but for now client-side loop.
    // Actually, let's just push them to the server history if needed?
    // The user wants LOCAL history visibility.
    // So we save to 'transactionHistory'.

    console.log(`🗄️ Archiving ${closedTransactions.length} transactions to history...`);
    for (const tx of closedTransactions) {
      await db.saveDocument('transactionHistory', tx);
    }

    // 7. Reset Current Period Data
    setTransactions([]);
    setCashMovements([]);
    await db.save('transactions', []);
    await db.save('cashMovements', []);
    setCurrentView('POS');

    // Trigger background sync
    backgroundSyncManager.triggerSync().catch(console.error);


  };

  // --- VIEW RENDERING LOGIC ---
  if (!isDataLoaded || restoringHistory) {
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
            adminUsers={users.filter(u => u.role === 'ADMIN')}
            onPair={handlePairTerminal}
            onConfigUpdate={handleConfigUpdate}
          />
        );

      case 'LOGIN':
        return <LoginScreen availableUsers={users} subVertical={config.subVertical} onLogin={(u) => { setCurrentUser(u); setCurrentView('POS'); }} />;

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
            onUpdateParkedTickets={async (pt) => { setParkedTickets(pt); await db.save('parkedTickets', pt); }}
            onLogout={() => { setCurrentUser(null); setCurrentView('LOGIN'); }}
            onOpenSettings={() => setCurrentView('SETTINGS')}
            onOpenCustomers={() => setCurrentView('CUSTOMERS')}
            onOpenHistory={() => setCurrentView('HISTORY')}
            onOpenFinance={() => setCurrentView('FINANCE')}
            onTransactionComplete={handleTransactionComplete}
            onAddCustomer={async (c) => {
              const updated = [...customers, c];
              setCustomers(updated);
              await db.save('customers', updated);
              syncManager.broadcastChange('customers', c, 'CREATE').catch(console.error);
            }}
            onUpdateConfig={handleConfigUpdate}
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
            onUpdateTransfers={async (t) => { setTransfers(t); await db.save('transfers', t); }}
            onUpdateConfig={handleConfigUpdate}
            onUpdateUsers={async (u) => { setUsers(u); await db.save('users', u); }}
            onUpdateRoles={async (r) => { setRoles(r); await db.save('roles', r); }}
            onUpdateProducts={async (p) => { setProducts(p); await db.save('products', p); syncManager.broadcastChange('products', null, 'UPDATE').catch(console.error); }}
            onUpdateWarehouses={async (w) => { setWarehouses(w); await db.save('warehouses', w); }}
            onOpenZReport={() => setCurrentView('Z_REPORT')}
            onOpenSupplyChain={() => setCurrentView('SUPPLY_CHAIN')}
            onOpenFranchise={() => setCurrentView('FRANCHISE_DASHBOARD')}
            isAdminMode={isAdminMode}
            onClose={() => {
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
            terminalId={(config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.id || 'T1'}
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
            onUpdateTransfers={async (t) => { setTransfers(t); await db.save('transfers', t); }}
            onUpdateConfig={handleConfigUpdate}
            onUpdateUsers={async (u) => { setUsers(u); await db.save('users', u); }}
            onUpdateRoles={async (r) => { setRoles(r); await db.save('roles', r); }}
            onUpdateProducts={async (p) => { setProducts(p); await db.save('products', p); }}
            onUpdateWarehouses={async (w) => { setWarehouses(w); await db.save('warehouses', w); }}
            onOpenZReport={() => setCurrentView('Z_REPORT')}
            onOpenSupplyChain={() => setCurrentView('SUPPLY_CHAIN')}
            onOpenFranchise={() => setCurrentView('FRANCHISE_DASHBOARD')}
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
              const updatedTxns = transactions.map(t => t.id === tx.id ? { ...t, status: 'REFUNDED' as const, refundReason: reason, syncStatus: 'PENDING' as const } : t);
              setTransactions(updatedTxns);
              await db.save('transactions', updatedTxns);

              // Trigger background sync
              backgroundSyncManager.triggerSync().catch(console.error);

              // Record Inventory Movement (Return = Entry)
              const defaultWarehouseId = config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId || 'wh_central';

              // If items are provided (partial refund), use them. Otherwise use all items from transaction.
              const itemsToRefund = items && items.length > 0 ? items : tx.items;

              // Get current terminal ID
              const currentTerminalId = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId)?.id || 'T1';

              for (const item of itemsToRefund) {
                const entry = await db.recordInventoryMovement(
                  defaultWarehouseId,
                  item.id,
                  'DEVOLUCION',
                  tx.displayId || tx.id,
                  item.quantity, // Positive for returns (Entry)
                  item.price,
                  tx.terminalId || currentTerminalId
                );

                if (entry) {
                  // No need to push individually anymore, BackgroundSyncManager handles it
                  // await syncManager.pushInventoryMovement(entry);
                }
              }

              // Refresh products
              const refreshedDb = await db.init();
              setProducts(refreshedDb.products || []);

              setCurrentView('POS');
            }}
          />
        );

      case 'FINANCE':
        return (
          <FinanceDashboard
            transactions={transactions}
            cashMovements={cashMovements}
            config={config}
            currentUser={currentUser}
            roles={roles}
            onRegisterMovement={handleRegisterMovement}
            onOpenZReport={() => setCurrentView('Z_REPORT')}
            onClose={() => setCurrentView('POS')}
          />
        );

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
            config={config}
            onClose={() => setCurrentView('POS')}
            onCreateOrder={async (o) => { const updated = [...purchaseOrders, o]; setPurchaseOrders(updated); await db.save('purchaseOrders', updated); }}
            onUpdateOrder={async (o) => { const updated = purchaseOrders.map(p => p.id === o.id ? o : p); setPurchaseOrders(updated); await db.save('purchaseOrders', updated); }}
            onReceiveStock={async (items, orderId) => {
              const pairedTerminal = (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
              const terminalId = pairedTerminal?.id || 'LOCAL';
              const whId = config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId || 'wh_central';

              // 1. Record Inventory Movements (Batch)
              const movements = items
                .filter(item => item.quantityReceived > 0)
                .map(item => ({
                  warehouseId: whId,
                  productId: item.productId,
                  concept: 'COMPRA' as LedgerConcept,
                  documentRef: orderId || 'OC-REC',
                  qty: item.quantityReceived,
                  movementCost: item.cost,
                  terminalId
                }));

              if (movements.length > 0) {
                await db.recordInventoryMovements(movements);
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
                syncStatus: 'PENDING'
              };

              const updatedReceptions = [...receptions, newReception];
              setReceptions(updatedReceptions);
              await db.save('receptions', updatedReceptions);

              // 3. Refresh Products State and Broadcast (CRITICAL for Sync)
              const refreshedProducts = await db.get('products') as Product[] || [];
              setProducts(refreshedProducts);

              if (permissionService.isMasterTerminal()) {
                syncManager.broadcastChange('products', null, 'UPDATE').catch(console.error);
                syncManager.broadcastChange('productStocks', null, 'UPDATE').catch(console.error);
              }

              // Refresh detailed stocks state
              const freshStocks = await db.get('productStocks') as ProductStock[] || [];
              setProductStocks(freshStocks);

              networkSyncService.sync();
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
              networkSyncService.sync();
              const freshData = await db.init();
              setProducts(freshData.products);

              if (permissionService.isMasterTerminal()) {
                syncManager.broadcastChange('products', null, 'UPDATE').catch(console.error);
                syncManager.broadcastChange('productStocks', null, 'UPDATE').catch(console.error);
              }

              // Refresh detailed stocks state
              const freshStocks = await db.get('productStocks') as ProductStock[] || [];
              setProductStocks(freshStocks);

              networkSyncService.sync();
            }}
            onAddSupplier={async (s) => {
              const updated = [...suppliers, s];
              setSuppliers(updated);
              // Note: The SupplierSelector already saves to DB via API, 
              // but we update local state here for immediate UI reflection if needed,
              // or we could re-fetch. Since we use API in selector, maybe we should just re-fetch?
              // For now, optimistic update is fine as the selector returns the saved object.
            }}
            receptions={receptions}
          />
        );

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
              setCart(applyPromotions(newCart, config));
            }}
            onRemoveFromCart={(productId) => {
              const newCart = cart.filter(item => item.id !== productId);
              setCart(applyPromotions(newCart, config));
            }}
            onCheckout={() => handleViewChange('KIOSK_PAYMENT')}
            onCancel={() => {
              setCart([]);
              handleViewChange('KIOSK_WELCOME');
            }}
            config={config}
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
          />
        );

      case 'INVENTORY_COUNT':
        return (
          <InventoryCount
            products={products}
            onSave={(counts) => {
              console.log('Inventory counts saved:', counts);
              alert(`Conteo guardado: ${counts.length} productos`);
              handleViewChange('INVENTORY_HOME');
            }}
            onCancel={() => handleViewChange('INVENTORY_HOME')}
          />
        );

      default:
        return <div className="h-screen flex items-center justify-center">Vista no implementada.</div>;
    }
  };

  // Get current terminal configuration
  const getCurrentTerminal = () => {
    return (config.terminals || []).find(t => t.config?.currentDeviceId === deviceId);
  };

  // Get current device role
  const getCurrentDeviceRole = (): DeviceRole => {
    const terminal = getCurrentTerminal();
    return terminal?.config?.deviceRole?.role || DeviceRole.STANDARD_POS;
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
    const handleHandheldNavigate = (view: string) => {
      const decision = terminalRouter.beforeNavigate(view, currentView);
      if (decision.allowed) {
        setCurrentView(view as ViewState);
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

  return (
    <ErrorBoundary componentName="App Root">
      <div className="h-screen w-screen overflow-hidden">
        {renderWithLayout()}
      </div>
    </ErrorBoundary>
  );
};

export default App;
