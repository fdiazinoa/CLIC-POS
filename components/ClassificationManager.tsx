
import React, { useState } from 'react';
import {
    ListTree, Plus, Edit2, Trash2, Save, X, ChevronRight, Check, FolderOpen, Tag, Layers, Grid, ArrowLeft
} from 'lucide-react';
import { BusinessConfig, ClassificationItem } from '../types';

interface ClassificationManagerProps {
    config: BusinessConfig;
    onUpdateConfig: (config: BusinessConfig) => void;
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

const ClassificationManager: React.FC<ClassificationManagerProps> = ({ config, onUpdateConfig, onClose }) => {
    const [activeType, setActiveType] = useState<ClassificationType>('DEPARTMENTS');
    const [editingItem, setEditingItem] = useState<ClassificationItem | null>(null);
    const [isCreating, setIsCreating] = useState(false);

    const activeDef = CLASSIFICATION_TYPES.find(t => t.id === activeType)!;
    const items: ClassificationItem[] = (config[activeDef.prop] as ClassificationItem[]) || [];

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

    const handleSave = () => {
        if (!editingItem) return;
        if (!editingItem.name.trim()) return alert("El nombre es requerido");

        const newItems = [...items];
        if (isCreating) {
            newItems.push({ ...editingItem, id: editingItem.id || `${activeType.toLowerCase().substring(0, 3)}_${Date.now()}` });
        } else {
            const idx = newItems.findIndex(i => i.id === editingItem.id);
            if (idx >= 0) newItems[idx] = editingItem;
        }

        onUpdateConfig({
            ...config,
            [activeDef.prop]: newItems
        });

        setEditingItem(null);
        setIsCreating(false);
    };

    const handleDelete = (id: string) => {
        if (!confirm("¿Está seguro de eliminar este elemento?")) return;
        const newItems = items.filter(i => i.id !== id);
        onUpdateConfig({
            ...config,
            [activeDef.prop]: newItems
        });
    };

    return (
        <div className="flex bg-white rounded-2xl border border-gray-100 h-[600px] overflow-hidden shadow-sm">
            {/* Sidebar */}
            <div className="w-64 bg-gray-50 border-r border-gray-100 flex flex-col">
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
                            className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-bold flex items-center gap-3 transition-colors ${activeType === type.id ? 'bg-white text-blue-600 shadow-sm border border-gray-100' : 'text-gray-500 hover:bg-gray-100'}`}
                        >
                            <type.icon size={16} />
                            {type.label}
                            <span className="ml-auto text-[10px] bg-gray-100 px-2 py-0.5 rounded-full text-gray-400">
                                {(config[type.prop] as any[])?.length || 0}
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
                        <p className="text-sm text-gray-500">Gestión de maestro de {activeDef.label.toLowerCase()}</p>
                    </div>
                    <button
                        onClick={() => {
                            setEditingItem({ id: '', name: '', code: '' });
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
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {items.length === 0 && (
                                <div className="col-span-full py-12 text-center text-gray-400 flex flex-col items-center">
                                    <Layers size={48} className="opacity-20 mb-4" />
                                    <p>No hay elementos registrados en esta clasificación.</p>
                                </div>
                            )}
                            {items.map(item => {
                                const parent = parentOptions.find(p => p.id === item.parentId);
                                return (
                                    <div key={item.id} className="bg-white p-4 rounded-xl border border-gray-100 hover:border-blue-200 hover:shadow-md transition-all group relative">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h4 className="font-bold text-gray-800">{item.name}</h4>
                                                <div className="flex items-center gap-2 mt-1">
                                                    {item.code && <span className="text-[10px] font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">{item.code}</span>}
                                                    {parent && (
                                                        <span className="text-[10px] flex items-center gap-1 text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                                                            <ChevronRight size={10} /> {parent.name}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                    )}
                </div>
            </div>
        </div>
    );
};

export default ClassificationManager;
