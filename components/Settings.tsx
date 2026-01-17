
import React, { useState } from 'react';
import { 
  Settings as SettingsIcon, X, CreditCard, Receipt, 
  Monitor, Users, Truck, ShieldCheck, FileText, 
  Globe, Database, Activity, Mail, Coins, 
  Cpu, HardDrive, Smartphone, Cloud, Lock, Package, Building2,
  Printer, ArrowRightLeft, ShieldAlert, ListChecks, History, Tag, Percent
} from 'lucide-react';
import { BusinessConfig, User, RoleDefinition, Transaction, Product, Warehouse } from '../types';

// Component Imports
import WarehouseManager from './WarehouseManager';
import CatalogManager from './CatalogManager';
import TerminalSettings from './TerminalSettings';
import HardwareSettings from './HardwareSettings';
import CurrencySettings from './CurrencySettings';
import ReceiptDesigner from './ReceiptDesigner';
import EmailSettings from './EmailSettings';
import TipsSettings from './TipsSettings';
import DataSecurityHub from './DataSecurityHub';
import ActivityLog from './ActivityLog';
import TeamHub from './TeamHub';
import PaymentSettings from './PaymentSettings';
import DocumentSettings from './DocumentSettings';
import PromotionBuilder from './PromotionBuilder';

interface SettingsProps {
  config: BusinessConfig;
  users: User[];
  roles: RoleDefinition[];
  transactions: Transaction[];
  products: Product[];
  warehouses: Warehouse[];
  onUpdateConfig: (newConfig: BusinessConfig, restart?: boolean) => void;
  onUpdateUsers: (users: User[]) => void;
  onUpdateRoles: (roles: RoleDefinition[]) => void;
  onUpdateProducts: (products: Product[]) => void;
  onUpdateWarehouses: (warehouses: Warehouse[]) => void;
  onOpenZReport: () => void;
  onOpenSupplyChain: () => void;
  onOpenFranchise: () => void;
  onClose: () => void;
}

type SettingsView = 'HOME' | 'CATALOG' | 'WAREHOUSES' | 'PAYMENTS' | 'RECEIPT' | 'TERMINALS' | 'TEAM' | 'HARDWARE' | 'SECURITY' | 'LOGS' | 'EXCHANGE' | 'EMAIL' | 'TIPS' | 'DOCUMENTS' | 'PROMOTIONS';

