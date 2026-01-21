import React, { useState } from 'react';
import { X, ArrowLeft, ArrowRight, Upload, FileText, Database, CheckCircle } from 'lucide-react';
import { BusinessConfig, Product, Customer, Supplier, Warehouse } from '../../types';
import { ImportMappingTemplate, ImportMode } from '../../types/importExport';
import { parseFile } from '../../utils/importParser';
import Step1Config from './Step1Config';
import Step2Mapping from './Step2Mapping';
import Step3Preview from './Step3Preview';
import Step4Processing from './Step4Processing';

interface ImportWizardProps {
    config: BusinessConfig;
    products: Product[];
    customers: Customer[];
    suppliers: Supplier[];
    warehouses: Warehouse[];
    onClose: () => void;
    onUpdateConfig: (newConfig: BusinessConfig) => void;
    onUpdateProducts: (products: Product[]) => Promise<void>;
    onUpdateCustomers: (customers: Customer[]) => Promise<void>;
    onUpdateSuppliers: (suppliers: Supplier[]) => Promise<void>;
    onUpdateWarehouses: (warehouses: Warehouse[]) => Promise<void>;
}

export const ImportWizard: React.FC<ImportWizardProps> = ({
    config,
    products,
    customers,
    suppliers,
    warehouses,
    onClose,
    onUpdateConfig,
    onUpdateProducts,
    onUpdateCustomers,
    onUpdateSuppliers,
    onUpdateWarehouses
}) => {
    const [step, setStep] = useState(1);
    const [file, setFile] = useState<File | null>(null);
    const [parsedData, setParsedData] = useState<any[]>([]);
    const [headers, setHeaders] = useState<string[]>([]);
    const [entityType, setEntityType] = useState<'PRODUCT' | 'CUSTOMER' | 'SUPPLIER' | 'INVENTORY'>('PRODUCT');
    const [importMode, setImportMode] = useState<ImportMode>('UPSERT');
    const [mapping, setMapping] = useState<{ [key: string]: string }>({});

    const handleFileSelect = async (selectedFile: File) => {
        setFile(selectedFile);
        try {
            const { data, headers } = await parseFile(selectedFile);
            setParsedData(data);
            setHeaders(headers);
        } catch (error) {
            alert("Error parsing file: " + error);
            setFile(null);
        }
    };

    const handleNext = () => {
        if (step < 4) setStep(step + 1);
    };

    const handleBack = () => {
        if (step > 1) setStep(step - 1);
    };

    return (
        <div className="fixed inset-0 z-[100] bg-gray-50 flex flex-col overflow-hidden animate-in slide-in-from-bottom-5">
            {/* Header */}
            <div className="bg-white px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500">
                        <X size={24} />
                    </button>
                    <div>
                        <h1 className="text-xl font-black text-gray-900">Asistente de Importación</h1>
                        <p className="text-xs text-gray-500 font-medium">Paso {step} de 4</p>
                    </div>
                </div>

                {/* Progress Indicators */}
                <div className="flex items-center gap-2">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className={`h-2 w-12 rounded-full transition-colors ${i <= step ? 'bg-blue-600' : 'bg-gray-200'}`} />
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full">
                {step === 1 && (
                    <Step1Config
                        file={file}
                        onFileSelect={handleFileSelect}
                        entityType={entityType}
                        setEntityType={setEntityType}
                        importMode={importMode}
                        setImportMode={setImportMode}
                    />
                )}
                {step === 2 && (
                    <Step2Mapping
                        headers={headers}
                        entityType={entityType}
                        mapping={mapping}
                        setMapping={setMapping}
                    />
                )}
                {step === 3 && (
                    <Step3Preview
                        data={parsedData}
                        mapping={mapping}
                        entityType={entityType}
                    />
                )}
                {step === 4 && (
                    <Step4Processing
                        data={parsedData}
                        mapping={mapping}
                        entityType={entityType}
                        importMode={importMode}
                        config={config}
                        products={products}
                        customers={customers}
                        suppliers={suppliers}
                        warehouses={warehouses}
                        onUpdateProducts={onUpdateProducts}
                        onUpdateCustomers={onUpdateCustomers}
                        onUpdateSuppliers={onUpdateSuppliers}
                        onUpdateWarehouses={onUpdateWarehouses}
                        onClose={onClose}
                    />
                )}
            </div>

            {/* Footer Navigation */}
            <div className="bg-white p-6 border-t border-gray-200 flex justify-between">
                <button
                    onClick={handleBack}
                    disabled={step === 1 || step === 4}
                    className="px-6 py-3 rounded-xl font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    <ArrowLeft size={20} /> Atrás
                </button>

                {step < 4 && (
                    <button
                        onClick={handleNext}
                        disabled={!file || (step === 2 && Object.keys(mapping).length === 0)}
                        className="px-6 py-3 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-700 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        Siguiente <ArrowRight size={20} />
                    </button>
                )}
            </div>
        </div>
    );
};
