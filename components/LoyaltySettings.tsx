import React, { useState } from 'react';
import { ArrowLeft, Save, Award, AlertCircle, HelpCircle, Mail } from 'lucide-react';
import { BusinessConfig, LoyaltyConfig } from '../types';
import EmailPreviewModal from './EmailPreviewModal';

interface LoyaltySettingsProps {
    config: BusinessConfig;
    onUpdateConfig: (newConfig: BusinessConfig) => void;
    onClose: () => void;
}

const LoyaltySettings: React.FC<LoyaltySettingsProps> = ({ config, onUpdateConfig, onClose }) => {
    const [loyaltyConfig, setLoyaltyConfig] = useState<LoyaltyConfig>(config.loyalty || {
        isEnabled: false,
        earnRate: 0.1, // Default: 1 point per $10 (0.1 points per $1)
        redeemRate: 1.0, // Default: 1 point = $1.00
        minRedemptionPoints: 10,
        expirationMonths: 12,
        expirationMonths: 12,
        excludedCategories: []
    });

    const [showEmailPreview, setShowEmailPreview] = useState(false);

    const handleSave = () => {
        onUpdateConfig({
            ...config,
            loyalty: loyaltyConfig
        });
        onClose();
    };

    return (
        <div className="flex flex-col h-full bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-8 py-5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
                        <ArrowLeft size={24} />
                    </button>
                    <div>
                        <h2 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                            <Award className="text-purple-600" /> Programa de Lealtad
                        </h2>
                        <p className="text-sm text-gray-500">Configura las reglas de acumulación y canje de puntos.</p>
                    </div>
                </div>
                <button
                    onClick={handleSave}
                    className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2"
                >
                    <Save size={18} /> Guardar Cambios
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full">

                {/* Main Toggle */}
                <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 mb-8 flex items-center justify-between">
                    <div>
                        <h3 className="text-lg font-bold text-gray-800">Habilitar Programa de Puntos</h3>
                        <p className="text-gray-500 text-sm mt-1">Permite a los clientes acumular y canjear puntos en sus compras.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            checked={loyaltyConfig.isEnabled}
                            onChange={(e) => setLoyaltyConfig({ ...loyaltyConfig, isEnabled: e.target.checked })}
                            className="sr-only peer"
                        />
                        <div className="w-14 h-7 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-purple-600"></div>
                    </label>
                </div>

                {loyaltyConfig.isEnabled && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">

                        {/* Accumulation Rules */}
                        <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
                            <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-sm">1</div>
                                Reglas de Acumulación
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Tasa de Acumulación</label>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={loyaltyConfig.earnRate}
                                            onChange={(e) => setLoyaltyConfig({ ...loyaltyConfig, earnRate: parseFloat(e.target.value) })}
                                            className="w-32 p-4 bg-gray-50 border border-gray-200 rounded-xl font-mono text-lg font-bold outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <span className="text-sm font-medium text-gray-600">Puntos por cada {config.currencySymbol}1.00 gastado</span>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                                        <HelpCircle size={12} /> Ejemplo: 0.1 significa 1 punto por cada $10.
                                    </p>
                                </div>

                                <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
                                    <h4 className="font-bold text-blue-800 text-sm mb-2">Simulación</h4>
                                    <p className="text-sm text-blue-600">
                                        Si un cliente gasta <strong>{config.currencySymbol}100.00</strong>, ganará:
                                    </p>
                                    <p className="text-3xl font-black text-blue-700 mt-2">
                                        {Math.floor(100 * loyaltyConfig.earnRate)} Puntos
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Redemption Rules */}
                        <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
                            <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-green-100 text-green-600 flex items-center justify-center font-bold text-sm">2</div>
                                Reglas de Canje
                            </h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Valor del Punto</label>
                                    <div className="flex items-center gap-3">
                                        <span className="text-lg font-bold text-gray-400">1 Punto = </span>
                                        <div className="relative">
                                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">{config.currencySymbol}</span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={loyaltyConfig.redeemRate}
                                                onChange={(e) => setLoyaltyConfig({ ...loyaltyConfig, redeemRate: parseFloat(e.target.value) })}
                                                className="w-32 pl-8 pr-4 py-4 bg-gray-50 border border-gray-200 rounded-xl font-mono text-lg font-bold outline-none focus:ring-2 focus:ring-green-500"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Mínimo para Canjear</label>
                                    <input
                                        type="number"
                                        value={loyaltyConfig.minRedemptionPoints}
                                        onChange={(e) => setLoyaltyConfig({ ...loyaltyConfig, minRedemptionPoints: parseInt(e.target.value) })}
                                        className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-mono text-lg font-bold outline-none focus:ring-2 focus:ring-green-500"
                                    />
                                    <p className="text-xs text-gray-400 mt-2">Puntos mínimos requeridos para usar en una compra.</p>
                                </div>
                            </div>
                        </div>

                        {/* Expiration */}
                        <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
                            <h3 className="text-lg font-bold text-gray-800 mb-6 flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-sm">3</div>
                                Vencimiento
                            </h3>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Vencimiento de Puntos (Meses)</label>
                                <input
                                    type="number"
                                    value={loyaltyConfig.expirationMonths}
                                    onChange={(e) => setLoyaltyConfig({ ...loyaltyConfig, expirationMonths: parseInt(e.target.value) })}
                                    className="w-full max-w-xs p-4 bg-gray-50 border border-gray-200 rounded-xl font-mono text-lg font-bold outline-none focus:ring-2 focus:ring-orange-500"
                                />
                                <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                                    <AlertCircle size={12} /> Los puntos vencerán si no hay actividad en este periodo.
                                </p>
                            </div>
                        </div>

                        {/* Email Template Preview */}
                        <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                    <Mail className="text-blue-600" size={20} />
                                    Plantilla de Correo
                                </h3>
                                <p className="text-gray-500 text-sm mt-1">
                                    Vista previa del correo de bienvenida con la tarjeta digital.
                                </p>
                            </div>
                            <button
                                onClick={() => setShowEmailPreview(true)}
                                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
                            >
                                Ver Vista Previa
                            </button>
                        </div>

                    </div>
                )}

                {showEmailPreview && <EmailPreviewModal onClose={() => setShowEmailPreview(false)} />}
            </div>
        </div>
    );
};

export default LoyaltySettings;
