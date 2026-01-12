
import React, { useState, useEffect } from 'react';
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
  VerticalType
} from './types';
import { 
  MOCK_USERS, 
  DEFAULT_ROLES, 
  MOCK_CUSTOMERS, 
  RETAIL_PRODUCTS, 
  FOOD_PRODUCTS, 
  getInitialConfig 
} from './constants';

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

const App: React.FC = () => {
  // --- GLOBAL STATE ---
  const [currentView, setCurrentView] = useState<ViewState>('SETUP'); // Start at SETUP to show the full flow
  const [config, setConfig] = useState<BusinessConfig>(() => getInitialConfig('Supermercado' as any)); // Default start
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  
  // --- DATA STORES (In-Memory Mock) ---
  const [users, setUsers] = useState<User[]>(MOCK_USERS);
  const [roles, setRoles] = useState<RoleDefinition[]>(DEFAULT_ROLES);
  const [customers, setCustomers] = useState<Customer[]>(MOCK_CUSTOMERS);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<Product[]>(RETAIL_PRODUCTS);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  
  // Supply Chain Data
  const [suppliers, setSuppliers] = useState<Supplier[]>([
    { id: 'sup1', name: 'Distribuidora Central', contactName: 'Carlos', phone: '555-0101', email: 'pedidos@central.com' },
    { id: 'sup2', name: 'Importadora Global', contactName: 'Ana', phone: '555-0202', email: 'ventas@global.com' }
  ]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);

  // --- EFFECTS ---
  
  // Switch product catalog when vertical changes
  useEffect(() => {
    if (config.vertical === VerticalType.RESTAURANT) {
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

  const handleTransactionComplete = (txn: Transaction) => {
    setTransactions(prev => [...prev, txn]);
    
    // Simple Stock Deduction Logic
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
    // 1. Create Refund Transaction
    const refundTotal = itemsToRefund.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    const taxRefund = refundTotal * config.taxRate;
    const totalRefund = refundTotal + taxRefund;

    const refundTx: Transaction = {
      id: `REF-${Math.random().toString(36).substr(2, 6)}`,
      date: new Date().toISOString(),
      items: itemsToRefund,
      total: -totalRefund, // Negative amount
      payments: [{ id: 'ref_pay', method: 'CASH', amount: -totalRefund, timestamp: new Date() }],
      userId: currentUser?.id || 'sys',
      userName: currentUser?.name || 'System',
      status: 'REFUNDED',
      refundReason: reason,
      customerId: originalTx.customerId,
      customerName: originalTx.customerName
    };

    setTransactions(prev => prev.map(t => t.id === originalTx.id ? { ...t, status: 'PARTIAL_REFUND' as const } : t).concat(refundTx));

    // 2. Restore Stock if applicable
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
    // In a real app, this would archive current transactions and reset daily counters
    console.log("Z Report Closed", { counted, notes });
    alert("Cierre Z realizado correctamente. Se ha generado el reporte.");
    setCurrentView('POS');
  };

  // Supply Chain Handlers
  const handleReceiveStock = (items: PurchaseOrderItem[]) => {
     setProducts(prev => prev.map(prod => {
        const receivedItem = items.find(i => i.productId === prod.id);
        if (receivedItem && receivedItem.quantityReceived > 0) {
           return { ...prod, stock: (prod.stock || 0) + receivedItem.quantityReceived };
        }
        return prod;
     }));
  };

  // Configuration Update
  const handleUpdateConfig = (newConfig: BusinessConfig, shouldRestart = false) => {
    setConfig(newConfig);
    if (shouldRestart) {
      setCurrentView('LOGIN'); // Or 'SETUP'
    }
  };

  // --- RENDER ROUTER ---

  switch (currentView) {
    case 'SETUP':
      return (
        <VerticalSelector 
          onSelect={(initialCfg) => {
             setConfig(initialCfg);
             setCurrentView('WIZARD');
          }} 
        />
      );

    case 'WIZARD':
      return (
        <SetupWizard 
          initialConfig={config}
          onComplete={(finalConfig) => {
             setConfig(finalConfig);
             setCurrentView('LOGIN');
          }}
        />
      );
      
    case 'LOGIN':
      return (
        <LoginScreen 
          onLogin={handleLogin} 
          availableUsers={users}
          subVertical={config.subVertical}
        />
      );

    case 'POS':
      if (!currentUser) return <LoginScreen onLogin={handleLogin} availableUsers={users} subVertical={config.subVertical} />;
      return (
        <POSInterface 
          config={config}
          currentUser={currentUser}
          roles={roles}
          customers={customers}
          products={products}
          onLogout={handleLogout}
          onOpenSettings={() => setCurrentView('SETTINGS')}
          onOpenCustomers={() => setCurrentView('CUSTOMERS')}
          onOpenHistory={() => setCurrentView('HISTORY')}
          onOpenFinance={() => setCurrentView('FINANCE')}
          onTransactionComplete={handleTransactionComplete}
          onAddCustomer={(c) => setCustomers([...customers, c])}
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
          onUpdateConfig={handleUpdateConfig}
          onUpdateUsers={setUsers}
          onUpdateRoles={setRoles}
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
          onClose={() => setCurrentView('SETTINGS')} // Return to settings usually
          onCreateOrder={(po) => setPurchaseOrders(prev => [...prev, po])}
          onUpdateOrder={(po) => setPurchaseOrders(prev => prev.map(o => o.id === po.id ? po : o))}
          onReceiveStock={handleReceiveStock}
        />
      );

    case 'FRANCHISE_DASHBOARD':
      return (
        <FranchiseDashboard 
          onBack={() => setCurrentView('POS')}
        />
      );

    default:
      return <div>Error: Vista desconocida</div>;
  }
};

export default App;
