
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
  StockTransfer
} from './types';
import {
  DEFAULT_ROLES,
  FOOD_PRODUCTS,
  RETAIL_PRODUCTS,
  getInitialConfig
} from './constants';
import { db } from './utils/db'; // Import Local DB
import { syncQueue } from './services/sync/SyncQueue';

// Component Imports
import LoginScreen from './components/LoginScreen';
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

const App: React.FC = () => {
  // --- GLOBAL STATE ---
  const [currentView, setCurrentView] = useState<ViewState>('LOGIN');
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
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // --- INITIAL DATA LOAD & DEVICE CHECK ---
  useEffect(() => {
    const loadData = async () => {
      const data = await db.init();
      if (data) {
        // 1. Cargar persistencia
        setConfig(data.config);
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

        // 2. Gestión de Identidad de Dispositivo (Persistente)
        let storedDeviceId = localStorage.getItem('pos_device_id');
        if (!storedDeviceId) {
          storedDeviceId = 'DEV-' + Math.random().toString(36).substring(2, 10).toUpperCase();
          localStorage.setItem('pos_device_id', storedDeviceId);
        }
        setDeviceId(storedDeviceId);

        // 3. Verificación de Vinculación
        const isDevicePaired = data.config.terminals.some(
          (t: any) => t.config.currentDeviceId === storedDeviceId
        );

        if (!isDevicePaired) {
          setCurrentView('DEVICE_UNAUTHORIZED');
        }

        setIsDataLoaded(true);
      }
    };
    loadData();

    // Start Sync Worker
    syncQueue.startBackgroundWorker(15000); // Check every 15s
    return () => syncQueue.stopBackgroundWorker();
  }, []);

  // --- CORE EVENT HANDLERS ---

  const handlePairTerminal = async (terminalId: string) => {
    const newTerminals = config.terminals.map(t => {
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
    setCurrentView('LOGIN');
  };

  const handleConfigUpdate = async (newConfig: BusinessConfig) => {
    setConfig(newConfig);
    await db.save('config', newConfig);
  };

  const handleTransactionComplete = async (txn: Transaction) => {
    const newTransactions = [...transactions, txn];
    setTransactions(newTransactions);
    await db.save('transactions', newTransactions);

    // Enqueue for Sync
    await syncQueue.enqueue('TRANSACTION', txn);

    for (const item of txn.items) {
      const whId = config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId || 'wh_central';
      await db.recordInventoryMovement(whId, item.id, 'VENTA', txn.id, -item.quantity);
    }

    const freshData = await db.init();
    setProducts(freshData.products);
  };

  const handleUpdateConfig = async (newConfig: BusinessConfig) => {
    setConfig(newConfig);
    await db.save('config', newConfig);
  };

  const handleRegisterMovement = async (type: 'IN' | 'OUT', amount: number, reason: string) => {
    const move: CashMovement = {
      id: `CM-${Date.now()}`,
      type, amount, reason,
      timestamp: new Date().toISOString(),
      userId: currentUser?.id || 'sys',
      userName: currentUser?.name || 'System'
    };
    const updated = [...cashMovements, move];
    setCashMovements(updated);
    await db.save('cashMovements', updated);
  };

  const handleZReport = async (cashCounted: number, notes: string) => {
    setTransactions([]);
    setCashMovements([]);
    await db.save('transactions', []);
    await db.save('cashMovements', []);
    setCurrentView('POS');
  };

  // --- VIEW RENDERING LOGIC ---
  if (!isDataLoaded) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-900 text-white">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="font-bold tracking-widest uppercase text-xs">Cargando CLIC POS OS...</p>
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
            onAddCustomer={async (c) => { const updated = [...customers, c]; setCustomers(updated); await db.save('customers', updated); }}
            onUpdateConfig={handleUpdateConfig}
          />
        );

      case 'SETTINGS':
        return (
          <Settings
            config={config}
            users={users}
            roles={roles}
            transactions={transactions}
            products={products}
            warehouses={warehouses}
            transfers={transfers}
            onUpdateTransfers={async (t) => { setTransfers(t); await db.save('transfers', t); }}
            onUpdateConfig={handleUpdateConfig}
            onUpdateUsers={async (u) => { setUsers(u); await db.save('users', u); }}
            onUpdateRoles={async (r) => { setRoles(r); await db.save('roles', r); }}
            onUpdateProducts={async (p) => { setProducts(p); await db.save('products', p); }}
            onUpdateWarehouses={async (w) => { setWarehouses(w); await db.save('warehouses', w); }}
            onOpenZReport={() => setCurrentView('Z_REPORT')}
            onOpenSupplyChain={() => setCurrentView('SUPPLY_CHAIN')}
            onOpenFranchise={() => setCurrentView('FRANCHISE_DASHBOARD')}
            onClose={() => setCurrentView('POS')}
          />
        );

      case 'CUSTOMERS':
        return (
          <CustomerManagement
            customers={customers}
            config={config}
            onAddCustomer={async (c) => { const updated = [...customers, c]; setCustomers(updated); await db.save('customers', updated); }}
            onUpdateCustomer={async (c) => { const updated = customers.map(cust => cust.id === c.id ? c : cust); setCustomers(updated); await db.save('customers', updated); }}
            onDeleteCustomer={async (id) => { const updated = customers.filter(cust => cust.id !== id); setCustomers(updated); await db.save('customers', updated); }}
            onSelect={(c) => { setSelectedCustomer(c); setCurrentView('POS'); }}
            onClose={() => setCurrentView('POS')}
          />
        );

      case 'HISTORY':
        return (
          <TicketHistory
            transactions={transactions}
            config={config}
            onClose={() => setCurrentView('POS')}
            onRefundTransaction={async (tx, items, reason) => {
              const updatedTxns = transactions.map(t => t.id === tx.id ? { ...t, status: 'REFUNDED' as const, refundReason: reason } : t);
              setTransactions(updatedTxns);
              await db.save('transactions', updatedTxns);
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
            onConfirmClose={handleZReport}
            onClose={() => setCurrentView('POS')}
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
            onReceiveStock={async (items) => {
              const whId = config.terminals[0]?.config.inventoryScope?.defaultSalesWarehouseId || 'wh_central';
              for (const item of items) {
                if (item.quantityReceived > 0) {
                  await db.recordInventoryMovement(whId, item.productId, 'COMPRA', 'OC-REC', item.quantityReceived, item.cost);
                }
              }
              const freshData = await db.init();
              setProducts(freshData.products);
            }}
          />
        );

      case 'FRANCHISE_DASHBOARD':
        return <FranchiseDashboard onBack={() => setCurrentView('POS')} />;

      default:
        return <div className="h-screen flex items-center justify-center">Vista no implementada.</div>;
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden">
      {renderView()}
    </div>
  );
};

export default App;
