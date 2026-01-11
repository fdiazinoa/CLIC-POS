import React, { useState } from 'react';
import { 
  ArrowLeft, Users, UserPlus, Search, Phone, Mail, MapPin, 
  Edit2, Trash2, Save, X, FileText, Award, Wallet, 
  TrendingUp, TrendingDown, AlertCircle, CreditCard, History, Check 
} from 'lucide-react';
import { Customer, BusinessConfig, CustomerTransaction } from '../types';

interface CustomerManagementProps {
  customers: Customer[];
  config: BusinessConfig;
  onAddCustomer: (customer: Customer) => void;
  onUpdateCustomer: (customer: Customer) => void;
  onDeleteCustomer: (id: string) => void;
  onClose: () => void;
}

const CustomerManagement: React.FC<CustomerManagementProps> = ({ 
  customers, 
  config, 
  onAddCustomer, 
  onUpdateCustomer, 
  onDeleteCustomer, 
  onClose 
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'INFO' | 'CREDIT'>('INFO');
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  
  // Form State
  const [formData, setFormData] = useState<Partial<Customer>>({
    name: '',
    phone: '',
    email: '',
    taxId: '',
    address: '',
    notes: '',
    loyaltyPoints: 0,
    creditLimit: 0,
    currentDebt: 0,
    creditHistory: []
  });

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.phone?.includes(searchTerm) || 
    c.taxId?.includes(searchTerm)
  );

  const handleCreateClick = () => {
    setEditingCustomer(null);
    setActiveTab('INFO');
    setFormData({
      name: '',
      phone: '',
      email: '',
      taxId: '',
      address: '',
      notes: '',
      loyaltyPoints: 0,
      creditLimit: 0,
      currentDebt: 0,
      creditHistory: []
    });
    setIsModalOpen(true);
  };

  const handleEditClick = (customer: Customer) => {
    setEditingCustomer(customer);
    setActiveTab('INFO');
    setFormData({
       ...customer,
       creditHistory: customer.creditHistory || generateMockHistory() // Mock history if empty for demo
    });
    setIsModalOpen(true);
  };

  // Mock generator for UI demonstration
  const generateMockHistory = (): CustomerTransaction[] => [
    { id: 't1', date: new Date(Date.now() - 86400000 * 2).toISOString(), type: 'SALE', amount: 150.50, description: 'Compra #1024' },
    { id: 't2', date: new Date(Date.now() - 86400000 * 5).toISOString(), type: 'PAYMENT', amount: 50.00, description: 'Abono en Efectivo' },
    { id: 't3', date: new Date(Date.now() - 86400000 * 10).toISOString(), type: 'SALE', amount: 80.00, description: 'Compra #998' },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;

    if (editingCustomer) {
      onUpdateCustomer({ ...editingCustomer, ...formData } as Customer);
    } else {
      const newCustomer: Customer = {
        id: Math.random().toString(36).substr(2, 9),
        createdAt: new Date().toISOString(),
        name: formData.name!,
        phone: formData.phone,
        email: formData.email,
        taxId: formData.taxId,
        address: formData.address,
        notes: formData.notes,
        loyaltyPoints: formData.loyaltyPoints || 0,
        creditLimit: formData.creditLimit || 0,
        currentDebt: formData.currentDebt || 0,
        creditHistory: formData.creditHistory || []
      };
      onAddCustomer(newCustomer);
    }
    setIsModalOpen(false);
  };

  const handlePayDebt = () => {
     // In a real app, this would open the PaymentModal passing the debt amount.
     // Here we simulate a full payment.
     if(!confirm(`¿Registrar pago total de ${config.currencySymbol}${formData.currentDebt?.toFixed(2)}?`)) return;
     
     const payment: CustomerTransaction = {
        id: Math.random().toString(36).substr(2,9),
        date: new Date().toISOString(),
        type: 'PAYMENT',
        amount: formData.currentDebt || 0,
        description: 'Pago de Saldo Pendiente'
     };

     setFormData(prev => ({
        ...prev,
        currentDebt: 0,
        creditHistory: [payment, ...(prev.creditHistory || [])]
     }));
  };

  const themeClasses = {
    blue: 'bg-blue-600 hover:bg-blue-700 text-white',
    orange: 'bg-orange-600 hover:bg-orange-700 text-white',
    gray: 'bg-gray-800 hover:bg-gray-900 text-white',
  }[config.themeColor] || 'bg-indigo-600 hover:bg-indigo-700 text-white';

  const themeText = {
    blue: 'text-blue-600',
    orange: 'text-orange-600',
    gray: 'text-gray-800',
  }[config.themeColor] || 'text-indigo-600';

  // Calculations for Credit Tab
  const limit = formData.creditLimit || 0;
  const debt = formData.currentDebt || 0;
  const available = Math.max(0, limit - debt);
  const usagePercent = limit > 0 ? (debt / limit) * 100 : 0;
  const circleRadius = 40;
  const circleCircumference = 2 * Math.PI * circleRadius;
  const strokeDashoffset = circleCircumference - (usagePercent / 100) * circleCircumference;

  return (
    <div className="h-screen w-full bg-gray-50 flex flex-col overflow-hidden relative">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 p-4 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-600 transition-colors">
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Users size={20} className="text-blue-500" />
            Gestión de Clientes
          </h1>
        </div>
        <button 
          onClick={handleCreateClick}
          className={`px-4 py-2 rounded-lg font-medium shadow-sm flex items-center gap-2 ${themeClasses}`}
        >
          <UserPlus size={18} />
          <span>Nuevo Cliente</span>
        </button>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex flex-col p-4 md:p-6 max-w-7xl mx-auto w-full">
        
        {/* Search Bar */}
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mb-6 flex items-center gap-3">
           <Search className="text-gray-400" size={20} />
           <input 
             type="text" 
             placeholder="Buscar por nombre, teléfono o RNC..." 
             className="flex-1 outline-none text-gray-700 placeholder-gray-400"
             value={searchTerm}
             onChange={(e) => setSearchTerm(e.target.value)}
           />
           {searchTerm && (
             <button onClick={() => setSearchTerm('')} className="text-gray-400 hover:text-gray-600">
               <X size={16} />
             </button>
           )}
        </div>

        {/* Customer List */}
        <div className="flex-1 overflow-y-auto bg-white rounded-xl border border-gray-200 shadow-sm">
           {filteredCustomers.length === 0 ? (
             <div className="h-full flex flex-col items-center justify-center text-gray-400 p-8">
                <Users size={64} className="mb-4 opacity-20" />
                <p className="text-lg font-medium">No se encontraron clientes</p>
                <p className="text-sm">Intenta otra búsqueda o agrega uno nuevo.</p>
             </div>
           ) : (
             <div className="divide-y divide-gray-100">
                {filteredCustomers.map(customer => (
                  <div key={customer.id} className="p-4 hover:bg-gray-50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
                     <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                           <h3 className="font-bold text-gray-800 text-lg">{customer.name}</h3>
                           {customer.taxId && (
                             <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-mono border border-gray-200">
                               {customer.taxId}
                             </span>
                           )}
                           {(customer.currentDebt || 0) > 0 && (
                              <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded font-bold flex items-center gap-1">
                                 <Wallet size={10} /> Deudor
                              </span>
                           )}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                           {customer.phone && (
                             <div className="flex items-center gap-1">
                               <Phone size={14} /> {customer.phone}
                             </div>
                           )}
                           {customer.email && (
                             <div className="flex items-center gap-1">
                               <Mail size={14} /> {customer.email}
                             </div>
                           )}
                        </div>
                     </div>

                     <div className="flex items-center gap-4 self-end md:self-center">
                        <div className="text-center px-4 border-l border-gray-100 hidden sm:block">
                           <span className="block text-xs text-gray-400 uppercase font-bold">Crédito</span>
                           <div className={`flex items-center justify-center gap-1 font-bold ${(customer.currentDebt || 0) > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                              {config.currencySymbol}{customer.currentDebt?.toFixed(2) || '0.00'}
                           </div>
                        </div>
                        <div className="flex gap-2">
                           <button 
                             onClick={() => handleEditClick(customer)} 
                             className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-100"
                           >
                              <Edit2 size={18} />
                           </button>
                           <button 
                             onClick={() => {
                               if (confirm('¿Eliminar cliente?')) onDeleteCustomer(customer.id);
                             }}
                             className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
                           >
                              <Trash2 size={18} />
                           </button>
                        </div>
                     </div>
                  </div>
                ))}
             </div>
           )}
        </div>
      </div>

      {/* Create/Edit Modal with TABS */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col h-[90vh]">
            
            {/* Modal Header */}
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-white z-10">
               <div>
                  <h3 className="font-black text-xl text-gray-800">{editingCustomer ? 'Perfil de Cliente' : 'Nuevo Cliente'}</h3>
                  <p className="text-xs text-gray-400">{editingCustomer?.id ? `ID: ${editingCustomer.id}` : 'Registro'}</p>
               </div>
               <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-100 rounded-full">
                 <X size={24} />
               </button>
            </div>

            {/* Modal Tabs */}
            <div className="flex px-6 border-b border-gray-100 bg-gray-50/50">
               <button 
                  onClick={() => setActiveTab('INFO')}
                  className={`py-4 px-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors ${
                     activeTab === 'INFO' ? `border-blue-500 text-blue-600` : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
               >
                  <FileText size={18} /> Datos Personales
               </button>
               <button 
                  onClick={() => setActiveTab('CREDIT')}
                  className={`py-4 px-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors ${
                     activeTab === 'CREDIT' ? `border-orange-500 text-orange-600` : 'border-transparent text-gray-400 hover:text-gray-600'
                  }`}
               >
                  <Wallet size={18} /> Billetera & Crédito
               </button>
            </div>
            
            <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col">
              <div className="flex-1 overflow-y-auto p-6 bg-white">
                 
                 {/* --- TAB: INFO --- */}
                 {activeTab === 'INFO' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in slide-in-from-left-4 duration-300">
                       <div className="md:col-span-2">
                          <label className="block text-sm font-bold text-gray-600 mb-1">Nombre Completo *</label>
                          <input 
                            required
                            type="text" 
                            value={formData.name}
                            onChange={e => setFormData({...formData, name: e.target.value})}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                            placeholder="Ej. Juan Pérez"
                          />
                       </div>

                       <div>
                          <label className="block text-sm font-bold text-gray-600 mb-1">Teléfono</label>
                          <input 
                            type="tel" 
                            value={formData.phone}
                            onChange={e => setFormData({...formData, phone: e.target.value})}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="809-555-0000"
                          />
                       </div>

                       <div>
                          <label className="block text-sm font-bold text-gray-600 mb-1">Email</label>
                          <input 
                            type="email" 
                            value={formData.email}
                            onChange={e => setFormData({...formData, email: e.target.value})}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="cliente@email.com"
                          />
                       </div>

                       <div>
                          <label className="block text-sm font-bold text-gray-600 mb-1">RNC / Cédula</label>
                          <input 
                            type="text" 
                            value={formData.taxId}
                            onChange={e => setFormData({...formData, taxId: e.target.value})}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="000-0000000-0"
                          />
                       </div>

                       <div>
                          <label className="block text-sm font-bold text-gray-600 mb-1">Puntos Fidelidad</label>
                          <div className="relative">
                             <input 
                               type="number" 
                               value={formData.loyaltyPoints}
                               onChange={e => setFormData({...formData, loyaltyPoints: parseInt(e.target.value) || 0})}
                               className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none pl-10"
                             />
                             <Award className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-500" size={18} />
                          </div>
                       </div>

                       <div className="md:col-span-2">
                          <label className="block text-sm font-bold text-gray-600 mb-1">Dirección</label>
                          <input 
                            type="text" 
                            value={formData.address}
                            onChange={e => setFormData({...formData, address: e.target.value})}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="Dirección de facturación"
                          />
                       </div>

                       <div className="md:col-span-2">
                          <label className="block text-sm font-bold text-gray-600 mb-1">Notas Internas</label>
                          <textarea 
                            value={formData.notes}
                            onChange={e => setFormData({...formData, notes: e.target.value})}
                            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                            rows={3}
                            placeholder="Preferencias del cliente..."
                          />
                       </div>
                    </div>
                 )}

                 {/* --- TAB: CREDIT / WALLET --- */}
                 {activeTab === 'CREDIT' && (
                    <div className="h-full flex flex-col md:flex-row gap-6 animate-in slide-in-from-right-4 duration-300">
                       
                       {/* LEFT: Debt Visualization */}
                       <div className="w-full md:w-1/3 flex flex-col gap-4">
                          <div className="bg-white rounded-2xl shadow-lg shadow-gray-100 border border-gray-100 p-6 flex flex-col items-center relative overflow-hidden">
                             <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-400 to-red-500"></div>
                             
                             <h4 className="text-gray-500 font-bold uppercase text-xs tracking-wider mb-4">Estado de Cuenta</h4>
                             
                             {/* Donut Chart */}
                             <div className="relative w-48 h-48 flex items-center justify-center mb-4">
                                <svg className="transform -rotate-90 w-full h-full">
                                   <circle
                                      cx="50%" cy="50%" r={circleRadius}
                                      stroke="#f3f4f6" strokeWidth="8" fill="transparent"
                                   />
                                   <circle
                                      cx="50%" cy="50%" r={circleRadius}
                                      stroke={usagePercent > 90 ? '#ef4444' : '#f97316'}
                                      strokeWidth="8" fill="transparent"
                                      strokeDasharray={circleCircumference}
                                      strokeDashoffset={strokeDashoffset}
                                      strokeLinecap="round"
                                      className="transition-all duration-1000 ease-out"
                                   />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                   <span className="text-xs text-gray-400 font-bold">Deuda Actual</span>
                                   <span className={`text-2xl font-black ${debt > 0 ? 'text-red-600' : 'text-emerald-500'}`}>
                                      {config.currencySymbol}{debt.toFixed(2)}
                                   </span>
                                </div>
                             </div>

                             <div className="w-full space-y-3">
                                <div className="flex justify-between text-sm">
                                   <span className="text-gray-500">Crédito Disponible</span>
                                   <span className="font-bold text-gray-700">{config.currencySymbol}{available.toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                   <span className="text-gray-500">Límite Total</span>
                                   <span className="font-bold text-gray-700">{config.currencySymbol}{limit.toFixed(2)}</span>
                                </div>
                             </div>

                             <button 
                               type="button"
                               onClick={handlePayDebt}
                               disabled={debt <= 0}
                               className="mt-6 w-full py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                             >
                                <CreditCard size={18} /> Saldar Deuda
                             </button>
                          </div>

                          {/* Limit Setting */}
                          <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
                             <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Ajustar Límite de Crédito</label>
                             <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">{config.currencySymbol}</span>
                                <input 
                                   type="number" 
                                   value={formData.creditLimit}
                                   onChange={e => setFormData({...formData, creditLimit: parseFloat(e.target.value) || 0})}
                                   className="w-full pl-8 p-3 bg-white border border-gray-200 rounded-xl font-bold text-gray-800 focus:border-orange-400 outline-none"
                                />
                             </div>
                          </div>
                       </div>

                       {/* RIGHT: Transaction History */}
                       <div className="flex-1 bg-white rounded-2xl border border-gray-200 flex flex-col overflow-hidden">
                          <div className="p-4 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
                             <History size={18} className="text-gray-400" />
                             <h4 className="font-bold text-gray-700">Historial de Movimientos</h4>
                          </div>
                          <div className="flex-1 overflow-y-auto p-0">
                             {(!formData.creditHistory || formData.creditHistory.length === 0) ? (
                                <div className="h-full flex flex-col items-center justify-center text-gray-400 p-8">
                                   <FileText size={48} className="mb-2 opacity-20" />
                                   <p className="text-sm">Sin movimientos registrados</p>
                                </div>
                             ) : (
                                <table className="w-full text-left text-sm">
                                   <thead className="bg-white sticky top-0 z-10 shadow-sm">
                                      <tr>
                                         <th className="p-3 text-xs text-gray-400 uppercase font-bold">Fecha</th>
                                         <th className="p-3 text-xs text-gray-400 uppercase font-bold">Descripción</th>
                                         <th className="p-3 text-xs text-gray-400 uppercase font-bold text-right">Monto</th>
                                      </tr>
                                   </thead>
                                   <tbody className="divide-y divide-gray-50">
                                      {formData.creditHistory.map((tx) => (
                                         <tr key={tx.id} className="hover:bg-gray-50/50">
                                            <td className="p-3 text-gray-500 font-mono text-xs">
                                               {new Date(tx.date).toLocaleDateString()}
                                            </td>
                                            <td className="p-3 font-medium text-gray-700 flex items-center gap-2">
                                               {tx.type === 'SALE' ? (
                                                  <div className="p-1 bg-red-50 text-red-500 rounded"><TrendingUp size={12} /></div>
                                               ) : (
                                                  <div className="p-1 bg-green-50 text-green-500 rounded"><TrendingDown size={12} /></div>
                                               )}
                                               {tx.description}
                                            </td>
                                            <td className={`p-3 text-right font-bold ${tx.type === 'SALE' ? 'text-red-600' : 'text-green-600'}`}>
                                               {tx.type === 'SALE' ? '-' : '+'}{config.currencySymbol}{tx.amount.toFixed(2)}
                                            </td>
                                         </tr>
                                      ))}
                                   </tbody>
                                </table>
                             )}
                          </div>
                       </div>
                    </div>
                 )}

              </div>

              {/* Modal Footer */}
              <div className="p-5 border-t border-gray-100 bg-white flex justify-end gap-3 z-10">
                 <button 
                   type="button"
                   onClick={() => setIsModalOpen(false)} 
                   className="px-6 py-3 text-gray-600 hover:bg-gray-100 rounded-xl font-bold transition-colors"
                 >
                   Cancelar
                 </button>
                 <button 
                   type="submit"
                   className={`px-8 py-3 rounded-xl font-bold shadow-lg transition-transform active:scale-95 flex items-center gap-2 ${themeClasses}`}
                 >
                   <Save size={18} />
                   Guardar Cambios
                 </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerManagement;