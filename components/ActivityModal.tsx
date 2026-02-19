import React, { useState, useEffect } from 'react';
import {
    X, Save, Calendar, Clock, MapPin, User,
    FileText, Tag, Briefcase, CheckCircle,
    AlertCircle, Users, Building2
} from 'lucide-react';
import { Activity, ActivityNature, ActivityType, Customer, Room, User as UserType, ServiceType } from '../types';
import { format } from 'date-fns';

interface ActivityModalProps {
    isOpen: boolean;
    onClose: () => void;
    activity: Activity | null;
    initialDate: Date | null;
    initialResourceId: string | null; // Room ID or User ID
    customers: Customer[];
    rooms: Room[];
    users: UserType[];
    serviceTypes: ServiceType[];
    onSave: (activity: Partial<Activity>) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onUpdateRooms?: (rooms: Room[]) => void;
}

const ActivityModal: React.FC<ActivityModalProps> = ({
    isOpen,
    onClose,
    activity,
    initialDate,
    initialResourceId,
    customers,
    rooms,
    users,
    serviceTypes,
    onSave,
    onDelete,
    onUpdateRooms
}) => {
    const [formData, setFormData] = useState<Partial<Activity>>({
        nature: 'CRM',
        type: 'MEETING',
        status: 'PLANNED',
        priority: 'MEDIUM'
    });
    const [isSaving, setIsSaving] = useState(false);
    const [showSpaceQuickAdd, setShowSpaceQuickAdd] = useState(false);
    const [newSpaceName, setNewSpaceName] = useState('');
    const [newSpaceCapacity, setNewSpaceCapacity] = useState('10');

    useEffect(() => {
        if (isOpen) {
            if (activity) {
                setFormData({ ...activity });
            } else {
                // Initialize new activity
                const now = initialDate || new Date();
                const end = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour duration default

                // Try to infer resource (Space or User)
                const inferredSpace = rooms.find(r => r.id === initialResourceId);
                const inferredUser = users.find(u => u.id === initialResourceId);

                setFormData({
                    nature: 'CRM',
                    type: 'MEETING',
                    status: 'PLANNED',
                    priority: 'MEDIUM',
                    startDate: now.toISOString(),
                    endDate: end.toISOString(),
                    spaceId: inferredSpace ? inferredSpace.id : undefined,
                    spaceName: inferredSpace ? inferredSpace.name : undefined,
                    assignedToId: inferredUser ? inferredUser.id : undefined,
                    assignedToName: inferredUser ? inferredUser.name : undefined,
                });
            }
        }
    }, [isOpen, activity, initialDate, initialResourceId, rooms, users]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            await onSave(formData);
            onClose();
        } catch (error) {
            console.error("Error saving activity:", error);
            alert("Error al guardar la actividad");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (activity && confirm('¿Estás seguro de eliminar esta actividad?')) {
            await onDelete(activity.id);
            onClose();
        }
    };

    // Filter service types based on nature
    const currentTypes = serviceTypes.filter(t => t.nature === formData.nature && t.isActive);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
            <div className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="px-8 py-5 border-b border-gray-100 flex items-center justify-between shrink-0 bg-white">
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-2xl ${formData.nature === 'BOOKING' ? 'bg-purple-100 text-purple-600' : 'bg-indigo-100 text-indigo-600'}`}>
                            {formData.nature === 'BOOKING' ? <Building2 size={24} /> : <Briefcase size={24} />}
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-gray-900 tracking-tight">
                                {activity ? 'Editar Actividad' : 'Nueva Actividad'}
                            </h2>
                            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                                {formData.nature === 'BOOKING' ? 'Reserva de Espacio' : 'Gestión CRM'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-400 hover:text-gray-600"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 overflow-hidden flex">
                    {/* LEFT COLUMN: Main Details */}
                    <div className="flex-1 overflow-y-auto p-8 custom-scrollbar border-r border-gray-100">
                        <form onSubmit={handleSubmit} id="activity-form" className="space-y-6">
                            {/* Nature Selector */}
                            <div className="flex bg-gray-100 p-1.5 rounded-2xl">
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, nature: 'CRM', type: serviceTypes.find(t => t.nature === 'CRM')?.name || 'MEETING' })}
                                    className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${formData.nature === 'CRM' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                >
                                    <Briefcase size={16} /> CRM
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, nature: 'BOOKING', type: serviceTypes.find(t => t.nature === 'BOOKING')?.name || 'SPACE_RENTAL' })}
                                    className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${formData.nature === 'BOOKING' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                >
                                    <Building2 size={16} /> Booking
                                </button>
                            </div>

                            {/* Title */}
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Título</label>
                                <input
                                    required
                                    value={formData.title || ''}
                                    onChange={e => setFormData({ ...formData, title: e.target.value })}
                                    placeholder={formData.nature === 'BOOKING' ? "Ej: Boda García-Pérez" : "Ej: Reunión de ventas"}
                                    className="w-full px-4 py-3 bg-gray-50 rounded-xl font-bold text-gray-900 placeholder:text-gray-300 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                                />
                            </div>

                            {/* Type & Priority Row */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Tipo</label>
                                    <div className="relative">
                                        <select
                                            value={formData.type || ''}
                                            onChange={e => setFormData({ ...formData, type: e.target.value })}
                                            className="w-full px-4 py-3 bg-gray-50 rounded-xl font-bold text-sm text-gray-900 appearance-none focus:ring-2 focus:ring-indigo-100 outline-none"
                                        >
                                            {currentTypes.length > 0 ? (
                                                currentTypes.map(t => (
                                                    <option key={t.id} value={t.name}>{t.label}</option>
                                                ))
                                            ) : (
                                                <option value="" disabled>No hay tipos definidos</option>
                                            )}
                                        </select>
                                        <Tag size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Prioridad</label>
                                    <div className="relative">
                                        <select
                                            value={formData.priority || 'MEDIUM'}
                                            onChange={e => setFormData({ ...formData, priority: e.target.value as any })}
                                            className="w-full px-4 py-3 bg-gray-50 rounded-xl font-bold text-sm text-gray-900 appearance-none focus:ring-2 focus:ring-indigo-100 outline-none"
                                        >
                                            <option value="LOW">Baja</option>
                                            <option value="MEDIUM">Media</option>
                                            <option value="HIGH">Alta</option>
                                            <option value="URGENT">Urgente</option>
                                        </select>
                                        <AlertCircle size={16} className={`absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none ${formData.priority === 'URGENT' ? 'text-red-500' : 'text-gray-400'}`} />
                                    </div>
                                </div>
                            </div>

                            {/* Status */}
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Estado</label>
                                <div className="flex gap-2">
                                    {['PLANNED', 'CONFIRMED', 'COMPLETED', 'CANCELLED'].map(s => (
                                        <button
                                            key={s}
                                            type="button"
                                            onClick={() => setFormData({ ...formData, status: s as any })}
                                            className={`
                                                flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all
                                                ${formData.status === s
                                                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                                                    : 'bg-white border-gray-100 text-gray-400 hover:bg-gray-50'}
                                            `}
                                        >
                                            {s === 'PLANNED' && 'Planificado'}
                                            {s === 'CONFIRMED' && 'Confirmado'}
                                            {s === 'COMPLETED' && 'Completado'}
                                            {s === 'CANCELLED' && 'Cancelado'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Description */}
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Descripción</label>
                                <textarea
                                    rows={4}
                                    value={formData.description || ''}
                                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="Detalles adicionales, notas, requerimientos..."
                                    className="w-full px-4 py-3 bg-gray-50 rounded-xl font-medium text-sm text-gray-900 placeholder:text-gray-300 focus:ring-2 focus:ring-indigo-100 outline-none resize-none"
                                />
                            </div>
                        </form>
                    </div>

                    {/* RIGHT COLUMN: Resources & Date */}
                    <div className="w-80 bg-gray-50/50 p-8 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
                        {/* Time & Date */}
                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                            <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <Calendar size={14} className="text-indigo-500" />
                                Fecha y Hora
                            </h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Inicio</label>
                                    <input
                                        type="datetime-local"
                                        required
                                        value={formData.startDate?.slice(0, 16) || ''}
                                        onChange={e => setFormData({ ...formData, startDate: new Date(e.target.value).toISOString() })}
                                        className="w-full bg-gray-50 border-none rounded-lg text-xs font-bold text-gray-700 py-2"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Fin</label>
                                    <input
                                        type="datetime-local"
                                        required
                                        value={formData.endDate?.slice(0, 16) || ''}
                                        onChange={e => setFormData({ ...formData, endDate: new Date(e.target.value).toISOString() })}
                                        className="w-full bg-gray-50 border-none rounded-lg text-xs font-bold text-gray-700 py-2"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Customer */}
                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                            <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <Users size={14} className="text-pink-500" />
                                Cliente
                            </h3>
                            <select
                                value={formData.customerId || ''}
                                onChange={e => {
                                    const cust = customers.find(c => c.id === e.target.value);
                                    setFormData({
                                        ...formData,
                                        customerId: cust?.id,
                                        customerName: cust ? cust.name : undefined
                                    });
                                }}
                                className="w-full bg-gray-50 border-none rounded-lg text-xs font-bold text-gray-700 py-2.5 px-3 outline-none"
                            >
                                <option value="">-- Seleccionar Cliente --</option>
                                {customers.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Assignments */}
                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                            <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <MapPin size={14} className="text-emerald-500" />
                                Asignación
                            </h3>

                            <div className="space-y-4">
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Espacio / Salón</label>
                                    <select
                                        value={formData.spaceId || ''}
                                        onChange={e => {
                                            const room = rooms.find(r => r.id === e.target.value);
                                            setFormData({
                                                ...formData,
                                                spaceId: room?.id,
                                                spaceName: room?.name
                                            });
                                        }}
                                        className="w-full bg-gray-50 border-none rounded-lg text-xs font-bold text-gray-700 py-2.5 px-3 outline-none"
                                    >
                                        <option value="">-- Ninguno --</option>
                                        {rooms.map(r => (
                                            <option key={r.id} value={r.id}>{r.name} ({r.capacity}p)</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Responsable</label>
                                    <select
                                        value={formData.assignedToId || ''}
                                        onChange={e => {
                                            const user = users.find(u => u.id === e.target.value);
                                            setFormData({
                                                ...formData,
                                                assignedToId: user?.id,
                                                assignedToName: user?.name
                                            });
                                        }}
                                        className="w-full bg-gray-50 border-none rounded-lg text-xs font-bold text-gray-700 py-2.5 px-3 outline-none"
                                    >
                                        <option value="">-- Sistema --</option>
                                        {users.map(u => (
                                            <option key={u.id} value={u.id}>{u.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="px-8 py-5 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between shrink-0">
                    {activity ? (
                        <button
                            type="button"
                            onClick={handleDelete}
                            className="text-red-500 hover:text-red-700 font-bold text-sm flex items-center gap-2 px-4 py-2 hover:bg-red-50 rounded-xl transition-colors"
                        >
                            <span className="hidden sm:inline">Eliminar</span> {/* Hidden text on mobile if needed, but this is desk */}
                            Eliminar
                        </button>
                    ) : (
                        <div />
                    )}

                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors text-sm"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={isSaving}
                            className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all text-sm flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                        >
                            {isSaving ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    <span>Guardando...</span>
                                </>
                            ) : (
                                <>
                                    <CheckCircle size={18} />
                                    <span>Guardar Actividad</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ActivityModal;
