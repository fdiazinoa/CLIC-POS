import React, { useState, useEffect, useCallback } from 'react';
import {
    X, Save, Calendar, Clock, MapPin, User,
    FileText, Tag, Briefcase, CheckCircle,
    AlertCircle, Users, Building2, Package,
    Search, Plus, Trash2, CreditCard, DollarSign,
    ChevronRight, MessageSquare, HandCoins
} from 'lucide-react';
import {
    Activity,
    BookingSalesDocumentType,
    CollectionMethod,
    Customer,
    Opportunity,
    Room,
    User as UserType,
    ServiceType,
    Product,
    CartItem
} from '../types';
import { db } from '../utils/db';
import { format } from 'date-fns';
import { agendaService } from '../services/AgendaService';

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
    currentUser?: UserType;
    terminalId?: string;
    onSave: (activity: Partial<Activity>) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onActivityUpdated?: () => void;
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
    currentUser,
    terminalId = 'T1',
    onSave,
    onDelete,
    onActivityUpdated,
    onUpdateRooms
}) => {
    const [formData, setFormData] = useState<Partial<Activity>>({
        nature: 'CRM',
        type: 'MEETING',
        status: 'PLANNED',
        priority: 'MEDIUM',
        items: [],
        required_deposit: 0,
        current_balance: 0,
        payment_status: 'PENDING'
    });
    const [isSaving, setIsSaving] = useState(false);

    // Items / Services State
    const [catalog, setCatalog] = useState<Product[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [showItemSearch, setShowItemSearch] = useState(false);

    // Follow-up state
    const [showFollowUpDialog, setShowFollowUpDialog] = useState(false);
    const [suggestedAction, setSuggestedAction] = useState<{ type: ServiceType, date: Date } | null>(null);
    const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
    const [showDocumentDialog, setShowDocumentDialog] = useState(false);
    const [showAdvanceDialog, setShowAdvanceDialog] = useState(false);
    const [advanceAmount, setAdvanceAmount] = useState(0);
    const [advanceMethod, setAdvanceMethod] = useState<CollectionMethod>('CASH');
    const [commercialActionBusy, setCommercialActionBusy] = useState(false);

    const getNextActionDate = (baseDate: Date, interval: number, unit: 'HOURS' | 'DAYS') => {
        const date = new Date(baseDate);
        if (unit === 'HOURS') {
            date.setHours(date.getHours() + interval);
        } else {
            date.setDate(date.getDate() + interval);
        }
        return date;
    };

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
                    spaceName: inferredSpace ? inferredSpace.name || inferredSpace.nombre : undefined,
                    assignedToId: inferredUser ? inferredUser.id : undefined,
                    assignedToName: inferredUser ? inferredUser.name : undefined,
                    items: [],
                    required_deposit: 0,
                    current_balance: 0,
                    payment_status: 'PENDING'
                });
            }
            fetchCatalog();
            fetchOpportunities();
        }
    }, [isOpen, activity, initialDate, initialResourceId, rooms, users]);

    const fetchCatalog = async () => {
        try {
            const products = await db.get('products') as Product[];
            if (products && products.length > 0) {
                setCatalog(products);
            } else {
                // If DB is empty, try to get from constant for demo/first run
                const { RETAIL_PRODUCTS } = await import('../constants');
                setCatalog(RETAIL_PRODUCTS.map(p => ({ ...p, stock: p.stock ?? 50 })) as Product[]);
            }
        } catch (error) {
            console.error("Error fetching catalog:", error);
        }
    };

    const fetchOpportunities = async () => {
        try {
            setOpportunities(await agendaService.getOpportunities());
        } catch (error) {
            console.error("Error fetching opportunities:", error);
        }
    };

    const handleGenerateDocument = async (documentType: BookingSalesDocumentType) => {
        if (!activity?.id) return;
        setCommercialActionBusy(true);
        try {
            const doc = await agendaService.generateSalesDocumentFromBooking(
                activity.id,
                documentType,
                rooms,
                currentUser,
                terminalId
            );
            setFormData(prev => ({
                ...prev,
                linked_document_id: doc.id,
                linkedDocumentId: doc.id,
                linkedTransactionId: doc.id,
                linkedDocumentType: doc.documentType,
                linkedDocumentDisplayId: doc.displayId
            }));
            setShowDocumentDialog(false);
            onActivityUpdated?.();
            alert(`Documento generado: ${doc.displayId}`);
        } catch (error) {
            console.error("Error generating booking document:", error);
            alert(error instanceof Error ? error.message : "No se pudo generar el documento");
        } finally {
            setCommercialActionBusy(false);
        }
    };

    const handleRegisterAdvance = async () => {
        if (!activity?.id || !currentUser) return;
        setCommercialActionBusy(true);
        try {
            const collection = await agendaService.registerBookingAdvance(
                activity.id,
                advanceAmount,
                advanceMethod,
                currentUser,
                terminalId
            );
            const currentBalance = Number(formData.current_balance || 0) + advanceAmount;
            const requiredDeposit = Number(formData.required_deposit || 0);
            setFormData(prev => ({
                ...prev,
                status: 'CONFIRMED',
                current_balance: currentBalance,
                payment_status: requiredDeposit > 0 && currentBalance >= requiredDeposit ? 'PAID' : 'PARTIAL'
            }));
            setShowAdvanceDialog(false);
            onActivityUpdated?.();
            alert(`Anticipo registrado: ${collection.displayId}`);
        } catch (error) {
            console.error("Error registering booking advance:", error);
            alert(error instanceof Error ? error.message : "No se pudo registrar el anticipo");
        } finally {
            setCommercialActionBusy(false);
        }
    };

    const handleSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        // Validation for CRM Follow-up
        if (formData.nature === 'CRM' && formData.status === 'COMPLETED' && !showFollowUpDialog) {
            // Check for suggested next action
            const currentType = serviceTypes.find(t => t.name === formData.type);
            if (currentType?.next_suggested_type_id) {
                const nextType = serviceTypes.find(t => t.id === currentType.next_suggested_type_id);
                if (nextType) {
                    const baseDate = new Date(); // Use current time as base for completion
                    const nextDate = getNextActionDate(
                        baseDate,
                        currentType.suggested_interval || 0,
                        currentType.suggested_interval_unit || 'DAYS'
                    );
                    setSuggestedAction({ type: nextType, date: nextDate });
                }
            }
            setShowFollowUpDialog(true);
            return;
        }

        setIsSaving(true);
        try {
            await onSave(formData);
            onClose();
            setShowFollowUpDialog(false);
        } catch (error) {
            console.error("Error saving activity:", error);
            alert(error instanceof Error ? error.message : "Error al guardar la actividad");
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (activity && await clicConfirm('¿Estás seguro de eliminar esta actividad?')) {
            await onDelete(activity.id);
            onClose();
        }
    };

    const addItem = (product: Product) => {
        const items = [...(formData.items || [])];
        const existing = items.find(i => i.id === product.id);
        const currentQty = existing ? existing.quantity : 0;

        // Stock Validation
        const availableStock = product.stock ?? 0;
        if (currentQty + 1 > availableStock) {
            alert(`Stock insuficiente para reservar: Solo quedan ${availableStock} unidades.`);
            return;
        }

        if (existing) {
            existing.quantity += 1;
        } else {
            items.push({
                ...product,
                quantity: 1,
                cartId: 'agenda'
            } as CartItem);
        }
        setFormData({ ...formData, items });
        setSearchTerm('');
        setShowItemSearch(false);
    };

    const updateItemQuantity = (id: string, delta: number) => {
        setFormData(prev => {
            const items = [...(prev.items || [])];
            const idx = items.findIndex(i => i.id === id);
            if (idx === -1) return prev;

            const item = items[idx];
            const newQty = Math.max(1, (item.quantity || 0) + delta);

            // Stock Validation for increase
            if (delta > 0) {
                const product = catalog.find(p => p.id === id);
                if (product && newQty > (product.stock || 0)) {
                    alert(`Stock insuficiente para reservar: Solo quedan ${product.stock} unidades.`);
                    return prev;
                }
            }

            items[idx] = { ...item, quantity: newQty };
            return { ...prev, items };
        });
    };

    const removeItem = (id: string) => {
        setFormData(prev => ({
            ...prev,
            items: prev.items?.filter(i => i.id !== id)
        }));
    };

    // Calculate total items cost
    const itemsTotal = formData.items?.reduce((sum, i) => sum + (i.quantity * i.price), 0) || 0;
    const linkedOpportunity = opportunities.find(o => o.id === formData.opportunityId);
    const canGenerateDocument = Boolean(activity?.id && formData.nature === 'BOOKING');
    const hasLinkedDocument = Boolean(formData.linked_document_id || formData.linkedDocumentId);
    const remainingDeposit = Math.max(0, Number(formData.required_deposit || 0) - Number(formData.current_balance || 0));

    // Financial integrity logic (Recommend 20% deposit)
    useEffect(() => {
        if (itemsTotal > 0 && !formData.required_deposit) {
            setFormData(prev => ({ ...prev, required_deposit: Math.ceil(itemsTotal * 0.20) }));
        }
    }, [itemsTotal]);

    // Filter service types based on nature
    const currentTypes = serviceTypes.filter(t => t.nature === formData.nature && t.isActive);

    // Filter catalog
    const filteredCatalog = catalog.filter(p =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.barcode && p.barcode.toLowerCase().includes(searchTerm.toLowerCase()))
    ).slice(0, 5);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
            <div className="bg-white rounded-3xl w-full max-w-5xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95 duration-200">
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
                                {formData.nature === 'BOOKING' ? 'Reserva Profesional de Recurso' : 'Gestión CRM Avanzada'}
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
                    {/* LEFT COLUMN: Main Details & Items */}
                    <div className="flex-1 overflow-y-auto p-8 custom-scrollbar border-r border-gray-100">
                        <form onSubmit={handleSubmit} id="activity-form" className="space-y-6">
                            {/* Nature Selector */}
                            <div className="flex bg-gray-100 p-1.5 rounded-2xl max-w-md mx-auto">
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

                            <div className="grid grid-cols-2 gap-6">
                                {/* Details Column */}
                                <div className="space-y-6">
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Título del Evento / Actividad</label>
                                        <input
                                            required
                                            value={formData.title || ''}
                                            onChange={e => setFormData({ ...formData, title: e.target.value })}
                                            placeholder={formData.nature === 'BOOKING' ? "Ej: Boda García-Pérez" : "Ej: Reunión de ventas"}
                                            className="w-full px-4 py-3 bg-gray-50 rounded-xl font-bold text-gray-900 placeholder:text-gray-300 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Tipo</label>
                                            <select
                                                value={formData.type || ''}
                                                onChange={e => setFormData({ ...formData, type: e.target.value })}
                                                className="w-full px-4 py-3 bg-gray-50 rounded-xl font-bold text-sm text-gray-900 appearance-none focus:ring-2 focus:ring-indigo-100 outline-none"
                                            >
                                                {currentTypes.map(t => (
                                                    <option key={t.id} value={t.name}>{t.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Prioridad</label>
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
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Estado</label>
                                        <div className="flex flex-wrap gap-2">
                                            {['PLANNED', 'CONFIRMED', 'COMPLETED', 'CANCELLED'].map(s => (
                                                <button
                                                    key={s}
                                                    type="button"
                                                    onClick={() => setFormData({ ...formData, status: s as any })}
                                                    className={`
                                                        px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-all
                                                        ${formData.status === s
                                                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                                                            : 'bg-white border-gray-100 text-gray-400 hover:bg-gray-50'}
                                                    `}
                                                >
                                                    {s}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Descripción</label>
                                        <textarea
                                            rows={3}
                                            value={formData.description || ''}
                                            onChange={e => setFormData({ ...formData, description: e.target.value })}
                                            className="w-full px-4 py-3 bg-gray-50 rounded-xl font-medium text-sm text-gray-900 placeholder:text-gray-300 focus:ring-2 focus:ring-indigo-100 outline-none resize-none"
                                        />
                                    </div>
                                </div>

                                {/* Items & Services Column */}
                                <div className="space-y-6">
                                    <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest flex items-center gap-2">
                                                <Package size={14} className="text-purple-500" />
                                                Items / Servicios Vinculados
                                            </h3>
                                            <button
                                                type="button"
                                                onClick={() => setShowItemSearch(!showItemSearch)}
                                                className="p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                                            >
                                                <Plus size={14} />
                                            </button>
                                        </div>

                                        {showItemSearch && (
                                            <div className="relative">
                                                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                                                    <Search size={14} className="text-gray-400" />
                                                </div>
                                                <input
                                                    autoFocus
                                                    value={searchTerm}
                                                    onChange={e => setSearchTerm(e.target.value)}
                                                    placeholder="Buscar en el catálogo..."
                                                    className="w-full pl-9 pr-4 py-2 bg-white rounded-xl text-xs font-bold border border-gray-100 outline-none"
                                                />
                                                {filteredCatalog.length > 0 ? (
                                                    <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 z-[80] overflow-hidden p-2">
                                                        <div className="px-3 py-2 border-b border-gray-50 mb-1">
                                                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Coincidencias en Catálogo</p>
                                                        </div>
                                                        {filteredCatalog.map(p => (
                                                            <button
                                                                key={p.id}
                                                                type="button"
                                                                onClick={() => addItem(p)}
                                                                className="w-full text-left p-3 hover:bg-indigo-50 rounded-xl flex items-center gap-4 transition-colors group"
                                                            >
                                                                <div className="w-10 h-10 bg-gray-50 rounded-lg overflow-hidden shrink-0 border border-gray-100">
                                                                    {p.image ? (
                                                                        <img src={p.image} alt={p.name} className="w-full h-full object-cover" />
                                                                    ) : (
                                                                        <div className="w-full h-full flex items-center justify-center text-gray-300">
                                                                            <Package size={16} />
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-xs font-black text-gray-900 truncate group-hover:text-indigo-700">{p.name}</p>
                                                                    <p className="text-[10px] font-bold text-gray-400">Barcode: {p.barcode || '---'}</p>
                                                                </div>
                                                                <div className="text-right">
                                                                    <p className="text-xs font-black text-indigo-600">${p.price.toLocaleString()}</p>
                                                                    <p className="text-[9px] font-bold text-emerald-500 uppercase">En Stock: {p.stock ?? 0}</p>
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                ) : searchTerm && (
                                                    <div className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 z-[80] overflow-hidden p-6 text-center">
                                                        <Package size={24} className="mx-auto text-gray-200 mb-2" />
                                                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">No se encontraron productos</p>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                                            {(formData.items || []).length === 0 ? (
                                                <div className="text-center py-8 border-2 border-dashed border-gray-100 rounded-[2rem] bg-gray-50/30">
                                                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-sm">
                                                        <Package size={20} className="text-gray-300" />
                                                    </div>
                                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Sin recursos asignados</p>
                                                </div>
                                            ) : (
                                                formData.items?.map(item => (
                                                    <div key={item.id} className="group bg-white p-4 rounded-2xl border border-gray-100 flex items-center gap-4 hover:shadow-md transition-all">
                                                        <div className="w-12 h-12 bg-gray-100 rounded-xl overflow-hidden shrink-0">
                                                            {item.image ? (
                                                                <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="w-full h-full flex items-center justify-center text-gray-300">
                                                                    <Package size={20} />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm font-black text-gray-900 truncate leading-tight mb-1">{item.name}</p>
                                                            <p className="text-[11px] font-bold text-indigo-500">${item.price.toLocaleString()}</p>
                                                        </div>

                                                        {/* Quantity Controls */}
                                                        <div className="flex items-center bg-gray-50 rounded-lg p-1">
                                                            <button
                                                                type="button"
                                                                onClick={() => updateItemQuantity(item.id, -1)}
                                                                className="w-6 h-6 flex items-center justify-center hover:bg-white rounded-md text-gray-400 transition-colors"
                                                            >
                                                                -
                                                            </button>
                                                            <span className="w-8 text-center text-xs font-black text-gray-700">{item.quantity}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => updateItemQuantity(item.id, 1)}
                                                                className="w-6 h-6 flex items-center justify-center hover:bg-white rounded-md text-gray-400 transition-colors"
                                                            >
                                                                +
                                                            </button>
                                                        </div>

                                                        <div className="text-right ml-2">
                                                            <p className="text-sm font-black text-gray-900">${(item.quantity * item.price).toLocaleString()}</p>
                                                        </div>

                                                        <button
                                                            type="button"
                                                            onClick={() => removeItem(item.id)}
                                                            className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl opacity-0 group-hover:opacity-100 transition-all"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                ))
                                            )}
                                        </div>

                                        {formData.items && formData.items.length > 0 && (
                                            <div className="pt-5 mt-2 border-t border-gray-100 flex justify-between items-center">
                                                <div>
                                                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Inversión Total</p>
                                                    <p className="text-[9px] font-bold text-emerald-500 uppercase tracking-tighter">Incluye {formData.items.length} ítems vinculados</p>
                                                </div>
                                                <p className="text-2xl font-black text-indigo-600 tracking-tighter">
                                                    RD${itemsTotal.toLocaleString()}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </form>
                    </div>

                    {/* RIGHT COLUMN: Resources & Date & Finance */}
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

                        {/* Customer & Responsibility */}
                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 space-y-4">
                            <div>
                                <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Users size={14} className="text-pink-500" />
                                    Cliente / Asignación
                                </h3>
                                <div className="space-y-3">
                                    <select
                                        value={formData.customerId || ''}
                                        onChange={e => {
                                            const cust = customers.find(c => c.id === e.target.value);
                                            setFormData({ ...formData, customerId: cust?.id, customerName: cust ? cust.name : undefined });
                                        }}
                                        className="w-full bg-gray-50 border-none rounded-lg text-xs font-bold text-gray-700 py-2.5 px-3 outline-none"
                                    >
                                        <option value="">-- Seleccionar Cliente --</option>
                                        {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                    <select
                                        value={formData.opportunityId || ''}
                                        onChange={e => {
                                            const opp = opportunities.find(o => o.id === e.target.value);
                                            setFormData({
                                                ...formData,
                                                opportunityId: opp?.id,
                                                opportunityTitle: opp?.title
                                            });
                                        }}
                                        className="w-full bg-gray-50 border-none rounded-lg text-xs font-bold text-gray-700 py-2.5 px-3 outline-none"
                                    >
                                        <option value="">-- Oportunidad: Ninguna --</option>
                                        {opportunities.map(o => (
                                            <option key={o.id} value={o.id}>
                                                {o.title} · {o.stage} · RD${Number(o.amount || 0).toLocaleString()}
                                            </option>
                                        ))}
                                    </select>
                                    <select
                                        value={formData.spaceId || ''}
                                        onChange={e => {
                                            const room = rooms.find(r => r.id === e.target.value);
                                            setFormData({ ...formData, spaceId: room?.id, spaceName: room?.name || room?.nombre });
                                        }}
                                        className="w-full bg-gray-50 border-none rounded-lg text-xs font-bold text-gray-700 py-2.5 px-3 outline-none"
                                    >
                                        <option value="">-- Espacio: Ninguno --</option>
                                        {rooms.map(r => <option key={r.id} value={r.id}>{r.name || r.nombre} ({r.capacity || r.capacidad_pax || r.capacidad_personas || 0}p)</option>)}
                                    </select>
                                    {linkedOpportunity && (
                                        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-blue-400">Pipeline</p>
                                            <p className="text-xs font-black text-blue-900">{linkedOpportunity.title}</p>
                                            <p className="text-[10px] font-bold text-blue-600">{linkedOpportunity.stage} · {linkedOpportunity.probability}%</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {formData.nature === 'BOOKING' && (
                            <div className="bg-white p-5 rounded-2xl shadow-sm border border-blue-100">
                                <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <FileText size={14} className="text-blue-500" />
                                    Ciclo Comercial
                                </h3>
                                <div className="space-y-3">
                                    {hasLinkedDocument ? (
                                        <div className="rounded-xl bg-blue-50 p-3 border border-blue-100">
                                            <p className="text-[9px] font-black uppercase tracking-widest text-blue-400">Documento vinculado</p>
                                            <p className="text-sm font-black text-blue-900">{formData.linkedDocumentDisplayId || formData.linked_document_id || formData.linkedDocumentId}</p>
                                            <p className="text-[10px] font-bold text-blue-600">{formData.linkedDocumentType || 'DOCUMENTO'}</p>
                                        </div>
                                    ) : (
                                        <p className="text-[11px] font-bold text-gray-400 leading-relaxed">
                                            Genera una cotización, pedido o factura con el salón y los servicios vinculados.
                                        </p>
                                    )}

                                    <button
                                        type="button"
                                        disabled={!canGenerateDocument || commercialActionBusy}
                                        onClick={() => setShowDocumentDialog(true)}
                                        className="w-full py-3 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                                    >
                                        <FileText size={15} />
                                        {hasLinkedDocument ? 'Generar Otro Documento' : 'Generar Documento'}
                                    </button>

                                    {hasLinkedDocument && (
                                        <button
                                            type="button"
                                            disabled={!currentUser || commercialActionBusy}
                                            onClick={() => {
                                                setAdvanceAmount(remainingDeposit || Number(formData.required_deposit || 0) || 0);
                                                setShowAdvanceDialog(true);
                                            }}
                                            className="w-full py-3 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                                        >
                                            <HandCoins size={15} />
                                            Registrar Anticipo
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Financial Integrity */}
                        <div className="bg-white p-5 rounded-2xl shadow-sm border border-emerald-100">
                            <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <DollarSign size={14} className="text-emerald-500" />
                                Integridad Financiera
                            </h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Depósito Requerido (Anticipo)</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                                            <span className="text-xs font-bold text-gray-400">$</span>
                                        </div>
                                        <input
                                            type="number"
                                            value={formData.required_deposit || ''}
                                            onChange={e => setFormData({ ...formData, required_deposit: Number(e.target.value) })}
                                            className="w-full pl-7 pr-4 py-2 bg-gray-50 border-none rounded-lg text-xs font-black text-gray-700"
                                            placeholder="0.00"
                                        />
                                    </div>
                                </div>
                                <div className="bg-emerald-50 p-3 rounded-xl flex items-center justify-between">
                                    <div>
                                        <p className="text-[10px] font-bold text-emerald-800 uppercase">Abonado</p>
                                        <p className="text-sm font-black text-emerald-900">${(formData.current_balance || 0).toFixed(2)}</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setAdvanceAmount(remainingDeposit || Number(formData.required_deposit || 0) || 0);
                                            setShowAdvanceDialog(true);
                                        }}
                                        disabled={formData.nature !== 'BOOKING' || !activity?.id || !currentUser || commercialActionBusy}
                                        className="p-2 bg-emerald-500 text-white rounded-lg shadow-sm hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                        title="Registrar Anticipo"
                                    >
                                        <CreditCard size={14} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="px-8 py-5 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-4">
                        {activity && (
                            <button
                                type="button"
                                onClick={handleDelete}
                                className="text-red-500 hover:text-red-700 font-bold text-sm px-4 py-2 hover:bg-red-50 rounded-xl transition-colors"
                            >
                                Eliminar
                            </button>
                        )}
                        <p className="text-[10px] font-bold text-gray-400 uppercase">
                            ID: <span className="text-gray-900">{formData.displayId || 'NEW'}</span>
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors text-sm"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={() => handleSubmit()}
                            disabled={isSaving}
                            className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all text-sm flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
                        >
                            {isSaving ? (
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <><CheckCircle size={18} /><span>Confirmar y Guardar</span></>
                            )}
                        </button>
                    </div>
                </div>
            </div>

            {/* CRM FOLLOW-UP DIALOG */}
            {showFollowUpDialog && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-indigo-900/40 backdrop-blur-md p-4">
                    <div className="bg-white rounded-3xl w-full max-w-md p-8 shadow-2xl animate-in fade-in zoom-in duration-200">
                        <div className="text-center space-y-4">
                            <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6">
                                <MessageSquare size={32} />
                            </div>
                            <h2 className="text-2xl font-black text-gray-900">Actividad Finalizada</h2>
                            <p className="text-gray-500 font-medium">
                                {suggestedAction
                                    ? `Se sugiere continuar con "${suggestedAction.type.label}" para el ${format(suggestedAction.date, "d 'de' MMMM")}. ¿Desea proceder?`
                                    : "¿Desea programar la siguiente acción de seguimiento para este flujo de venta?"
                                }
                            </p>

                            <div className="pt-6 grid grid-cols-2 gap-4">
                                <button
                                    onClick={() => {
                                        // Reset form for new follow-up
                                        let newType = 'MEETING';
                                        let newTitle = `Seguimiento: ${formData.title}`;
                                        let startDate = new Date(Date.now() + 86400000); // Default +1 day

                                        if (suggestedAction) {
                                            newType = suggestedAction.type.name;
                                            newTitle = suggestedAction.type.label;
                                            startDate = suggestedAction.date;
                                        }

                                        const endDate = new Date(startDate.getTime() + (suggestedAction?.type.defaultDuration || 60) * 60000);

                                        setFormData({
                                            ...formData,
                                            id: undefined,
                                            displayId: undefined,
                                            status: 'PLANNED',
                                            type: newType,
                                            title: newTitle,
                                            startDate: startDate.toISOString(),
                                            endDate: endDate.toISOString(),
                                        });
                                        setShowFollowUpDialog(false);
                                        setSuggestedAction(null);
                                    }}
                                    className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-100"
                                >
                                    {suggestedAction ? `Sí, Agendar ${suggestedAction.type.label}` : 'Sí, Programar Seguimiento'}
                                </button>
                                <button
                                    onClick={() => handleSubmit()}
                                    className="px-6 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200"
                                >
                                    No por ahora
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showDocumentDialog && (
                <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/40 backdrop-blur-md p-4">
                    <div className="bg-white rounded-3xl w-full max-w-lg p-8 shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="flex items-start justify-between gap-4 mb-6">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-blue-500 mb-2">Booking to Sales</p>
                                <h3 className="text-2xl font-black text-gray-900">Generar Documento</h3>
                                <p className="text-sm font-medium text-gray-500 mt-2">
                                    Se crearán renglones con el salón/espacio y los servicios vinculados.
                                </p>
                            </div>
                            <button onClick={() => setShowDocumentDialog(false)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="grid grid-cols-1 gap-3">
                            {[
                                { type: 'QUOTE' as BookingSalesDocumentType, title: 'Cotización', desc: 'Documento comercial inicial para aprobación del cliente.' },
                                { type: 'SALES_ORDER' as BookingSalesDocumentType, title: 'Pedido de Venta', desc: 'Reserva comercial aprobada pendiente de facturación.' },
                                { type: 'INVOICE' as BookingSalesDocumentType, title: 'Factura', desc: 'Factura directamente desde la reserva.' }
                            ].map(option => (
                                <button
                                    key={option.type}
                                    type="button"
                                    disabled={commercialActionBusy}
                                    onClick={() => handleGenerateDocument(option.type)}
                                    className="text-left p-5 rounded-2xl border border-gray-100 bg-gray-50 hover:bg-blue-50 hover:border-blue-200 transition-all disabled:opacity-50"
                                >
                                    <p className="font-black text-gray-900">{option.title}</p>
                                    <p className="text-xs font-bold text-gray-400 mt-1">{option.desc}</p>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {showAdvanceDialog && (
                <div className="fixed inset-0 z-[75] flex items-center justify-center bg-emerald-950/40 backdrop-blur-md p-4">
                    <div className="bg-white rounded-3xl w-full max-w-md p-8 shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="flex items-start justify-between gap-4 mb-6">
                            <div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mb-2">Anticipo de Cliente</p>
                                <h3 className="text-2xl font-black text-gray-900">Registrar Anticipo</h3>
                                <p className="text-sm font-medium text-gray-500 mt-2">
                                    El recibo se guardará como pago no aplicado y confirmará el booking.
                                </p>
                            </div>
                            <button onClick={() => setShowAdvanceDialog(false)} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Monto</label>
                                <input
                                    type="number"
                                    value={advanceAmount || ''}
                                    onChange={e => setAdvanceAmount(Number(e.target.value))}
                                    className="mt-2 w-full rounded-2xl bg-gray-50 px-5 py-4 text-2xl font-black text-gray-900 outline-none focus:ring-2 focus:ring-emerald-200"
                                    placeholder="0.00"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Método</label>
                                <select
                                    value={advanceMethod}
                                    onChange={e => setAdvanceMethod(e.target.value as CollectionMethod)}
                                    className="mt-2 w-full rounded-2xl bg-gray-50 px-5 py-4 text-sm font-black text-gray-700 outline-none"
                                >
                                    <option value="CASH">Efectivo</option>
                                    <option value="CARD">Tarjeta</option>
                                    <option value="TRANSFER">Transferencia</option>
                                    <option value="CHECK">Cheque</option>
                                    <option value="WALLET">Wallet</option>
                                </select>
                            </div>
                            <button
                                type="button"
                                disabled={commercialActionBusy || advanceAmount <= 0}
                                onClick={handleRegisterAdvance}
                                className="w-full py-4 rounded-2xl bg-emerald-600 text-white font-black uppercase tracking-widest text-xs hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Confirmar Anticipo
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ActivityModal;
