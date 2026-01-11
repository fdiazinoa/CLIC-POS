import React, { useState, useEffect } from 'react';
import { ViewState, BusinessConfig, User, RoleDefinition, Transaction, Customer, CartItem, CashMovement, Supplier, PurchaseOrder, PurchaseOrderItem, VerticalType } from './types';
import { MOCK_USERS, DEFAULT_ROLES, getInitialConfig, MOCK_CUSTOMERS, RETAIL_PRODUCTS, FOOD_PRODUCTS } from './constants';
import VerticalSelector from './components/VerticalSelector';
import POSInterface from './components/POSInterface';
import Settings from './components/Settings';
import LoginScreen from './components/LoginScreen';
import CustomerManagement from './components/CustomerManagement';
import ZReportDashboard from './components/ZReportDashboard';
import FinanceDashboard from './components/FinanceDashboard';
import SetupWizard from './components/SetupWizard';
import TicketHistory from './components/TicketHistory';
import SupplyChainManager from './components/SupplyChainManager';

const CONFIG_KEY = 'antigravity_pos_config';
const USERS_KEY = 'antigravity_pos_users';
const ROLES_KEY = 'antigravity_pos_roles';
const TRANSACTIONS_KEY = 'antigravity_pos_transactions';
const CUSTOMERS_KEY = 'antigravity_pos_customers';
const CASH_MOVEMENTS_KEY = 'antigravity_pos_cash_movements';
const SUPPLIERS_KEY = 'antigravity_pos_suppliers';
const PO_KEY = 'antigravity_pos_purchase_orders';

