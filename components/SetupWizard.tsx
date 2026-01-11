import React, { useState, useEffect } from 'react';
import { 
  ArrowRight, ArrowLeft, Check, UploadCloud, FileSpreadsheet, 
  Map, DollarSign, Flag, Building2, Package, Percent, Wand2,
  CheckCircle2, X, ChevronDown, AlertCircle
} from 'lucide-react';
import { BusinessConfig, CompanyInfo } from '../types';

interface SetupWizardProps {
  initialConfig: BusinessConfig;
  onComplete: (finalConfig: BusinessConfig) => void;
}

type WizardStep = 'BUSINESS' | 'CATALOG' | 'TAXES' | 'READY';

const STEPS: { id: WizardStep; label: string; icon: any }[] = [
  { id: 'BUSINESS', label: 'Negocio', icon: Building2 },
  { id: 'CATALOG', label: 'Catálogo', icon: Package },
  { id: 'TAXES', label: 'Impuestos', icon: DollarSign },
  { id: 'READY', label: 'Listo', icon: CheckCircle2 },
];

const TAX_PRESETS = [
  { id: 'DO', label: 'Rep. Dominicana', taxName: 'ITBIS', rate: 0.18, currency: 'RD$', flag: '🇩🇴' },
  { id: 'ES', label: 'España', taxName: 'IVA', rate: 0.21, currency: '€', flag: '🇪🇸' },
  { id: 'MX', label: 'México', taxName: 'IVA', rate: 0.16, currency: '$', flag: '🇲🇽' },
  { id: 'US', label: 'USA', taxName: 'Sales Tax', rate: 0.08, currency: '$', flag: '🇺🇸' },
  { id: 'OTHER', label: 'Otro', taxName: 'Tax', rate: 0.00, currency: '$', flag: '🌍' },
];

// Available fields in the App to map to
const SYSTEM_FIELDS = [
  { id: 'ignore', label: '⛔ Ignorar columna' },
  { id: 'name', label: 'Nombre Producto' },
  { id: 'price', label: 'Precio Venta' },
  { id: 'cost', label: 'Costo Unitario' },
  { id: 'sku', label: 'Código Barras / SKU' },
  { id: 'stock', label: 'Stock Inicial' },
  { id: 'category', label: 'Categoría' },
  { id: 'attr_size', label: 'Atributo: Talla' },
  { id: 'attr_color', label: 'Atributo: Color' },
];

// Simulating headers detected from the user's CSV
const DETECTED_CSV_HEADERS = [
  'Código', 
  'Descripción Item', 
  'Talla', 
  'Color', 
  'PVP'
];

