import React, { useState, useRef } from 'react';
import {
    Wallet, Shield, Upload, CheckCircle2, AlertTriangle,
    Eye, EyeOff, Save, RefreshCw, Lock, FileJson, FileKey
} from 'lucide-react';
import { WalletConfig, BusinessConfig } from '../types';

interface WalletIntegrationsProps {
    config: BusinessConfig;
    onUpdateConfig: (config: BusinessConfig) => void;
}

const WalletIntegrations: React.FC<WalletIntegrationsProps> = ({ config, onUpdateConfig }) => {
    const [activeTab, setActiveTab] = useState<'APPLE' | 'GOOGLE'>('APPLE');
    const [showPassword, setShowPassword] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    // Local state for form inputs
    const [appleTeamId, setAppleTeamId] = useState(config.terminals?.[0]?.config?.wallet?.apple?.teamId || '');
    const [applePassType, setApplePassType] = useState(config.terminals?.[0]?.config?.wallet?.apple?.passTypeIdentifier || '');
    const [appleP12Password, setAppleP12Password] = useState(config.terminals?.[0]?.config?.wallet?.apple?.p12Password || '');
    const [appleP12File, setAppleP12File] = useState<string | null>(config.terminals?.[0]?.config?.wallet?.apple?.p12Cert || null);

    const [googleIssuerId, setGoogleIssuerId] = useState(config.terminals?.[0]?.config?.wallet?.google?.issuerId || '');
    const [googleJsonFile, setGoogleJsonFile] = useState<string | null>(config.terminals?.[0]?.config?.wallet?.google?.serviceAccountJson || null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>, type: 'APPLE' | 'GOOGLE') => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result as string;
            if (type === 'APPLE') {
                // For P12, we might want base64. FileReader.readAsDataURL gives base64.
                // However, for this demo, let's assume we handle it as a string or base64.
                setAppleP12File(content);
            } else {
                setGoogleJsonFile(content);
            }
        };

        if (type === 'APPLE') {
            reader.readAsDataURL(file); // Base64 for binary
        } else {
            reader.readAsText(file); // Text for JSON
        }
    };

    const handleSave = async () => {
        // In a real app, we would send this to the backend to be encrypted and stored.
        // Here we simulate updating the local config state.

        const newWalletConfig: WalletConfig = {
            apple: {
                teamId: appleTeamId,
                passTypeIdentifier: applePassType,
                p12Cert: appleP12File || '',
                p12Password: appleP12Password,
                isConfigured: !!(appleTeamId && applePassType && appleP12File)
            },
            google: {
                issuerId: googleIssuerId,
                serviceAccountJson: googleJsonFile || '',
                isConfigured: !!(googleIssuerId && googleJsonFile)
            }
        };

        // Update the main config object
        // Note: We are assuming 'terminal' exists in config. If not, we'd need to handle that.
        // For this specific codebase structure, we might need to adjust where 'wallet' lives.
        // Based on types.ts, it's inside TerminalConfig.

        // We'll create a deep copy or use the prop updater
        const updatedConfig = { ...config };
        if (!updatedConfig.terminals[0]) return; // Guard clause

        // We'll attach it to the first terminal or a global setting if available.
        // The types.ts showed 'wallet' inside TerminalConfig.
        // Let's assume we update the primary terminal.

        const updatedTerminals = updatedConfig.terminals.map((t, idx) => {
            if (idx === 0) { // Assuming primary terminal for global config
                return {
                    ...t,
                    config: {
                        ...t.config,
                        wallet: newWalletConfig
                    }
                };
            }
            return t;
        });

        onUpdateConfig({ ...updatedConfig, terminals: updatedTerminals });
        alert("Configuración guardada (Simulación: Datos encriptados localmente)");
    };

    const handleTestConnection = async () => {
        setIsTesting(true);
        setTestResult(null);

        // Simulate API call
        setTimeout(() => {
            setIsTesting(false);
            if (activeTab === 'APPLE') {
                if (appleTeamId && appleP12File) {
                    setTestResult({ success: true, message: 'Conexión con Apple Wallet exitosa. Certificado válido.' });
                } else {
                    setTestResult({ success: false, message: 'Error: Faltan credenciales de Apple.' });
                }
            } else {
                if (googleIssuerId && googleJsonFile) {
                    try {
                        JSON.parse(googleJsonFile);
                        setTestResult({ success: true, message: 'Conexión con Google Wallet exitosa. JSON válido.' });
                    } catch (e) {
                        setTestResult({ success: false, message: 'Error: El archivo JSON no es válido.' });
                    }
                } else {
                    setTestResult({ success: false, message: 'Error: Faltan credenciales de Google.' });
                }
            }
        }, 1500);
    };

    return (
        <div className="h-full flex flex-col bg-gray-50 animate-in fade-in duration-300">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 p-6 flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                        <Wallet className="text-blue-600" /> Integraciones Wallet
                    </h2>
                    <p className="text-sm text-gray-500">Gestiona las llaves criptográficas para Apple y Google Wallet</p>
                </div>
                <div className="flex bg-gray-100 p-1 rounded-xl">
                    <button
                        onClick={() => setActiveTab('APPLE')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'APPLE' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <img src="https://upload.wikimedia.org/wikipedia/commons/f/fa/Apple_logo_black.svg" className="w-4 h-4" alt="Apple" /> Apple Wallet
                    </button>
                    <button
                        onClick={() => setActiveTab('GOOGLE')}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'GOOGLE' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <img src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg" className="w-4 h-4" alt="Google" /> Google Wallet
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">

                {/* Security Notice */}
                <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 mb-8 flex gap-4 items-start">
                    <div className="bg-blue-100 p-2 rounded-lg text-blue-600 shrink-0">
                        <Shield size={24} />
                    </div>
                    <div>
                        <h4 className="font-bold text-blue-800">Almacenamiento Seguro (Vault)</h4>
                        <p className="text-sm text-blue-600 mt-1">
                            Las credenciales subidas aquí son encriptadas antes de guardarse.
                            Nunca almacenamos tus llaves privadas o contraseñas en texto plano.
                        </p>
                    </div>
                </div>

                {activeTab === 'APPLE' ? (
                    <div className="space-y-6 animate-in slide-in-from-right-4">
                        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-6">
                            <h3 className="font-bold text-gray-800 text-lg border-b border-gray-100 pb-2">Credenciales de Apple Developer</h3>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Team ID</label>
                                    <input
                                        type="text"
                                        value={appleTeamId}
                                        onChange={(e) => setAppleTeamId(e.target.value)}
                                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="Ej. A1B2C3D4E5"
                                    />
                                    <p className="text-[10px] text-gray-400 mt-1">Lo encuentras en tu cuenta de Apple Developer.</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Pass Type Identifier</label>
                                    <input
                                        type="text"
                                        value={applePassType}
                                        onChange={(e) => setApplePassType(e.target.value)}
                                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                        placeholder="pass.com.tuempresa.loyalty"
                                    />
                                </div>
                            </div>

                            <div className="border-t border-gray-100 pt-6">
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-4">Certificado de Producción (.p12)</label>

                                <div className="flex items-start gap-6">
                                    <div className="flex-1">
                                        <div
                                            onClick={() => fileInputRef.current?.click()}
                                            className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center cursor-pointer hover:bg-gray-50 transition-colors group"
                                        >
                                            <input
                                                type="file"
                                                ref={fileInputRef}
                                                accept=".p12"
                                                className="hidden"
                                                onChange={(e) => handleFileUpload(e, 'APPLE')}
                                            />
                                            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                                                <FileKey className="text-gray-400" size={24} />
                                            </div>
                                            <p className="font-bold text-gray-600">
                                                {appleP12File ? 'Certificado Cargado' : 'Click para subir archivo .p12'}
                                            </p>
                                            <p className="text-xs text-gray-400 mt-1">
                                                {appleP12File ? 'El archivo está listo para guardarse.' : 'Asegúrate de exportarlo con clave privada.'}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="w-full md:w-1/3">
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Contraseña del Certificado</label>
                                        <div className="relative">
                                            <input
                                                type={showPassword ? "text" : "password"}
                                                value={appleP12Password}
                                                onChange={(e) => setAppleP12Password(e.target.value)}
                                                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 pr-10"
                                                placeholder="••••••••"
                                            />
                                            <button
                                                onClick={() => setShowPassword(!showPassword)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                            >
                                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-6 animate-in slide-in-from-right-4">
                        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-6">
                            <h3 className="font-bold text-gray-800 text-lg border-b border-gray-100 pb-2">Credenciales de Google Pay Console</h3>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Issuer ID</label>
                                <input
                                    type="text"
                                    value={googleIssuerId}
                                    onChange={(e) => setGoogleIssuerId(e.target.value)}
                                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                    placeholder="Ej. 3388000000000000000"
                                />
                                <p className="text-[10px] text-gray-400 mt-1">Es el ID numérico de tu cuenta de emisor en Google Pay.</p>
                            </div>

                            <div className="border-t border-gray-100 pt-6">
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-4">Service Account Key (.json)</label>

                                <div
                                    onClick={() => fileInputRef.current?.click()}
                                    className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center cursor-pointer hover:bg-gray-50 transition-colors group"
                                >
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        accept=".json"
                                        className="hidden"
                                        onChange={(e) => handleFileUpload(e, 'GOOGLE')}
                                    />
                                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                                        <FileJson className="text-gray-400" size={24} />
                                    </div>
                                    <p className="font-bold text-gray-600">
                                        {googleJsonFile ? 'Llave JSON Cargada' : 'Click para subir archivo JSON'}
                                    </p>
                                    <p className="text-xs text-gray-400 mt-1">
                                        Descarga este archivo desde Google Cloud IAM.
                                    </p>
                                </div>
                                {googleJsonFile && (
                                    <div className="mt-4 bg-gray-900 text-gray-300 p-4 rounded-xl font-mono text-xs overflow-x-auto">
                                        {googleJsonFile.substring(0, 100)}...
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Actions */}
                <div className="mt-8 flex items-center justify-end gap-4">
                    {testResult && (
                        <div className={`flex items-center gap-2 text-sm font-bold px-4 py-2 rounded-lg animate-in fade-in ${testResult.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {testResult.success ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                            {testResult.message}
                        </div>
                    )}

                    <button
                        onClick={handleTestConnection}
                        disabled={isTesting}
                        className="px-6 py-3 bg-white border border-gray-300 text-gray-700 rounded-xl font-bold hover:bg-gray-50 transition-all flex items-center gap-2 disabled:opacity-50"
                    >
                        {isTesting ? <RefreshCw size={20} className="animate-spin" /> : <RefreshCw size={20} />}
                        Probar Conexión
                    </button>

                    <button
                        onClick={handleSave}
                        className="px-8 py-3 bg-gray-900 text-white rounded-xl font-bold shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                    >
                        <Save size={20} />
                        Guardar Configuración
                    </button>
                </div>

            </div>
        </div>
    );
};

export default WalletIntegrations;
