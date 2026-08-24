import React, { useState, useEffect, useMemo } from 'react';
import { ServiceType } from '../types';
import { agendaService } from '../services/AgendaService';
import {
    Plus, Trash2, Edit2, Check, X, Tag,
    LayoutList, Calendar, Users, Clock, User,
    Mail, Phone, MapPin, Wrench, Utensils,
    Heart, Star, Camera, Gift, Music,
    Briefcase, Wine, PartyPopper, ChevronRight,
    DollarSign, Map, Info, GripVertical, AlertCircle,
    GitMerge
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface ServiceTypeManagerProps {
    onClose: () => void;
    onUpdate: () => void;
}

const AVAILABLE_ICONS = [
    { name: 'Tag', icon: Tag },
    { name: 'Calendar', icon: Calendar },
    { name: 'Clock', icon: Clock },
    { name: 'User', icon: User },
    { name: 'Mail', icon: Mail },
    { name: 'Phone', icon: Phone },
    { name: 'MapPin', icon: MapPin },
    { name: 'Wrench', icon: Wrench },
    { name: 'Utensils', icon: Utensils },
    { name: 'Heart', icon: Heart },
    { name: 'Star', icon: Star },
    { name: 'Camera', icon: Camera },
    { name: 'Gift', icon: Gift },
    { name: 'Music', icon: Music },
    { name: 'Briefcase', icon: Briefcase },
    { name: 'Wine', icon: Wine },
    { name: 'PartyPopper', icon: PartyPopper },
];

const COLORS = [
    '#6366f1', // Indigo
    '#8b5cf6', // Violet
    '#ec4899', // Pink
    '#f43f5e', // Rose
    '#f97316', // Orange
    '#f59e0b', // Amber
    '#10b981', // Emerald
    '#0ea5e9', // Sky
    '#3b82f6', // Blue
    '#6b7280', // Gray
    '#1d4ed8', // Dark Blue
    '#b91c1c', // Dark Red
];

const ServiceTypeManager: React.FC<ServiceTypeManagerProps> = ({ onClose, onUpdate }) => {
    const [types, setTypes] = useState<ServiceType[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [editForm, setEditForm] = useState<Partial<ServiceType>>({});
    const [draggedItem, setDraggedItem] = useState<ServiceType | null>(null);

    useEffect(() => {
        loadTypes();
    }, []);

    const loadTypes = async () => {
        setIsLoading(true);
        try {
            const data = await agendaService.getServiceTypes();
            // Sort by order if available
            setTypes(data.sort((a, b) => (a.order || 0) - (b.order || 0)));
        } catch (error) {
            console.error("Error loading types", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleEdit = (type: ServiceType) => {
        setEditForm({ ...type });
        setShowEditModal(true);
    };

    const handleCreate = () => {
        setEditForm({
            id: uuidv4(),
            name: '',
            label: '',
            nature: 'CRM',
            color: COLORS[0],
            icon: 'Tag',
            isActive: true,
            defaultDuration: 45,
            basePrice: 0,
            requiresSpace: false,
            order: types.length
        });
        setShowEditModal(true);
    };

    const handleSave = async () => {
        if (!editForm.label || !editForm.nature) return;

        const name = editForm.name || editForm.label.toUpperCase().replace(/\s+/g, '_');
        const typeToSave = {
            ...editForm,
            name,
            defaultDuration: Number(editForm.defaultDuration) || 45,
            basePrice: Number(editForm.basePrice) || 0,
            order: editForm.order ?? types.length
        } as ServiceType;

        await agendaService.saveServiceType(typeToSave);
        setShowEditModal(false);
        setEditForm({});
        await loadTypes();
        onUpdate();
    };

    const handleDelete = async (id: string) => {
        if (await clicConfirm('¿Seguro que desea eliminar este tipo?')) {
            await agendaService.deleteServiceType(id);
            await loadTypes();
            onUpdate();
        }
    };

    const handleToggleActive = async (type: ServiceType) => {
        const updated = { ...type, isActive: !type.isActive };
        await agendaService.saveServiceType(updated);
        await loadTypes();
        onUpdate();
    };

    // Drag and Drop Logic
    const handleDragStart = (e: React.DragEvent, type: ServiceType) => {
        setDraggedItem(type);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent, targetType: ServiceType) => {
        e.preventDefault();
        if (!draggedItem || draggedItem.id === targetType.id || draggedItem.nature !== targetType.nature) return;

        const natureTypes = types.filter(t => t.nature === targetType.nature);
        const others = types.filter(t => t.nature !== targetType.nature);

        const oldIndex = natureTypes.findIndex(t => t.id === draggedItem.id);
        const newIndex = natureTypes.findIndex(t => t.id === targetType.id);

        const newNatureTypes = [...natureTypes];
        newNatureTypes.splice(oldIndex, 1);
        newNatureTypes.splice(newIndex, 0, draggedItem);

        // Update orders
        const updatedNatureTypes = newNatureTypes.map((t, idx) => ({ ...t, order: idx }));
        setTypes([...others, ...updatedNatureTypes].sort((a, b) => (a.order || 0) - (b.order || 0)));
    };

    const handleDragEnd = async () => {
        setDraggedItem(null);
        await agendaService.saveServiceTypes(types);
        onUpdate();
    };

    const renderIcon = (iconName: string, color: string, size = 18) => {
        const iconObj = AVAILABLE_ICONS.find(i => i.name === iconName) || AVAILABLE_ICONS[0];
        const IconComponent = iconObj.icon;
        return (
            <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white shadow-sm shrink-0"
                style={{ backgroundColor: color }}
            >
                <IconComponent size={size} />
            </div>
        );
    };

    const ServiceCard = ({ type }: { type: ServiceType }) => (
        <div
            draggable
            onDragStart={(e) => handleDragStart(e, type)}
            onDragOver={(e) => handleDragOver(e, type)}
            onDragEnd={handleDragEnd}
            className={`group p-4 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all flex items-center gap-4 ${!type.isActive ? 'opacity-60 bg-gray-50' : ''}`}
        >
            <div className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-400">
                <GripVertical size={16} />
            </div>

            {renderIcon(type.icon || 'Tag', type.color || COLORS[0])}

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <p className="font-black text-gray-900 truncate leading-tight">{type.label}</p>
                    <span className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">{type.name}</span>
                </div>

                <div className="flex items-center gap-3 mt-1.5">
                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-gray-100 rounded-lg">
                        <Clock size={10} className="text-gray-400" />
                        <span className="text-[10px] font-black text-gray-600">Default: {type.defaultDuration || 45} min</span>
                    </div>
                    {type.basePrice ? (
                        <div className="flex items-center gap-1 text-indigo-600">
                            <span className="text-[10px] font-black uppercase tracking-tighter">Sugerido: RD${type.basePrice.toLocaleString()}</span>
                        </div>
                    ) : null}
                    {type.nature === 'BOOKING' && type.requiresSpace && (
                        <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-lg border border-emerald-100">
                            <Map size={10} />
                            <span className="text-[8px] font-black uppercase tracking-widest">Requiere Espacio</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-4 shrink-0">
                {/* Active Toggle */}
                <button
                    onClick={() => handleToggleActive(type)}
                    className={`relative w-8 h-4 rounded-full transition-colors ${type.isActive ? 'bg-indigo-600' : 'bg-gray-200'}`}
                >
                    <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${type.isActive ? 'left-4.5' : 'left-0.5'}`} />
                </button>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={() => handleEdit(type)}
                        className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                    >
                        <Edit2 size={14} />
                    </button>
                    <button
                        onClick={() => handleDelete(type.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>
        </div>
    );

    const crmTypes = types.filter(t => t.nature === 'CRM');
    const bookingTypes = types.filter(t => t.nature === 'BOOKING');

    return (
        <div className="h-full flex flex-col bg-gray-50/50 relative overflow-hidden">
            <header className="px-8 py-6 border-b border-gray-100 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-10 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-gradient-to-br from-pink-500 to-rose-600 text-white rounded-2xl shadow-lg shadow-pink-200">
                        <Tag size={20} />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-gray-900 tracking-tight">Tipos de Servicio</h2>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Panel Operativo</p>
                    </div>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={handleCreate}
                        className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all"
                    >
                        <Plus size={16} strokeWidth={3} /> Nuevo Tipo
                    </button>
                    <button
                        onClick={onClose}
                        className="p-3 bg-gray-100 text-gray-500 rounded-xl hover:bg-gray-200 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-12 custom-scrollbar">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 max-w-7xl mx-auto">
                    {/* CRM Section */}
                    <div className="space-y-6">
                        <div className="flex items-center justify-between pb-3 border-b-2 border-indigo-100">
                            <div className="flex items-center gap-2">
                                <Users size={18} className="text-indigo-500" />
                                <h3 className="text-xs font-black text-gray-600 uppercase tracking-widest">CRM (Ventas & Seguimiento)</h3>
                            </div>
                            <span className="text-[10px] font-bold text-indigo-400">{crmTypes.length} Items</span>
                        </div>

                        <div className="space-y-3">
                            {crmTypes.map(type => <ServiceCard key={type.id} type={type} />)}
                            {crmTypes.length === 0 && (
                                <div className="py-12 border-2 border-dashed border-gray-200 rounded-3xl flex flex-col items-center justify-center text-gray-400">
                                    <Users size={32} className="mb-2 opacity-20" />
                                    <p className="text-[10px] font-black uppercase tracking-widest">Sin servicios CRM</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Booking Section */}
                    <div className="space-y-6">
                        <div className="flex items-center justify-between pb-3 border-b-2 border-emerald-100">
                            <div className="flex items-center gap-2">
                                <Calendar size={18} className="text-emerald-500" />
                                <h3 className="text-xs font-black text-gray-600 uppercase tracking-widest">Bookings (Espacios & Eventos)</h3>
                            </div>
                            <span className="text-[10px] font-bold text-emerald-400">{bookingTypes.length} Items</span>
                        </div>

                        <div className="space-y-3">
                            {bookingTypes.map(type => <ServiceCard key={type.id} type={type} />)}
                            {bookingTypes.length === 0 && (
                                <div className="py-12 border-2 border-dashed border-gray-200 rounded-3xl flex flex-col items-center justify-center text-gray-400">
                                    <Calendar size={32} className="mb-2 opacity-20" />
                                    <p className="text-[10px] font-black uppercase tracking-widest">Sin servicios de Reserva</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Slide-over Edit Modal */}
            {showEditModal && (
                <>
                    <div
                        className="fixed inset-0 z-[60] bg-black/20 backdrop-blur-sm animate-in fade-in"
                        onClick={() => setShowEditModal(false)}
                    />
                    <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white z-[70] shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                        <div className="p-8 border-b border-gray-100 flex items-center justify-between shrink-0">
                            <div>
                                <h3 className="text-xl font-black text-gray-900 tracking-tight">
                                    {types.find(t => t.id === editForm.id) ? 'Editar Servicio' : 'Nuevo Servicio'}
                                </h3>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Configuración Detallada</p>
                            </div>
                            <button
                                onClick={() => setShowEditModal(false)}
                                className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-400"
                            >
                                <X size={24} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                            {/* Visual Appearance */}
                            <section className="space-y-4">
                                <h4 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2">
                                    <Info size={14} /> Apariencia Visual
                                </h4>
                                <div className="flex items-center gap-6 p-6 bg-gray-50 rounded-[2rem] border border-gray-100">
                                    {renderIcon(editForm.icon || 'Tag', editForm.color || COLORS[0], 24)}
                                    <div className="flex-1">
                                        <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2">Color del Tema</p>
                                        <div className="flex flex-wrap gap-2">
                                            {COLORS.map(c => (
                                                <button
                                                    key={c}
                                                    onClick={() => setEditForm(prev => ({ ...prev, color: c }))}
                                                    className={`w-6 h-6 rounded-full transition-all ${editForm.color === c ? 'scale-125 ring-2 ring-indigo-500 ring-offset-2' : 'hover:scale-110'}`}
                                                    style={{ backgroundColor: c }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">Selector de Icono</p>
                                    <div className="grid grid-cols-6 gap-2">
                                        {AVAILABLE_ICONS.map(i => (
                                            <button
                                                key={i.name}
                                                onClick={() => setEditForm(prev => ({ ...prev, icon: i.name }))}
                                                className={`p-3 rounded-xl flex items-center justify-center transition-all ${editForm.icon === i.name ? 'bg-indigo-600 text-white shadow-lg' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}
                                            >
                                                <i.icon size={20} />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </section>

                            {/* Basic Info */}
                            <section className="space-y-4">
                                <h4 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2">
                                    <Tag size={14} /> Información General
                                </h4>
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Nombre del Servicio</label>
                                        <input
                                            value={editForm.label || ''}
                                            onChange={e => setEditForm(prev => ({ ...prev, label: e.target.value }))}
                                            placeholder="Ej: Technical Visit Premium"
                                            className="w-full px-5 py-4 bg-gray-50 rounded-2xl font-black text-sm outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Naturaleza</label>
                                            <select
                                                value={editForm.nature || 'CRM'}
                                                onChange={e => setEditForm(prev => ({ ...prev, nature: e.target.value as any }))}
                                                className="w-full px-5 py-4 bg-gray-50 rounded-2xl font-black text-sm outline-none focus:ring-2 focus:ring-indigo-500 border-none appearance-none"
                                            >
                                                <option value="CRM">CRM</option>
                                                <option value="BOOKING">BOOKING</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Nombre Interno (Auto)</label>
                                            <input
                                                value={editForm.name || ''}
                                                onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                                                placeholder="TECHNICAL_PREMIUM"
                                                className="w-full px-5 py-4 bg-gray-50 rounded-2xl font-bold text-xs text-gray-400 outline-none"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </section>

                            {/* Operational Settings */}
                            <section className="space-y-4">
                                <h4 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2">
                                    <Clock size={14} /> Parámetros Operativos
                                </h4>
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Duración (Minutos)</label>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    value={editForm.defaultDuration || ''}
                                                    onChange={e => setEditForm(prev => ({ ...prev, defaultDuration: parseInt(e.target.value) }))}
                                                    placeholder="45"
                                                    className="w-full px-5 py-4 bg-gray-50 rounded-2xl font-black text-sm outline-none focus:ring-2 focus:ring-indigo-500 pr-12 transition-all"
                                                />
                                                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-gray-300">MIN</span>
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Precio Base</label>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    value={editForm.basePrice || ''}
                                                    onChange={e => setEditForm(prev => ({ ...prev, basePrice: parseFloat(e.target.value) }))}
                                                    placeholder="0.00"
                                                    className="w-full px-5 py-4 bg-gray-50 rounded-2xl font-black text-sm outline-none focus:ring-2 focus:ring-indigo-500 pl-10 transition-all"
                                                />
                                                <DollarSign size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" />
                                            </div>
                                        </div>
                                    </div>

                                    {editForm.nature === 'BOOKING' && (
                                        <button
                                            onClick={() => setEditForm(prev => ({ ...prev, requiresSpace: !prev.requiresSpace }))}
                                            className={`w-full p-4 rounded-2xl border flex items-center justify-between transition-all ${editForm.requiresSpace ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-gray-50 border-gray-100 text-gray-400'}`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <Map size={18} />
                                                <div className="text-left">
                                                    <p className="text-xs font-black">Obligar carga de Espacio</p>
                                                    <p className="text-[9px] font-bold opacity-70 italic tracking-tight">Requiere asignar salón/sala para guardar</p>
                                                </div>
                                            </div>
                                            <div className={`w-8 h-4 rounded-full relative transition-colors ${editForm.requiresSpace ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                                                <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${editForm.requiresSpace ? 'left-4.5' : 'left-0.5'}`} />
                                            </div>
                                        </button>
                                    )}
                                </div>
                            </section>

                            {/* Succession Flow Settings */}
                            <section className="space-y-4">
                                <h4 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest flex items-center gap-2">
                                    <GitMerge size={14} /> Flujo de Sucesión
                                </h4>
                                <div className="p-6 bg-indigo-50/50 rounded-[2rem] border border-indigo-100 space-y-4">
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Siguiente Acción Sugerida</label>
                                        <select
                                            value={editForm.next_suggested_type_id || ''}
                                            onChange={e => setEditForm(prev => ({ ...prev, next_suggested_type_id: e.target.value || undefined }))}
                                            className="w-full px-5 py-4 bg-white rounded-2xl font-bold text-sm text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500 appearance-none border border-transparent focus:border-indigo-100 transition-all"
                                        >
                                            <option value="">-- Sin acción posterior --</option>
                                            {types
                                                .filter(t => t.id !== editForm.id && t.isActive) // Prevent self-reference
                                                .map(t => (
                                                    <option key={t.id} value={t.id}>{t.label} ({t.nature})</option>
                                                ))}
                                        </select>
                                        <p className="mt-2 text-[10px] text-gray-400 font-medium">
                                            Al completar este servicio, se sugerirá agendar automáticamente esta acción.
                                        </p>
                                    </div>

                                    {editForm.next_suggested_type_id && (
                                        <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                                            <div>
                                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Intervalo Sugerido</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={editForm.suggested_interval || ''}
                                                    onChange={e => setEditForm(prev => ({ ...prev, suggested_interval: parseInt(e.target.value) || 0 }))}
                                                    placeholder="Ej: 2"
                                                    className="w-full px-5 py-4 bg-white rounded-2xl font-black text-sm outline-none focus:ring-2 focus:ring-indigo-500 border border-transparent focus:border-indigo-100 transition-all"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">Unidad de Tiempo</label>
                                                <select
                                                    value={editForm.suggested_interval_unit || 'DAYS'}
                                                    onChange={e => setEditForm(prev => ({ ...prev, suggested_interval_unit: e.target.value as any }))}
                                                    className="w-full px-5 py-4 bg-white rounded-2xl font-bold text-sm text-gray-700 outline-none focus:ring-2 focus:ring-indigo-500 appearance-none border border-transparent focus:border-indigo-100 transition-all"
                                                >
                                                    <option value="HOURS">Horas después</option>
                                                    <option value="DAYS">Días después</option>
                                                </select>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </section>
                        </div>

                        <div className="p-8 border-t border-gray-100 bg-gray-50/50 flex flex-col gap-3 shrink-0">
                            <button
                                onClick={handleSave}
                                className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all"
                            >
                                {types.find(t => t.id === editForm.id) ? 'Guardar Cambios' : 'Crear Tipo de Servicio'}
                            </button>
                            <button
                                onClick={() => setShowEditModal(false)}
                                className="w-full py-4 bg-white text-gray-400 rounded-2xl font-black uppercase tracking-widest text-xs border border-gray-100 hover:bg-gray-100 transition-all"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default ServiceTypeManager;
