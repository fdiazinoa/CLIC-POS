
import React from 'react';
import {
    Building2, LayoutGrid, ShieldCheck,
    Monitor, Utensils, ShoppingBag,
    Lock, Users, Info, Sparkles, CalendarDays, Percent, Landmark
} from 'lucide-react';

interface SettingsOperationalProps {
    config: any; // activeTerminal.config
    onUpdate: (section: string, key: string, value: any) => void;
    isReadOnly?: boolean;
}

const Toggle = ({ label, description, checked, onChange, icon: Icon, disabled }: any) => (
    <div className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${checked ? 'bg-indigo-50/50 border-indigo-200' : 'bg-white border-gray-100'} ${disabled ? 'opacity-60 grayscale' : 'hover:border-indigo-300'}`}>
        <div className="flex items-start gap-4 flex-1">
            <div className={`p-3 rounded-xl ${checked ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                {Icon && <Icon size={20} />}
            </div>
            <div className="space-y-1">
                <p className="text-sm font-black text-gray-800 tracking-tight">{label}</p>
                <p className="text-[11px] text-gray-500 leading-tight pr-4">{description}</p>
            </div>
        </div>
        <button
            onClick={() => !disabled && onChange(!checked)}
            disabled={disabled}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${checked ? 'bg-indigo-600' : 'bg-gray-200'}`}
        >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
    </div>
);

const SettingsOperational: React.FC<SettingsOperationalProps> = ({ config, onUpdate, isReadOnly }) => {
    const operational = config.operational || {
        vertical_negocio: 'RETAIL',
        usa_mesas: false,
        pantalla_inicio: 'VENTA_DIRECTA',
        bloqueo_meseros: false,
        pedir_comensales: true,
        reservationPolicy: {
            validityDays: 7,
            requireAdvance: false,
            minimumAdvancePercent: 20
        },
        expandTicket: false
    };

    const reservationPolicy = operational.reservationPolicy || {
        validityDays: 7,
        requireAdvance: false,
        minimumAdvancePercent: 20
    };

    const handleToggle = (key: string, val: boolean) => {
        onUpdate('operational', key, val);
    };

    const handleReservationPolicyChange = (key: 'validityDays' | 'requireAdvance' | 'minimumAdvancePercent', value: number | boolean) => {
        const nextPolicy = {
            ...reservationPolicy,
            [key]: value
        };
        onUpdate('operational', 'reservationPolicy', nextPolicy);
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header / Intro */}
            <div className="bg-gradient-to-br from-indigo-600 to-purple-700 p-8 rounded-[2.5rem] text-white shadow-xl relative overflow-hidden">
                <div className="relative z-10">
                    <h2 className="text-2xl font-black mb-2 flex items-center gap-3">
                        <Building2 size={32} />
                        Modo Operativo Multi-Vertical
                    </h2>
                    <p className="text-indigo-100 text-sm max-w-xl leading-relaxed">
                        Configura el comportamiento fundamental de esta terminal. Cambia entre Retail y Restaurante para activar módulos específicos y flujos de trabajo optimizados.
                    </p>
                </div>
                <Sparkles className="absolute right-[-20px] bottom-[-20px] text-white/10 w-48 h-48" />
            </div>

            {/* Section: Business Mode */}
            <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center">
                        <ShoppingBag size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-gray-800">Modelo de Negocio</h3>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Configuración Base</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                        onClick={() => onUpdate('operational', 'vertical_negocio', 'RETAIL')}
                        disabled={isReadOnly}
                        className={`p-6 rounded-[2rem] border-2 transition-all flex flex-col gap-4 text-left ${operational.vertical_negocio === 'RETAIL' ? 'bg-blue-50 border-blue-500 shadow-md ring-4 ring-blue-50' : 'bg-white border-gray-100 hover:border-blue-200'}`}
                    >
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${operational.vertical_negocio === 'RETAIL' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                            <ShoppingBag size={24} />
                        </div>
                        <div>
                            <p className="font-black text-gray-800">RETAIL (Comercio)</p>
                            <p className="text-xs text-gray-500 mt-1 leading-snug">Venta rápida, código de barras y atención directa en mostrador.</p>
                        </div>
                        {operational.vertical_negocio === 'RETAIL' && (
                            <div className="mt-auto pt-2">
                                <span className="bg-blue-600 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase">Activo</span>
                            </div>
                        )}
                    </button>

                    <button
                        onClick={() => onUpdate('operational', 'vertical_negocio', 'RESTAURANTE')}
                        disabled={isReadOnly}
                        className={`p-6 rounded-[2rem] border-2 transition-all flex flex-col gap-4 text-left ${operational.vertical_negocio === 'RESTAURANTE' ? 'bg-orange-50 border-orange-500 shadow-md ring-4 ring-orange-50' : 'bg-white border-gray-100 hover:border-orange-200'}`}
                    >
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${operational.vertical_negocio === 'RESTAURANTE' ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                            <Utensils size={24} />
                        </div>
                        <div>
                            <p className="font-black text-gray-800">RESTAURANTE (Hospitalidad)</p>
                            <p className="text-xs text-gray-500 mt-1 leading-snug">Gestión de mesas, comensales y seguimiento de órdenes pendientes.</p>
                        </div>
                        {operational.vertical_negocio === 'RESTAURANTE' && (
                            <div className="mt-auto pt-2">
                                <span className="bg-orange-600 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase">Activo</span>
                            </div>
                        )}
                    </button>
                </div>
            </div>

            {/* Section: Table Management */}
            <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center">
                        <LayoutGrid size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-gray-800">Gestión de Mesas</h3>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Flujo Operativo</p>
                    </div>
                </div>

                <div className="space-y-4">
                    <Toggle
                        label="Habilitar Mapa de Mesas"
                        description="Muestra el acceso al mapa de mesas en la barra de navegación del punto de venta."
                        checked={operational.usa_mesas}
                        onChange={(v: boolean) => handleToggle('usa_mesas', v)}
                        icon={LayoutGrid}
                        disabled={isReadOnly}
                    />

                    {operational.usa_mesas && (
                        <div className="pl-6 space-y-4 animate-in slide-in-from-left-4 duration-300">
                            <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 space-y-6">
                                <div>
                                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-4 ml-1">Pantalla de Inicio Recomendada</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            onClick={() => onUpdate('operational', 'pantalla_inicio', 'VENTA_DIRECTA')}
                                            disabled={isReadOnly}
                                            className={`p-4 rounded-2xl border-2 font-bold text-sm flex items-center gap-3 transition-all ${operational.pantalla_inicio === 'VENTA_DIRECTA' ? 'bg-white border-indigo-600 text-indigo-600 shadow-sm' : 'bg-white border-transparent text-gray-400 gray-50 hover:bg-white hover:border-gray-200'}`}
                                        >
                                            <ShoppingBag size={18} />
                                            Venta Directa
                                        </button>
                                        <button
                                            onClick={() => onUpdate('operational', 'pantalla_inicio', 'MAPA_MESAS')}
                                            disabled={isReadOnly}
                                            className={`p-4 rounded-2xl border-2 font-bold text-sm flex items-center gap-3 transition-all ${operational.pantalla_inicio === 'MAPA_MESAS' ? 'bg-white border-indigo-600 text-indigo-600 shadow-sm' : 'bg-white border-transparent text-gray-400 hover:bg-white hover:border-gray-200'}`}
                                        >
                                            <LayoutGrid size={18} />
                                            Mapa de Mesas
                                        </button>
                                    </div>
                                </div>

                                <Toggle
                                    label="Solicitar Comensales"
                                    description="Pedir el número de personas al abrir una nueva orden desde el mapa."
                                    checked={operational.pedir_comensales}
                                    onChange={(v: boolean) => handleToggle('pedir_comensales', v)}
                                    icon={Users}
                                    disabled={isReadOnly}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Section: UX & Visual Experience */}
            <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6 animate-in slide-in-from-bottom-8 duration-700">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center">
                        <Monitor size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-gray-800">Experiencia Visual</h3>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Interfaz y Diseño</p>
                    </div>
                </div>

                <div className="space-y-4">
                    <Toggle
                        label="Modo Supermercado (Grid Expandido)"
                        description="Oculta la barra de categorías y expande la cuadrícula de productos para maximizar el espacio de venta."
                        checked={config.ux?.viewMode === 'RETAIL'}
                        onChange={(v: boolean) => onUpdate('ux', 'viewMode', v ? 'RETAIL' : 'VISUAL')}
                        icon={LayoutGrid}
                        disabled={isReadOnly}
                    />

                    <Toggle
                        label="Ampliar Ticket (Vista de Alta Densidad)"
                        description="Al activar, el ticket ocupará todo el alto lateral y los botones de acción se moverán a una barra inferior."
                        checked={operational.expandTicket}
                        onChange={(v: boolean) => handleToggle('expandTicket', v)}
                        icon={LayoutGrid}
                        disabled={isReadOnly}
                    />

                    <Toggle
                        label="Iniciar en Modo Agenda"
                        description="Al iniciar la aplicación, ir directamente a la vista de Agenda en lugar del POS o Login."
                        checked={config.startWithAgenda || false}
                        onChange={(v: boolean) => onUpdate('', 'startWithAgenda', v)}
                        icon={CalendarDays}
                        disabled={isReadOnly}
                    />
                </div>
            </div>

            {/* Section: Operational Security */}
            <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center">
                        <Lock size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-gray-800">Seguridad Operativa</h3>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Control y Auditoría</p>
                    </div>
                </div>

                <div className="space-y-4">
                    <Toggle
                        label="Bloqueo de Meseros"
                        description="Restringir la edición de mesas para que solo el vendedor que la abrió pueda modificarla."
                        checked={operational.bloqueo_meseros}
                        onChange={(v: boolean) => handleToggle('bloqueo_meseros', v)}
                        icon={ShieldCheck}
                        disabled={isReadOnly}
                    />

                    <Toggle
                        label="Visualizar Ventas de otras Terminales"
                        description="Permite buscar y ver transacciones realizadas en cualquier caja para propósitos de devolución o auditoría."
                        checked={operational.showGlobalSales}
                        onChange={(v: boolean) => handleToggle('showGlobalSales', v)}
                        icon={Monitor}
                        disabled={isReadOnly}
                    />

                    <div className="flex items-start gap-4 p-4 rounded-2xl bg-amber-50 border border-amber-100">
                        <Info className="text-amber-500 mt-1 shrink-0" size={18} />
                        <p className="text-[11px] text-amber-700 leading-relaxed font-medium">
                            El bloqueo de meseros requiere un PIN de Supervisor en caso de que otro empleado necesite acceder a la mesa para cobro o asistencia.
                        </p>
                    </div>
                </div>
            </div>

            {/* Section: Reservation Policies */}
            <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center">
                        <CalendarDays size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-gray-800">Políticas de Reserva</h3>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Pre-Facturación y Hold</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-5 rounded-2xl border border-gray-100 bg-slate-50">
                        <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-3">
                            Días de Vigencia
                        </label>
                        <input
                            type="number"
                            min={1}
                            max={90}
                            disabled={isReadOnly}
                            value={reservationPolicy.validityDays}
                            onChange={(e) => handleReservationPolicyChange('validityDays', Math.max(1, parseInt(e.target.value, 10) || 7))}
                            className="w-full p-3 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-100"
                        />
                        <p className="text-[11px] text-slate-500 mt-2">
                            Define cuándo caduca una pre-factura de reserva.
                        </p>
                    </div>

                    <div className="p-5 rounded-2xl border border-gray-100 bg-slate-50 space-y-4">
                        <Toggle
                            label="Anticipo Obligatorio"
                            description="Exige un pago mínimo para confirmar la reserva."
                            checked={reservationPolicy.requireAdvance}
                            onChange={(v: boolean) => handleReservationPolicyChange('requireAdvance', v)}
                            icon={Percent}
                            disabled={isReadOnly}
                        />

                        <div>
                            <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-3">
                                Porcentaje Mínimo
                            </label>
                            <input
                                type="number"
                                min={0}
                                max={100}
                                disabled={isReadOnly || !reservationPolicy.requireAdvance}
                                value={reservationPolicy.minimumAdvancePercent}
                                onChange={(e) => handleReservationPolicyChange('minimumAdvancePercent', Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)))}
                                className="w-full p-3 rounded-xl border border-slate-200 bg-white text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
                            />
                            <p className="text-[11px] text-slate-500 mt-2">
                                Porcentaje mínimo de abono para validar la reserva.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Section: Fiscal Threshold */}
            <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm space-y-6">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center">
                        <Landmark size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-gray-800">Límites Fiscales</h3>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Control de Facturación</p>
                    </div>
                </div>

                <div className="p-5 rounded-2xl border border-gray-100 bg-slate-50">
                    <label className="block text-xs font-black text-slate-500 uppercase tracking-widest mb-3">
                        Umbral para Factura de Crédito Fiscal (B01)
                    </label>
                    <div className="relative">
                        <input
                            type="number"
                            min={0}
                            disabled={isReadOnly}
                            value={operational.fiscalThreshold || 0}
                            onChange={(e) => onUpdate('operational', 'fiscalThreshold', Math.max(0, parseFloat(e.target.value) || 0))}
                            className="w-full p-4 pl-12 bg-white border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-amber-100 transition-all"
                            placeholder="Ej: 50000"
                        />
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-lg">$</div>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
                        Si el monto de la factura excede este valor, el sistema forzará el uso de **Comprobante de Crédito Fiscal (B01)** y requerirá la asociación obligatoria de un cliente con RNC.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default SettingsOperational;
