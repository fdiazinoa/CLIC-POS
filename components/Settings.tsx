
import React, { useState } from 'react';
import {
  Settings as SettingsIcon, X, CreditCard, Receipt,
  Monitor, Users, Truck, ShieldCheck, FileText,
  Globe, Database, Activity, Mail, Coins,
  Cpu, HardDrive, Smartphone, Cloud, Lock, Package, Building2,
  Printer, ArrowRightLeft, ShieldAlert, ListChecks, History, Tag, Percent
} from 'lucide-react';
import { BusinessConfig, User, RoleDefinition, Transaction, Product, Warehouse, StockTransfer } from '../types';

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
import AuditLogViewer from './AuditLogViewer';
import TeamHub from './TeamHub';
import PaymentSettings from './PaymentSettings';
import DocumentSettings from './DocumentSettings';
import PromotionBuilder from './PromotionBuilder';
import { ImportWizard } from './ImportWizard/ImportWizard';

interface SettingsProps {
  config: BusinessConfig;
  users: User[];
  roles: RoleDefinition[];
  transactions: Transaction[];
  products: Product[];
  warehouses: Warehouse[];
  transfers?: StockTransfer[];
  onUpdateTransfers?: (transfers: StockTransfer[]) => void;
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

type SettingsView = 'HOME' | 'CATALOG' | 'WAREHOUSES' | 'PAYMENTS' | 'RECEIPT' | 'TERMINALS' | 'TEAM' | 'HARDWARE' | 'SECURITY' | 'LOGS' | 'EXCHANGE' | 'EMAIL' | 'TIPS' | 'DOCUMENTS' | 'PROMOTIONS' | 'IMPORT_EXPORT';

const Settings: React.FC<SettingsProps> = (props) => {
  const [currentView, setCurrentView] = useState<SettingsView>('HOME');

  const renderContent = () => {
    switch (currentView) {
      // ... (existing cases)
      case 'IMPORT_EXPORT':
        return (
          <ImportWizard
            config={props.config}
            products={props.products}
            customers={props.users.map(u => ({ ...u, creditLimit: 0, currentDebt: 0, points: 0 } as any))} // Hack: users are not customers. We need customers prop in Settings.
            suppliers={[]} // Hack: suppliers not in Settings props yet
            warehouses={props.warehouses}
            onClose={() => setCurrentView('HOME')}
            onUpdateConfig={props.onUpdateConfig}
            onUpdateProducts={async (p) => props.onUpdateProducts(p)}
            onUpdateCustomers={async (c) => { /* Implement customer update in App.tsx first */ }}
            onUpdateSuppliers={async (s) => { /* Implement supplier update */ }}
            onUpdateWarehouses={async (w) => props.onUpdateWarehouses(w)}
          />
        );

      case 'CATALOG':
        return (
          <CatalogManager
            products={props.products}
            config={props.config}
            warehouses={props.warehouses}
            transactions={props.transactions}
            onUpdateProducts={props.onUpdateProducts}
            onUpdateConfig={props.onUpdateConfig}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'WAREHOUSES':
        return (
          <WarehouseManager
            warehouses={props.warehouses}
            products={props.products}
            transfers={props.transfers || []}
            config={props.config}
            onUpdateWarehouses={props.onUpdateWarehouses}
            onUpdateProducts={props.onUpdateProducts}
            onUpdateTransfers={props.onUpdateTransfers || (() => { })}
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

      case 'EXCHANGE':
        return (
          <CurrencySettings
            config={props.config}
            onUpdateConfig={props.onUpdateConfig}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'DOCUMENTS':
        return (
          <DocumentSettings
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'TERMINALS':
        return (
          <TerminalSettings
            config={props.config}
            onUpdateConfig={props.onUpdateConfig}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'HARDWARE':
        return (
          <HardwareSettings
            config={props.config}
            products={props.products}
            onUpdateConfig={props.onUpdateConfig}
            onClose={() => setCurrentView('HOME')}
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
          <EmailSettings
            config={props.config}
            onUpdateConfig={props.onUpdateConfig}
            onClose={() => setCurrentView('HOME')}
          />
        );

      case 'SECURITY':
        return (
          <DataSecurityHub
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

            <div className="space-y-12">
              <section>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-2">Inventario y Catálogo</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <SettingsCard icon={Package} label="Artículos y Tarifas" description="Catálogo, Precios, Variantes" color="bg-blue-600" onClick={() => setCurrentView('CATALOG')} />
                  <SettingsCard icon={Building2} label="Almacenes" description="Ubicaciones, Traspasos, Stock" color="bg-purple-600" onClick={() => setCurrentView('WAREHOUSES')} />
                  <SettingsCard icon={Database} label="Importar / Exportar" description="Carga Masiva de Datos" color="bg-cyan-600" onClick={() => setCurrentView('IMPORT_EXPORT')} />
                  <SettingsCard icon={Truck} label="Proveedores" description="Compras y Abastecimiento" color="bg-emerald-500" onClick={props.onOpenSupplyChain} />
                </div>
              </section>

              <section>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-2">Finanzas y Legal</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <SettingsCard icon={CreditCard} label="Métodos de Pago" description="Pasarelas, Tarjetas, QR" color="bg-indigo-500" onClick={() => setCurrentView('PAYMENTS')} />
                  <SettingsCard icon={ArrowRightLeft} label="Divisas y Cambio" description="Multi-moneda y Tasas" color="bg-teal-500" onClick={() => setCurrentView('EXCHANGE')} />
                  <SettingsCard icon={Lock} label="Cierre de Caja" description="Corte Z y Auditoría Fiscal" color="bg-slate-900" onClick={props.onOpenZReport} />
                  <SettingsCard icon={FileText} label="Documentos" description="Series, NCF, Prefijos" color="bg-blue-400" onClick={() => setCurrentView('DOCUMENTS')} />
                </div>
              </section>

              <section>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-2">Configuración Local</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <SettingsCard icon={Monitor} label="Terminales POS" description="Perfiles de Caja, Inventario" color="bg-blue-500" onClick={() => setCurrentView('TERMINALS')} />
                  <SettingsCard icon={Printer} label="Hardware" description="Impresoras, Balanzas, VFD" color="bg-gray-700" onClick={() => setCurrentView('HARDWARE')} />
                  <SettingsCard icon={Coins} label="Propinas" description="Cargos por Servicio y Tips" color="bg-yellow-500" onClick={() => setCurrentView('TIPS')} />
                </div>
              </section>

              <section>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-2">Equipo y Marketing</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <SettingsCard icon={Users} label="Equipo y Roles" description="Usuarios, Turnos, Permisos" color="bg-pink-500" onClick={() => setCurrentView('TEAM')} />
                  <SettingsCard icon={Percent} label="Promociones" description="Descuentos, 2x1 y Temporadas" color="bg-rose-500" onClick={() => setCurrentView('PROMOTIONS')} />
                  <SettingsCard icon={Receipt} label="Diseño de Ticket" description="Logo, Cabecera y Pie" color="bg-rose-600" onClick={() => setCurrentView('RECEIPT')} />
                  <SettingsCard icon={Mail} label="E-mail" description="Factura Digital" color="bg-sky-500" onClick={() => setCurrentView('EMAIL')} />
                </div>
              </section>

              <section>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 border-b border-slate-100 pb-2">Sistema y Auditoría</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <SettingsCard icon={ShieldAlert} label="Seguridad y Datos" description="Backups y Modo Kiosco" color="bg-red-600" onClick={() => setCurrentView('SECURITY')} />
                  <SettingsCard icon={History} label="Traza de Auditoría" description="Logs de Operaciones" color="bg-orange-500" onClick={() => setCurrentView('LOGS')} />
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
