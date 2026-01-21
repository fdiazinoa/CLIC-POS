import React from 'react';
import { Upload, FileText, Database, AlertCircle, Download } from 'lucide-react';
import { ImportMode } from '../../types/importExport';
import { SYSTEM_FIELDS, DEMO_DATA } from '../../constants/importFields';

interface Step1ConfigProps {
    file: File | null;
    onFileSelect: (file: File) => void;
    entityType: 'PRODUCT' | 'CUSTOMER' | 'SUPPLIER' | 'INVENTORY';
    setEntityType: (type: 'PRODUCT' | 'CUSTOMER' | 'SUPPLIER' | 'INVENTORY') => void;
    importMode: ImportMode;
    setImportMode: (mode: ImportMode) => void;
}

const Step1Config: React.FC<Step1ConfigProps> = ({
    file,
    onFileSelect,
    entityType,
    setEntityType,
    importMode,
    setImportMode
}) => {
    const generateTemplate = () => {
        const fields = SYSTEM_FIELDS[entityType];
        const headers = fields.map(f => f.id).join(',');

        // Get demo data for the current entity type
        const demoData = DEMO_DATA[entityType];
        const demoRow = fields.map(f => {
            const value = demoData[f.id as keyof typeof demoData];
            return value !== undefined ? value : '';
        }).join(',');

        const csvContent = `${headers}\n${demoRow}`;
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `template_${entityType.toLowerCase()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
            <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-gray-900">Configuración de la Carga</h2>
                <p className="text-gray-500">Selecciona el archivo y define qué tipo de datos vas a importar.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* File Upload */}
                <div className="space-y-4">
                    <label className="block text-sm font-bold text-gray-700">Archivo de Origen</label>
                    <div className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center hover:bg-gray-50 transition-colors relative">
                        <input
                            type="file"
                            accept=".csv,.json,.txt"
                            onChange={(e) => e.target.files && onFileSelect(e.target.files[0])}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div className="flex flex-col items-center gap-3 pointer-events-none">
                            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center">
                                <Upload size={32} />
                            </div>
                            <div>
                                <p className="font-bold text-gray-900">
                                    {file ? file.name : "Arrastra tu archivo aquí"}
                                </p>
                                <p className="text-xs text-gray-400 mt-1">Soporta CSV, JSON, TXT</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Configuration */}
                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">Entidad a Importar</label>
                        <div className="grid grid-cols-2 gap-3">
                            {[
                                { id: 'PRODUCT', label: 'Artículos' },
                                { id: 'CUSTOMER', label: 'Clientes' },
                                { id: 'SUPPLIER', label: 'Proveedores' },
                                { id: 'INVENTORY', label: 'Inventario (Stock)' }
                            ].map((type) => (
                                <button
                                    key={type.id}
                                    onClick={() => setEntityType(type.id as any)}
                                    className={`p-4 rounded-xl border text-left transition-all ${entityType === type.id
                                        ? 'bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500'
                                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                                        }`}
                                >
                                    <span className="font-bold text-sm">{type.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <button
                        onClick={generateTemplate}
                        className="mt-4 w-full flex items-center justify-center gap-2 p-3 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors font-medium text-sm"
                    >
                        <Download size={16} />
                        Descargar Plantilla CSV para {entityType === 'PRODUCT' ? 'Artículos' : entityType === 'CUSTOMER' ? 'Clientes' : entityType === 'SUPPLIER' ? 'Proveedores' : 'Inventario'}
                    </button>


                    {entityType === 'INVENTORY' && (
                        <div className="bg-yellow-50 p-4 rounded-xl border border-yellow-100 animate-in fade-in">
                            <label className="block text-sm font-bold text-yellow-800 mb-3 flex items-center gap-2">
                                <AlertCircle size={16} /> Modo de Operación
                            </label>
                            <div className="space-y-3">
                                <label className="flex items-start gap-3 p-3 bg-white rounded-lg border border-yellow-200 cursor-pointer hover:bg-yellow-50/50 transition-colors">
                                    <input
                                        type="radio"
                                        name="importMode"
                                        checked={importMode === 'ADDITIVE'}
                                        onChange={() => setImportMode('ADDITIVE')}
                                        className="mt-1 text-blue-600 focus:ring-blue-500"
                                    />
                                    <div>
                                        <span className="block font-bold text-gray-900 text-sm">Modo Aditivo (Compra)</span>
                                        <span className="block text-xs text-gray-500 mt-0.5">Suma al stock actual y recalcula costo promedio.</span>
                                    </div>
                                </label>
                                <label className="flex items-start gap-3 p-3 bg-white rounded-lg border border-yellow-200 cursor-pointer hover:bg-yellow-50/50 transition-colors">
                                    <input
                                        type="radio"
                                        name="importMode"
                                        checked={importMode === 'ABSOLUTE'}
                                        onChange={() => setImportMode('ABSOLUTE')}
                                        className="mt-1 text-blue-600 focus:ring-blue-500"
                                    />
                                    <div>
                                        <span className="block font-bold text-gray-900 text-sm">Modo Absoluto (Toma Física)</span>
                                        <span className="block text-xs text-gray-500 mt-0.5">Reemplaza el stock actual con el valor del archivo.</span>
                                    </div>
                                </label>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Step1Config;
