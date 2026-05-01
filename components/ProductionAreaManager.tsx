import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Save, Printer, Monitor, Layers, Server, AlertCircle, ChefHat } from 'lucide-react';
import { BusinessConfig, DeviceRole } from '../types';
import { db } from '../utils/db';
import { resolveDeviceRoleValue } from '../utils/deviceRoleHelpers';

interface ProductionArea {
    id: string;
    nombre: string;
    modo_salida: 'KDS' | 'PRINTER' | 'AMBOS';
    target_terminal_id?: string;
    printer_ip?: string;
}

interface ProductionAreaManagerProps {
    terminals: any[];
    config: BusinessConfig;
    onUpdateConfig: (config: BusinessConfig, restart?: boolean) => void;
}

const ProductionAreaManager: React.FC<ProductionAreaManagerProps> = ({ terminals, config, onUpdateConfig }) => {
    const [areas, setAreas] = useState<ProductionArea[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [kitchenEnabled, setKitchenEnabled] = useState(false);
    const kdsTerminals = terminals.filter((terminal) => {
        const terminalConfig = terminal?.config || {};
        const role = resolveDeviceRoleValue([
            terminalConfig.deviceRole,
            terminalConfig.deviceRole?.role,
            terminalConfig.device_role,
            terminalConfig.device_role_code,
            terminalConfig.role_code,
            terminalConfig.role,
            terminalConfig.erpBinding?.role,
            terminal?.deviceRole,
            terminal?.device_role,
            terminal?.role_code,
            terminal?.device_role_code,
            terminal?.role,
        ]);
        return role === DeviceRole.KITCHEN_DISPLAY;
    });

    useEffect(() => {
        fetchAreas();
        fetchConfig();
    }, []);

    const resolveLocalConfig = async (): Promise<BusinessConfig> => {
        const rawConfig = await db.get('config' as any) as BusinessConfig | BusinessConfig[];
        const configDoc = Array.isArray(rawConfig)
            ? (rawConfig.find((c: any) => c.id === 'current') || rawConfig[0])
            : rawConfig;
        return configDoc?.operational ? configDoc : config;
    };

    const fetchConfig = async () => {
        try {
            const configDoc = await resolveLocalConfig();
            setKitchenEnabled(Boolean(configDoc?.operational?.usa_modulos_cocina ?? config?.operational?.usa_modulos_cocina));
        } catch (e) {
            console.error("Failed to fetch operational config", e);
            setKitchenEnabled(Boolean(config?.operational?.usa_modulos_cocina));
        }
    };

    const toggleKitchen = async (val: boolean) => {
        setKitchenEnabled(val);
        try {
            const configDoc = await resolveLocalConfig();
            if (!configDoc) return;
            const nextOperational = {
                vertical_negocio: configDoc.vertical,
                usa_mesas: false,
                pantalla_inicio: 'VENTA_DIRECTA' as const,
                bloqueo_meseros: false,
                pedir_comensales: false,
                ...configDoc.operational,
                usa_modulos_cocina: val
            };
            const nextConfig: BusinessConfig = {
                ...configDoc,
                operational: nextOperational
            };
            await db.save('config' as any, nextConfig);
            onUpdateConfig(nextConfig);
        } catch (e) {
            console.error("Failed to update kitchen module status", e);
            setKitchenEnabled(!val); // Revert on failure
        }
    };

    const fetchAreas = async () => {
        try {
            const localAreas = await db.get('productionAreas' as any) as ProductionArea[] || [];
            setAreas(Array.isArray(localAreas) ? localAreas : []);
        } catch (e) {
            console.error("Failed to fetch production areas", e);
        } finally {
            setLoading(false);
        }
    };

    const handleAddArea = () => {
        const newArea: ProductionArea = {
            id: `pa_${Date.now()}`,
            nombre: 'Nueva Área',
            modo_salida: 'KDS'
        };
        setAreas([...areas, newArea]);
    };

    const handleUpdateArea = (id: string, updates: Partial<ProductionArea>) => {
        setAreas(areas.map(a => a.id === id ? { ...a, ...updates } : a));
    };

    const handleDeleteArea = (id: string) => {
        if (confirm("¿Está seguro de eliminar esta área de producción?")) {
            const nextAreas = areas.filter(a => a.id !== id);
            setAreas(nextAreas);
            db.save('productionAreas' as any, nextAreas).catch((error) => {
                console.error("Failed to delete production area", error);
                alert("Error al eliminar área");
            });
        }
    };

    const handleSave = async (area: ProductionArea) => {
        setSaving(true);
        try {
            const normalizedArea: ProductionArea = {
                ...area,
                nombre: area.nombre?.trim() || 'Nueva Área'
            };
            const nextAreas = areas.some(existing => existing.id === normalizedArea.id)
                ? areas.map(existing => existing.id === normalizedArea.id ? normalizedArea : existing)
                : [...areas, normalizedArea];
            setAreas(nextAreas);
            await db.save('productionAreas' as any, nextAreas);
            alert("Área guardada correctamente");
        } catch (e) {
            console.error("Failed to save production area", e);
            alert("Error al guardar área");
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="p-8 text-center text-slate-500 font-bold animate-pulse">Cargando Centros de Producción...</div>;

    return (
        <div className="p-6 max-w-5xl mx-auto animate-in fade-in duration-500">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h2 className="text-2xl font-black text-slate-800">Centros de Producción</h2>
                    <p className="text-sm text-slate-400 font-medium">Configura dónde se preparan tus productos (Cocina, Barra, Hornos, etc.)</p>
                </div>
                <button
                    onClick={handleAddArea}
                    className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-black text-sm hover:scale-105 active:scale-95 transition-all flex items-center gap-2 shadow-xl shadow-slate-200"
                >
                    <Plus size={18} />
                    NUEVA ÁREA
                </button>
            </div>

            <div className="mb-8 bg-white rounded-[2rem] p-6 shadow-sm border border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-2xl ${kitchenEnabled ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-400'}`}>
                        <ChefHat size={24} />
                    </div>
                    <div>
                        <h3 className="font-black text-slate-800">Módulo de Cocina y Producción</h3>
                        <p className="text-xs text-slate-400 font-medium">Activa o desactiva el sistema de ruteo de comandas globalmente.</p>
                    </div>
                </div>
                <button
                    onClick={() => toggleKitchen(!kitchenEnabled)}
                    className={`relative inline-flex h-8 w-14 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${kitchenEnabled ? 'bg-orange-600' : 'bg-slate-200'}`}
                >
                    <span
                        aria-hidden="true"
                        className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${kitchenEnabled ? 'translate-x-6' : 'translate-x-0'}`}
                    />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {areas.length === 0 ? (
                    <div className="col-span-full py-12 bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400">
                        <Layers size={48} className="mb-4 opacity-20" />
                        <p className="font-bold">No hay áreas de producción configuradas.</p>
                        <p className="text-xs">Usa el botón superior para crear la primera.</p>
                    </div>
                ) : areas.map(area => (
                    <div key={area.id} className="bg-white rounded-[2rem] shadow-xl border border-slate-100 p-6 hover:shadow-2xl transition-all group overflow-hidden relative">
                        {/* Status Accent */}
                        <div className={`absolute top-0 left-0 w-2 h-full ${area.modo_salida === 'KDS' ? 'bg-blue-500' : area.modo_salida === 'PRINTER' ? 'bg-emerald-500' : 'bg-purple-500'}`} />

                        <div className="flex justify-between items-start mb-6 pl-2">
                            <div className="flex-1">
                                <input
                                    type="text"
                                    value={area.nombre}
                                    onChange={(e) => handleUpdateArea(area.id, { nombre: e.target.value })}
                                    className="text-lg font-black text-slate-800 bg-transparent border-b-2 border-transparent focus:border-blue-500 outline-none w-full"
                                    placeholder="Nombre del Área"
                                />
                            </div>
                            <button
                                onClick={() => handleDeleteArea(area.id)}
                                className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>

                        <div className="space-y-4 pl-2">
                            {/* Mode Selection */}
                            <div>
                                <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2 block">Modo de Notificación</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { id: 'KDS', label: 'Monitor', icon: Monitor, color: 'text-blue-600', bg: 'bg-blue-50' },
                                        { id: 'PRINTER', label: 'Ticket', icon: Printer, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                                        { id: 'AMBOS', label: 'Ambos', icon: Layers, color: 'text-purple-600', bg: 'bg-purple-50' }
                                    ].map(mode => (
                                        <button
                                            key={mode.id}
                                            onClick={() => handleUpdateArea(area.id, { modo_salida: mode.id as any })}
                                            className={`flex flex-col items-center justify-center py-3 rounded-2xl border-2 transition-all ${area.modo_salida === mode.id ? `${mode.bg} border-current ${mode.color} scale-95 font-bold shadow-inner` : 'border-slate-50 text-slate-400 hover:border-slate-100'}`}
                                        >
                                            <mode.icon size={18} className="mb-1" />
                                            <span className="text-[10px] uppercase font-black">{mode.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Conditional Settings */}
                            {(area.modo_salida === 'KDS' || area.modo_salida === 'AMBOS') && (
                                <div className="animate-in slide-in-from-left-2">
                                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">Pantalla Destino (Terminal)</label>
                                    <select
                                        value={area.target_terminal_id || ''}
                                        onChange={(e) => handleUpdateArea(area.id, { target_terminal_id: e.target.value })}
                                        className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:border-blue-500 outline-none"
                                    >
                                        <option value="">Seleccionar terminal...</option>
                                        {kdsTerminals.length === 0 && (
                                            <option value="" disabled>No hay pantallas KDS configuradas</option>
                                        )}
                                        {kdsTerminals.map(t => (
                                            <option key={t.id} value={t.id}>{t.config?.terminalName || t.name || t.nombre || t.id} (KDS)</option>
                                        ))}
                                    </select>
                                    {kdsTerminals.length === 0 && (
                                        <p className="mt-2 text-[11px] font-bold text-amber-600">
                                            Configura una terminal como Pantalla de Cocina en ERP y sincroniza la configuración.
                                        </p>
                                    )}
                                </div>
                            )}

                            {(area.modo_salida === 'PRINTER' || area.modo_salida === 'AMBOS') && (
                                <div className="animate-in slide-in-from-left-2">
                                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">IP de Impresora</label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={area.printer_ip || ''}
                                            onChange={(e) => handleUpdateArea(area.id, { printer_ip: e.target.value })}
                                            className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-3 text-sm font-black text-slate-700 focus:border-emerald-500 outline-none pl-10"
                                            placeholder="Ej: 192.168.1.100"
                                        />
                                        <Server size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="mt-8 flex justify-end">
                            <button
                                onClick={() => handleSave(area)}
                                disabled={saving}
                                className="bg-slate-900 text-white px-6 py-2 rounded-xl font-black text-xs hover:bg-black active:scale-95 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
                            >
                                <Save size={14} />
                                {saving ? 'GUARDANDO...' : 'GUARDAR CAMBIOS'}
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-12 bg-blue-50 border-2 border-blue-100 rounded-3xl p-6 flex gap-4">
                <AlertCircle className="text-blue-500 shrink-0" size={24} />
                <div>
                    <h4 className="text-blue-800 font-black text-sm uppercase">Recordatorio Operativo</h4>
                    <p className="text-blue-600 text-xs font-medium leading-relaxed">
                        Una vez configuradas las áreas, recuerda asignar a cada producto su destino correspondiente desde el editor de catálogo. Los productos sin área asignada se ignorarán en las comandas de cocina.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default ProductionAreaManager;
