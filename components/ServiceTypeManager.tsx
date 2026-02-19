import React, { useState, useEffect } from 'react';
import { ServiceType } from '../types';
import { agendaService } from '../services/AgendaService';
import {
    Plus, Trash2, Edit2, Check, X, Tag,
    LayoutList, Calendar, Users
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

interface ServiceTypeManagerProps {
    onClose: () => void;
    onUpdate: () => void;
}

const ServiceTypeManager: React.FC<ServiceTypeManagerProps> = ({ onClose, onUpdate }) => {
    const [types, setTypes] = useState<ServiceType[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isEditing, setIsEditing] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<Partial<ServiceType>>({});

    // Default color palette
    const colors = [
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

    useEffect(() => {
        loadTypes();
    }, []);

    const loadTypes = async () => {
        setIsLoading(true);
        try {
            const data = await agendaService.getServiceTypes();
            setTypes(data);
        } catch (error) {
            console.error("Error loading types", error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleEdit = (type: ServiceType) => {
        setIsEditing(type.id);
        setEditForm({ ...type });
    };

    const handleCreate = () => {
        const newId = uuidv4();
        // Avoid collision with existing edits
        if (isEditing) return;

        const newType: Partial<ServiceType> = {
            id: newId,
            name: '',
            label: '',
            nature: 'CRM',
            color: colors[0],
            isActive: true
        };

        setEditForm(newType);
        setIsEditing(newId);
    };

    const handleSave = async () => {
        if (!editForm.label || !editForm.nature) return;

        // Auto-generate name from label if missing
        const name = editForm.name || editForm.label.toUpperCase().replace(/\s+/g, '_');

        const typeToSave = {
            ...editForm,
            name
        } as ServiceType;

        await agendaService.saveServiceType(typeToSave);
        setIsEditing(null);
        setEditForm({});
        await loadTypes();
        onUpdate();
    };

    const handleDelete = async (id: string) => {
        if (confirm('¿Seguro que desea eliminar este tipo?')) {
            await agendaService.deleteServiceType(id);
            await loadTypes();
            onUpdate();
        }
    };

    const crmTypes = types.filter(t => t.nature === 'CRM');
    const bookingTypes = types.filter(t => t.nature === 'BOOKING');

    return (
        <div className="h-full flex flex-col bg-white/50">
            <header className="px-8 py-6 border-b border-gray-100 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-pink-500 text-white rounded-2xl shadow-lg shadow-pink-200">
                        <Tag size={20} />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-gray-900 tracking-tight">Tipos de Servicio</h2>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Configuración</p>
                    </div>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={handleCreate}
                        disabled={!!isEditing}
                        className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 transition-all"
                    >
                        <Plus size={18} /> Nuevo
                    </button>
                    <button
                        onClick={onClose}
                        className="p-3 bg-gray-100 text-gray-500 rounded-xl hover:bg-gray-200 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl mx-auto">

                    {/* CRM Section */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-200">
                            <Users size={16} className="text-indigo-500" />
                            <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">CRM (Clientes)</h3>
                        </div>

                        {crmTypes.map(type => (
                            <div key={type.id} className="group p-4 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all">
                                {isEditing === type.id ? (
                                    <div className="flex flex-col gap-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="col-span-2">
                                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Nombre Visible</label>
                                                <input
                                                    autoFocus
                                                    value={editForm.label || ''}
                                                    onChange={e => setEditForm({ ...editForm, label: e.target.value })}
                                                    placeholder="Ej: Reunión Ejecutiva"
                                                    className="w-full px-4 py-3 bg-gray-50 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                                />
                                            </div>

                                            <div>
                                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Naturaleza</label>
                                                <select
                                                    value={editForm.nature || 'CRM'}
                                                    onChange={e => setEditForm({ ...editForm, nature: e.target.value as any })}
                                                    className="w-full px-4 py-3 bg-gray-50 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                                >
                                                    <option value="CRM">CRM</option>
                                                    <option value="BOOKING">BOOKING</option>
                                                </select>
                                            </div>

                                            <div>
                                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Color</label>
                                                <div className="flex gap-2 flex-wrap items-center">
                                                    {colors.slice(0, 5).map((c: string) => (
                                                        <button
                                                            key={c}
                                                            onClick={() => setEditForm({ ...editForm, color: c })}
                                                            className={`w-6 h-6 rounded-full transition-transform ${editForm.color === c ? 'scale-125 ring-2 ring-offset-2 ring-gray-300' : 'hover:scale-110'}`}
                                                            style={{ backgroundColor: c }}
                                                        />
                                                    ))}
                                                    <input
                                                        type="color"
                                                        value={editForm.color || '#000000'}
                                                        onChange={e => setEditForm({ ...editForm, color: e.target.value })}
                                                        className="w-6 h-6 rounded-full overflow-hidden border-0 p-0 cursor-pointer"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex justify-end gap-3 mt-2 border-t border-gray-50 pt-3">
                                            <button onClick={() => setIsEditing(null)} className="px-4 py-2 text-gray-500 font-bold hover:bg-gray-100 rounded-lg text-sm">Cancelar</button>
                                            <button onClick={handleSave} className="px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg text-sm hover:bg-indigo-700 shadow-md">Guardar</button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div
                                                className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm"
                                                style={{ backgroundColor: type.color }}
                                            >
                                                <Tag size={18} />
                                            </div>
                                            <div>
                                                <p className="font-bold text-gray-900">{type.label}</p>
                                                <p className="text-[10px] text-gray-400 font-mono uppercase">{type.name}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => handleEdit(type)} className="p-2 text-indigo-500 hover:bg-indigo-50 rounded-lg">
                                                <Edit2 size={16} />
                                            </button>
                                            <button onClick={() => handleDelete(type.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Booking Section */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-200">
                            <Calendar size={16} className="text-emerald-500" />
                            <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">Bookings (Reservas)</h3>
                        </div>

                        {bookingTypes.map(type => (
                            <div key={type.id} className="group p-4 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all">
                                {isEditing === type.id ? (
                                    <div className="flex flex-col gap-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="col-span-2">
                                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Nombre Visible</label>
                                                <input
                                                    autoFocus
                                                    value={editForm.label || ''}
                                                    onChange={e => setEditForm({ ...editForm, label: e.target.value })}
                                                    placeholder="Ej: Boda Premium"
                                                    className="w-full px-4 py-3 bg-gray-50 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                                />
                                            </div>

                                            <div>
                                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Naturaleza</label>
                                                <select
                                                    value={editForm.nature || 'BOOKING'}
                                                    onChange={e => setEditForm({ ...editForm, nature: e.target.value as any })}
                                                    className="w-full px-4 py-3 bg-gray-50 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                                >
                                                    <option value="CRM">CRM</option>
                                                    <option value="BOOKING">BOOKING</option>
                                                </select>
                                            </div>

                                            <div>
                                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Color</label>
                                                <div className="flex gap-2 flex-wrap items-center">
                                                    {colors.slice(0, 5).map((c: string) => (
                                                        <button
                                                            key={c}
                                                            onClick={() => setEditForm({ ...editForm, color: c })}
                                                            className={`w-6 h-6 rounded-full transition-transform ${editForm.color === c ? 'scale-125 ring-2 ring-offset-2 ring-gray-300' : 'hover:scale-110'}`}
                                                            style={{ backgroundColor: c }}
                                                        />
                                                    ))}
                                                    <input
                                                        type="color"
                                                        value={editForm.color || '#000000'}
                                                        onChange={e => setEditForm({ ...editForm, color: e.target.value })}
                                                        className="w-6 h-6 rounded-full overflow-hidden border-0 p-0 cursor-pointer"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex justify-end gap-3 mt-2 border-t border-gray-50 pt-3">
                                            <button onClick={() => setIsEditing(null)} className="px-4 py-2 text-gray-500 font-bold hover:bg-gray-100 rounded-lg text-sm">Cancelar</button>
                                            <button onClick={handleSave} className="px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg text-sm hover:bg-indigo-700 shadow-md">Guardar</button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div
                                                className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-sm"
                                                style={{ backgroundColor: type.color }}
                                            >
                                                <Tag size={18} />
                                            </div>
                                            <div>
                                                <p className="font-bold text-gray-900">{type.label}</p>
                                                <p className="text-[10px] text-gray-400 font-mono uppercase">{type.name}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button onClick={() => handleEdit(type)} className="p-2 text-indigo-500 hover:bg-indigo-50 rounded-lg">
                                                <Edit2 size={16} />
                                            </button>
                                            <button onClick={() => handleDelete(type.id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Create Modal Overlay */}
                {isEditing && !types.find(t => t.id === isEditing) && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm p-4">
                        <div className="w-full max-w-lg bg-white rounded-3xl p-8 shadow-2xl animate-in zoom-in-95">
                            <h3 className="text-xl font-black text-gray-900 mb-6 flex items-center gap-2">
                                <Plus size={24} className="text-indigo-600" />
                                Nuevo Tipo de Servicio
                            </h3>

                            <div className="flex flex-col gap-6">
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="col-span-2">
                                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Nombre Visible</label>
                                        <input
                                            autoFocus
                                            value={editForm.label || ''}
                                            onChange={e => setEditForm({ ...editForm, label: e.target.value })}
                                            placeholder="Ej: Reunión Ejecutiva"
                                            className="w-full px-5 py-4 bg-gray-50 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                        />
                                    </div>

                                    <div>
                                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Naturaleza</label>
                                        <select
                                            value={editForm.nature || 'CRM'}
                                            onChange={e => setEditForm({ ...editForm, nature: e.target.value as any })}
                                            className="w-full px-5 py-4 bg-gray-50 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                        >
                                            <option value="CRM">CRM</option>
                                            <option value="BOOKING">BOOKING</option>
                                        </select>
                                    </div>

                                    <div>
                                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Color</label>
                                        <div className="flex gap-2 flex-wrap items-center mt-2">
                                            {colors.slice(0, 5).map((c: string) => (
                                                <button
                                                    key={c}
                                                    onClick={() => setEditForm({ ...editForm, color: c })}
                                                    className={`w-8 h-8 rounded-full transition-transform ${editForm.color === c ? 'scale-125 ring-2 ring-offset-2 ring-gray-300' : 'hover:scale-110'}`}
                                                    style={{ backgroundColor: c }}
                                                />
                                            ))}
                                            <input
                                                type="color"
                                                value={editForm.color || '#000000'}
                                                onChange={e => setEditForm({ ...editForm, color: e.target.value })}
                                                className="w-8 h-8 rounded-full overflow-hidden border-0 p-0 cursor-pointer"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-end gap-3 pt-4">
                                    <button onClick={() => setIsEditing(null)} className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl text-sm">Cancelar</button>
                                    <button onClick={handleSave} className="px-8 py-3 bg-indigo-600 text-white font-bold rounded-xl text-sm hover:bg-indigo-700 shadow-xl shadow-indigo-200">Guardar Tipo</button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ServiceTypeManager;
