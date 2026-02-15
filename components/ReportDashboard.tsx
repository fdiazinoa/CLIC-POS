import React from 'react';
import {
    X, BarChart3, TrendingUp, Users, FileText,
    History, PieChart, ShoppingBag, Truck,
    PackageSearch, Clock, Calculator, ShieldCheck, Zap
} from 'lucide-react';
import { BusinessConfig, AnalyticsCategory } from '../types';

interface ReportDashboardProps {
    onSelectCategory: (category: AnalyticsCategory) => void;
    onClose: () => void;
}

const ReportDashboard: React.FC<ReportDashboardProps> = ({ onSelectCategory, onClose }) => {
    const categories: { id: AnalyticsCategory; label: string; description: string; icon: any; color: string }[] = [
        {
            id: 'SOURCING',
            label: 'BI de Proveedores',
            description: 'Compras, Lead Times y Margen',
            icon: Truck,
            color: 'bg-emerald-600'
        },
        {
            id: 'INVENTORY',
            label: 'Inventario y Almacén',
            description: 'Snapshot, Rotación y Mermas',
            icon: PackageSearch,
            color: 'bg-blue-600'
        },
        {
            id: 'CUSTOMERS',
            label: 'Fidelización',
            description: 'Ranking, RFM y Créditos',
            icon: Users,
            color: 'bg-purple-600'
        },
        {
            id: 'FISCAL',
            label: 'Fiscalidad (DGII)',
            description: '607/608 e Impuestos',
            icon: FileText,
            color: 'bg-indigo-600'
        },
        {
            id: 'OPERATIONS',
            label: 'Operativa de Caja',
            description: 'Ventas por Hora y Cajeros',
            icon: Calculator,
            color: 'bg-orange-600'
        },
        {
            id: 'CATALOG',
            label: 'Inteligencia de Catálogo',
            description: 'Ranking ABC y Food Cost',
            icon: PieChart,
            color: 'bg-rose-600'
        },
        {
            id: 'HR',
            label: 'Asistencia y RRHH',
            description: 'Fichajes y Nómina',
            icon: Clock,
            color: 'bg-sky-600'
        }
    ];

    return (
        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto w-full animate-in fade-in">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-3xl font-black text-gray-800 flex items-center gap-3">
                        <BarChart3 className="text-blue-600" size={32} />
                        Informes y Analítica
                    </h1>
                    <p className="text-gray-500 mt-1">Inteligencia de negocio y reportes operativos.</p>
                </div>
                <button onClick={onClose} className="p-3 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">
                    <X size={24} className="text-gray-600" />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {categories.map((cat) => (
                    <button
                        key={cat.id}
                        onClick={() => onSelectCategory(cat.id)}
                        className="flex flex-col items-start p-6 bg-white rounded-3xl shadow-sm border border-slate-100 transition-all text-left group hover:shadow-xl hover:border-blue-200 hover:-translate-y-1 active:scale-95"
                    >
                        <div className={`p-4 rounded-2xl text-white mb-5 shadow-lg transition-transform group-hover:scale-110 ${cat.color}`}>
                            <cat.icon size={26} strokeWidth={2.5} />
                        </div>
                        <h3 className="font-bold text-lg text-slate-800 group-hover:text-blue-600 transition-colors leading-tight mb-1">{cat.label}</h3>
                        <p className="text-sm text-slate-400 leading-snug">{cat.description}</p>
                    </button>
                ))}
            </div>
        </div>
    );
};

export default ReportDashboard;