const App: React.FC = () => {
  // Initialize config
  const [config, setConfig] = useState<BusinessConfig | null>(() => {
    const saved = localStorage.getItem(CONFIG_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (!parsed.companyInfo) {
           const defaults = getInitialConfig(parsed.subVertical);
           return { ...parsed, companyInfo: defaults.companyInfo };
        }
        return parsed;
      } catch (e) {
        console.error("Configuración corrupta, reiniciando.", e);
        localStorage.removeItem(CONFIG_KEY);
      }
    }
    return null;
  });

  // Data States
  const [roles, setRoles] = useState<RoleDefinition[]>(() => {
    const savedRoles = localStorage.getItem(ROLES_KEY);
    return savedRoles ? JSON.parse(savedRoles) : DEFAULT_ROLES;
  });

  const [users, setUsers] = useState<User[]>(() => {
    const savedUsers = localStorage.getItem(USERS_KEY);
    return savedUsers ? JSON.parse(savedUsers) : MOCK_USERS;
  });

  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem(TRANSACTIONS_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  const [cashMovements, setCashMovements] = useState<CashMovement[]>(() => {
    const saved = localStorage.getItem(CASH_MOVEMENTS_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  const [customers, setCustomers] = useState<Customer[]>(() => {
    const saved = localStorage.getItem(CUSTOMERS_KEY);
    return saved ? JSON.parse(saved) : MOCK_CUSTOMERS;
  });

  // --- SUPPLY CHAIN STATE ---
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => {
    const saved = localStorage.getItem(SUPPLIERS_KEY);
    return saved ? JSON.parse(saved) : [
      { id: 's1', name: 'Distribuidora Central', contactName: 'Pedro', phone: '555-0101' },
      { id: 's2', name: 'Importadora Global', contactName: 'Laura', phone: '555-0202' }
    ];
  });

  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(() => {
    const saved = localStorage.getItem(PO_KEY);
    return saved ? JSON.parse(saved) : [];
  });

  // Products State - Initialized based on Config Vertical if possible, else default
  const [products, setProducts] = useState(() => {
     if (config) {
        return config.vertical === VerticalType.RESTAURANT ? FOOD_PRODUCTS : RETAIL_PRODUCTS;
     }
     return RETAIL_PRODUCTS; 
  });

  // Ensure products match vertical when config changes
  useEffect(() => {
    if (config) {
      const correctProducts = config.vertical === VerticalType.RESTAURANT ? FOOD_PRODUCTS : RETAIL_PRODUCTS;
      // Simple check to see if we need to switch (comparing first item ID prefix)
      const currentIsRetail = products.length > 0 && products[0].id.startsWith('r');
      const shouldBeRetail = config.vertical === VerticalType.RETAIL;
      
      if (currentIsRetail !== shouldBeRetail) {
         setProducts(correctProducts);
      }
    }
  }, [config?.vertical]);

  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const [view, setView] = useState<ViewState | 'WIZARD'>(() => {
    if (!config) return 'SETUP';
    return 'LOGIN'; 
  });

  // Handlers
  const handleVerticalSelect = (selectedConfig: BusinessConfig) => {
    setConfig(selectedConfig);
    setView('WIZARD');
  };

  const handleWizardComplete = (finalConfig: BusinessConfig) => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(finalConfig));
    setConfig(finalConfig);
    // Reset products based on new config
    setProducts(finalConfig.vertical === VerticalType.RESTAURANT ? FOOD_PRODUCTS : RETAIL_PRODUCTS);
    setView('LOGIN');
  };

  const handleUpdateConfig = (newConfig: BusinessConfig, shouldRestart: boolean = false) => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(newConfig));
    setConfig(newConfig);
    if (shouldRestart) {
      // Also reset products if vertical changed
      setProducts(newConfig.vertical === VerticalType.RESTAURANT ? FOOD_PRODUCTS : RETAIL_PRODUCTS);
      setCurrentUser(null);
      setView('LOGIN');
    }
  };

  const handleUpdateUsers = (newUsers: User[]) => {
    localStorage.setItem(USERS_KEY, JSON.stringify(newUsers));
    setUsers(newUsers);
  };

  const handleUpdateRoles = (newRoles: RoleDefinition[]) => {
    localStorage.setItem(ROLES_KEY, JSON.stringify(newRoles));
    setRoles(newRoles);
  };

  const handleTransactionComplete = (newTransaction: Transaction) => {
    const updatedTransactions = [...transactions, newTransaction];
    setTransactions(updatedTransactions);
    localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(updatedTransactions));
    
    // Deduct Stock
    setProducts(prev => prev.map(p => {
       const soldItem = newTransaction.items.find(i => i.id === p.id);
       if (soldItem && p.trackStock) {
          return { ...p, stock: (p.stock || 0) - soldItem.quantity };
       }
       return p;
    }));
  };

  const handleRefundTransaction = (originalTx: Transaction, refundedItems: CartItem[], reason: string) => {
    const isFullRefund = refundedItems.length === originalTx.items.length;
    const updatedOriginal = { 
      ...originalTx, 
      status: isFullRefund ? 'REFUNDED' : 'PARTIAL_REFUND' 
    } as Transaction;

    const refundTotal = refundedItems.reduce((acc, item) => acc + (item.price * item.quantity), 0) * (1 + (config?.taxRate || 0));
    
    const refundTx: Transaction = {
      id: `REF-${Math.random().toString(36).substr(2, 6)}`,
      date: new Date().toISOString(),
      items: refundedItems,
      total: -refundTotal,
      payments: [{ id: `pay_${Date.now()}`, method: 'CASH', amount: -refundTotal, timestamp: new Date() }],
      userId: currentUser?.id || 'system',
      userName: currentUser?.name || 'System',
      customerId: originalTx.customerId,
      customerName: originalTx.customerName,
      status: 'REFUNDED',
      refundReason: reason
    };

    const updatedTransactions = transactions.map(t => t.id === originalTx.id ? updatedOriginal : t).concat(refundTx);
    setTransactions(updatedTransactions);
    localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(updatedTransactions));

    // Return Stock
    setProducts(prev => prev.map(p => {
       const returnedItem = refundedItems.find(i => i.id === p.id);
       if (returnedItem && p.trackStock) {
          return { ...p, stock: (p.stock || 0) + returnedItem.quantity };
       }
       return p;
    }));
  };

  // Register Petty Cash Movement
  const handleRegisterCashMovement = (type: 'IN' | 'OUT', amount: number, reason: string) => {
    const newMovement: CashMovement = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      amount,
      reason,
      timestamp: new Date().toISOString(),
      userId: currentUser?.id || 'system',
      userName: currentUser?.name || 'System'
    };
    const updated = [...cashMovements, newMovement];
    setCashMovements(updated);
    localStorage.setItem(CASH_MOVEMENTS_KEY, JSON.stringify(updated));
  };

  const handleAddCustomer = (newCustomer: Customer) => {
    const updated = [...customers, newCustomer];
    setCustomers(updated);
    localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(updated));
  };

  const handleUpdateCustomer = (updatedCustomer: Customer) => {
    const updated = customers.map(c => c.id === updatedCustomer.id ? updatedCustomer : c);
    setCustomers(updated);
    localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(updated));
  };

  const handleDeleteCustomer = (customerId: string) => {
    const updated = customers.filter(c => c.id !== customerId);
    setCustomers(updated);
    localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(updated));
  };

  // --- SUPPLY CHAIN HANDLERS ---
  const handleCreatePO = (order: PurchaseOrder) => {
     const updated = [...purchaseOrders, order];
     setPurchaseOrders(updated);
     localStorage.setItem(PO_KEY, JSON.stringify(updated));
  };

  const handleUpdatePO = (order: PurchaseOrder) => {
     const updated = purchaseOrders.map(po => po.id === order.id ? order : po);
     setPurchaseOrders(updated);
     localStorage.setItem(PO_KEY, JSON.stringify(updated));
  };

  const handleReceiveStock = (itemsReceived: PurchaseOrderItem[]) => {
     setProducts(prev => prev.map(p => {
        const receivedItem = itemsReceived.find(i => i.productId === p.id);
        if (receivedItem && receivedItem.quantityReceived > 0) {
           return { ...p, stock: (p.stock || 0) + receivedItem.quantityReceived };
        }
        return p;
     }));
  };

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    setView('POS');
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setView('LOGIN');
  };

  // Z-Report Logic
  const handleZReportConfirm = (cashCounted: number, notes: string) => {
    console.log("Z-Report Closed", { cashCounted, notes, total: transactions.length });
    alert("Caja cerrada exitosamente. El sistema volverá al inicio.");
    setTransactions([]); 
    setCashMovements([]); 
    localStorage.removeItem(TRANSACTIONS_KEY);
    localStorage.removeItem(CASH_MOVEMENTS_KEY);
    setCurrentUser(null);
    setView('LOGIN');
  };

  // --- VIEW ROUTING ---

  if (view === 'SETUP') return <VerticalSelector onSelect={handleVerticalSelect} />;
  if (view === 'WIZARD' && config) return <SetupWizard initialConfig={config} onComplete={handleWizardComplete} />;
  
  if (view === 'LOGIN') {
    if (!config) { setView('SETUP'); return null; }
    return <LoginScreen onLogin={handleLogin} subVertical={config.subVertical} availableUsers={users} />;
  }

  if (view === 'SETTINGS' && currentUser && config) {
    return (
      <Settings 
        config={config} 
        users={users}
        roles={roles}
        transactions={transactions}
        onUpdateConfig={handleUpdateConfig} 
        onUpdateUsers={handleUpdateUsers}
        onUpdateRoles={handleUpdateRoles}
        onOpenZReport={() => setView('FINANCE')} 
        onOpenSupplyChain={() => setView('SUPPLY_CHAIN')}
        onClose={() => setView('POS')} 
      />
    );
  }

  if (view === 'CUSTOMERS' && currentUser && config) {
    return (
      <CustomerManagement 
        customers={customers}
        config={config}
        onAddCustomer={handleAddCustomer}
        onUpdateCustomer={handleUpdateCustomer}
        onDeleteCustomer={handleDeleteCustomer}
        onClose={() => setView('POS')}
      />
    );
  }

  if (view === 'HISTORY' && currentUser && config) {
    return (
      <TicketHistory 
        transactions={transactions}
        config={config}
        onClose={() => setView('POS')}
        onRefundTransaction={handleRefundTransaction}
      />
    );
  }

  if (view === 'FINANCE' && currentUser && config) {
    return (
      <FinanceDashboard 
        transactions={transactions}
        cashMovements={cashMovements}
        config={config}
        onClose={() => setView('POS')}
        onRegisterMovement={handleRegisterCashMovement}
        onOpenZReport={() => setView('Z_REPORT')}
      />
    );
  }

  if (view === 'SUPPLY_CHAIN' && currentUser && config) {
     return (
        <SupplyChainManager 
           products={products}
           suppliers={suppliers}
           purchaseOrders={purchaseOrders}
           config={config}
           onClose={() => setView('SETTINGS')} 
           onCreateOrder={handleCreatePO}
           onUpdateOrder={handleUpdatePO}
           onReceiveStock={handleReceiveStock}
        />
     );
  }

  if (view === 'Z_REPORT' && currentUser && config) {
    return (
      <ZReportDashboard 
        transactions={transactions}
        cashMovements={cashMovements}
        config={config}
        userName={currentUser.name}
        onClose={() => setView('FINANCE')} 
        onConfirmClose={handleZReportConfirm}
      />
    );
  }

  if (view === 'POS' && currentUser && config) {
    return (
      <POSInterface 
        config={config} 
        currentUser={currentUser}
        roles={roles}
        customers={customers}
        products={products} // Passed to POS to ensure stock sync
        onLogout={handleLogout} 
        onOpenSettings={() => setView('SETTINGS')}
        onOpenCustomers={() => setView('CUSTOMERS')}
        onOpenHistory={() => setView('HISTORY')} 
        onOpenFinance={() => setView('FINANCE')} 
        onOpenSupplyChain={() => setView('SUPPLY_CHAIN')}
        onTransactionComplete={handleTransactionComplete}
        onAddCustomer={handleAddCustomer}
      />
    );
  }

  return <div className="p-4 flex items-center justify-center h-screen bg-gray-50 text-gray-400">Cargando sistema...</div>;
};

export default App;