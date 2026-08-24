
import React, { useEffect, useMemo, useState } from 'react';
import {
    ListTree, Plus, Edit2, Trash2, ChevronRight, FolderOpen, Tag, Layers, Grid, ArrowLeft,
    ArrowUp, ArrowDown, Eye, EyeOff, Package
} from 'lucide-react';
import { BusinessConfig, ClassificationItem, Product } from '../types';
import { db } from '../utils/db';
import { syncManager } from '../services/sync/SyncManager';
import {
    categoryAliases,
    comparePosProducts,
    normalizeCatalogKey,
    resolveClassificationActive,
    resolveClassificationColor,
    resolveClassificationSortOrder,
} from '../utils/posCatalogPresentation';

interface ClassificationManagerProps {
    config: BusinessConfig;
    onUpdateConfig: (config: BusinessConfig) => void;
    products?: Product[];
    onUpdateProducts?: (products: Product[]) => void;
    onClose: () => void;
}

type ClassificationType = 'DEPARTMENTS' | 'SECTIONS' | 'FAMILIES' | 'SUBFAMILIES' | 'BRANDS' | 'POS_CATEGORIES';

const CLASSIFICATION_TYPES: { id: ClassificationType; label: string; icon: any; prop: keyof BusinessConfig }[] = [
    { id: 'DEPARTMENTS', label: 'Departamentos', icon: FolderOpen, prop: 'departments' },
    { id: 'SECTIONS', label: 'Secciones', icon: Layers, prop: 'sections' },
    { id: 'FAMILIES', label: 'Familias', icon: Grid, prop: 'families' },
    { id: 'SUBFAMILIES', label: 'Sub-Familias', icon: ListTree, prop: 'subfamilies' },
    { id: 'BRANDS', label: 'Marcas', icon: Tag, prop: 'brands' },
    { id: 'POS_CATEGORIES', label: 'Categorías POS', icon: Grid, prop: 'posCategories' }
];

