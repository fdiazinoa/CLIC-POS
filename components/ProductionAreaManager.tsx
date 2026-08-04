import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Save, Printer, Monitor, Layers, Server, AlertCircle, RefreshCw, CheckCircle2, XCircle, Search, PackageCheck, PackageX } from 'lucide-react';
import { BusinessConfig, PrinterDevice, Product } from '../types';
import { db } from '../utils/db';
import { getKdsTerminalTargets, resolveKdsBaseUrl } from '../utils/kdsRouting';
import { normalizeRestaurantProductConfig, resolveRestaurantProductConfig } from '../utils/restaurantProductConfig';

interface ProductionArea {
    id: string;
    nombre: string;
    modo_salida: 'KDS' | 'PRINTER' | 'AMBOS';
    kds_delivery_mode?: 'LAN' | 'WEB';
    target_terminal_id?: string;
    target_terminal_name?: string;
    kds_host?: string;
    kds_port?: string;
    kds_warning_minutes?: number | string;
    kds_critical_minutes?: number | string;
    printer_id?: string;
    printer_ip?: string;
}

interface ProductionAreaManagerProps {
    terminals: any[];
    config: BusinessConfig;
    onUpdateConfig: (config: BusinessConfig, restart?: boolean) => void;
}

const ProductionAreaManager: React.FC<ProductionAreaManagerProps> = ({ terminals, config, onUpdateConfig }) => {
    const NO_CATEGORY_FILTER_VALUE = '__NO_CATEGORY__';
    const [areas, setAreas] = useState<ProductionArea[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [productSearch, setProductSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('');
    const [savingProductAreaId, setSavingProductAreaId] = useState<string | null>(null);
    const [testingKdsAreaId, setTestingKdsAreaId] = useState<string | null>(null);
    const [kdsTestResults, setKdsTestResults] = useState<Record<string, { ok: boolean; message: string; baseUrl?: string }>>({});
    const kdsTerminals = getKdsTerminalTargets(config, terminals);
    const kitchenPrinters = useMemo(
        () => (config.availablePrinters || [])
            .filter((printer): printer is PrinterDevice => Boolean(printer && printer.id))
            .filter(printer => printer.type === 'KITCHEN' || printer.type === 'TICKET'),
        [config.availablePrinters]
    );
    const printerById = useMemo(
        () => new Map((config.availablePrinters || []).map(printer => [printer.id, printer])),
        [config.availablePrinters]
    );

    useEffect(() => {
        fetchAreas();
        fetchProducts();

        // La sincronización LAN puede terminar mientras esta pantalla ya está
        // abierta. Refrescar el catálogo sin obligar al usuario a salir y entrar.
        const handleProductionAreasUpdated = () => { void fetchAreas(); };
        const handleProductsUpdated = () => { void fetchProducts(); };
        window.addEventListener('productionAreasUpdated', handleProductionAreasUpdated);
        window.addEventListener('productsUpdated', handleProductsUpdated);
        return () => {
            window.removeEventListener('productionAreasUpdated', handleProductionAreasUpdated);
            window.removeEventListener('productsUpdated', handleProductsUpdated);
        };
    }, []);

    const assignedProductCountByArea = useMemo(() => {
        const counts: Record<string, number> = {};
        products.forEach(product => {
            const areaId = resolveRestaurantProductConfig(product).production_area_id;
            if (areaId) counts[areaId] = (counts[areaId] || 0) + 1;
        });
        return counts;
    }, [products]);

    const normalizedCategories = useMemo(() => {
        const categorySet = new Set<string>();
        products.forEach(product => {
            const normalized = String(product.category || '').trim();
            if (!normalized) {
                categorySet.add(NO_CATEGORY_FILTER_VALUE);
            } else {
                categorySet.add(normalized);
            }
        });
        return Array.from(categorySet)
            .sort((a, b) => a.localeCompare(b))
            .map(category => ({
                label: category === NO_CATEGORY_FILTER_VALUE ? 'Sin categoría' : category,
                value: category,
            }));
    }, [products]);

    const resolveLocalConfig = async (): Promise<BusinessConfig> => {
        const rawConfig = await db.get('config' as any) as BusinessConfig | BusinessConfig[];
        const configDoc = Array.isArray(rawConfig)
            ? (rawConfig.find((c: any) => c.id === 'current') || rawConfig[0])
            : rawConfig;
        return configDoc?.operational ? configDoc : config;
    };

    const ensureKitchenModuleEnabled = async () => {
        try {
            const configDoc = await resolveLocalConfig();
            if (configDoc?.operational?.usa_modulos_cocina) return;
            if (!configDoc) return;
            const nextConfig: BusinessConfig = {
                ...configDoc,
                operational: {
                    vertical_negocio: configDoc.vertical,
                    usa_mesas: false,
                    pantalla_inicio: 'VENTA_DIRECTA' as const,
                    bloqueo_meseros: false,
                    pedir_comensales: false,
                    ...configDoc.operational,
                    usa_modulos_cocina: true
                }
            };
            await db.save('config' as any, nextConfig);
            onUpdateConfig(nextConfig);
        } catch (e) {
            console.error("Failed to enable kitchen module status", e);
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

    const fetchProducts = async () => {
        try {
            const localProducts = await db.get('products' as any) as Product[] || [];
            setProducts(Array.isArray(localProducts) ? localProducts : []);
        } catch (e) {
            console.error("Failed to fetch products", e);
        }
    };

    const handleAddArea = () => {
        const newArea: ProductionArea = {
            id: `pa_${Date.now()}`,
            nombre: 'Nueva Área',
            modo_salida: 'KDS',
            kds_delivery_mode: 'LAN',
            kds_port: '8001',
            kds_warning_minutes: 10,
            kds_critical_minutes: 20
        };
        setAreas([...areas, newArea]);
        ensureKitchenModuleEnabled();
    };

    const handleUpdateArea = (id: string, updates: Partial<ProductionArea>) => {
        setAreas(areas.map(a => a.id === id ? { ...a, ...updates } : a));
    };

    const handleSelectKdsTerminal = (area: ProductionArea, targetId: string) => {
        const target = kdsTerminals.find((candidate) => candidate.id === targetId);
        handleUpdateArea(area.id, {
            kds_delivery_mode: 'LAN',
            target_terminal_id: targetId || undefined,
            target_terminal_name: target?.label || undefined,
            kds_host: target?.host || area.kds_host,
            kds_port: target?.port || area.kds_port || '8001',
        });
    };

    const handleDeleteArea = (id: string) => {
        if (confirm("¿Está seguro de eliminar esta área de producción?")) {
            const nextAreas = areas.filter(a => a.id !== id);
            setAreas(nextAreas);
            db.save('productionAreas' as any, nextAreas)
                .then(() => window.dispatchEvent(new CustomEvent('productionAreasUpdated')))
                .catch((error) => {
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
                kds_warning_minutes: Math.max(1, Math.floor(Number(area.kds_warning_minutes || 10))),
                kds_critical_minutes: Math.max(
                    Math.max(1, Math.floor(Number(area.kds_warning_minutes || 10))) + 1,
                    Math.floor(Number(area.kds_critical_minutes || 20))
                ),
                printer_id: area.printer_id?.trim() || undefined,
                printer_ip: area.printer_ip?.trim() || undefined
            };
            const nextAreas = areas.some(existing => existing.id === normalizedArea.id)
                ? areas.map(existing => existing.id === normalizedArea.id ? normalizedArea : existing)
                : [...areas, normalizedArea];
            setAreas(nextAreas);
            await db.save('productionAreas' as any, nextAreas);
            window.dispatchEvent(new CustomEvent('productionAreasUpdated'));
            await ensureKitchenModuleEnabled();
            alert("Área guardada correctamente");
        } catch (e) {
            console.error("Failed to save production area", e);
            alert("Error al guardar área");
        } finally {
            setSaving(false);
        }
    };

    const getAreaFilteredProducts = (areaId: string) => {
        const query = productSearch.trim().toLowerCase();
        const categoryFilter = selectedCategory.trim();
        return products
            .filter(product => {
                const text = `${product.name || ''} ${product.category || ''} ${product.barcode || ''}`.toLowerCase();
                const normalizedCategory = String(product.category || '').trim();
                const productCategoryFilterValue = normalizedCategory || NO_CATEGORY_FILTER_VALUE;
                const matchesCategory = !categoryFilter || productCategoryFilterValue === categoryFilter;
                return matchesCategory && (!query || text.includes(query));
            })
            .sort((a, b) => {
                const aAssigned = resolveRestaurantProductConfig(a).production_area_id === areaId ? 0 : 1;
                const bAssigned = resolveRestaurantProductConfig(b).production_area_id === areaId ? 0 : 1;
                if (aAssigned !== bAssigned) return aAssigned - bAssigned;
                return String(a.name || '').localeCompare(String(b.name || ''));
            })
            .slice(0, 80);
    };

    const handleAssignProductToArea = async (productId: string, areaId: string, assign: boolean) => {
        setSavingProductAreaId(areaId);
        try {
            const nextProducts = products.map(product => {
                if (product.id !== productId) return product;
                const resolved = resolveRestaurantProductConfig(product);
                const nextAreaId = assign ? areaId : undefined;
                return normalizeRestaurantProductConfig({
                    ...product,
                    production_area_id: nextAreaId,
                    restaurant: {
                        ...(product.restaurant || {}),
                        production_area_id: nextAreaId,
                        product_type: resolved.product_type || product.product_type || 'SIMPLE',
                    },
                    updatedAt: new Date().toISOString(),
                });
            });
            setProducts(nextProducts);
            await db.save('products' as any, nextProducts);
            window.dispatchEvent(new CustomEvent('productsUpdated'));
            await ensureKitchenModuleEnabled();
        } catch (error) {
            console.error('Failed to assign product to production area', error);
            alert('No se pudo asignar el artículo al centro de producción.');
            fetchProducts();
        } finally {
            setSavingProductAreaId(null);
        }
    };

    const getFilteredSelectionState = (areaId: string) => {
        const visibleProducts = getAreaFilteredProducts(areaId);
        const selectedCount = visibleProducts.filter(product =>
            resolveRestaurantProductConfig(product).production_area_id === areaId
        ).length;
        return {
            visibleProducts,
            selectedCount,
            allSelected: visibleProducts.length > 0 && selectedCount === visibleProducts.length,
        };
    };

    const handleSetFilteredProductsForArea = async (areaId: string, assign: boolean) => {
        const visibleProducts = getAreaFilteredProducts(areaId);
        if (visibleProducts.length === 0) return;

        setSavingProductAreaId(areaId);
        try {
            const visibleIds = new Set(visibleProducts.map(product => product.id));
            const nextProducts = products.map(product => {
                if (!visibleIds.has(product.id)) return product;
                const resolved = resolveRestaurantProductConfig(product);
                const currentAreaId = resolved.production_area_id;
                const nextAreaId = assign ? areaId : (currentAreaId === areaId ? undefined : currentAreaId);
                return normalizeRestaurantProductConfig({
                    ...product,
                    production_area_id: nextAreaId,
                    restaurant: {
                        ...(product.restaurant || {}),
                        production_area_id: nextAreaId,
                        product_type: resolved.product_type || product.product_type || 'SIMPLE',
                    },
                    updatedAt: new Date().toISOString(),
                });
            });
            setProducts(nextProducts);
            await db.save('products' as any, nextProducts);
            window.dispatchEvent(new CustomEvent('productsUpdated'));
            await ensureKitchenModuleEnabled();
        } catch (error) {
            console.error('Failed to bulk assign products to production area', error);
            alert('No se pudo asignar los artículos visibles al centro de producción.');
            fetchProducts();
        } finally {
            setSavingProductAreaId(null);
        }
    };

    const handleAssignFilteredProductsToArea = async (areaId: string) => {
        await handleSetFilteredProductsForArea(areaId, true);
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
        <div className="p-4 pb-28 md:p-6 md:pb-28 max-w-[92rem] mx-auto animate-in fade-in duration-500">
            <div className="flex justify-between items-center mb-5">
                <div>
                    <h2 className="text-2xl font-black text-slate-800">Centros de Producción</h2>
                    <p className="text-sm text-slate-400 font-medium">Configura rutas KDS/impresión y asigna artículos sin salir de esta pantalla.</p>
                </div>
                <button
                    onClick={handleAddArea}
                    className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-black text-sm hover:scale-105 active:scale-95 transition-all flex items-center gap-2 shadow-xl shadow-slate-200"
                >
                    <Plus size={18} />
                    NUEVA ÁREA
                </button>
            </div>

            <div className="mb-5 flex flex-col gap-3 rounded-[1.5rem] border border-blue-100 bg-blue-50/70 px-5 py-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-blue-600 p-3 text-white shadow-lg shadow-blue-100">
                        <PackageCheck size={20} />
                    </div>
                    <div>
                        <h3 className="text-sm font-black uppercase tracking-wide text-blue-900">Ruteo activo por configuración</h3>
                        <p className="text-xs font-bold text-blue-600">
                            Crear y guardar centros activa el flujo de comandas. Los artículos asignados viajarán al KDS/impresora del área.
                        </p>
                    </div>
                </div>
                <div className="rounded-2xl bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-blue-700 shadow-sm">
                    {areas.length} áreas · {products.filter(product => resolveRestaurantProductConfig(product).production_area_id).length} artículos asignados
                </div>
            </div>

            <div className="grid grid-cols-1 gap-5">
                {areas.length === 0 ? (
                    <div className="col-span-full py-12 bg-slate-50 rounded-[2rem] border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400">
                        <Layers size={48} className="mb-4 opacity-20" />
                        <p className="font-bold">No hay áreas de producción configuradas.</p>
                        <p className="text-xs">Usa el botón superior para crear la primera.</p>
                    </div>
                ) : areas.map(area => (
                    <div key={area.id} className="bg-white rounded-[2rem] shadow-xl border border-slate-100 p-5 hover:shadow-2xl transition-all group overflow-hidden relative">
                        {/* Status Accent */}
                        <div className={`absolute top-0 left-0 w-2 h-full ${area.modo_salida === 'KDS' ? 'bg-blue-500' : area.modo_salida === 'PRINTER' ? 'bg-emerald-500' : 'bg-purple-500'}`} />

                        <div className="flex justify-between items-start mb-4 pl-2">
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

                        <div className="grid grid-cols-1 gap-5 pl-2 xl:grid-cols-[minmax(0,1fr)_24rem]">
                        <div className="space-y-4">
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
                                    <div className="mt-3 grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">Alerta (min)</label>
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                min={1}
                                                value={area.kds_warning_minutes ?? 10}
                                                onChange={(e) => handleUpdateArea(area.id, { kds_warning_minutes: e.target.value })}
                                                className="w-full bg-amber-50 border-2 border-amber-100 rounded-xl px-3 py-3 text-sm font-black text-amber-800 focus:border-amber-400 outline-none"
                                                placeholder="10"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">Crítico (min)</label>
                                            <input
                                                type="number"
                                                inputMode="numeric"
                                                min={2}
                                                value={area.kds_critical_minutes ?? 20}
                                                onChange={(e) => handleUpdateArea(area.id, { kds_critical_minutes: e.target.value })}
                                                className="w-full bg-red-50 border-2 border-red-100 rounded-xl px-3 py-3 text-sm font-black text-red-800 focus:border-red-400 outline-none"
                                                placeholder="20"
                                            />
                                        </div>
                                    </div>
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
                                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1 block">Impresora de cocina</label>
                                    <div className="relative">
                                        <select
                                            value={area.printer_id || ''}
                                            onChange={(e) => handleUpdateArea(area.id, { printer_id: e.target.value || undefined })}
                                            className="w-full appearance-none bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-3 text-sm font-black text-slate-700 focus:border-emerald-500 outline-none pl-10"
                                        >
                                            <option value="">Usar impresora KITCHEN por defecto de Hardware</option>
                                            {kitchenPrinters.map(printer => (
                                                <option key={printer.id} value={printer.id}>
                                                    {printer.name} · {printer.type}{printer.address ? ` · ${printer.address}` : ''}
                                                </option>
                                            ))}
                                        </select>
                                        <Server size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                                    </div>
                                    {area.printer_id && printerById.get(area.printer_id) && (
                                        <p className="mt-2 text-[10px] font-bold text-emerald-600">
                                            Se imprimirá en {printerById.get(area.printer_id)?.name}. La conexión se administra en Ajustes &gt; Hardware.
                                        </p>
                                    )}
                                    {kitchenPrinters.length === 0 && (
                                        <p className="mt-2 text-[11px] font-bold text-amber-600">
                                            No hay impresoras de cocina configuradas en Hardware. Registra una impresora y asígnale uso Cocina / KDS.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="rounded-[1.5rem] border border-slate-100 bg-slate-50/70 p-4">
                            <div className="mb-3 flex items-start justify-between gap-3">
                                <div>
                                    <h4 className="text-sm font-black text-slate-800">Artículos del centro</h4>
                                    <p className="text-[11px] font-bold text-slate-400">
                                        {assignedProductCountByArea[area.id] || 0} asignados a {area.nombre || 'esta área'}
                                    </p>
                                </div>
                                <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase text-slate-500 shadow-sm">
                                    {products.length} artículos
                                </span>
                            </div>
                            <div className="relative mb-3">
                                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    value={productSearch}
                                    onChange={(event) => setProductSearch(event.target.value)}
                                    placeholder="Buscar artículo, categoría o código..."
                                    className="w-full rounded-2xl border-2 border-white bg-white py-3 pl-9 pr-3 text-xs font-bold text-slate-700 outline-none transition-all focus:border-blue-200"
                                />
                            </div>
                            <div className="mb-3">
                                <select
                                    value={selectedCategory}
                                    onChange={(event) => setSelectedCategory(event.target.value)}
                                    className="w-full rounded-2xl border-2 border-white bg-white py-3 px-4 text-xs font-bold text-slate-700 outline-none transition-all focus:border-blue-200"
                                >
                                    <option value="">Todas las categorías</option>
                                    {normalizedCategories.map((category) => (
                                        <option key={category.value || 'sin-categoria'} value={category.value}>
                                            {category.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="mb-3 flex flex-col gap-2 rounded-2xl border border-blue-100 bg-white px-3 py-3">
                                <label className={`flex items-center justify-between gap-3 text-xs font-black uppercase tracking-wide ${savingProductAreaId === area.id || getAreaFilteredProducts(area.id).length === 0 ? 'cursor-not-allowed text-slate-300' : 'cursor-pointer text-blue-700'}`}>
                                    <span className="inline-flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={getFilteredSelectionState(area.id).allSelected}
                                            disabled={savingProductAreaId === area.id || getAreaFilteredProducts(area.id).length === 0}
                                            onChange={(event) => {
                                                void handleSetFilteredProductsForArea(area.id, event.target.checked);
                                            }}
                                            className="h-4 w-4 rounded border-blue-200 text-blue-600 focus:ring-blue-500"
                                        />
                                        Seleccionar todo lo visible
                                    </span>
                                    <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] text-blue-600">
                                        {getFilteredSelectionState(area.id).selectedCount}/{getAreaFilteredProducts(area.id).length}
                                    </span>
                                </label>
                                <button
                                    type="button"
                                    onClick={() => handleAssignFilteredProductsToArea(area.id)}
                                    disabled={savingProductAreaId === area.id || getAreaFilteredProducts(area.id).length === 0}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl border-2 border-blue-200 bg-blue-50 px-4 py-2 text-xs font-black uppercase tracking-wide text-blue-700 transition-all hover:border-blue-300 hover:bg-blue-100 disabled:opacity-60"
                                >
                                    <PackageCheck size={15} />
                                    Aplicar visibles
                                </button>
                            </div>
                            <div className="max-h-[24rem] space-y-2 overflow-y-auto pr-1">
                                {getAreaFilteredProducts(area.id).length === 0 ? (
                                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-center text-xs font-bold text-slate-400">
                                        No hay artículos que coincidan.
                                    </div>
                                ) : getAreaFilteredProducts(area.id).map(product => {
                                    const productAreaId = resolveRestaurantProductConfig(product).production_area_id;
                                    const assignedHere = productAreaId === area.id;
                                    const assignedElsewhere = Boolean(productAreaId && productAreaId !== area.id);
                                    return (
                                        <button
                                            key={product.id}
                                            type="button"
                                            disabled={savingProductAreaId === area.id}
                                            onClick={() => handleAssignProductToArea(product.id, area.id, !assignedHere)}
                                            className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-3 text-left transition-all active:scale-[0.99] disabled:opacity-60 ${assignedHere
                                                ? 'border-blue-200 bg-blue-50 text-blue-900'
                                                : assignedElsewhere
                                                    ? 'border-amber-100 bg-amber-50/70 text-slate-700'
                                                    : 'border-white bg-white text-slate-700 hover:border-slate-200'}`}
                                        >
                                            <span className="min-w-0">
                                                <span className="block truncate text-xs font-black">{product.name}</span>
                                                <span className="block truncate text-[10px] font-bold uppercase text-slate-400">
                                                    {product.category || 'Sin categoría'}
                                                    {assignedElsewhere ? ' · asignado a otro centro' : ''}
                                                </span>
                                            </span>
                                            {assignedHere ? (
                                                <CheckCircle2 size={18} className="shrink-0 text-blue-600" />
                                            ) : (
                                                <PackageX size={18} className="shrink-0 text-slate-300" />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="mt-3 text-[10px] font-bold leading-relaxed text-slate-400">
                                Al marcar un artículo aquí se guarda su destino de producción local. Si luego sincroniza desde ERP, el snapshot puede actualizar esta asignación.
                            </p>
                        </div>
                        </div>

                        <div className="mt-5 flex justify-end">
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
                        Los productos sin centro asignado mantienen el comportamiento actual. Puedes asignarlos aquí para una configuración rápida o desde la ficha del artículo si necesitas revisar otros parámetros.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default ProductionAreaManager;
