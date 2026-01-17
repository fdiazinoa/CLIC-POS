
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
  ParkedTicket
} from './types';
import { 
  DEFAULT_ROLES, 
  FOOD_PRODUCTS, 
  RETAIL_PRODUCTS,
  getInitialConfig
} from './constants';
import { db } from './utils/db'; // Import Local DB

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
  const [currentView, setCurrentView] = useState<ViewState>('LOGIN'); // Default to LOGIN as DB initializes
  const [config, setConfig] = useState<BusinessConfig>(() => getInitialConfig('Supermercado' as any)); 
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  
  // --- SECURITY & DEVICE HANDSHAKE ---
  const [deviceId, setDeviceId] = useState<string>('');
  const [isDataLoaded, setIsDataLoaded] = useState<boolean>(false); 

  // --- DATA STORES (Initialized Empty, populated by Effect) ---
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>(DEFAULT_ROLES);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  
  // POS Persistent State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [parkedTickets, setParkedTickets] = useState<ParkedTicket[]>([]); 

  // Supply Chain Data
  const [suppliers, setSuppliers] = useState<Supplier[]>([
    { id: 'sup1', name: 'Distribuidora Central', contactName: 'Carlos', phone: '555-0101', email: 'pedidos@central.com' },
    { id: 'sup2', name: 'Importadora Global', contactName: 'Ana', phone: '555-0202', email: 'ventas@global.com' }
  ]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);

  // --- 1. DATA PERSISTENCE LOADER ---
  useEffect(() => {
    // Initialize DB (Seed if empty)
    const initialData = db.init();

    // Load State from DB
    setConfig(initialData.config);
    setUsers(initialData.users);
    setCustomers(initialData.customers);
    setProducts(initialData.products);
    setWarehouses(initialData.warehouses);
    setTransactions(initialData.transactions);
    setCashMovements(initialData.cashMovements);

    // Initialize Device ID
    let dId = localStorage.getItem('clic_pos_device_id');
    if (!dId) {
      dId = `DEV-${Math.random().toString(36).substring(2, 15)}-${Date.now()}`;
      localStorage.setItem('clic_pos_device_id', dId);
    }
    setDeviceId(dId);

    setIsDataLoaded(true); // Signal that DB is fully loaded
    console.log("✅ Datos cargados desde almacenamiento local (Persistente).");
  }, []);

  // --- 2. PERSISTENCE SAVERS (Auto-save on change) ---
  useEffect(() => { if (products.length) db.save('products', products); }, [products]);
  useEffect(() => { if (users.length) db.save('users', users); }, [users]);
  useEffect(() => { if (warehouses.length) db.save('warehouses', warehouses); }, [warehouses]);
  useEffect(() => { if (transactions.length) db.save('transactions', transactions); }, [transactions]);
  useEffect(() => { if (isDataLoaded && config) db.save('config', config); }, [config, isDataLoaded]);

  // --- 3. DERIVED AUTHORIZATION STATE (Hard Gate) ---
  const isAuthorized = useMemo(() => {
    if (!isDataLoaded) return false;
    // Check if this specific device ID is assigned to any terminal in the config
    return config.terminals?.some(t => t.config.currentDeviceId === deviceId);
  }, [config.terminals, deviceId, isDataLoaded]);

  // --- HANDLERS ---
  const handleLogin = (user: User) => {
    setCurrentUser(user);
    setCurrentView('POS');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setCurrentView('LOGIN');
  };

  const handleDevicePairing = (terminalId: string) => {
    const updatedTerminals = config.terminals.map(t => {
      // Unpair this device from any other terminal it might be on (integrity)
      if (t.config.currentDeviceId === deviceId) {
        return { ...t, config: { ...t.config, currentDeviceId: null } }; // Use null
      }
      // Pair with new terminal
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

    // Update state immediately
    const newConfig = { ...config, terminals: updatedTerminals };
    setConfig(newConfig);
    db.save('config', newConfig); 
    
    // Authorization will recalculate automatically via useMemo
    setCurrentView('LOGIN');
  };

  const handleTransactionComplete = (txn: Transaction) => {
    setTransactions(prev => [...prev, txn]);
    setCart([]); 
    setSelectedCustomer(null); 
    
    // Optimistic Update & Stock Deduction
    if (config.features.stockTracking) {
      const activeTerminal = config.terminals.find(t => t.config.currentDeviceId === deviceId);
      const warehouseId = activeTerminal?.config.inventoryScope?.defaultSalesWarehouseId;

      if (warehouseId) {
        setProducts(prevProducts => prevProducts.map(p => {
          const itemInCart = txn.items.find(i => i.id === p.id);
          if (itemInCart) {
             const currentStock = p.stockBalances?.[warehouseId] || 0;
             const newStock = Math.max(0, currentStock - itemInCart.quantity);
             return { 
               ...p, 
               stockBalances: { ...p.stockBalances, [warehouseId]: newStock },
               // Update legacy total stock for backward compatibility
               stock: (p.stock || 0) - itemInCart.quantity
             };
          }
          return p;
        }));
      }
    }
  };

  const handleRefundTransaction = (originalTx: Transaction, itemsToRefund: CartItem[], reason: string) => {
    const refundTotal = itemsToRefund.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    const taxRefund = refundTotal * config.taxRate;
    const totalRefund = refundTotal + taxRefund;

    const refundTx: Transaction = {
      id: `REF-${Math.random().toString(36).substr(2, 6)}`,
      date: new Date().toISOString(),
      items: itemsToRefund,
      total: -totalRefund, 
      payments: [{ id: 'ref_pay', method: 'CASH', amount: -totalRefund, timestamp: new Date() }],
      userId: currentUser?.id || 'sys',
      userName: currentUser?.name || 'System',
      status: 'REFUNDED',
      refundReason: reason,
      customerId: originalTx.customerId,
      customerName: originalTx.customerName
    };

    setTransactions(prev => prev.map(t => t.id === originalTx.id ? { ...t, status: 'PARTIAL_REFUND' as const } : t).concat(refundTx));
    alert("Devolución procesada correctamente.");
  };

  const handleRegisterCashMovement = (type: 'IN' | 'OUT', amount: number, reason: string) => {
    const movement: CashMovement = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      amount,
      reason,
      timestamp: new Date().toISOString(),
      userId: currentUser?.id || '',
      userName: currentUser?.name || ''
    };
    setCashMovements(prev => {
        const newVal = [...prev, movement];
        db.save('cashMovements', newVal);
        return newVal;
    });
  };

  const handleZReportClose = (counted: number, notes: string) => {
    alert("Cierre Z realizado correctamente. Ventas del día archivadas.");
    setCurrentView('POS');
  };

  const handleReceiveStock = (items: PurchaseOrderItem[]) => {
     setProducts(prev => prev.map(prod => {
        const receivedItem = items.find(i => i.productId === prod.id);
        if (receivedItem && receivedItem.quantityReceived > 0) {
           return { ...prod, stock: (prod.stock || 0) + receivedItem.quantityReceived };
        }
        return prod;
     }));
  };

  const handleUpdateConfig = (newConfig: BusinessConfig, shouldRestart = false) => {
    setConfig(newConfig);
    if (shouldRestart) {
      setCurrentView('LOGIN'); 
    }
  };

  // --- RENDER ROUTER (HARD GATED) ---

  // 1. Loading State
  if (!isDataLoaded) {
     return (
        <div className="h-screen w-full flex items-center justify-center bg-gray-50">
           <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
     );
  }

  // 2. Setup Exceptions (First time run)
  if (currentView === 'SETUP') {
    return <VerticalSelector onSelect={(initialCfg) => { setConfig(initialCfg); setCurrentView('WIZARD'); }} />;
  }
  if (currentView === 'WIZARD') {
    return <SetupWizard initialConfig={config} onComplete={(finalConfig) => { setConfig(finalConfig); setCurrentView('LOGIN'); }} />;
  }

  // 3. HARD SECURITY GATE
  // If we are not in Setup/Wizard, and the device is not authorized, FORCE Binding Screen.
  // This overrides any other view state (like LOGIN).
  if (!isAuthorized) {
    return (
      <TerminalBindingScreen 
        config={config} 
        deviceId={deviceId} 
        adminUsers={users} 
        onPair={handleDevicePairing} 
      />
    );
  }

  // 4. Authorized Routes
  switch (currentView) {
    // Removed redundant DEVICE_UNAUTHORIZED case as it's handled by Hard Gate

    case 'LOGIN':
      return <LoginScreen onLogin={handleLogin} availableUsers={users} subVertical={config.subVertical} />;

    case 'POS':
      if (!currentUser) return <LoginScreen onLogin={handleLogin} availableUsers={users} subVertical={config.subVertical} />;
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
          onUpdateCart={setCart}
          selectedCustomer={selectedCustomer}
          onSelectCustomer={setSelectedCustomer}
          parkedTickets={parkedTickets}
          onUpdateParkedTickets={setParkedTickets}
          onLogout={handleLogout}
          onOpenSettings={() => setCurrentView('SETTINGS')}
          onOpenCustomers={() => setCurrentView('CUSTOMERS')}
          onOpenHistory={() => setCurrentView('HISTORY')}
          onOpenFinance={() => setCurrentView('FINANCE')}
          onTransactionComplete={handleTransactionComplete}
          onAddCustomer={(c) => setCustomers([...customers, c])}
          onUpdateConfig={handleUpdateConfig}
        />
      );

    case 'SETTINGS':
      if (!currentUser) return <LoginScreen onLogin={handleLogin} availableUsers={users} subVertical={config.subVertical} />;
      return (
        <Settings 
          config={config}
          users={users}
          roles={roles}
          transactions={transactions}
          products={products}
          warehouses={warehouses}
          onUpdateConfig={handleUpdateConfig}
          onUpdateUsers={setUsers}
          onUpdateRoles={setRoles}
          onUpdateProducts={setProducts}
          onUpdateWarehouses={setWarehouses}
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
          onAddCustomer={(c) => setCustomers([...customers, c])}
          onUpdateCustomer={(c) => setCustomers(prev => prev.map(cust => cust.id === c.id ? c : cust))}
          onDeleteCustomer={(id) => setCustomers(prev => prev.filter(c => c.id !== id))}
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
          onRefundTransaction={handleRefundTransaction}
        />
      );

    case 'FINANCE':
      return (
        <FinanceDashboard 
          transactions={transactions}
          cashMovements={cashMovements}
          config={config}
          onClose={() => setCurrentView('POS')}
          onRegisterMovement={handleRegisterCashMovement}
          onOpenZReport={() => setCurrentView('Z_REPORT')}
        />
      );

    case 'Z_REPORT':
      return (
        <ZReportDashboard 
          transactions={transactions}
          cashMovements={cashMovements}
          config={config}
          userName={currentUser?.name || ''}
          onClose={() => setCurrentView('POS')}
          onConfirmClose={handleZReportClose}
        />
      );

    case 'SUPPLY_CHAIN':
      return (
        <SupplyChainManager 
          products={products}
          suppliers={suppliers}
          purchaseOrders={purchaseOrders}
          config={config}
          onClose={() => setCurrentView('SETTINGS')} 
          onCreateOrder={(po) => setPurchaseOrders(prev => [...prev, po])}
          onUpdateOrder={(po) => setPurchaseOrders(prev => prev.map(o => o.id === po.id ? po : o))}
          onReceiveStock={handleReceiveStock}
        />
      );

    case 'FRANCHISE_DASHBOARD':
      return <FranchiseDashboard onBack={() => setCurrentView('POS')} />;

    default:
      return <div>Error: Vista desconocida</div>;
  }
};

export default App;
