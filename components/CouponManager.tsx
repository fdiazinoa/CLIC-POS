import React, { useState } from 'react';
import {
    Ticket, Plus, Calendar, Clock, DollarSign, Percent,
    Trash2, Edit, Save, X, QrCode, Copy, CheckCircle2,
    AlertCircle, Search
} from 'lucide-react';
import { BusinessConfig, Campaign, Coupon } from '../types';
import { couponService } from '../utils/couponService';

interface CouponManagerProps {
    config: BusinessConfig;
    onUpdateConfig: (newConfig: BusinessConfig) => void;
}

const DAYS = [
    { key: 'L', label: 'Lunes' },
    { key: 'M', label: 'Martes' },
    { key: 'X', label: 'Miércoles' },
    { key: 'J', label: 'Jueves' },
    { key: 'V', label: 'Viernes' },
    { key: 'S', label: 'Sábado' },
    { key: 'D', label: 'Domingo' }
];

const CouponManager: React.FC<CouponManagerProps> = ({ config, onUpdateConfig }) => {
    const [viewMode, setViewMode] = useState<'LIST' | 'EDIT'>('LIST');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [showGenerateModal, setShowGenerateModal] = useState(false);
    const [showCouponsModal, setShowCouponsModal] = useState(false);
    const [selectedCampaignForGen, setSelectedCampaignForGen] = useState<Campaign | null>(null);
    const [selectedCampaignForView, setSelectedCampaignForView] = useState<Campaign | null>(null);
    const [generateQty, setGenerateQty] = useState(10);

    // Form State
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [benefitType, setBenefitType] = useState<'PERCENT' | 'FIXED_AMOUNT'>('PERCENT');
    const [benefitValue, setBenefitValue] = useState(0);
    const [minPurchase, setMinPurchase] = useState(0);
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [endDate, setEndDate] = useState(new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0]);
    const [activeDays, setActiveDays] = useState<string[]>(['L', 'M', 'X', 'J', 'V', 'S', 'D']);
    const [startTime, setStartTime] = useState('00:00');
    const [endTime, setEndTime] = useState('23:59');

    const campaigns = config.campaigns || [];

    const handleCreateNew = () => {
        setEditingId(null);
        setName('');
        setDescription('');
        setBenefitType('PERCENT');
        setBenefitValue(0);
        setMinPurchase(0);
        setStartDate(new Date().toISOString().split('T')[0]);
        setEndDate(new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0]);
        setActiveDays(['L', 'M', 'X', 'J', 'V', 'S', 'D']);
        setStartTime('00:00');
        setEndTime('23:59');
        setViewMode('EDIT');
    };

    const handleEdit = (camp: Campaign) => {
        setEditingId(camp.id);
        setName(camp.name);
        setDescription(camp.description || '');
        setBenefitType(camp.benefitType as any);
        setBenefitValue(camp.benefitValue);
        setMinPurchase(camp.minPurchaseAmount || 0);
        setStartDate(camp.startDate.split('T')[0]);
        setEndDate(camp.endDate.split('T')[0]);
        setActiveDays(camp.activeDays || ['L', 'M', 'X', 'J', 'V', 'S', 'D']);
        setStartTime(camp.activeHours?.start || '00:00');
        setEndTime(camp.activeHours?.end || '23:59');
        setViewMode('EDIT');
    };

    const handleSave = () => {
        if (!name || benefitValue <= 0) {
            alert("Completa los campos obligatorios");
            return;
        }

        const newCampaign: Campaign = {
            id: editingId || `CAMP-${Date.now()}`,
            name,
            description,
            benefitType,
            benefitValue,
            minPurchaseAmount: minPurchase > 0 ? minPurchase : undefined,
            startDate: new Date(startDate).toISOString(),
            endDate: new Date(endDate).toISOString(),
            activeDays,
            activeHours: { start: startTime, end: endTime },
            totalGenerated: editingId ? (campaigns.find(c => c.id === editingId)?.totalGenerated || 0) : 0,
            createdAt: editingId ? (campaigns.find(c => c.id === editingId)?.createdAt || new Date().toISOString()) : new Date().toISOString()
        };

        const updatedCampaigns = editingId
            ? campaigns.map(c => c.id === editingId ? newCampaign : c)
            : [...campaigns, newCampaign];

        onUpdateConfig({ ...config, campaigns: updatedCampaigns });
        setViewMode('LIST');
    };

    const handleDelete = (id: string) => {
        if (confirm('¿Eliminar esta campaña? Los cupones existentes seguirán funcionando hasta que expiren.')) {
            onUpdateConfig({
                ...config,
                campaigns: campaigns.filter(c => c.id !== id)
            });
        }
    };

    const handleGenerateCoupons = () => {
        if (!selectedCampaignForGen) return;
        const newConfig = couponService.generateCoupons(selectedCampaignForGen, generateQty, config);
        onUpdateConfig(newConfig);
        setShowGenerateModal(false);
        alert(`¡${generateQty} cupones generados exitosamente!`);
    };

    const toggleDay = (day: string) => {
        setActiveDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
    };

    if (viewMode === 'EDIT') {
        return (
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 animate-in fade-in slide-in-from-bottom-4">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-black text-gray-800">{editingId ? 'Editar Campaña' : 'Nueva Campaña'}</h3>
                    <button onClick={() => setViewMode('LIST')} className="p-2 hover:bg-gray-100 rounded-full text-gray-400"><X size={24} /></button>
                </div>

                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Nombre</label>
                            <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full p-3 bg-gray-50 rounded-xl font-bold outline-none focus:ring-2 focus:ring-blue-500" placeholder="Ej. Verano 2024" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Descripción</label>
                            <input type="text" value={description} onChange={e => setDescription(e.target.value)} className="w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" placeholder="Descripción interna..." />
                        </div>
                    </div>

                    <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                        <label className="block text-xs font-bold text-blue-400 uppercase tracking-widest mb-4">Beneficio</label>
                        <div className="flex gap-4 items-center">
                            <div className="flex bg-white rounded-lg p-1 border border-blue-200">
                                <button onClick={() => setBenefitType('PERCENT')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${benefitType === 'PERCENT' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}>Porcentaje</button>
                                <button onClick={() => setBenefitType('FIXED_AMOUNT')} className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${benefitType === 'FIXED_AMOUNT' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}>Monto Fijo</button>
                            </div>
                            <div className="flex-1 relative">
                                <input type="number" value={benefitValue} onChange={e => setBenefitValue(parseFloat(e.target.value))} className="w-full p-3 pl-10 bg-white rounded-xl font-black text-xl text-blue-700 outline-none border border-blue-200 focus:border-blue-500" />
                                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-300">
                                    {benefitType === 'PERCENT' ? <Percent size={20} /> : <DollarSign size={20} />}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-100">
                            <label className="block text-xs font-bold text-emerald-600 uppercase tracking-widest mb-4">Condiciones</label>
                            <div className="flex items-center gap-3 mb-2">
                                <span className="text-sm font-bold text-gray-600">Compra Mínima:</span>
                                <input type="number" value={minPurchase} onChange={e => setMinPurchase(parseFloat(e.target.value))} className="w-32 p-2 bg-white rounded-lg border border-emerald-200 font-bold text-emerald-700 outline-none" />
                            </div>
                            <p className="text-xs text-emerald-600/70">Deja en 0 para no aplicar mínimo.</p>
                        </div>

                        <div className="bg-gray-50 p-6 rounded-2xl border border-gray-200">
                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Vigencia</label>
                            <div className="flex gap-2 mb-4">
                                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="flex-1 p-2 bg-white rounded-lg border border-gray-200 text-sm font-bold" />
                                <span className="self-center text-gray-400">-</span>
                                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="flex-1 p-2 bg-white rounded-lg border border-gray-200 text-sm font-bold" />
                            </div>
                            <div className="flex justify-between gap-1 mb-4">
                                {DAYS.map(day => (
                                    <button key={day.key} onClick={() => toggleDay(day.key)} className={`w-8 h-8 rounded-full text-xs font-bold transition-all ${activeDays.includes(day.key) ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-400'}`}>{day.key}</button>
                                ))}
                            </div>
                            <div className="flex gap-2 items-center">
                                <Clock size={16} className="text-gray-400" />
                                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="bg-white p-1 rounded border border-gray-200 text-xs font-bold" />
                                <span className="text-gray-400">-</span>
                                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} className="bg-white p-1 rounded border border-gray-200 text-xs font-bold" />
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <button onClick={() => setViewMode('LIST')} className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors">Cancelar</button>
                        <button onClick={handleSave} className="px-8 py-3 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-lg hover:shadow-xl transition-all flex items-center gap-2">
                            <Save size={20} /> Guardar Campaña
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in">
            {/* Stats Header */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-blue-50 text-blue-600 rounded-xl"><Ticket size={24} /></div>
                    <div>
                        <p className="text-xs text-gray-400 font-bold uppercase">Campañas Activas</p>
                        <p className="text-2xl font-black text-gray-800">{campaigns.length}</p>
                    </div>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-purple-50 text-purple-600 rounded-xl"><QrCode size={24} /></div>
                    <div>
                        <p className="text-xs text-gray-400 font-bold uppercase">Cupones Generados</p>
                        <p className="text-2xl font-black text-gray-800">{config.coupons?.length || 0}</p>
                    </div>
                </div>
                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4">
                    <div className="p-3 bg-green-50 text-green-600 rounded-xl"><CheckCircle2 size={24} /></div>
                    <div>
                        <p className="text-xs text-gray-400 font-bold uppercase">Canjeados</p>
                        <p className="text-2xl font-black text-gray-800">{config.coupons?.filter(c => c.status === 'REDEEMED').length || 0}</p>
                    </div>
                </div>
            </div>

            {/* Campaign List */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                    <h3 className="font-bold text-lg text-gray-800">Campañas</h3>
                    <button onClick={handleCreateNew} className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors flex items-center gap-2">
                        <Plus size={18} /> Nueva Campaña
                    </button>
                </div>

                {campaigns.length === 0 ? (
                    <div className="p-12 text-center text-gray-400">
                        <Ticket size={48} className="mx-auto mb-4 opacity-20" />
                        <p>No hay campañas creadas aún.</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-100">
                        {campaigns.map(camp => (
                            <div key={camp.id} className="p-6 hover:bg-gray-50 transition-colors flex flex-col md:flex-row md:items-center gap-4">
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-1">
                                        <h4 className="font-bold text-gray-800 text-lg">{camp.name}</h4>
                                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${camp.benefitType === 'PERCENT' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
                                            {camp.benefitType === 'PERCENT' ? `${camp.benefitValue}% OFF` : `$${camp.benefitValue} OFF`}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-500 mb-2">{camp.description}</p>
                                    <div className="flex gap-4 text-xs text-gray-400 font-medium">
                                        <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(camp.startDate).toLocaleDateString()} - {new Date(camp.endDate).toLocaleDateString()}</span>
                                        <span className="flex items-center gap-1"><QrCode size={12} /> {camp.totalGenerated} Generados</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => { setSelectedCampaignForGen(camp); setShowGenerateModal(true); }} className="px-3 py-2 bg-purple-50 text-purple-600 rounded-lg text-xs font-bold hover:bg-purple-100 transition-colors flex items-center gap-1">
                                        <QrCode size={14} /> Generar Cupones
                                    </button>
                                    <button onClick={() => { setSelectedCampaignForView(camp); setShowCouponsModal(true); }} className="px-3 py-2 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors flex items-center gap-1">
                                        <Ticket size={14} /> Ver Cupones
                                    </button>
                                    <button onClick={() => handleEdit(camp)} className="p-2 hover:bg-blue-50 text-gray-400 hover:text-blue-600 rounded-lg transition-colors"><Edit size={18} /></button>
                                    <button onClick={() => handleDelete(camp.id)} className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded-lg transition-colors"><Trash2 size={18} /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Generate Modal */}
            {showGenerateModal && selectedCampaignForGen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="font-bold text-lg text-gray-800">Generar Cupones</h3>
                            <button onClick={() => setShowGenerateModal(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-500"><X size={20} /></button>
                        </div>
                        <div className="mb-6">
                            <p className="text-sm text-gray-500 mb-4">Generar códigos únicos para la campaña <strong className="text-gray-800">{selectedCampaignForGen.name}</strong>.</p>
                            <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Cantidad a Generar</label>
                            <input type="number" min="1" max="1000" value={generateQty} onChange={e => setGenerateQty(parseInt(e.target.value))} className="w-full p-3 bg-gray-50 rounded-xl font-bold text-center text-2xl outline-none focus:ring-2 focus:ring-purple-500" />
                        </div>
                        <button onClick={handleGenerateCoupons} className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 transition-colors shadow-lg">
                            Generar {generateQty} Cupones
                        </button>
                    </div>
                </div>
            )}

            {/* View Coupons Modal */}
            {showCouponsModal && selectedCampaignForView && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 animate-in zoom-in-95 flex flex-col max-h-[80vh]">
                        <div className="flex justify-between items-center mb-6 shrink-0">
                            <div>
                                <h3 className="font-bold text-lg text-gray-800">Cupones Generados</h3>
                                <p className="text-sm text-gray-500">{selectedCampaignForView.name}</p>
                            </div>
                            <button onClick={() => setShowCouponsModal(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-500"><X size={20} /></button>
                        </div>

                        <div className="flex-1 overflow-y-auto pr-2">
                            {config.coupons?.filter(c => c.campaignId === selectedCampaignForView.id).length === 0 ? (
                                <div className="text-center py-10 text-gray-400">
                                    <Ticket size={48} className="mx-auto mb-4 opacity-20" />
                                    <p>No hay cupones generados para esta campaña.</p>
                                </div>
                            ) : (
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-gray-50 sticky top-0 z-10">
                                        <tr>
                                            <th className="p-3 text-xs font-bold text-gray-400 uppercase tracking-widest rounded-l-xl">Código</th>
                                            <th className="p-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Estado</th>
                                            <th className="p-3 text-xs font-bold text-gray-400 uppercase tracking-widest rounded-r-xl">Detalles</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {config.coupons?.filter(c => c.campaignId === selectedCampaignForView.id).map(coupon => (
                                            <tr key={coupon.id} className="hover:bg-gray-50 transition-colors">
                                                <td className="p-3 font-mono font-bold text-gray-700 select-all">{coupon.code}</td>
                                                <td className="p-3">
                                                    <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase ${coupon.status === 'REDEEMED' ? 'bg-green-100 text-green-600' :
                                                            coupon.status === 'EXPIRED' ? 'bg-red-100 text-red-600' :
                                                                'bg-blue-100 text-blue-600'
                                                        }`}>
                                                        {coupon.status === 'REDEEMED' ? 'CANJEADO' :
                                                            coupon.status === 'EXPIRED' ? 'EXPIRADO' : 'DISPONIBLE'}
                                                    </span>
                                                </td>
                                                <td className="p-3 text-xs text-gray-500">
                                                    {coupon.status === 'REDEEMED' ? (
                                                        <div>
                                                            <p>Ticket: {coupon.ticketRef}</p>
                                                            <p>{new Date(coupon.redeemedAt!).toLocaleString()}</p>
                                                        </div>
                                                    ) : (
                                                        <span>Creado: {new Date(coupon.createdAt).toLocaleDateString()}</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CouponManager;
