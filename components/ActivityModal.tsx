import React, { useState, useEffect } from 'react';
import {
    X, Calendar, Clock, User, Users, MapPin,
    Tag, AlertCircle, Check, Trash2, Building2, ArrowUpRight, Plus
} from 'lucide-react';
import {
    Activity,
    ActivityNature,
    ActivityType,
    ActivityStatus,
    ActivityPriority,
    Customer,
    Room,
    User as UserType
} from '../types';
import { format, parseISO } from 'date-fns';
import { agendaService } from '../services/AgendaService';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../utils/db';

interface ActivityModalProps {
    isOpen: boolean;
    onClose: () => void;
    activity: Activity | null;
    initialDate?: Date | null;
    initialResourceId?: string | null;
    customers: Customer[];
    rooms: Room[];
    users: UserType[];
    onSave: (activity: Partial<Activity>) => Promise<void>;
    onDelete?: (id: string) => Promise<void>;
    onConvertToQuote?: (activity: Activity) => Promise<void>;
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
    onSave,
    onDelete,
    onConvertToQuote,
    onUpdateRooms
}) => {
    const [formData, setFormData] = useState<Partial<Activity>>({
        nature: 'CRM',
        type: 'MEETING',
        status: 'PLANNED',
        priority: 'MEDIUM',
        title: '',
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 3600000).toISOString(),
        assignedToId: 'sys'
    });

    const [isSaving, setIsSaving] = useState(false);
    const [isCreatingSpace, setIsCreatingSpace] = useState(false);
    const [newSpaceName, setNewSpaceName] = useState('');
    const [availabilityConflict, setAvailabilityConflict] = useState<Activity | null>(null);

    useEffect(() => {
        if (activity) {
            setFormData(activity);
        } else if (initialDate) {
            const room = rooms.find(r => r.id === initialResourceId);
            setFormData({
                nature: initialResourceId ? 'BOOKING' : 'CRM',
                type: initialResourceId ? 'SPACE_RENTAL' : 'MEETING',
                status: 'PLANNED',
                priority: 'MEDIUM',
                title: '',
                startDate: initialDate.toISOString(),
                endDate: new Date(initialDate.getTime() + 3600000).toISOString(),
                assignedToId: 'sys',
                spaceId: initialResourceId || undefined,
                spaceName: room ? (room.name || room.nombre) : undefined
            });
        } else {
            setFormData({
                nature: 'CRM',
                type: 'MEETING',
                status: 'PLANNED',
                priority: 'MEDIUM',
                title: '',
                startDate: new Date().toISOString(),
                endDate: new Date(Date.now() + 3600000).toISOString(),
                assignedToId: 'sys'
            });
        }
    }, [activity, initialDate, initialResourceId, isOpen, rooms]);

    if (!isOpen) return null;

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setAvailabilityConflict(null);

        try {
            // Real-time Availability Validation (only for Bookings)
            if (formData.nature === 'BOOKING' && formData.spaceId && formData.startDate && formData.endDate) {
                const conflicts = await agendaService.getActivitiesByRange(formData.startDate, formData.endDate);
                const actualConflict = conflicts.find(a =>
                    a.id !== activity?.id &&
                    a.nature === 'BOOKING' &&
                    a.spaceId === formData.spaceId &&
                    a.status !== 'CANCELLED'
                );

                if (actualConflict) {
                    setAvailabilityConflict(actualConflict);
                    setIsSaving(false);
                    return;
                }
            }

            await onSave(formData);
            onClose();
        } catch (error) {
            console.error("Save error:", error);
            alert("Error al guardar la actividad");
        } finally {
            setIsSaving(false);
        }
    };

    const handleQuickAddSpace = async () => {
        if (!newSpaceName.trim()) return;
        setIsSaving(true);
        try {
            const newRoom: Room = {
                id: uuidv4(),
                name: newSpaceName,
                nombre: newSpaceName,
                color: '#4f46e5',
                capacidad_pax: 0,
                base_price: 0
            } as Room;

            const updatedRooms = [...rooms, newRoom];
            await db.save('rooms' as any, updatedRooms);

            if (onUpdateRooms) {
                onUpdateRooms(updatedRooms);
            }

            setFormData({
                ...formData,
                spaceId: newRoom.id,
                spaceName: newRoom.name
            });
            setIsCreatingSpace(false);
            setNewSpaceName('');
        } catch (error) {
            console.error("Quick add failed:", error);
        } finally {
            setIsSaving(false);
        }
    };

    const crmTypes: ActivityType[] = ['CALL', 'EMAIL', 'MEETING', 'VISIT', 'TECHNICAL', 'LUNCH', 'OTHER'];
    const bookingTypes: ActivityType[] = ['WEDDING', 'CONFERENCE', 'SPACE_RENTAL', 'OTHER'];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-md transition-opacity"
                onClick={onClose}
            />

            {/* Modal Card */}
            <div className="relative w-full max-w-4xl bg-white/90 backdrop-blur-2xl rounded-[2.5rem] shadow-[0_20px_70px_rgba(0,0,0,0.25)] border border-white overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                <header className="px-8 py-6 border-b border-gray-100 flex items-center justify-between bg-white/50">
                    <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-2xl shadow-lg ${formData.nature === 'BOOKING' ? 'bg-emerald-500 shadow-emerald-200' : 'bg-indigo-500 shadow-indigo-200'} text-white`}>
                            {formData.nature === 'BOOKING' ? <Building2 size={20} /> : <Calendar size={20} />}
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-gray-900 tracking-tight">
                                {activity ? 'Editar Actividad' : 'Nueva Actividad'}
                            </h2>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                {formData.nature === 'BOOKING' ? 'Reserva de Espacio' : 'Gestión de Cliente'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-400 hover:text-gray-600"
                    >
                        <X size={24} />
                    </button>
                </header>

                <form onSubmit={handleSave} className="flex-1 flex flex-col min-h-0">
                    <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                        <div className="grid grid-cols-2 gap-8">

                            {/* Nature Selector */}
                            <div className="col-span-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Naturaleza de la Actividad</label>
                                <div className="flex bg-gray-100 p-1.5 rounded-2xl border border-gray-100">
                                    <button
                                        type="button"
                                        onClick={() => setFormData({ ...formData, nature: 'CRM', type: 'MEETING' })}
                                        className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${formData.nature === 'CRM' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400'}`}
                                    >
                                        <Users size={16} /> CRM
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setFormData({ ...formData, nature: 'BOOKING', type: 'SPACE_RENTAL' })}
                                        className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${formData.nature === 'BOOKING' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400'}`}
                                    >
                                        <Building2 size={16} /> Reserva
                                    </button>
                                </div>
                            </div>

                            {/* Title */}
                            <div className="col-span-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Título / Motivo</label>
                                <input
                                    required
                                    type="text"
                                    value={formData.title || ''}
                                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                                    placeholder="Ej: Reunión de ventas, Reserva Salón A..."
                                    className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 transition-all outline-none"
                                />
                            </div>

                            {/* Type & Priority */}
                            <div className="flex flex-col gap-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Tipo</label>
                                <select
                                    value={formData.type}
                                    onChange={(e) => setFormData({ ...formData, type: e.target.value as ActivityType })}
                                    className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 appearance-none outline-none"
                                >
                                    {(formData.nature === 'BOOKING' ? bookingTypes : crmTypes).map(t => (
                                        <option key={t} value={t}>{t}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Prioridad</label>
                                <select
                                    value={formData.priority}
                                    onChange={(e) => setFormData({ ...formData, priority: e.target.value as ActivityPriority })}
                                    className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 appearance-none outline-none"
                                >
                                    <option value="LOW">BAJA</option>
                                    <option value="MEDIUM">MEDIA</option>
                                    <option value="HIGH">ALTA</option>
                                    <option value="URGENT">URGENTE</option>
                                </select>
                            </div>

                            {/* Timestamps */}
                            <div className="flex flex-col gap-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                    <Clock size={12} /> Inicio
                                </label>
                                <input
                                    type="datetime-local"
                                    value={formData.startDate ? format(parseISO(formData.startDate), "yyyy-MM-dd'T'HH:mm") : ''}
                                    onChange={(e) => setFormData({ ...formData, startDate: new Date(e.target.value).toISOString() })}
                                    className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                    <Clock size={12} /> Fin
                                </label>
                                <input
                                    type="datetime-local"
                                    value={formData.endDate ? format(parseISO(formData.endDate), "yyyy-MM-dd'T'HH:mm") : ''}
                                    onChange={(e) => setFormData({ ...formData, endDate: new Date(e.target.value).toISOString() })}
                                    className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                            </div>

                            {/* Relationships */}
                            <div className="col-span-2 grid grid-cols-2 gap-6 pt-4 border-t border-gray-50">
                                <div className="flex flex-col gap-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                        <User size={12} /> Cliente (Opcional)
                                    </label>
                                    <select
                                        value={formData.customerId || ''}
                                        onChange={(e) => {
                                            const c = customers.find(x => x.id === e.target.value);
                                            setFormData({ ...formData, customerId: e.target.value, customerName: c?.name });
                                        }}
                                        className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 appearance-none outline-none"
                                    >
                                        <option value="">Ninguno</option>
                                        {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>

                                <div className="flex flex-col gap-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                        <Tag size={12} /> Responsable
                                    </label>
                                    <select
                                        value={formData.assignedToId || ''}
                                        onChange={(e) => {
                                            const u = users.find(x => x.id === e.target.value);
                                            setFormData({ ...formData, assignedToId: e.target.value, assignedToName: u?.name });
                                        }}
                                        className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 appearance-none outline-none"
                                    >
                                        {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* Space Selector (only for Bookings) */}
                            {formData.nature === 'BOOKING' && (
                                <div className="col-span-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2 mb-2">
                                        <Building2 size={12} /> Espacio / Salón
                                    </label>
                                    <div className="flex gap-3">
                                        {isCreatingSpace ? (
                                            <div className="flex-1 flex gap-2">
                                                <input
                                                    autoFocus
                                                    type="text"
                                                    value={newSpaceName}
                                                    onChange={(e) => setNewSpaceName(e.target.value)}
                                                    placeholder="Nombre del nuevo salón..."
                                                    className="flex-1 px-5 py-4 bg-white border-2 border-emerald-500 rounded-2xl text-sm font-bold outline-none"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleQuickAddSpace}
                                                    className="px-6 py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700"
                                                >
                                                    Crear
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setIsCreatingSpace(false)}
                                                    className="p-4 bg-gray-100 text-gray-400 rounded-2xl hover:bg-gray-200"
                                                >
                                                    <X size={20} />
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <select
                                                    required
                                                    value={formData.spaceId || ''}
                                                    onChange={(e) => {
                                                        const r = rooms.find(x => x.id === e.target.value);
                                                        setFormData({ ...formData, spaceId: e.target.value, spaceName: r?.name || r?.nombre });
                                                    }}
                                                    className="flex-1 px-5 py-4 bg-emerald-50 text-emerald-900 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-emerald-500 appearance-none outline-none"
                                                >
                                                    <option value="">Seleccione un espacio...</option>
                                                    {rooms.map(r => <option key={r.id} value={r.id}>{r.name || r.nombre}</option>)}
                                                </select>
                                                <button
                                                    type="button"
                                                    title="Alta Rápida de Espacio"
                                                    onClick={() => setIsCreatingSpace(true)}
                                                    className="p-4 bg-emerald-100 text-emerald-600 rounded-2xl hover:bg-emerald-200 transition-colors"
                                                >
                                                    <Plus size={20} />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Availability Conflict Alert */}
                            {availabilityConflict && (
                                <div className="col-span-2 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-4 animate-in fade-in slide-in-from-top-2">
                                    <AlertCircle className="text-red-500 shrink-0 mt-1" size={20} />
                                    <div>
                                        <p className="text-sm font-black text-red-900">Conflicto de Disponibilidad</p>
                                        <p className="text-xs text-red-700 font-medium">
                                            El espacio <b>{formData.spaceName}</b> ya está reservado para: <br />
                                            <span className="font-bold">"{availabilityConflict.title}"</span> ({format(parseISO(availabilityConflict.startDate), "HH:mm")} - {format(parseISO(availabilityConflict.endDate), "HH:mm")})
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Description */}
                            <div className="col-span-2">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 block">Descripción / Notas</label>
                                <textarea
                                    value={formData.description || ''}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    rows={3}
                                    placeholder="Detalles adicionales..."
                                    className="w-full px-5 py-4 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 transition-all outline-none resize-none"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Footer Actions (Sticky) */}
                    <div className="px-8 py-6 bg-white/50 backdrop-blur-md border-t border-gray-100 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            {activity && onDelete && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (confirm('¿Seguro que desea eliminar esta actividad?')) {
                                            onDelete(activity.id).then(onClose);
                                        }
                                    }}
                                    className="flex items-center gap-2 px-6 py-3 text-red-600 hover:bg-red-50 rounded-xl font-bold transition-all"
                                >
                                    <Trash2 size={18} /> <span className="hidden md:inline">Eliminar</span>
                                </button>
                            )}
                            {activity && activity.status !== 'COMPLETED' && (
                                <button
                                    type="button"
                                    onClick={async () => {
                                        if (confirm(`¿Convertir esta ${activity.nature === 'BOOKING' ? 'reserva' : 'actividad'} en una cotización de venta?`)) {
                                            setIsSaving(true);
                                            try {
                                                if (onConvertToQuote) {
                                                    await onConvertToQuote(activity);
                                                } else {
                                                    await agendaService.convertToQuote(activity);
                                                }
                                                onClose();
                                            } catch (e) {
                                                console.error(e);
                                                alert("Error al convertir a cotización");
                                            } finally {
                                                setIsSaving(false);
                                            }
                                        }
                                    }}
                                    className="flex items-center gap-2 px-6 py-3 text-indigo-600 hover:bg-indigo-50 rounded-xl font-bold transition-all"
                                >
                                    <ArrowUpRight size={18} /> <span className="hidden lg:inline">Convertir a Cotización</span>
                                </button>
                            )}
                        </div>

                        <div className="flex items-center gap-4">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-8 py-4 text-gray-500 font-bold hover:bg-gray-100 rounded-2xl transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                disabled={isSaving}
                                type="submit"
                                className={`
                                    px-12 py-4 rounded-2xl text-white font-black uppercase tracking-widest flex items-center gap-3 transition-all
                                    ${formData.nature === 'BOOKING' ? 'bg-emerald-600 shadow-xl shadow-emerald-200 hover:bg-emerald-700' : 'bg-indigo-600 shadow-xl shadow-indigo-200 hover:bg-indigo-700'}
                                    ${isSaving ? 'opacity-50' : 'active:scale-95'}
                                `}
                            >
                                {isSaving ? (
                                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                    <Check size={20} strokeWidth={3} />
                                )}
                                {activity ? 'Actualizar' : 'Guardar'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ActivityModal;
