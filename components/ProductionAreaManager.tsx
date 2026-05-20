import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Save, Printer, Monitor, Layers, Server, AlertCircle, ChefHat, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { BusinessConfig } from '../types';
import { db } from '../utils/db';
import { getKdsTerminalTargets, resolveKdsBaseUrl } from '../utils/kdsRouting';

interface ProductionArea {
    id: string;
    nombre: string;
    modo_salida: 'KDS' | 'PRINTER' | 'AMBOS';
    kds_delivery_mode?: 'LAN' | 'WEB';
    target_terminal_id?: string;
    kds_host?: string;
    kds_port?: string;
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
    const [testingKdsAreaId, setTestingKdsAreaId] = useState<string | null>(null);
    const [kdsTestResults, setKdsTestResults] = useState<Record<string, { ok: boolean; message: string; baseUrl?: string }>>({});
    const kdsTerminals = getKdsTerminalTargets(config, terminals);

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
            modo_salida: 'KDS',
            kds_delivery_mode: 'LAN',
            kds_port: '8001'
        };
        setAreas([...areas, newArea]);
    };

    const handleUpdateArea = (id: string, updates: Partial<ProductionArea>) => {
        setAreas(areas.map(a => a.id === id ? { ...a, ...updates } : a));
    };

    const handleSelectKdsTerminal = (area: ProductionArea, targetId: string) => {
        const target = kdsTerminals.find((candidate) => candidate.id === targetId);
        handleUpdateArea(area.id, {
            kds_delivery_mode: 'LAN',
            target_terminal_id: targetId || undefined,
            kds_host: target?.host || area.kds_host,
            kds_port: target?.port || area.kds_port || '8001',
        });
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
                nombre: area.nombre?.trim() || 'Nueva Área',
                kds_delivery_mode: area.kds_delivery_mode === 'WEB' ? 'WEB' : 'LAN',
                target_terminal_id: area.target_terminal_id?.trim() || undefined,
                kds_host: area.kds_host?.trim() || undefined,
                kds_port: String(area.kds_port || '').trim() || '8001',
                printer_ip: area.printer_ip?.trim() || undefined
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

    const handleTestKdsConnection = async (area: ProductionArea) => {
        const normalizedArea: ProductionArea = {
            ...area,
            kds_delivery_mode: area.kds_delivery_mode === 'WEB' ? 'WEB' : 'LAN',
            target_terminal_id: area.target_terminal_id?.trim() || undefined,
            kds_host: area.kds_host?.trim() || undefined,
            kds_port: String(area.kds_port || '').trim() || '8001',
        };
        const baseUrl = resolveKdsBaseUrl(normalizedArea, config, terminals);

        if (!baseUrl) {
            setKdsTestResults(prev => ({
                ...prev,
                [area.id]: {
                    ok: false,
                    message: 'Configura la IP/Host o selecciona una terminal KDS con IP LAN.',
                }
            }));
            return;
        }

        setTestingKdsAreaId(area.id);
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 4000);

        try {
            const response = await fetch(`${baseUrl}/api/cocina/ordenes-activas`, {
                method: 'GET',
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            setKdsTestResults(prev => ({
                ...prev,
                [area.id]: {
                    ok: true,
                    baseUrl,
                    message: 'Conexión KDS exitosa. El POS puede alcanzar esta pantalla.',
                }
            }));
        } catch (error: any) {
            const message = error?.name === 'AbortError'
                ? 'Tiempo agotado. Verifica que el KDS esté encendido, en la misma red y con el puerto abierto.'
                : `No se pudo conectar al KDS (${error?.message || 'error de red'}).`;
            setKdsTestResults(prev => ({
                ...prev,
                [area.id]: {
                    ok: false,
                    baseUrl,
                    message,
                }
            }));
        } finally {
            window.clearTimeout(timeoutId);
            setTestingKdsAreaId(null);
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
                                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2 block">Ruta del KDS</label>
                                    <div className="mb-3 grid grid-cols-2 gap-2">
                                        {[
                                            { id: 'LAN', label: 'IP / LAN', helper: 'Equipo local' },
                                            { id: 'WEB', label: 'Web URL', helper: 'Ruta http/https' },
                                        ].map(mode => (
                                            <button
                                                key={mode.id}
                                                type="button"
                                                onClick={() => handleUpdateArea(area.id, {
                                                    kds_delivery_mode: mode.id as 'LAN' | 'WEB',
                                                    target_terminal_id: mode.id === 'WEB' ? undefined : area.target_terminal_id,
                                                    kds_port: mode.id === 'WEB' ? area.kds_port : (area.kds_port || '8001'),
                                                })}
                                                className={`rounded-2xl border-2 px-3 py-3 text-left transition-all ${((area.kds_delivery_mode || 'LAN') === mode.id)
                                                    ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-inner'
                                                    : 'border-slate-100 bg-white text-slate-500 hover:border-slate-200'}`}
                                            >
                                                <span className="block text-xs font-black uppercase">{mode.label}</span>
                                                <span className="block text-[10px] font-bold opacity-70">{mode.helper}</span>
                                            </button>
                                        ))}
                                    </div>
                                    {(area.kds_delivery_mode || 'LAN') !== 'WEB' && (
                                        <>
                                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">Pantalla Destino (Terminal)</label>
                                    <select
                                        value={area.target_terminal_id || ''}
                                        onChange={(e) => handleSelectKdsTerminal(area, e.target.value)}
                                        className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:border-blue-500 outline-none"
                                    >
                                        <option value="">Manual por IP / sin terminal ERP</option>
                                        {kdsTerminals.map(t => (
                                            <option key={t.id} value={t.id}>
                                                {t.label}{t.host ? ` (${t.host}:${t.port || '8001'})` : ' (sin IP reportada)'}
                                            </option>
                                        ))}
                                    </select>
                                    {kdsTerminals.length === 0 && (
                                        <p className="mt-2 text-[11px] font-bold text-amber-600">
                                            No llegó ninguna terminal con rol KDS desde ERP. Puedes usar el modo manual colocando la IP/Host del equipo KDS.
                                        </p>
                                    )}
                                    {area.target_terminal_id && !area.kds_host && (
                                        <p className="mt-2 text-[11px] font-bold text-amber-600">
                                            La terminal KDS seleccionada no reportó IP LAN. Escribe la IP/Host manualmente para poder enviar comandas.
                                        </p>
                                    )}
                                        </>
                                    )}
                                    <div className={`mt-3 grid gap-2 ${(area.kds_delivery_mode || 'LAN') === 'WEB' ? 'grid-cols-1' : 'grid-cols-[1fr_6rem]'}`}>
                                        <div>
                                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">
                                                {(area.kds_delivery_mode || 'LAN') === 'WEB' ? 'URL Web del KDS' : 'IP / Host del KDS'}
                                            </label>
                                            <input
                                                type="text"
                                                value={area.kds_host || ''}
                                                onChange={(e) => handleUpdateArea(area.id, { kds_host: e.target.value })}
                                                className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-3 text-sm font-black text-slate-700 focus:border-blue-500 outline-none"
                                                placeholder={(area.kds_delivery_mode || 'LAN') === 'WEB' ? 'Ej: https://kds.mercasend.net' : 'Ej: 192.168.1.50'}
                                            />
                                        </div>
                                        {(area.kds_delivery_mode || 'LAN') !== 'WEB' && (
                                            <div>
                                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">Puerto</label>
                                            <input
                                                type="text"
                                                inputMode="numeric"
                                                value={area.kds_port || '8001'}
                                                onChange={(e) => handleUpdateArea(area.id, { kds_port: e.target.value })}
                                                className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl px-3 py-3 text-sm font-black text-slate-700 focus:border-blue-500 outline-none"
                                                placeholder="8001"
                                            />
                                            </div>
                                        )}
                                    </div>
                                    <p className="mt-2 text-[10px] font-bold leading-relaxed text-slate-400">
                                        {(area.kds_delivery_mode || 'LAN') === 'WEB'
                                            ? 'Usa una URL http/https cuando el KDS está publicado por web o túnel seguro.'
                                            : 'La terminal ERP identifica la pantalla; la IP/Host es la ruta LAN para enviar la comanda a ese equipo.'}
                                    </p>
                                    <div className="mt-3 flex flex-col gap-2">
                                        <button
                                            type="button"
                                            onClick={() => handleTestKdsConnection(area)}
                                            disabled={testingKdsAreaId === area.id}
                                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-blue-100 bg-blue-50 px-4 py-3 text-xs font-black uppercase tracking-wide text-blue-700 transition-all hover:border-blue-200 hover:bg-blue-100 active:scale-[0.98] disabled:opacity-60"
                                        >
                                            <RefreshCw size={15} className={testingKdsAreaId === area.id ? 'animate-spin' : ''} />
                                            {testingKdsAreaId === area.id ? 'Probando KDS...' : 'Probar conexión KDS'}
                                        </button>
                                        {kdsTestResults[area.id] && (
                                            <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] font-bold leading-relaxed ${kdsTestResults[area.id].ok ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-red-100 bg-red-50 text-red-700'}`}>
                                                {kdsTestResults[area.id].ok ? <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> : <XCircle size={15} className="mt-0.5 shrink-0" />}
                                                <span>
                                                    {kdsTestResults[area.id].message}
                                                    {kdsTestResults[area.id].baseUrl && (
                                                        <span className="block text-[10px] opacity-80">{kdsTestResults[area.id].baseUrl}</span>
                                                    )}
                                                </span>
                                            </div>
                                        )}
                                    </div>
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