const Settings: React.FC<SettingsProps> = (props) => {
  const [currentView, setCurrentView] = useState<SettingsView>('HOME');

  const renderContent = () => {
    switch (currentView) {
      case 'WAREHOUSES':
        return <WarehouseManager warehouses={props.warehouses} products={props.products} onUpdateWarehouses={props.onUpdateWarehouses} onClose={() => setCurrentView('HOME')} />;
      case 'CATALOG':
        return <CatalogManager products={props.products} warehouses={props.warehouses} config={props.config} transactions={props.transactions} onUpdateProducts={props.onUpdateProducts} onUpdateConfig={props.onUpdateConfig} onClose={() => setCurrentView('HOME')} />;
      case 'TERMINALS':
        return <TerminalSettings config={props.config} warehouses={props.warehouses} onUpdateConfig={props.onUpdateConfig} onClose={() => setCurrentView('HOME')} />;
      case 'HARDWARE':
        return <HardwareSettings />; 
      case 'EXCHANGE':
        return <CurrencySettings config={props.config} onUpdateConfig={props.onUpdateConfig} onClose={() => setCurrentView('HOME')} />;
      case 'PAYMENTS':
        return <PaymentSettings config={props.config} onUpdateConfig={props.onUpdateConfig} onClose={() => setCurrentView('HOME')} />;
      case 'RECEIPT':
        return (
          <div className="p-8 h-full flex flex-col overflow-hidden">
             <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-black text-slate-800">Diseño de Comprobantes</h2>
                <button onClick={() => setCurrentView('HOME')} className="text-sm font-bold text-blue-600">Volver</button>
             </div>
             <div className="flex-1 overflow-hidden">
                <ReceiptDesigner config={props.config} onUpdateConfig={props.onUpdateConfig} />
             </div>
          </div>
        );
      case 'EMAIL':
        return <EmailSettings config={props.config} onUpdateConfig={props.onUpdateConfig} onClose={() => setCurrentView('HOME')} />;
      case 'TIPS':
        return <TipsSettings config={props.config} onUpdateConfig={props.onUpdateConfig} onClose={() => setCurrentView('HOME')} />;
      case 'SECURITY':
        return (
          <div className="p-8 h-full overflow-y-auto">
             <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-black text-slate-800">Seguridad y Respaldo</h2>
                <button onClick={() => setCurrentView('HOME')} className="text-sm font-bold text-blue-600">Volver</button>
             </div>
             <DataSecurityHub onClose={() => setCurrentView('HOME')} />
          </div>
        );
      case 'LOGS':
        return <ActivityLog onClose={() => setCurrentView('HOME')} />;
      case 'TEAM':
        return <TeamHub users={props.users} roles={props.roles} onUpdateUsers={props.onUpdateUsers} onUpdateRoles={props.onUpdateRoles} onClose={() => setCurrentView('HOME')} />;
      case 'DOCUMENTS':
        return <DocumentSettings onClose={() => setCurrentView('HOME')} />;
      case 'PROMOTIONS':
        return <PromotionBuilder products={props.products} config={props.config} onClose={() => setCurrentView('HOME')} />;
      
      default:
        return (
          <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto w-full animate-in fade-in">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h1 className="text-3xl font-black text-gray-800">Configuración</h1>
                <p className="text-gray-500 mt-1">Administra todos los aspectos de tu negocio.</p>
              </div>
              <button onClick={props.onClose} className="p-3 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">
                <X size={24} className="text-gray-600" />
              </button>
            </div>

            {/* SECTIONS GRID */}
            <div className="space-y-12">
               
               {/* 1. PRODUCTOS Y LOGÍSTICA */}
               <section>
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-2">Inventario y Catálogo</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <SettingsCard 
                      icon={Package} label="Artículos y Tarifas" description="Catálogo, Precios, Variantes" color="bg-blue-600"
                      onClick={() => setCurrentView('CATALOG')} 
                    />
                    <SettingsCard 
                      icon={Building2} label="Almacenes" description="Ubicaciones, Traspasos, Stock" color="bg-purple-600"
                      onClick={() => setCurrentView('WAREHOUSES')} 
                    />
                    <SettingsCard 
                      icon={Truck} label="Proveedores" description="Compras y Abastecimiento" color="bg-emerald-500" 
                      onClick={props.onOpenSupplyChain} 
                    />
                  </div>
               </section>

               {/* 2. FINANZAS Y FACTURACIÓN */}
               <section>
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-2">Finanzas y Legal</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <SettingsCard 
                      icon={CreditCard} label="Métodos de Pago" description="Pasarelas, Tarjetas, QR" color="bg-indigo-500" 
                      onClick={() => setCurrentView('PAYMENTS')} 
                    />
                    <SettingsCard 
                      icon={ArrowRightLeft} label="Divisas y Cambio" description="Multi-moneda y Tasas" color="bg-teal-500" 
                      onClick={() => setCurrentView('EXCHANGE')} 
                    />
                    <SettingsCard 
                      icon={Lock} label="Cierre de Caja" description="Corte Z y Auditoría Fiscal" color="bg-slate-900" 
                      onClick={props.onOpenZReport} 
                    />
                    <SettingsCard 
                      icon={FileText} label="Documentos" description="Series, NCF, Prefijos" color="bg-blue-400" 
                      onClick={() => setCurrentView('DOCUMENTS')} 
                    />
                  </div>
               </section>

               {/* 3. TERMINALES Y HARDWARE */}
               <section>
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-2">Configuración Local</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <SettingsCard 
                      icon={Monitor} label="Terminales POS" description="Perfiles de Caja, Inventario" color="bg-blue-500" 
                      onClick={() => setCurrentView('TERMINALS')} 
                    />
                    <SettingsCard 
                      icon={Printer} label="Hardware" description="Impresoras, Balanzas, VFD" color="bg-gray-700" 
                      onClick={() => setCurrentView('HARDWARE')} 
                    />
                    <SettingsCard 
                      icon={Coins} label="Propinas" description="Cargos por Servicio y Tips" color="bg-yellow-500" 
                      onClick={() => setCurrentView('TIPS')} 
                    />
                  </div>
               </section>

               {/* 4. EQUIPO Y COMUNICACIÓN */}
               <section>
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-2">Equipo y Marketing</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <SettingsCard 
                      icon={Users} label="Equipo y Roles" description="Usuarios, Turnos, Permisos" color="bg-pink-500" 
                      onClick={() => setCurrentView('TEAM')} 
                    />
                    <SettingsCard 
                      icon={Percent} label="Promociones" description="Descuentos, 2x1 y Temporadas" color="bg-rose-500" 
                      onClick={() => setCurrentView('PROMOTIONS')} 
                    />
                    <SettingsCard 
                      icon={Receipt} label="Diseño de Ticket" description="Logo, Cabecera y Pie" color="bg-rose-600" 
                      onClick={() => setCurrentView('RECEIPT')} 
                    />
                    <SettingsCard 
                      icon={Mail} label="E-mail" description="Factura Digital" color="bg-sky-500" 
                      onClick={() => setCurrentView('EMAIL')} 
                    />
                  </div>
               </section>

               {/* 5. SEGURIDAD Y DATOS */}
               <section>
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-2">Sistema y Auditoría</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <SettingsCard 
                      icon={ShieldAlert} label="Seguridad y Datos" description="Backups y Modo Kiosco" color="bg-red-600" 
                      onClick={() => setCurrentView('SECURITY')} 
                    />
                    <SettingsCard 
                      icon={History} label="Traza de Auditoría" description="Logs de Operaciones" color="bg-orange-500" 
                      onClick={() => setCurrentView('LOGS')} 
                    />
                  </div>
               </section>

            </div>
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col overflow-hidden">
      {renderContent()}
    </div>
  );
};

const SettingsCard: React.FC<{ icon: any; label: string; description: string; color: string; onClick: () => void }> = ({ icon: Icon, label, description, color, onClick }) => (
  <button onClick={onClick} className="flex flex-col items-start p-6 bg-white rounded-3xl shadow-sm border border-slate-100 hover:shadow-xl hover:border-blue-200 hover:-translate-y-1 transition-all text-left group active:scale-95 h-full">
    <div className={`p-4 rounded-2xl text-white mb-5 shadow-lg transition-transform group-hover:scale-110 ${color}`}>
      <Icon size={26} strokeWidth={2.5} />
    </div>
    <h3 className="font-bold text-lg text-slate-800 group-hover:text-blue-600 transition-colors leading-tight mb-1">{label}</h3>
    <p className="text-sm text-slate-400 leading-snug">{description}</p>
  </button>
);

export default Settings;