const SetupWizard: React.FC<SetupWizardProps> = ({ initialConfig, onComplete }) => {
  const [currentStep, setCurrentStep] = useState<WizardStep>('BUSINESS');
  const [config, setConfig] = useState<BusinessConfig>(initialConfig);
  
  // Catalog Import State
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isMappingMode, setIsMappingMode] = useState(false);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [isAutoMatching, setIsAutoMatching] = useState(false);

  // --- HANDLERS ---

  const handleNext = () => {
    const currentIndex = STEPS.findIndex(s => s.id === currentStep);
    if (currentIndex < STEPS.length - 1) {
      setCurrentStep(STEPS[currentIndex + 1].id);
    } else {
      onComplete(config);
    }
  };

  const handleBack = () => {
    const currentIndex = STEPS.findIndex(s => s.id === currentStep);
    if (currentIndex > 0) {
      setCurrentStep(STEPS[currentIndex - 1].id);
    }
  };

  const handleUpdateCompany = (field: keyof CompanyInfo, value: string) => {
    setConfig(prev => ({
      ...prev,
      companyInfo: { ...prev.companyInfo, [field]: value }
    }));
  };

  const handleTaxSelect = (preset: typeof TAX_PRESETS[0]) => {
    setConfig(prev => ({
      ...prev,
      currencySymbol: preset.currency,
      taxRate: preset.rate
    }));
    handleNext();
  };

  // Mock File Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setImportFile(e.target.files[0]);
      // Simulate processing delay
      setTimeout(() => {
        setIsMappingMode(true);
        // Initialize mapping with 'ignore'
        const initialMap: Record<string, string> = {};
        DETECTED_CSV_HEADERS.forEach(h => initialMap[h] = 'ignore');
        setColumnMapping(initialMap);
      }, 800);
    }
  };

  const handleAutoMap = () => {
    setIsAutoMatching(true);
    setTimeout(() => {
      const newMap: Record<string, string> = {};
      DETECTED_CSV_HEADERS.forEach(header => {
        const h = header.toLowerCase();
        // Simple fuzzy matching logic simulation
        if (h.includes('código') || h.includes('sku') || h.includes('000')) newMap[header] = 'sku';
        else if (h.includes('descripción') || h.includes('nombre') || h.includes('item')) newMap[header] = 'name';
        else if (h.includes('pvp') || h.includes('precio') || h.includes('venta')) newMap[header] = 'price';
        else if (h.includes('costo')) newMap[header] = 'cost';
        else if (h.includes('stock') || h.includes('cantidad')) newMap[header] = 'stock';
        else if (h.includes('talla')) newMap[header] = 'attr_size';
        else if (h.includes('color')) newMap[header] = 'attr_color';
        else newMap[header] = 'ignore';
      });
      setColumnMapping(newMap);
      setIsAutoMatching(false);
    }, 600);
  };

  const handleManualMapChange = (header: string, fieldId: string) => {
    setColumnMapping(prev => ({
      ...prev,
      [header]: fieldId
    }));
  };

  // --- RENDER STEPS ---

  const renderBusinessStep = () => (
    <div className="space-y-6 animate-in slide-in-from-right-8 duration-500">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-800">Datos del Negocio</h2>
        <p className="text-gray-500">Información básica para tus tickets y facturas.</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="col-span-2">
          <label className="block text-sm font-bold text-gray-600 mb-2">Nombre Comercial</label>
          <input 
            type="text" 
            value={config.companyInfo.name}
            onChange={(e) => handleUpdateCompany('name', e.target.value)}
            className="w-full p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-lg"
            placeholder="Ej. Cafetería Central"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-600 mb-2">Identificación Fiscal (RNC/NIF)</label>
          <input 
            type="text" 
            value={config.companyInfo.rnc}
            onChange={(e) => handleUpdateCompany('rnc', e.target.value)}
            className="w-full p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            placeholder="XXX-XXXXXX-X"
          />
        </div>
        <div>
          <label className="block text-sm font-bold text-gray-600 mb-2">Teléfono</label>
          <input 
            type="tel" 
            value={config.companyInfo.phone}
            onChange={(e) => handleUpdateCompany('phone', e.target.value)}
            className="w-full p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            placeholder="+1 (000) 000-0000"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-bold text-gray-600 mb-2">Dirección</label>
          <input 
            type="text" 
            value={config.companyInfo.address}
            onChange={(e) => handleUpdateCompany('address', e.target.value)}
            className="w-full p-4 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            placeholder="Calle Principal #123"
          />
        </div>
      </div>
    </div>
  );

  const renderCatalogStep = () => (
    <div className="space-y-6 animate-in slide-in-from-right-8 duration-500 h-full flex flex-col">
      <div className="text-center mb-4">
        <h2 className="text-2xl font-bold text-gray-800">Importación de Catálogo</h2>
        <p className="text-gray-500">Carga tus productos masivamente o salta este paso.</p>
      </div>

      {!isMappingMode ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <label className="w-full max-w-lg aspect-video border-2 border-dashed border-gray-300 rounded-3xl bg-gray-50 hover:bg-blue-50 hover:border-blue-400 transition-all cursor-pointer flex flex-col items-center justify-center group relative overflow-hidden">
            <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="p-4 bg-white rounded-full shadow-sm mb-4 group-hover:scale-110 transition-transform">
              <UploadCloud size={32} className="text-blue-500" />
            </div>
            <h3 className="font-bold text-gray-700 text-lg">Arrastra tu Excel o CSV aquí</h3>
            <p className="text-gray-400 text-sm mt-2">o haz click para buscar</p>
            <input type="file" className="hidden" accept=".csv,.xlsx" onChange={handleFileUpload} />
          </label>
          <div className="mt-8 flex gap-4 text-sm text-gray-400">
            <span className="flex items-center gap-2"><FileSpreadsheet size={16} /> Plantilla CSV</span>
            <span className="flex items-center gap-2"><FileSpreadsheet size={16} /> Plantilla Excel</span>
          </div>
        </div>
      ) : (
        <div className="flex-1 bg-white border border-gray-200 rounded-2xl overflow-hidden flex flex-col shadow-sm">
          {/* Header Bar */}
          <div className="bg-gray-50 p-4 border-b border-gray-200 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="bg-green-100 text-green-700 p-2 rounded-lg"><FileSpreadsheet size={20} /></div>
              <div>
                <p className="font-bold text-gray-800 text-sm truncate max-w-[200px]">{importFile?.name}</p>
                <p className="text-xs text-gray-500">Detectadas {DETECTED_CSV_HEADERS.length} columnas</p>
              </div>
            </div>
            <button 
              onClick={handleAutoMap} 
              disabled={isAutoMatching}
              className="text-blue-600 text-sm font-bold flex items-center gap-2 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              <Wand2 size={16} className={isAutoMatching ? 'animate-spin' : ''} /> 
              {isAutoMatching ? 'Analizando...' : 'Auto-Match'}
            </button>
          </div>
          
          {/* Mapping Table */}
          <div className="flex-1 p-6 overflow-y-auto">
            <div className="grid grid-cols-12 gap-4 mb-4 px-2">
              <div className="col-span-5 text-xs font-bold text-gray-400 uppercase tracking-wider">Columna Archivo</div>
              <div className="col-span-2 flex justify-center text-xs font-bold text-gray-400 uppercase tracking-wider">Estado</div>
              <div className="col-span-5 text-xs font-bold text-gray-400 uppercase tracking-wider">Campo en Sistema</div>
            </div>

            {DETECTED_CSV_HEADERS.map((header, idx) => {
              const mappedFieldId = columnMapping[header];
              const isMapped = mappedFieldId && mappedFieldId !== 'ignore';
              
              return (
                <div key={idx} className="grid grid-cols-12 gap-4 items-center mb-3 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50/50 rounded-lg px-2 transition-colors">
                  {/* Left: CSV Header */}
                  <div className="col-span-5">
                    <div className="bg-gray-100 text-gray-700 px-3 py-2.5 rounded-xl text-sm font-medium border border-gray-200 flex items-center gap-2">
                      <FileSpreadsheet size={14} className="text-gray-400" />
                      {header}
                    </div>
                  </div>

                  {/* Center: Status Indicator */}
                  <div className="col-span-2 flex justify-center">
                    {isMapped ? (
                      <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center animate-in zoom-in">
                        <Check size={16} strokeWidth={3} />
                      </div>
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-300 flex items-center justify-center">
                        <ArrowRight size={16} />
                      </div>
                    )}
                  </div>

                  {/* Right: Dropdown Selector */}
                  <div className="col-span-5 relative">
                    <select
                      value={mappedFieldId || 'ignore'}
                      onChange={(e) => handleManualMapChange(header, e.target.value)}
                      className={`
                        w-full appearance-none px-3 py-2.5 rounded-xl text-sm font-bold border outline-none transition-all cursor-pointer
                        ${isMapped 
                          ? 'bg-blue-50 text-blue-700 border-blue-200 hover:border-blue-300 focus:ring-2 focus:ring-blue-200' 
                          : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300 focus:ring-2 focus:ring-gray-100'
                        }
                      `}
                    >
                      {SYSTEM_FIELDS.map(field => (
                        <option key={field.id} value={field.id}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <ChevronDown size={16} className={isMapped ? 'text-blue-500' : 'text-gray-400'} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          
          <div className="bg-blue-50/50 p-3 text-center border-t border-blue-100">
             <p className="text-xs text-blue-600 font-medium flex items-center justify-center gap-2">
                <AlertCircle size={14} />
                Asegúrate de revisar todas las columnas antes de continuar.
             </p>
          </div>
        </div>
      )}
    </div>
  );

  const renderTaxesStep = () => (
    <div className="space-y-6 animate-in slide-in-from-right-8 duration-500">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-800">Región e Impuestos</h2>
        <p className="text-gray-500">Selecciona tu región para configurar automáticamente.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {TAX_PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => handleTaxSelect(preset)}
            className={`
              relative group p-6 rounded-2xl border-2 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-lg
              ${config.currencySymbol === preset.currency && config.taxRate === preset.rate 
                ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-200' 
                : 'border-gray-100 bg-white hover:border-blue-200'
              }
            `}
          >
            <div className="text-4xl mb-4 transform transition-transform group-hover:scale-110 origin-left">{preset.flag}</div>
            <h3 className="text-lg font-bold text-gray-800">{preset.label}</h3>
            <div className="flex items-center gap-2 mt-2 text-sm text-gray-600">
              <span className="bg-gray-200 px-2 py-0.5 rounded text-gray-700 font-mono font-bold">{preset.currency}</span>
              <span>{preset.taxName}: <strong>{(preset.rate * 100).toFixed(0)}%</strong></span>
            </div>
            
            {config.currencySymbol === preset.currency && config.taxRate === preset.rate && (
              <div className="absolute top-4 right-4 bg-blue-500 text-white p-1 rounded-full">
                <Check size={16} />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );

  const renderReadyStep = () => (
    <div className="flex flex-col items-center justify-center text-center space-y-8 animate-in zoom-in duration-500 py-10">
      <div className="relative">
        <div className="absolute inset-0 bg-green-500 blur-3xl opacity-20 rounded-full animate-pulse"></div>
        <div className="bg-white p-6 rounded-full shadow-xl relative z-10">
          <CheckCircle2 size={80} className="text-green-500" />
        </div>
      </div>
      
      <div className="space-y-2">
        <h2 className="text-3xl font-black text-gray-800">¡Todo Listo!</h2>
        <p className="text-gray-500 max-w-xs mx-auto">
          Hemos configurado tu punto de venta. Ya puedes empezar a vender.
        </p>
      </div>

      <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 w-full max-w-sm text-left space-y-3">
        <div className="flex justify-between border-b border-gray-200 pb-2">
          <span className="text-gray-500 text-sm">Negocio</span>
          <span className="font-bold text-gray-800">{config.companyInfo.name || 'Sin nombre'}</span>
        </div>
        <div className="flex justify-between border-b border-gray-200 pb-2">
          <span className="text-gray-500 text-sm">Moneda</span>
          <span className="font-bold text-gray-800">{config.currencySymbol}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500 text-sm">Vertical</span>
          <span className="font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded text-xs uppercase">{config.subVertical}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-4xl bg-white rounded-[2rem] shadow-2xl overflow-hidden flex flex-col h-[700px] max-h-[90vh]">
        
        {/* Header - Progress Stepper */}
        <div className="bg-gray-50/50 border-b border-gray-100 px-8 py-6">
          <div className="flex justify-between relative">
            {/* Connecting Line */}
            <div className="absolute top-1/2 left-0 w-full h-1 bg-gray-200 -z-0 rounded-full transform -translate-y-1/2"></div>
            <div 
              className="absolute top-1/2 left-0 h-1 bg-blue-600 -z-0 rounded-full transform -translate-y-1/2 transition-all duration-500"
              style={{ width: `${(STEPS.findIndex(s => s.id === currentStep) / (STEPS.length - 1)) * 100}%` }}
            ></div>

            {STEPS.map((step, idx) => {
              const isActive = step.id === currentStep;
              const isCompleted = STEPS.findIndex(s => s.id === currentStep) > idx;
              
              return (
                <div key={step.id} className="relative z-10 flex flex-col items-center gap-2">
                  <div 
                    className={`
                      w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 border-4
                      ${isActive 
                        ? 'bg-blue-600 text-white border-blue-100 shadow-lg scale-110' 
                        : isCompleted 
                          ? 'bg-green-500 text-white border-green-100' 
                          : 'bg-white text-gray-400 border-gray-200'
                      }
                    `}
                  >
                    {isCompleted ? <Check size={18} strokeWidth={3} /> : <step.icon size={18} />}
                  </div>
                  <span className={`text-xs font-bold transition-colors ${isActive ? 'text-blue-600' : 'text-gray-400'}`}>
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 p-8 overflow-y-auto relative">
          {currentStep === 'BUSINESS' && renderBusinessStep()}
          {currentStep === 'CATALOG' && renderCatalogStep()}
          {currentStep === 'TAXES' && renderTaxesStep()}
          {currentStep === 'READY' && renderReadyStep()}
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-gray-100 flex justify-between items-center bg-white">
          <button 
            onClick={handleBack}
            disabled={currentStep === 'BUSINESS' || currentStep === 'READY'}
            className={`
              flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-gray-500 transition-colors
              ${currentStep === 'BUSINESS' || currentStep === 'READY' ? 'opacity-0 pointer-events-none' : 'hover:bg-gray-100'}
            `}
          >
            <ArrowLeft size={20} /> Atrás
          </button>

          <button 
            onClick={handleNext}
            className={`
              flex items-center gap-2 px-8 py-3 rounded-xl font-bold text-white shadow-lg transition-all active:scale-95
              ${currentStep === 'READY' 
                ? 'bg-green-600 hover:bg-green-500 shadow-green-500/30 w-full md:w-auto justify-center' 
                : 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/30'
              }
            `}
          >
            {currentStep === 'READY' ? 'Empezar a Vender' : 'Continuar'} 
            {currentStep !== 'READY' && <ArrowRight size={20} />}
          </button>
        </div>

      </div>
    </div>
  );
};

export default SetupWizard;