import React, { useState } from 'react';
import {
    Plus, Trash2, Edit2, Save, X, Building2,
    Users, DollarSign, Palette, Warehouse as WarehouseIcon,
    ChevronRight, Info
} from 'lucide-react';
import { Room, Warehouse } from '../types';
import { db } from '../utils/db';
import { v4 as uuidv4 } from 'uuid';

interface SpacesManagerProps {
    rooms: Room[];
    warehouses: Warehouse[];
    onUpdateRooms: (rooms: Room[]) => void;
    onClose: () => void;
}

const SpacesManager: React.FC<SpacesManagerProps> = ({
    rooms,
    warehouses,
    onUpdateRooms,
    onClose
}) => {
    const [editingRoom, setEditingRoom] = useState<Partial<Room> | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        if (!editingRoom?.nombre && !editingRoom?.name) {
            alert("El nombre es obligatorio");
            return;
        }

        setIsSaving(true);
        try {
            let updatedRooms: Room[];
            const nameToUse = editingRoom.name || editingRoom.nombre || '';

            if (editingRoom.id) {
                // Update
                updatedRooms = rooms.map(r => r.id === editingRoom.id ? { ...r, ...editingRoom, name: nameToUse, nombre: nameToUse } as Room : r);
            } else {
                // Create
                const newRoom: Room = {
                    ...editingRoom,
                    id: uuidv4(),
                    name: nameToUse,
                    nombre: nameToUse,
                    capacidad_pax: editingRoom.capacidad_pax || 0,
                    base_price: editingRoom.base_price || 0,
                    color: editingRoom.color || '#4f46e5',
                } as Room;
                updatedRooms = [...rooms, newRoom];
            }

            await db.save('rooms' as any, updatedRooms);
            onUpdateRooms(updatedRooms);
            setEditingRoom(null);
        } catch (error) {
            console.error("Failed to save room:", error);
            alert("Error al guardar el espacio");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm("¿Seguro que desea eliminar este espacio?")) return;

        try {
            const updatedRooms = rooms.filter(r => r.id !== id);
            await db.save('rooms' as any, updatedRooms);
            onUpdateRooms(updatedRooms);
        } catch (error) {
            console.error("Failed to delete room:", error);
        }
    };

    return (
        <div className="flex-1 flex flex-col bg-gray-50 h-full overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <header className="px-8 py-6 bg-white border-b border-gray-100 flex items-center justify-between sticky top-0 z-10 shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-600 text-white rounded-2xl shadow-lg shadow-indigo-100">
                        <Building2 size={24} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-gray-900 tracking-tight leading-none mb-1">Espacios y Salones</h1>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Maestro de Infraestructura</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setEditingRoom({ color: '#4f46e5', capacidad_pax: 0, base_price: 0 })}
                        className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-black uppercase tracking-widest text-xs hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 active:scale-95"
                    >
                        <Plus size={18} strokeWidth={3} /> Nuevo Espacio
                    </button>
                    <button onClick={onClose} className="p-3 hover:bg-gray-100 rounded-full transition-colors">
                        <X size={24} className="text-gray-400" />
                    </button>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                <div className="max-w-6xl mx-auto">
                    {rooms.length === 0 && !editingRoom && (
                        <div className="flex flex-col items-center justify-center py-20 text-center">
                            <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-6">
                                <Building2 size={40} className="text-gray-300" />
                            </div>
                            <h3 className="text-xl font-bold text-gray-800 mb-2">No hay espacios configurados</h3>
                            <p className="text-gray-500 max-w-sm mb-8">Define salones, áreas o espacios físicos para gestionar reservas y eventos.</p>
                            <button
                                onClick={() => setEditingRoom({ color: '#4f46e5', capacidad_pax: 0, base_price: 0 })}
                                className="px-8 py-4 bg-white border border-gray-200 text-indigo-600 rounded-2xl font-bold hover:shadow-lg transition-all"
                            >
                                Empezar a Configurar
                            </button>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {rooms.map(room => (
                            <div
                                key={room.id}
                                className="group bg-white rounded-[2rem] border border-gray-100 p-6 hover:shadow-2xl hover:shadow-indigo-100/50 transition-all relative overflow-hidden"
                            >
                                <div className="absolute top-0 left-0 w-2 h-full" style={{ backgroundColor: room.color || '#4f46e5' }} />

                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2.5 rounded-xl bg-gray-50 text-gray-500">
                                            <Building2 size={20} />
                                        </div>
                                        <div>
                                            <h4 className="font-black text-gray-900 text-lg group-hover:text-indigo-600 transition-colors uppercase">
                                                {room.name || room.nombre}
                                            </h4>
                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">ID: {room.id.slice(0, 8)}</span>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setEditingRoom(room)}
                                            className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                        >
                                            <Edit2 size={18} />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(room.id)}
                                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4 mt-6">
                                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Capacidad</p>
                                        <div className="flex items-center gap-1.5">
                                            <Users size={14} className="text-slate-500" />
                                            <span className="text-lg font-black text-slate-700">{room.capacidad_pax || room.capacidad_personas || 0} Pax</span>
                                        </div>
                                    </div>
                                    <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-100">
                                        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Precio Base</p>
                                        <div className="flex items-center gap-1.5">
                                            <DollarSign size={14} className="text-indigo-500" />
                                            <span className="text-lg font-black text-indigo-700">${(room.base_price || 0).toLocaleString()}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-4 p-4 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <WarehouseIcon size={14} className="text-gray-400" />
                                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                                            {warehouses.find(w => w.id === room.warehouse_id)?.name || 'Sin Almacén'}
                                        </span>
                                    </div>
                                    <div className="w-4 h-4 rounded-full border border-white shadow-sm" style={{ backgroundColor: room.color }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Edit Modal */}
            {editingRoom && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-md transition-opacity" onClick={() => setEditingRoom(null)} />
                    <div className="relative w-full max-w-xl bg-white rounded-[2.5rem] shadow-2xl border border-white overflow-hidden animate-in zoom-in-95 duration-300">
                        <header className="px-8 py-6 border-b border-gray-100 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-indigo-500 text-white rounded-xl">
                                    {editingRoom.id ? <Edit2 size={20} /> : <Plus size={20} />}
                                </div>
                                <h3 className="text-xl font-black text-gray-900 tracking-tight">
                                    {editingRoom.id ? 'Editar Espacio' : 'Nuevo Espacio'}
                                </h3>
                            </div>
                            <button onClick={() => setEditingRoom(null)} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-400">
                                <X size={24} />
                            </button>
                        </header>

                        <div className="p-8 space-y-6">
                            <div className="space-y-4">
                                <div>
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Nombre del Espacio</label>
                                    <input
                                        type="text"
                                        value={editingRoom.name || editingRoom.nombre || ''}
                                        onChange={(e) => setEditingRoom({ ...editingRoom, name: e.target.value, nombre: e.target.value })}
                                        placeholder="Ej: Salón Rubí, Terraza Norte..."
                                        className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Capacidad Máxima</label>
                                        <div className="relative">
                                            <Users size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                            <input
                                                type="number"
                                                value={editingRoom.capacidad_pax || 0}
                                                onChange={(e) => setEditingRoom({ ...editingRoom, capacidad_pax: Number(e.target.value) })}
                                                className="w-full pl-12 pr-5 py-4 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Precio Base / Reserva</label>
                                        <div className="relative">
                                            <DollarSign size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                            <input
                                                type="number"
                                                value={editingRoom.base_price || 0}
                                                onChange={(e) => setEditingRoom({ ...editingRoom, base_price: Number(e.target.value) })}
                                                className="w-full pl-12 pr-5 py-4 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Almacén de Inventario Relacionado</label>
                                    <select
                                        value={editingRoom.warehouse_id || ''}
                                        onChange={(e) => setEditingRoom({ ...editingRoom, warehouse_id: e.target.value })}
                                        className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none appearance-none"
                                    >
                                        <option value="">Ninguno</option>
                                        {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                                    </select>
                                </div>

                                <div>
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Identificador Visual (Color)</label>
                                    <div className="flex gap-3">
                                        {['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777'].map(c => (
                                            <button
                                                key={c}
                                                onClick={() => setEditingRoom({ ...editingRoom, color: c })}
                                                className={`w-10 h-10 rounded-full border-2 transition-all ${editingRoom.color === c ? 'border-gray-900 scale-110 shadow-lg' : 'border-transparent'}`}
                                                style={{ backgroundColor: c }}
                                            />
                                        ))}
                                        <input
                                            type="color"
                                            value={editingRoom.color || '#4f46e5'}
                                            onChange={(e) => setEditingRoom({ ...editingRoom, color: e.target.value })}
                                            className="w-10 h-10 rounded-full border-2 border-transparent bg-transparent overflow-hidden"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 flex items-center gap-4">
                                <button
                                    onClick={() => setEditingRoom(null)}
                                    className="flex-1 px-8 py-4 text-gray-500 font-bold hover:bg-gray-100 rounded-2xl transition-all"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={isSaving}
                                    className="flex-1 px-8 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-3 hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 active:scale-95 disabled:opacity-50"
                                >
                                    {isSaving ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={18} />}
                                    {editingRoom.id ? 'Actualizar' : 'Crear Espacio'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SpacesManager;
