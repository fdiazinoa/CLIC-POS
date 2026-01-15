
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
  MOCK_USERS, 
  DEFAULT_ROLES, 
  MOCK_CUSTOMERS, 
  RETAIL_PRODUCTS, 
  FOOD_PRODUCTS, 
  getInitialConfig,
  INITIAL_TARIFFS
} from './constants';

// Component Imports
import LoginScreen from './components/LoginScreen';
import POSInterface from './components/POSInterface'; // FIXED IMPORT
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

const INITIAL_WAREHOUSES: Warehouse[] = [
  { id: 'wh_1', code: 'CEN', name: 'Almacén Central', type: 'PHYSICAL', address: 'Calle Industria 45', allowPosSale: true, allowNegativeStock: false, isMain: true, storeId: 'S1' },
  { id: 'wh_2', code: 'NTE', name: 'Tienda Norte', type: 'PHYSICAL', address: 'Av. Principal 12', allowPosSale: true, allowNegativeStock: false, isMain: false, storeId: 'S1' },
  { id: 'wh_3', code: 'MER', name: 'Bodega Mermas', type: 'VIRTUAL', address: 'Virtual', allowPosSale: false, allowNegativeStock: false, isMain: false, storeId: 'S1' },
];

const App: React.FC = () => {
  // --- GLOBAL STATE ---
  const [currentView, setCurrentView] = useState<ViewState>('SETUP'); 
  const [config, setConfig] = useState<BusinessConfig>(() => getInitialConfig('Supermercado' as any)); 
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  
  // --- SECURITY & DEVICE HANDSHAKE ---
  const [deviceId, setDeviceId] = useState<string>('');
  const [isAuthorized, setIsAuthorized] = useState<boolean>(false);

  // --- DATA STORES ---
  const [users, setUsers] = useState<User[]>(MOCK_USERS);
  const [roles, setRoles] = useState<RoleDefinition[]>(DEFAULT_ROLES);
  const [customers, setCustomers] = useState<Customer[]>(MOCK_CUSTOMERS);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<Product[]>(RETAIL_PRODUCTS);
  const [warehouses, setWarehouses] = useState<Warehouse[]>(INITIAL_WAREHOUSES);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  
  // POS Persistent State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [parkedTickets, setParkedTickets] = useState<ParkedTicket[]>([]); // Lifted state to persist across views

  // Supply Chain Data
  const [suppliers, setSuppliers] = useState<Supplier[]>([
    { id: 'sup1', name: 'Distribuidora Central', contactName: 'Carlos', phone: '555-0101', email: 'pedidos@central.com' },
    { id: 'sup2', name: 'Importadora Global', contactName: 'Ana', phone: '555-0202', email: 'ventas@global.com' }
  ]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);

  // --- DEVICE AUTH EFFECT ---
  useEffect(() => {
    // 1. Get or Create Device ID
    let dId = localStorage.getItem('clic_pos_device_id');
    if (!dId) {
      dId = `DEV-${Math.random().toString(36).substring(2, 15)}-${Date.now()}`;
      localStorage.setItem('clic_pos_device_id', dId);
    }
    setDeviceId(dId);

    // 2. Initial Setup Bypass Check
    // If setup is not done, we don't block by device yet
    if (currentView === 'SETUP' || currentView === 'WIZARD') return;

    // 3. Check if device is bound to any terminal
    const boundTerminal = config.terminals.find(t => t.config.currentDeviceId === dId);
    if (boundTerminal) {
       setIsAuthorized(true);
    } else {
       setIsAuthorized(false);
       setCurrentView('DEVICE_UNAUTHORIZED');
    }
  }, [config.terminals, currentView]);

  // --- EFFECTS ---
  useEffect(() => {
    if (config.vertical === 'RESTAURANT') {
      setProducts(prev => prev[0]?.category === 'Lácteos' ? FOOD_PRODUCTS : prev);
    } else {
      setProducts(prev => prev[0]?.category === 'Platos' ? RETAIL_PRODUCTS : prev);
    }
  }, [config.vertical]);

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
      // Unlink any other terminal using this deviceId
      if (t.config.currentDeviceId === deviceId) {
        return { ...t, config: { ...t.config, currentDeviceId: undefined } };
      }
      // Link the target terminal
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

    handleUpdateConfig({ ...config, terminals: updatedTerminals });
    setIsAuthorized(true);
    setCurrentView('LOGIN');
  };

  const handleTransactionComplete = (txn: Transaction) => {
    setTransactions(prev => [...prev, txn]);
    setCart([]); 
    setSelectedCustomer(null); 
    
    if (config.features.stockTracking) {
      const itemsMap = new Map<string, number>();
      txn.items.forEach(item => {
        itemsMap.set(item.id, (itemsMap.get(item.id) || 0) + item.quantity);
      });

      setProducts(prevProducts => prevProducts.map(p => {
        if (itemsMap.has(p.id)) {
          return { ...p, stock: Math.max(0, (p.stock || 0) - (itemsMap.get(p.id) || 0)) };
        }
        return p;
      }));
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

    if (reason !== 'DAMAGED' && config.features.stockTracking) {
       setProducts(prev => prev.map(p => {
          const item = itemsToRefund.find(i => i.id === p.id);
          if (item) {
             return { ...p, stock: (p.stock || 0) + item.quantity };
          }
          return p;
       }));
    }
    
    alert("Devolución procesada correctamente.");
  };

  const handleRegisterCashMovement = (type: 'IN' | 'OUT', amount: number, reason: string) => {
    setCashMovements(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      type,
      amount,
      reason,
      timestamp: new Date().toISOString(),
      userId: currentUser?.id || '',
      userName: currentUser?.name || ''
    }]);
  };

  const handleZReportClose = (counted: number, notes: string) => {
    alert("Cierre Z realizado correctamente.");
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

  // --- RENDER ROUTER ---

  switch (currentView) {
    case 'SETUP':
      return <VerticalSelector onSelect={(initialCfg) => { setConfig(initialCfg); setCurrentView('WIZARD'); }} />;

    case 'WIZARD':
      return <SetupWizard initialConfig={config} onComplete={(finalConfig) => { setConfig(finalConfig); setCurrentView('LOGIN'); }} />;
      
    case 'DEVICE_UNAUTHORIZED':
      return (
        <TerminalBindingScreen 
          config={config} 
          deviceId={deviceId} 
          adminUsers={users} 
          onPair={handleDevicePairing} 
        />
      );

    case 'LOGIN':
      return <LoginScreen onLogin={handleLogin} availableUsers={users} subVertical={config.subVertical} />;

    case 'POS':
      if (!currentUser) return <LoginScreen onLogin={handleLogin} availableUsers={users} subVertical={config.subVertical} />;
      return (
        <POSInterface 
          config={config}
          currentUser={currentUser}
          roles={roles}
          users={users} // Pass full list of users for salesperson assignment
          customers={customers}
          products={products}
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
