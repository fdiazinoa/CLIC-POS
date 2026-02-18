
import React, { useState } from 'react';
import { X, Save, Building2, Users, DollarSign, Palette, Box } from 'lucide-react';
import { Room, Warehouse } from '../types';

interface SpaceFormProps {
    initialData: Room | null;
    warehouses: Warehouse[];
    onSave: (space: Room) => void;
    onClose: () => void;
}

const SpaceForm: React.FC<SpaceFormProps> = ({ initialData, warehouses, onSave, onClose }) => {
    const [formData, setFormData] = useState<Room>(initialData || {
        id: crypto.randomUUID(),
        nombre: '',
        name: '',
        capacidad_pax: 0,
        base_price: 0,
        color: 'bg-blue-500',
        warehouse_id: warehouses[0]?.id || ''
    });

    const colors = [
        { name: 'Azul', value: 'bg-blue-500' },
        { name: 'Esmeralda', value: 'bg-emerald-500' },
        { name: 'Indigo', value: 'bg-indigo-500' },
        { name: 'Naranja', value: 'bg-orange-500' },
        { name: 'Rosa', value: 'bg-pink-500' },
        { name: 'Purpura', value: 'bg-purple-500' },
        { name: 'Cian', value: 'bg-cyan-500' },
        { name: 'Ambar', value: 'bg-amber-500' },
    ];

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({ ...formData, name: formData.nombre });
    };

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-lg bg-white rounded-[2rem] shadow-2xl border border-white overflow-hidden animate-in zoom-in-95">
                <header className="px-8 py-6 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-xl">
                            <Building2 size={24} />
                        </div>
                        <h2 className="text-xl font-black text-gray-800 tracking-tight">
                            {initialData ? 'Editar Espacio' : 'Nuevo Espacio'}
                        </h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
                        <X size={24} />
                    </button>
                </header>

                <form onSubmit={handleSubmit} className="p-8 space-y-6">
                    <div>
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Nombre del Espacio</label>
                        <input
                            required
                            type="text"
                            value={formData.nombre}
                            onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                            placeholder="Ej: Salón A, Terraza, Cabina 1"
                            className="w-full px-5 py-3 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block flex items-center gap-2">
                                <Users size={12} /> Capacidad (PAX)
                            </label>
                            <input
                                type="number"
                                value={formData.capacidad_pax || ''}
                                onChange={(e) => setFormData({ ...formData, capacidad_pax: parseInt(e.target.value) || 0 })}
                                className="w-full px-5 py-3 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block flex items-center gap-2">
                                <DollarSign size={12} /> Precio Base
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                value={formData.base_price || ''}
                                onChange={(e) => setFormData({ ...formData, base_price: parseFloat(e.target.value) || 0 })}
                                className="w-full px-5 py-3 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block flex items-center gap-2">
                            <Box size={12} /> Almacén Relacionado
                        </label>
                        <select
                            value={formData.warehouse_id || ''}
                            onChange={(e) => setFormData({ ...formData, warehouse_id: e.target.value })}
                            className="w-full px-5 py-3 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold appearance-none"
                        >
                            <option value="">Seleccione Almacén...</option>
                            {warehouses.map(wh => <option key={wh.id} value={wh.id}>{wh.name}</option>)}
                        </select>
                    </div>

                    <div>
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block flex items-center gap-2">
                            <Palette size={12} /> Color Identificador
                        </label>
                        <div className="grid grid-cols-4 gap-2">
                            {colors.map(c => (
                                <button
                                    key={c.value}
                                    type="button"
                                    onClick={() => setFormData({ ...formData, color: c.value })}
                                    className={`h-10 rounded-lg flex items-center justify-center transition-all ${c.value} ${formData.color === c.value ? 'ring-4 ring-offset-2 ring-blue-500 scale-95 shadow-lg' : 'hover:scale-105 opacity-80'}`}
                                >
                                    {formData.color === c.value && <div className="w-2 h-2 bg-white rounded-full" />}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl transition-all"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            className="px-8 py-3 bg-blue-600 text-white font-black uppercase tracking-widest rounded-xl hover:bg-blue-700 shadow-xl shadow-blue-100 flex items-center gap-2 transition-all active:scale-95"
                        >
                            <Save size={18} /> Guardar Espacio
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SpaceForm;
