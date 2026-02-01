import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Plus, User, Phone, Landmark, X, Check, Mail } from 'lucide-react';
import { Supplier } from '../types';

interface SupplierSelectorProps {
    selectedSupplierId: string;
    onSelect: (supplier: Supplier) => void;
    onAddSupplier: (supplier: Supplier) => void;
}

const SupplierSelector: React.FC<SupplierSelectorProps> = ({
    selectedSupplierId,
    onSelect,
    onAddSupplier
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Quick Add Form State
    const [quickAddForm, setQuickAddForm] = useState({
        name: '',
        taxId: '',
        phone: ''
    });

    useEffect(() => {
        const fetchSuppliers = async () => {
            setIsLoading(true);
            try {
                const response = await fetch(`/api/suppliers?q=${searchTerm}`);
                const data = await response.json();
                setSuppliers(data);
            } catch (error) {
                console.error('Error fetching suppliers:', error);
            } finally {
                setIsLoading(false);
            }
        };

        const timeoutId = setTimeout(fetchSuppliers, 300);
        return () => clearTimeout(timeoutId);
    }, [searchTerm]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const selectedSupplier = useMemo(() =>
        suppliers.find(s => s.id === selectedSupplierId),
        [suppliers, selectedSupplierId]);

    const handleQuickAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const response = await fetch('/api/suppliers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...quickAddForm,
                    isActive: true,
                    paymentTermDays: 0
                })
            });
            const data = await response.json();
            if (response.ok) {
                onAddSupplier(data);
                onSelect(data);
                setIsQuickAddOpen(false);
                setIsOpen(false);
                setQuickAddForm({ name: '', taxId: '', phone: '' });
                // Trigger success toast if available in parent
            } else {
                alert(data.message || 'Error al crear proveedor');
            }
        } catch (error) {
            console.error('Error creating supplier:', error);
            alert('Error de conexión');
        }
    };

    return (
        <div className="relative w-full" ref={dropdownRef}>
            <label className="text-xs font-bold text-indigo-200 uppercase mb-2 block">Proveedor</label>
            <div
                onClick={() => setIsOpen(!isOpen)}
                className="w-full p-4 pl-12 bg-indigo-700 border-none rounded-xl text-white font-bold text-lg cursor-pointer flex items-center justify-between hover:bg-indigo-600 transition-colors"
            >
                <User className="absolute left-4 top-[42px] text-indigo-300" size={24} />
                <span className={selectedSupplier ? 'text-white' : 'text-indigo-300'}>
                    {selectedSupplier ? selectedSupplier.name : 'Seleccionar Proveedor...'}
                </span>
                {selectedSupplier && (
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-indigo-500 px-2 py-0.5 rounded text-indigo-100 font-mono">
                            {selectedSupplier.taxId}
                        </span>
                    </div>
                )}
            </div>

            {isOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="p-3 border-b border-gray-50">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                autoFocus
                                type="text"
                                placeholder="Buscar por nombre o RNC..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-3 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20 text-gray-800 font-medium"
                            />
                        </div>
                    </div>

                    <div className="max-h-[300px] overflow-y-auto">
                        {suppliers.length > 0 ? (
                            suppliers.map(s => (
                                <div
                                    key={s.id}
                                    onClick={() => {
                                        onSelect(s);
                                        setIsOpen(false);
                                    }}
                                    className="p-4 hover:bg-indigo-50 cursor-pointer flex items-center justify-between border-b border-gray-50 last:border-none group"
                                >
                                    <div>
                                        <p className="font-bold text-gray-800 group-hover:text-indigo-700 transition-colors">{s.name}</p>
                                        <p className="text-xs text-gray-400 font-mono">RNC: {s.taxId}</p>
                                    </div>
                                    {selectedSupplierId === s.id && (
                                        <Check className="text-indigo-600" size={20} />
                                    )}
                                </div>
                            ))
                        ) : (
                            <div className="p-8 text-center">
                                <p className="text-gray-400 mb-4">No se encontraron resultados para "{searchTerm}"</p>
                                <button
                                    onClick={() => {
                                        setQuickAddForm({ ...quickAddForm, name: searchTerm });
                                        setIsQuickAddOpen(true);
                                    }}
                                    className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2 mx-auto"
                                >
                                    <Plus size={20} />
                                    Crear "{searchTerm}"
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Quick Add Modal */}
            {isQuickAddOpen && (
                <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                    <div className="bg-white rounded-[2.5rem] w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
                        <div className="p-8 bg-indigo-600 text-white relative">
                            <button
                                onClick={() => setIsQuickAddOpen(false)}
                                className="absolute top-6 right-6 p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
                            >
                                <X size={20} />
                            </button>
                            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mb-4">
                                <Landmark size={32} />
                            </div>
                            <h3 className="text-2xl font-black">Creación Rápida</h3>
                            <p className="text-indigo-100 text-sm">Agrega un nuevo proveedor al vuelo.</p>
                        </div>

                        <form onSubmit={handleQuickAdd} className="p-8 space-y-6">
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 ml-1">Nombre del Proveedor</label>
                                    <div className="relative">
                                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                                        <input
                                            required
                                            type="text"
                                            value={quickAddForm.name}
                                            onChange={e => setQuickAddForm({ ...quickAddForm, name: e.target.value })}
                                            className="w-full pl-12 pr-4 py-4 bg-gray-50 border-2 border-transparent rounded-2xl outline-none focus:bg-white focus:border-indigo-500 transition-all font-bold text-gray-800"
                                            placeholder="Ej: Embutidos Juan"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 ml-1">RNC / Cédula</label>
                                    <div className="relative">
                                        <Landmark className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                                        <input
                                            required
                                            type="text"
                                            value={quickAddForm.taxId}
                                            onChange={e => setQuickAddForm({ ...quickAddForm, taxId: e.target.value })}
                                            className="w-full pl-12 pr-4 py-4 bg-gray-50 border-2 border-transparent rounded-2xl outline-none focus:bg-white focus:border-indigo-500 transition-all font-mono font-bold text-gray-800"
                                            placeholder="101-XXXXX-X"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 ml-1">Teléfono</label>
                                    <div className="relative">
                                        <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                                        <input
                                            type="tel"
                                            value={quickAddForm.phone}
                                            onChange={e => setQuickAddForm({ ...quickAddForm, phone: e.target.value })}
                                            className="w-full pl-12 pr-4 py-4 bg-gray-50 border-2 border-transparent rounded-2xl outline-none focus:bg-white focus:border-indigo-500 transition-all font-bold text-gray-800"
                                            placeholder="809-555-0000"
                                        />
                                    </div>
                                </div>
                            </div>

                            <button
                                type="submit"
                                className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-xl shadow-xl shadow-indigo-100 hover:bg-indigo-700 active:scale-[0.98] transition-all flex items-center justify-center gap-3"
                            >
                                <Save size={24} />
                                GUARDAR PROVEEDOR
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

const Save = ({ size }: { size: number }) => <Check size={size} />;

export default SupplierSelector;