const normalizeClassificationItem = (entry: unknown, fallbackPrefix = 'POS-CAT'): ClassificationItem | null => {
    if (typeof entry === 'string') {
        const name = entry.trim();
        return name ? { id: name, name, code: name } : null;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const record = entry as Record<string, unknown>;
    const name = String(
        record.name ||
        record.nombre ||
        record.label ||
        record.description ||
        record.descripcion ||
        record.code ||
        record.id ||
        ''
    ).trim();
    if (!name) return null;
    const id = String(record.id || record.code || name).trim() || `${fallbackPrefix}-${name}`;
    const code = String(record.code || id || name).trim();
    return {
        id,
        name,
        code,
        parentId: typeof record.parentId === 'string'
            ? record.parentId
            : typeof record.parent_id === 'string'
                ? record.parent_id
                : undefined,
        color: resolveClassificationColor(record),
        sortOrder: resolveClassificationSortOrder(record, 0),
        isActive: resolveClassificationActive(record),
    };
};

const ClassificationManager: React.FC<ClassificationManagerProps> = ({
    config,
    onUpdateConfig,
    products = [],
    onUpdateProducts,
    onClose,
}) => {
    const [activeType, setActiveType] = useState<ClassificationType>('DEPARTMENTS');
    const [editingItem, setEditingItem] = useState<ClassificationItem | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [localPosCategories, setLocalPosCategories] = useState<ClassificationItem[]>([]);
    const [selectedCategoryId, setSelectedCategoryId] = useState('');
    const [isSavingProductOrder, setIsSavingProductOrder] = useState(false);

    const activeDef = CLASSIFICATION_TYPES.find(t => t.id === activeType)!;
    const posCategoryItems = useMemo(() => {
        const byName = new Map<string, ClassificationItem>();
        const addItem = (entry: unknown) => {
            const item = normalizeClassificationItem(entry);
            if (!item) return;
            const key = item.name.trim().toLowerCase();
            if (!byName.has(key)) byName.set(key, item);
        };
        ((config.posCategories || []) as ClassificationItem[]).forEach(addItem);
        localPosCategories.forEach(addItem);
        return Array.from(byName.values()).sort((left, right) => {
            const orderDifference = resolveClassificationSortOrder(left) - resolveClassificationSortOrder(right);
            return orderDifference || left.name.localeCompare(right.name, 'es', { sensitivity: 'base' });
        });
    }, [config.posCategories, localPosCategories]);
    const rawItems: ClassificationItem[] = activeType === 'POS_CATEGORIES'
        ? posCategoryItems
        : ((config[activeDef.prop] as ClassificationItem[]) || []);
    const supportsPosPresentation = activeType === 'POS_CATEGORIES' || activeType === 'FAMILIES';
    const items = useMemo(() => [...rawItems].sort((left, right) => {
        if (supportsPosPresentation) {
            const orderDifference = resolveClassificationSortOrder(left) - resolveClassificationSortOrder(right);
            if (orderDifference) return orderDifference;
        }
        return left.name.localeCompare(right.name, 'es', { sensitivity: 'base' });
    }), [rawItems, supportsPosPresentation]);

    const selectedCategory = activeType === 'POS_CATEGORIES'
        ? items.find(item => item.id === selectedCategoryId) || items[0]
        : undefined;
    const selectedCategoryAliases = useMemo(
        () => new Set(selectedCategory ? categoryAliases(selectedCategory) : []),
        [selectedCategory],
    );
    const orderedCategoryProducts = useMemo(() => products
        .filter(product => selectedCategoryAliases.has(normalizeCatalogKey(product.category)))
        .sort(comparePosProducts), [products, selectedCategoryAliases]);

    useEffect(() => {
        if (activeType !== 'POS_CATEGORIES') return;
        if (!selectedCategoryId || !items.some(item => item.id === selectedCategoryId)) {
            setSelectedCategoryId(items[0]?.id || '');
        }
    }, [activeType, items, selectedCategoryId]);

    useEffect(() => {
        let cancelled = false;
        const loadLocalPosCategories = async () => {
            try {
                const [rawCategories, rawProductCategories, rawProductGroups, rawCollections] = await Promise.all([
                    db.get('categories' as any).catch(() => []),
                    db.get('productCategories' as any).catch(() => []),
                    db.get('productGroups' as any).catch(() => []),
                    db.get('collections' as any).catch(() => []),
                ]);
                if (cancelled) return;
                const nextItems = [
                    ...(Array.isArray(rawCategories) ? rawCategories : []),
                    ...(Array.isArray(rawProductCategories) ? rawProductCategories : []),
                    ...(Array.isArray(rawProductGroups) ? rawProductGroups : []),
                    ...(Array.isArray(rawCollections) ? rawCollections : []),
                ]
                    .map((entry) => normalizeClassificationItem(entry))
                    .filter(Boolean) as ClassificationItem[];
                setLocalPosCategories(nextItems);
            } catch (error) {
                console.warn('[ClassificationManager] No se pudieron cargar categorías POS locales:', error);
            }
        };
        const handleCategoriesUpdated = () => {
            void loadLocalPosCategories();
        };

        void loadLocalPosCategories();
        window.addEventListener('categoriesUpdated', handleCategoriesUpdated);
        window.addEventListener('productGroupsUpdated', handleCategoriesUpdated);
        return () => {
            cancelled = true;
            window.removeEventListener('categoriesUpdated', handleCategoriesUpdated);
            window.removeEventListener('productGroupsUpdated', handleCategoriesUpdated);
        };
    }, []);

    // Derived state for parent selectors
    const departments = config.departments || [];
    const sections = config.sections || [];
    const families = config.families || [];

    const getParentOptions = () => {
        switch (activeType) {
            case 'SECTIONS': return departments;
            case 'FAMILIES': return sections; // Logic: Famlies belong to sections? Or just independent? Usually Dep -> Sec -> Fam
            case 'SUBFAMILIES': return families;
            default: return [];
        }
    };

    const parentOptions = getParentOptions();
    const parentLabel = activeType === 'SECTIONS' ? 'Departamento' :
        activeType === 'FAMILIES' ? 'Sección' :
            activeType === 'SUBFAMILIES' ? 'Familia' : '';

    const persistItems = (nextItems: ClassificationItem[]) => {
        onUpdateConfig({
            ...config,
            [activeDef.prop]: nextItems,
        });

        if (activeType === 'POS_CATEGORIES') {
            const previousById = new Map(items.map(item => [item.id, item]));
            const nextIds = new Set(nextItems.map(item => item.id));
            void (async () => {
                try {
                    for (const item of nextItems) {
                        await db.saveDocument('categories' as any, item);
                        void syncManager.broadcastChange(
                            'categories',
                            item,
                            previousById.has(item.id) ? 'UPDATE' : 'CREATE',
                        ).catch(error => console.warn('[ClassificationManager] No se pudo sincronizar la categoría:', error));
                    }
                    for (const previousItem of items) {
                        if (nextIds.has(previousItem.id)) continue;
                        await db.deleteDocument('categories' as any, previousItem.id);
                        void syncManager.broadcastChange('categories', previousItem, 'DELETE')
                            .catch(error => console.warn('[ClassificationManager] No se pudo sincronizar la eliminación de categoría:', error));
                    }
                    window.dispatchEvent(new CustomEvent('categoriesUpdated'));
                } catch (error) {
                    console.error('[ClassificationManager] No se pudo persistir la organización de categorías:', error);
                }
            })();
        }
    };

    const handleSave = () => {
        if (!editingItem) return;
        if (!editingItem.name.trim()) return alert("El nombre es requerido");

        const newItems = [...items];
        if (isCreating) {
            newItems.push({
                ...editingItem,
                id: editingItem.id || `${activeType.toLowerCase().substring(0, 3)}_${Date.now()}`,
                sortOrder: supportsPosPresentation
                    ? Math.max(-1, ...newItems.map((item, index) => resolveClassificationSortOrder(item, index))) + 1
                    : editingItem.sortOrder,
                isActive: supportsPosPresentation ? editingItem.isActive !== false : editingItem.isActive,
            });
        } else {
            const idx = newItems.findIndex(i => i.id === editingItem.id);
            if (idx >= 0) newItems[idx] = editingItem;
        }

        persistItems(newItems);

        setEditingItem(null);
        setIsCreating(false);
    };

    const handleDelete = async (id: string) => {
        if (!await clicConfirm("¿Está seguro de eliminar este elemento?")) return;
        const newItems = items.filter(i => i.id !== id);
        persistItems(newItems);
    };

    const handleMoveClassification = (id: string, direction: -1 | 1) => {
        const currentIndex = items.findIndex(item => item.id === id);
        const targetIndex = currentIndex + direction;
        if (currentIndex < 0 || targetIndex < 0 || targetIndex >= items.length) return;
        const reordered = [...items];
        [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
        persistItems(reordered.map((item, index) => ({ ...item, sortOrder: index })));
    };

    const handleToggleClassification = (id: string) => {
        persistItems(items.map(item => item.id === id
            ? { ...item, isActive: !resolveClassificationActive(item) }
            : item));
    };

    const handleMoveProduct = async (productId: string, direction: -1 | 1) => {
        const currentIndex = orderedCategoryProducts.findIndex(product => product.id === productId);
        const targetIndex = currentIndex + direction;
        if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedCategoryProducts.length || isSavingProductOrder) return;

        const reordered = [...orderedCategoryProducts];
        [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
        const orderById = new Map(reordered.map((product, index) => [product.id, index]));
        const changedProducts = products
            .filter(product => orderById.has(product.id))
            .map(product => ({ ...product, posSortOrder: orderById.get(product.id)! }));
        const changedById = new Map(changedProducts.map(product => [product.id, product]));
        const nextProducts = products.map(product => changedById.get(product.id) || product);

        setIsSavingProductOrder(true);
        try {
            await Promise.all(changedProducts.map(product => db.saveDocument('products', product)));
            onUpdateProducts?.(nextProducts);
            window.dispatchEvent(new CustomEvent('productsUpdated'));
            for (const product of changedProducts) {
                void syncManager.broadcastChange('products', product, 'UPDATE').catch(error =>
                    console.warn('[ClassificationManager] No se pudo sincronizar el orden del artículo:', error)
                );
            }
        } catch (error) {
            console.error('[ClassificationManager] No se pudo guardar el orden de los artículos:', error);
            alert('No se pudo guardar el orden de los artículos. Intente nuevamente.');
        } finally {
            setIsSavingProductOrder(false);
        }
    };

    return (
        <div className="flex bg-white rounded-2xl border border-gray-100 h-[680px] overflow-hidden shadow-sm">
            {/* Sidebar */}
            <div className="w-64 bg-white border-r border-gray-100 flex flex-col">
                <div className="p-4 border-b border-gray-100 flex items-center gap-2">
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-gray-700 transition-colors">
                        <ArrowLeft size={20} />
                    </button>
                    <h3 className="font-bold text-gray-800 flex items-center gap-2">
                        <ListTree size={20} className="text-blue-600" />
                        Clasificaciones
                    </h3>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {CLASSIFICATION_TYPES.map(type => (
                        <button
                            key={type.id}
                            onClick={() => { setActiveType(type.id); setEditingItem(null); setIsCreating(false); }}
                            className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-bold flex items-center gap-3 transition-colors border ${activeType === type.id ? 'bg-white text-blue-600 shadow-sm border-gray-100' : 'bg-white text-gray-500 border-gray-100 hover:bg-gray-50 hover:border-gray-200'}`}
                        >
                            <type.icon size={16} />
                            {type.label}
                            <span className="ml-auto text-[10px] bg-gray-100 px-2 py-0.5 rounded-full text-gray-400">
                                {type.id === 'POS_CATEGORIES'
                                    ? posCategoryItems.length
                                    : ((config[type.prop] as any[])?.length || 0)}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-white">
                    <div>
                        <h2 className="text-xl font-black text-gray-800">{activeDef.label}</h2>
                        <p className="text-sm text-gray-500">
                            {supportsPosPresentation
                                ? 'Configure nombre, orden, color y visibilidad en el POS.'
                                : `Gestión de maestro de ${activeDef.label.toLowerCase()}`}
                        </p>
                    </div>
                    <button
                        onClick={() => {
                            setEditingItem({ id: '', name: '', code: '', color: '#2563EB', isActive: true });
                            setIsCreating(true);
                        }}
                        className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all flex items-center gap-2"
                    >
                        <Plus size={18} /> Nuevo Elemento
                    </button>
                </div>

                {/* List / Form */}
                <div className="flex-1 overflow-y-auto p-6 bg-gray-50/30">
                    {editingItem ? (
                        <div className="max-w-md mx-auto bg-white p-8 rounded-2xl shadow-sm border border-gray-100 animate-in zoom-in-95">
                            <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
                                {isCreating ? <Plus size={20} className="text-blue-500" /> : <Edit2 size={20} className="text-orange-500" />}
                                {isCreating ? 'Crear Nuevo' : 'Editar Elemento'}
                            </h3>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Nombre</label>
                                    <input
                                        autoFocus
                                        type="text"
                                        value={editingItem.name}
                                        onChange={e => setEditingItem({ ...editingItem, name: e.target.value })}
                                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800 focus:bg-white focus:border-blue-500 outline-none transition-all"
                                        placeholder="Ej: Alimentos y Bebidas"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Código (Opcional)</label>
                                    <input
                                        type="text"
                                        value={editingItem.code || ''}
                                        onChange={e => setEditingItem({ ...editingItem, code: e.target.value })}
                                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm focus:bg-white focus:border-blue-500 outline-none transition-all"
                                        placeholder="Ej: DEP-001"
                                    />
                                </div>

                                {parentOptions.length > 0 && (
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Pertenece a ({parentLabel})</label>
                                        <select
                                            value={editingItem.parentId || ''}
                                            onChange={e => setEditingItem({ ...editingItem, parentId: e.target.value })}
                                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none text-sm"
                                        >
                                            <option value="">-- Sin Padre --</option>
                                            {parentOptions.map(p => (
                                                <option key={p.id} value={p.id}>{p.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {supportsPosPresentation && (
                                    <div className="grid grid-cols-[1fr_auto] gap-4 items-end">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1 ml-1">Color en el POS</label>
                                            <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-2">
                                                <input
                                                    type="color"
                                                    value={resolveClassificationColor(editingItem) || '#2563EB'}
                                                    onChange={event => setEditingItem({ ...editingItem, color: event.target.value.toUpperCase() })}
                                                    className="h-9 w-12 cursor-pointer rounded-lg border-0 bg-transparent p-0"
                                                    aria-label="Color de la categoría"
                                                />
                                                <span className="font-mono text-sm font-bold text-gray-600">
                                                    {resolveClassificationColor(editingItem) || '#2563EB'}
                                                </span>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setEditingItem({ ...editingItem, isActive: editingItem.isActive === false })}
                                            className={`h-[54px] rounded-xl border px-4 text-sm font-black transition-colors ${editingItem.isActive !== false
                                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                : 'border-gray-200 bg-gray-100 text-gray-500'}`}
                                        >
                                            {editingItem.isActive !== false ? 'Visible' : 'Oculta'}
                                        </button>
                                    </div>
                                )}

                                <div className="flex gap-3 pt-4">
                                    <button
                                        onClick={() => { setEditingItem(null); setIsCreating(false); }}
                                        className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={handleSave}
                                        className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
                                    >
                                        Guardar
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {items.length === 0 && (
                                <div className="col-span-full py-12 text-center text-gray-400 flex flex-col items-center">
                                    <Layers size={48} className="opacity-20 mb-4" />
                                    <p>No hay elementos registrados en esta clasificación.</p>
                                </div>
                            )}
                            {items.map((item, itemIndex) => {
                                const parent = parentOptions.find(p => p.id === item.parentId);
                                const itemColor = resolveClassificationColor(item);
                                const isItemActive = resolveClassificationActive(item);
                                return (
                                    <div
                                        key={item.id}
                                        className={`bg-white p-4 rounded-xl border hover:shadow-md transition-all group relative ${isItemActive ? 'border-gray-100 hover:border-blue-200' : 'border-gray-200 opacity-70'}`}
                                    >
                                        {supportsPosPresentation && itemColor && (
                                            <div className="absolute inset-x-0 top-0 h-1 rounded-t-xl" style={{ backgroundColor: itemColor }} />
                                        )}
                                        <div className="flex justify-between items-start">
                                            <div className="min-w-0 pr-2">
                                                <h4 className="font-bold text-gray-800 truncate">{item.name}</h4>
                                                <div className="flex items-center gap-2 mt-1">
                                                    {item.code && <span className="text-[10px] font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">{item.code}</span>}
                                                    {parent && (
                                                        <span className="text-[10px] flex items-center gap-1 text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                                                            <ChevronRight size={10} /> {parent.name}
                                                        </span>
                                                    )}
                                                    {supportsPosPresentation && (
                                                        <span className={`text-[10px] rounded px-1.5 py-0.5 font-bold ${isItemActive ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'}`}>
                                                            {isItemActive ? 'Visible' : 'Oculta'}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                                {supportsPosPresentation && (
                                                    <>
                                                        <button
                                                            type="button"
                                                            disabled={itemIndex === 0}
                                                            onClick={() => handleMoveClassification(item.id, -1)}
                                                            className="p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 rounded-lg disabled:opacity-20"
                                                            title="Subir"
                                                        >
                                                            <ArrowUp size={15} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={itemIndex === items.length - 1}
                                                            onClick={() => handleMoveClassification(item.id, 1)}
                                                            className="p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 rounded-lg disabled:opacity-20"
                                                            title="Bajar"
                                                        >
                                                            <ArrowDown size={15} />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleToggleClassification(item.id)}
                                                            className="p-1.5 text-gray-400 hover:bg-amber-50 hover:text-amber-600 rounded-lg"
                                                            title={isItemActive ? 'Ocultar en el POS' : 'Mostrar en el POS'}
                                                        >
                                                            {isItemActive ? <Eye size={15} /> : <EyeOff size={15} />}
                                                        </button>
                                                    </>
                                                )}
                                                <button onClick={() => { setEditingItem(item); setIsCreating(false); }} className="p-1.5 text-gray-400 hover:bg-blue-50 hover:text-blue-600 rounded-lg">
                                                    <Edit2 size={16} />
                                                </button>
                                                <button onClick={() => handleDelete(item.id)} className="p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 rounded-lg">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {activeType === 'POS_CATEGORIES' && items.length > 0 && (
                            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                                    <div>
                                        <h3 className="flex items-center gap-2 font-black text-gray-800">
                                            <Package size={18} className="text-blue-600" /> Orden de artículos
                                        </h3>
                                        <p className="mt-1 text-xs text-gray-500">Defina la posición de cada artículo dentro de su categoría.</p>
                                    </div>
                                    <label className="min-w-[240px] text-xs font-bold uppercase text-gray-500">
                                        Categoría
                                        <select
                                            value={selectedCategory?.id || ''}
                                            onChange={event => setSelectedCategoryId(event.target.value)}
                                            className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 p-2.5 text-sm font-bold normal-case text-gray-700 outline-none focus:border-blue-500"
                                        >
                                            {items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                                        </select>
                                    </label>
                                </div>

                                <div className="mt-4 max-h-64 space-y-2 overflow-y-auto pr-1">
                                    {orderedCategoryProducts.length === 0 ? (
                                        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-5 text-center text-sm text-gray-400">
                                            Esta categoría no tiene artículos asignados.
                                        </div>
                                    ) : orderedCategoryProducts.map((product, productIndex) => (
                                        <div key={product.id} className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
                                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-xs font-black text-gray-500 shadow-sm">
                                                {productIndex + 1}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-700">{product.name}</span>
                                            <button
                                                type="button"
                                                disabled={productIndex === 0 || isSavingProductOrder}
                                                onClick={() => void handleMoveProduct(product.id, -1)}
                                                className="rounded-lg p-2 text-gray-400 hover:bg-white hover:text-blue-600 disabled:opacity-20"
                                                title="Subir artículo"
                                            >
                                                <ArrowUp size={16} />
                                            </button>
                                            <button
                                                type="button"
                                                disabled={productIndex === orderedCategoryProducts.length - 1 || isSavingProductOrder}
                                                onClick={() => void handleMoveProduct(product.id, 1)}
                                                className="rounded-lg p-2 text-gray-400 hover:bg-white hover:text-blue-600 disabled:opacity-20"
                                                title="Bajar artículo"
                                            >
                                                <ArrowDown size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ClassificationManager;
