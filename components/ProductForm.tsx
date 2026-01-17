
import React, { useState, useRef, useMemo } from 'react';
import { 
  X, Save, Barcode, DollarSign, Box, Plus, Trash2, 
  Info, Layers, RefreshCw, CheckCircle2, Tag, 
  Package, LayoutGrid, FileText, Settings2, Upload,
  Image as ImageIcon, Percent, ShoppingCart, Calculator, Download,
  ShieldAlert, AlertCircle, Check, LayoutTemplate, ClipboardList, ListTree,
  Truck, ArrowDownToLine, Building2, Search, Filter, AlertTriangle
} from 'lucide-react';
import { 
  Product, ProductAttribute, ProductVariant, BusinessConfig, Tariff, TariffPrice, TaxDefinition, Warehouse
} from '../types';

interface ProductFormProps {
  initialData?: Product | null;
  config: BusinessConfig;
  availableTariffs: Tariff[];
  warehouses?: Warehouse[];
  hasHistory?: boolean;
  onSave: (product: Product) => void;
  onClose: () => void;
}

type ProductTab = 'GENERAL' | 'PRICING' | 'VARIANTS' | 'TAXES' | 'STOCKS' | 'CLASSIFICATION' | 'LOGISTICS';

// Mock templates simulating data from VariantManager
const PREDEFINED_TEMPLATES = [
  { id: 'tpl_1', name: 'Tallas Ropa (Letras)', attrName: 'Talla', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  { id: 'tpl_2', name: 'Tallas Calzado (EU)', attrName: 'Talla', options: ['36', '37', '38', '39', '40', '41', '42', '43', '44'] },
  { id: 'tpl_3', name: 'Colores Básicos', attrName: 'Color', options: ['Blanco', 'Negro', 'Azul Marino', 'Rojo', 'Gris'] },
  { id: 'tpl_4', name: 'Colores Pastel', attrName: 'Color', options: ['Rosa Palo', 'Celeste', 'Menta', 'Crema', 'Lila'] },
  { id: 'tpl_5', name: 'Materiales', attrName: 'Material', options: ['Algodón', 'Poliéster', 'Lana', 'Seda', 'Lino'] },
];

// --- INITIAL MOCK MASTER DATA ---
const INITIAL_DEPARTMENTS = [
  { id: 'DEP_01', name: 'Alimentos' },
  { id: 'DEP_02', name: 'Hogar' },
  { id: 'DEP_03', name: 'Electrónica' },
  { id: 'DEP_04', name: 'Cuidado Personal' },
];

const INITIAL_SECTIONS = [
  { id: 'SEC_01', depId: 'DEP_01', name: 'Frescos' },
  { id: 'SEC_02', depId: 'DEP_01', name: 'Abarrotes' },
  { id: 'SEC_03', depId: 'DEP_01', name: 'Congelados' },
  { id: 'SEC_04', depId: 'DEP_02', name: 'Cocina' },
  { id: 'SEC_05', depId: 'DEP_02', name: 'Decoración' },
  { id: 'SEC_06', depId: 'DEP_03', name: 'Audio' },
  { id: 'SEC_07', depId: 'DEP_03', name: 'Computación' },
];

const INITIAL_FAMILIES = [
  { id: 'FAM_01', name: 'Lácteos' },
  { id: 'FAM_02', name: 'Bebidas' },
  { id: 'FAM_03', name: 'Limpieza' },
  { id: 'FAM_04', name: 'Snacks' },
];

const INITIAL_SUBFAMILIES = [
  { id: 'SUB_01', famId: 'FAM_01', name: 'Leches' },
  { id: 'SUB_02', famId: 'FAM_01', name: 'Quesos' },
  { id: 'SUB_03', famId: 'FAM_01', name: 'Yogurts' },
  { id: 'SUB_04', famId: 'FAM_02', name: 'Gaseosas' },
  { id: 'SUB_05', famId: 'FAM_02', name: 'Jugos' },
  { id: 'SUB_06', famId: 'FAM_02', name: 'Aguas' },
];

const INITIAL_BRANDS = [
  { id: 'BR_01', name: 'Nestlé' },
  { id: 'BR_02', name: 'Coca-Cola' },
  { id: 'BR_03', name: 'Samsung' },
  { id: 'BR_04', name: 'Sony' },
  { id: 'BR_05', name: 'Marca Blanca' },
  { id: 'BR_06', name: 'Procter & Gamble' },
];

const ProductForm: React.FC<ProductFormProps> = ({ initialData, config, availableTariffs, warehouses = [], hasHistory = false, onSave, onClose }) => {
  const [activeTab, setActiveTab] = useState<ProductTab>('GENERAL');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // --- LOCAL STATE FOR MASTER DATA (To allow "Quick Add") ---
  const [departments, setDepartments] = useState(INITIAL_DEPARTMENTS);
  const [sections, setSections] = useState(INITIAL_SECTIONS);
  const [families, setFamilies] = useState(INITIAL_FAMILIES);
  const [subfamilies, setSubfamilies] = useState(INITIAL_SUBFAMILIES);
  const [brands, setBrands] = useState(INITIAL_BRANDS);

  // --- QUICK ADD MODAL STATE ---
  const [quickAddState, setQuickAddState] = useState<{
    type: 'DEP' | 'SEC' | 'FAM' | 'SUB' | 'BRAND';
    label: string;
  } | null>(null);
  const [quickAddValue, setQuickAddValue] = useState('');

  // --- LOGISTICS TAB STATE ---
  const [logisticsSearch, setLogisticsSearch] = useState('');
  const [logisticsFilterStock, setLogisticsFilterStock] = useState(false);
  // Initialized from initialData to allow persistence
  const [warehouseSettings, setWarehouseSettings] = useState<Record<string, {min: number, max: number}>>(initialData?.warehouseSettings || {});

  const [formData, setFormData] = useState<Product>(initialData || {
    id: `PRD_${Date.now()}`,
    name: '',
    type: 'PRODUCT',
    category: 'General',
    images: [],
    attributes: [],
    variants: [],
    tariffs: [],
    stockBalances: {},
    activeInWarehouses: warehouses.map(w => w.id), // Default active in all
    price: 0,
    barcode: '',
    trackStock: true,
    purchaseTax: 0,
    salesTax: 0,
    appliedTaxIds: config.taxes?.[0] ? [config.taxes[0].id] : [],
    cost: 0,
    description: '',
    departmentId: '',
    sectionId: '',
    familyId: '',
    subfamilyId: '',
    brandId: ''
  });

  const [optionInputs, setOptionInputs] = useState<Record<string, string>>({});
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  
  // --- LOGIC: CLASSIFICATION HANDLERS ---
  const handleDepartmentChange = (newDepId: string) => {
    setFormData(prev => ({
      ...prev,
      departmentId: newDepId,
      sectionId: '' // Cascading Reset
    }));
  };

  const handleFamilyChange = (newFamId: string) => {
    setFormData(prev => ({
      ...prev,
      familyId: newFamId,
      subfamilyId: '' // Cascading Reset
    }));
  };

  // --- LOGIC: QUICK ADD ---
  const openQuickAdd = (type: 'DEP' | 'SEC' | 'FAM' | 'SUB' | 'BRAND') => {
    // Validation for dependents
    if (type === 'SEC' && !formData.departmentId) return alert("Selecciona un Departamento primero.");
    if (type === 'SUB' && !formData.familyId) return alert("Selecciona una Familia primero.");

    const label = type === 'DEP' ? 'Departamento' : type === 'SEC' ? 'Sección' : type === 'FAM' ? 'Familia' : type === 'SUB' ? 'Subfamilia' : 'Marca';
    
    setQuickAddValue('');
    setQuickAddState({ type, label });
  };

  const confirmQuickAdd = () => {
    if (!quickAddValue.trim() || !quickAddState) return;
    
    const { type } = quickAddState;
    const name = quickAddValue.trim();
    const id = `${type}_${Date.now()}`;

    switch(type) {
        case 'DEP':
            setDepartments(prev => [...prev, { id, name }]);
            handleDepartmentChange(id); // Automatically select new dept
            break;
        case 'SEC':
            setSections(prev => [...prev, { id, name, depId: formData.departmentId! }]);
            setFormData(prev => ({ ...prev, sectionId: id }));
            break;
        case 'FAM':
            setFamilies(prev => [...prev, { id, name }]);
            handleFamilyChange(id); // Automatically select new family
            break;
        case 'SUB':
            setSubfamilies(prev => [...prev, { id, name, famId: formData.familyId! }]);
            setFormData(prev => ({ ...prev, subfamilyId: id }));
            break;
        case 'BRAND':
            setBrands(prev => [...prev, { id, name }]);
            setFormData(prev => ({ ...prev, brandId: id }));
            break;
    }
    
    setQuickAddState(null);
  };

  const availableSections = useMemo(() => 
    sections.filter(s => s.depId === formData.departmentId), 
  [formData.departmentId, sections]);

  const availableSubfamilies = useMemo(() => 
    subfamilies.filter(s => s.famId === formData.familyId), 
  [formData.familyId, subfamilies]);

  // --- LOGIC: LOGISTICS ---
  const toggleWarehouseActive = (whId: string) => {
    setFormData(prev => {
        const currentActive = prev.activeInWarehouses || [];
        const isActive = currentActive.includes(whId);
        return {
            ...prev,
            activeInWarehouses: isActive 
                ? currentActive.filter(id => id !== whId)
                : [...currentActive, whId]
        };
    });
  };

  const updateWarehouseSettings = (whId: string, field: 'min' | 'max', value: number) => {
      setWarehouseSettings(prev => ({
          ...prev,
          [whId]: {
              ...(prev[whId] || { min: 0, max: 0 }),
              [field]: value
          }
      }));
  };

  // --- LOGIC: TAXES ---
  const toggleTax = (taxId: string) => {
    setFormData(prev => {
      const current = prev.appliedTaxIds || [];
      const isSelected = current.includes(taxId);
      return {
        ...prev,
        appliedTaxIds: isSelected ? current.filter(id => id !== taxId) : [...current, taxId]
      };
    });
  };

  const combinedTaxRate = useMemo(() => {
    const activeTaxes = config.taxes.filter(t => formData.appliedTaxIds?.includes(t.id));
    return activeTaxes.reduce((sum, t) => sum + t.rate, 0);
  }, [formData.appliedTaxIds, config.taxes]);

  // --- LOGIC: IMAGES ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ 
          ...prev, 
          image: reader.result as string,
          images: prev.images.includes(reader.result as string) ? prev.images : [reader.result as string, ...prev.images]
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  // --- LOGIC: ATTRIBUTES & VARIANTS ---
  const addAttribute = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    setFormData(prev => ({
      ...prev,
      attributes: [...(prev.attributes || []), { id: newId, name: '', options: [], optionCodes: [] }]
    }));
  };

  const applyTemplate = (template: typeof PREDEFINED_TEMPLATES[0]) => {
    const newId = Math.random().toString(36).substr(2, 9);
    const newAttr: ProductAttribute = {
      id: newId,
      name: template.attrName,
      options: [...template.options],
      optionCodes: template.options.map(o => o.substring(0, 3).toUpperCase())
    };
    
    setFormData(prev => ({
      ...prev,
      attributes: [...(prev.attributes || []), newAttr]
    }));
    setIsTemplateModalOpen(false);
  };

  const addOption = (attrId: string) => {
    const value = optionInputs[attrId]?.trim();
    if (!value) return;

    setFormData(prev => ({
      ...prev,
      attributes: prev.attributes.map(a => {
        if (a.id === attrId && !a.options.includes(value)) {
          const code = value.substring(0, 3).toUpperCase();
          const currentCodes = a.optionCodes || [];
          return { 
            ...a, 
            options: [...a.options, value],
            optionCodes: [...currentCodes, code]
          };
        }
        return a;
      })
    }));
    setOptionInputs(prev => ({ ...prev, [attrId]: '' }));
  };

  const removeAttribute = (id: string) => {
    setFormData(prev => ({
      ...prev,
      attributes: prev.attributes.filter(a => a.id !== id)
    }));
  };

  const generateVariants = () => {
    const attrs = formData.attributes.filter(a => a.name && a.options.length > 0);
    if (attrs.length === 0) return;

    const cartesian = (arrays: any[][]): any[][] => {
      return arrays.reduce((a, b) => a.flatMap(d => b.map(e => [d, e].flat())), [[]] as any[][]);
    };

    const indices = attrs.map(a => a.options.map((_, i) => i));
    const combinations = cartesian(indices);
    
    const newVariants: ProductVariant[] = combinations.map((comboIndices) => {
      const attrValues: Record<string, string> = {};
      const skuParts: string[] = [formData.barcode || 'PRD'];

      attrs.forEach((attr, i) => {
        const optIndex = comboIndices[i];
        attrValues[attr.name] = attr.options[optIndex];
        const code = attr.optionCodes?.[optIndex] || attr.options[optIndex].substring(0, 3).toUpperCase();
        skuParts.push(code);
      });

      const sku = skuParts.join('-');
      return {
        sku: sku,
        barcode: [sku],
        attributeValues: attrValues,
        price: formData.price,
        initialStock: 0
      };
    });
    setFormData(prev => ({ ...prev, variants: newVariants }));
  };

  // --- LOGIC: TARIFFS ---
  const handleToggleTariff = (tariff: Tariff) => {
    const isPresent = formData.tariffs.some(t => t.tariffId === tariff.id);
    if (isPresent) {
      setFormData(prev => ({
        ...prev,
        tariffs: prev.tariffs.filter(t => t.tariffId !== tariff.id)
      }));
    } else {
      const baseCost = formData.cost || 0;
      const marginPct = 30;
      const newTariffPrice: TariffPrice = {
        tariffId: tariff.id,
        name: tariff.name,
        costBase: baseCost,
        margin: marginPct,
        tax: combinedTaxRate * 100,
        price: baseCost * (1 + marginPct / 100) * (1 + combinedTaxRate)
      };
      setFormData(prev => ({
        ...prev,
        tariffs: [...prev.tariffs, newTariffPrice]
      }));
    }
  };

  const updateTariffDetail = (tariffId: string, field: keyof TariffPrice, value: number) => {
    setFormData(prev => {
      const newTariffs = prev.tariffs.map(t => {
        if (t.tariffId === tariffId) {
          const updated = { ...t, [field]: value };
          if (field !== 'price') {
             updated.price = (updated.costBase || 0) * (1 + (updated.margin || 0) / 100) * (1 + (updated.tax || 0) / 100);
          } else {
             if (updated.costBase && updated.costBase > 0) {
                const netPrice = value / (1 + (updated.tax || 0) / 100);
                updated.margin = ((netPrice - updated.costBase) / updated.costBase) * 100;
             }
          }
          return updated;
        }
        return t;
      });
      return { ...prev, tariffs: newTariffs };
    });
  };

  // --- SAVE ---
  const handleFinalSave = () => {
    if (formData.tariffs.length === 0) {
      alert("Error de integridad: El artículo debe tener al menos una TARIFA activa para poder venderse.");
      return;
    }
    // Merge the logistics settings into the product object so they are persisted
    const finalProduct = {
      ...formData,
      warehouseSettings: warehouseSettings
    };
    onSave(finalProduct);
  };

  // --- PREPARE LOGISTICS DATA ---
  const filteredWarehouses = useMemo(() => {
    const all = warehouses || [];
    return all.filter(wh => {
      if (logisticsSearch && !wh.name.toLowerCase().includes(logisticsSearch.toLowerCase())) return false;
      if (logisticsFilterStock && (formData.stockBalances?.[wh.id] || 0) <= 0) return false;
      return true;
    });
  }, [warehouses, logisticsSearch, logisticsFilterStock, formData.stockBalances]);

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-5xl h-[90vh] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 relative">
        
        {/* HEADER */}
        <div className="p-6 border-b flex justify-between items-center bg-gray-50/50 shrink-0">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-600 text-white rounded-2xl shadow-lg">
              <Package size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-gray-800">{initialData ? 'Editar Artículo' : 'Nuevo Artículo'}</h2>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Mantenimiento de Catálogo</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* TABS NAVIGATION */}
        <div className="flex px-6 border-b bg-white shrink-0 overflow-x-auto no-scrollbar gap-2">
          {[
            { id: 'GENERAL', label: 'Datos Generales', icon: Info },
            { id: 'CLASSIFICATION', label: 'Clasificación', icon: ListTree },
            { id: 'TAXES', label: 'Impuestos', icon: Percent },
            { id: 'PRICING', label: 'Tarifas', icon: DollarSign },
            { id: 'VARIANTS', label: 'Variantes', icon: Layers },
            { id: 'LOGISTICS', label: 'Stock y Logística', icon: Building2 },
            { id: 'STOCKS', label: 'Inv. Inicial', icon: ClipboardList },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as ProductTab)}
              className={`flex items-center gap-2 py-5 px-6 font-bold text-sm transition-all border-b-4 whitespace-nowrap shrink-0 ${
                activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <tab.icon size={18} /> {tab.label}
            </button>
          ))}
        </div>

        {/* CONTENT AREA */}
        <div className="flex-1 overflow-y-auto p-8 bg-gray-50/30 no-scrollbar relative">
          
          {/* TAB: DATOS GENERALES */}
          {activeTab === 'GENERAL' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-1 space-y-4">
                  <label className="block text-[10px] font-black text-gray-500 uppercase ml-1">Imagen del Producto</label>
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-square bg-white rounded-[2rem] border-4 border-dashed border-gray-200 flex flex-col items-center justify-center relative overflow-hidden group cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-all"
                  >
                    {formData.image ? (
                      <>
                        <img src={formData.image} alt="Preview" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                           <ImageIcon className="text-white mb-2" size={32} />
                           <span className="text-xs font-bold text-white uppercase tracking-wider">Cambiar Imagen</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <ImageIcon size={48} className="text-gray-300 mb-2 group-hover:text-blue-400 transition-colors" />
                        <span className="text-xs font-bold text-gray-400 group-hover:text-blue-600">Subir Imagen</span>
                      </>
                    )}
                    <input 
                        ref={fileInputRef}
                        type="file" 
                        className="hidden" 
                        accept="image/*" 
                        onChange={handleImageUpload} 
                    />
                  </div>
                </div>

                <div className="md:col-span-2 space-y-6">
                  <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 space-y-6">
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 ml-1">Nombre del Producto</label>
                      <input 
                        type="text" 
                        value={formData.name} 
                        onChange={e => setFormData({ ...formData, name: e.target.value })} 
                        className="w-full p-4 bg-gray-50 border-2 border-transparent rounded-2xl text-xl font-bold text-gray-800 outline-none focus:bg-white focus:border-blue-100 transition-all" 
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 ml-1">Tipo de Artículo</label>
                        <select 
                          value={formData.type} 
                          onChange={e => setFormData({ ...formData, type: e.target.value as any })} 
                          className="w-full p-4 bg-gray-50 border-none rounded-2xl font-bold text-gray-700 shadow-inner outline-none"
                        >
                          <option value="PRODUCT">Producto</option>
                          <option value="SERVICE">Servicio</option>
                          <option value="KIT">Combo / Kit</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2 ml-1">Categoría (Simple)</label>
                        <input 
                          type="text" 
                          value={formData.category} 
                          onChange={e => setFormData({ ...formData, category: e.target.value })} 
                          className="w-full p-4 bg-gray-50 border-none rounded-2xl font-bold text-gray-700 shadow-inner" 
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                            <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 ml-1">Costo de Referencia ($)</label>
                            <input 
                                type="number" 
                                value={formData.cost || 0} 
                                onChange={e => setFormData({ ...formData, cost: parseFloat(e.target.value) })} 
                                className="w-full p-4 bg-white border-2 border-gray-100 rounded-2xl font-bold text-gray-700 outline-none focus:border-blue-200" 
                            />
                            <p className="text-[10px] text-gray-400 mt-1 ml-1">
                                El precio de venta se define exclusivamente en la pestaña <strong>Tarifas</strong>.
                            </p>
                        </div>
                    </div>
                    
                    <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 ml-1">Código de Barras / SKU</label>
                        <div className="relative">
                            <input 
                                type="text" 
                                value={formData.barcode || ''} 
                                onChange={e => setFormData({ ...formData, barcode: e.target.value })} 
                                className="w-full p-4 pl-12 bg-white border-2 border-gray-100 rounded-2xl font-mono text-gray-700 outline-none focus:border-blue-200" 
                            />
                            <Barcode className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: CLASSIFICATION (UPDATED WITH QUICK ADD MODAL) */}
          {activeTab === 'CLASSIFICATION' && (
             <div className="max-w-4xl mx-auto space-y-6 animate-in slide-in-from-right-4">
                <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm">
                   
                   <div className="mb-8">
                      <h3 className="text-xl font-bold text-gray-800">Jerarquía Comercial</h3>
                      <p className="text-sm text-gray-400">Asigna la estructura organizativa y agrupaciones del producto.</p>
                   </div>

                   <div className="space-y-8">
                      
                      {/* GROUP 1: ORGANIZATION */}
                      <div>
                         <h4 className="text-xs font-black text-blue-600 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Box size={14} /> Estructura Organizativa
                         </h4>
                         <div className="grid grid-cols-2 gap-4">
                            {/* Department */}
                            <div>
                               <div className="flex justify-between items-center mb-1 ml-1">
                                  <label className="block text-[10px] font-bold text-gray-700 uppercase">Departamento</label>
                                  <button 
                                    type="button"
                                    onClick={() => openQuickAdd('DEP')} 
                                    className="text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded cursor-pointer"
                                  >
                                     <Plus size={10} /> Crear Nuevo
                                  </button>
                               </div>
                               <select
                                  value={formData.departmentId || ''}
                                  onChange={(e) => handleDepartmentChange(e.target.value)}
                                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium text-gray-700"
                               >
                                  <option value="">-- Seleccionar --</option>
                                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                               </select>
                            </div>

                            {/* Section */}
                            <div>
                               <div className="flex justify-between items-center mb-1 ml-1">
                                  <label className="block text-[10px] font-bold text-gray-700 uppercase">Sección</label>
                                  {formData.departmentId && (
                                     <button 
                                        type="button"
                                        onClick={() => openQuickAdd('SEC')} 
                                        className="text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded cursor-pointer"
                                     >
                                        <Plus size={10} /> Crear Nuevo
                                     </button>
                                  )}
                               </div>
                               <select
                                  value={formData.sectionId || ''}
                                  onChange={(e) => setFormData({...formData, sectionId: e.target.value})}
                                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                  disabled={!formData.departmentId}
                               >
                                  <option value="">{formData.departmentId ? '-- Seleccionar --' : '-- Primero seleccione Dpto --'}</option>
                                  {availableSections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                               </select>
                            </div>
                         </div>
                      </div>

                      <div className="h-px bg-gray-100 w-full" />

                      {/* GROUP 2: PRODUCT GROUPING */}
                      <div>
                         <h4 className="text-xs font-black text-blue-600 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Layers size={14} /> Agrupación de Producto
                         </h4>
                         <div className="grid grid-cols-2 gap-4">
                            {/* Family */}
                            <div>
                               <div className="flex justify-between items-center mb-1 ml-1">
                                  <label className="block text-[10px] font-bold text-gray-700 uppercase">Familia</label>
                                  <button 
                                    type="button"
                                    onClick={() => openQuickAdd('FAM')} 
                                    className="text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded cursor-pointer"
                                  >
                                     <Plus size={10} /> Crear Nueva
                                  </button>
                               </div>
                               <select
                                  value={formData.familyId || ''}
                                  onChange={(e) => handleFamilyChange(e.target.value)}
                                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium text-gray-700"
                               >
                                  <option value="">-- Seleccionar --</option>
                                  {families.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                               </select>
                            </div>

                            {/* Subfamily */}
                            <div>
                               <div className="flex justify-between items-center mb-1 ml-1">
                                  <label className="block text-[10px] font-bold text-gray-700 uppercase">Subfamilia</label>
                                  {formData.familyId && (
                                     <button 
                                        type="button"
                                        onClick={() => openQuickAdd('SUB')} 
                                        className="text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded cursor-pointer"
                                     >
                                        <Plus size={10} /> Crear Nueva
                                     </button>
                                  )}
                               </div>
                               <select
                                  value={formData.subfamilyId || ''}
                                  onChange={(e) => setFormData({...formData, subfamilyId: e.target.value})}
                                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                  disabled={!formData.familyId}
                               >
                                  <option value="">{formData.familyId ? '-- Seleccionar --' : '-- Primero seleccione Familia --'}</option>
                                  {availableSubfamilies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                               </select>
                            </div>
                         </div>
                      </div>

                      <div className="h-px bg-gray-100 w-full" />

                      {/* GROUP 3: COMMERCIAL IDENTITY */}
                      <div>
                         <h4 className="text-xs font-black text-blue-600 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Tag size={14} /> Identidad Comercial
                         </h4>
                         <div className="grid grid-cols-2 gap-4">
                            {/* Brand */}
                            <div>
                               <div className="flex justify-between items-center mb-1 ml-1">
                                  <label className="block text-[10px] font-bold text-gray-700 uppercase">Marca</label>
                                  <button 
                                    type="button"
                                    onClick={() => openQuickAdd('BRAND')} 
                                    className="text-[10px] font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded cursor-pointer"
                                  >
                                     <Plus size={10} /> Crear Nueva
                                  </button>
                               </div>
                               <select
                                  value={formData.brandId || ''}
                                  onChange={(e) => setFormData({...formData, brandId: e.target.value})}
                                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium text-gray-700"
                               >
                                  <option value="">-- Seleccionar --</option>
                                  {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                               </select>
                            </div>
                         </div>
                      </div>

                   </div>
                </div>
             </div>
          )}

          {/* TAB: TAXES */}
          {activeTab === 'TAXES' && (
             <div className="max-w-4xl mx-auto space-y-6 animate-in slide-in-from-right-4">
                <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm">
                   <div className="flex justify-between items-center mb-6">
                      <div>
                         <h3 className="text-xl font-bold text-gray-800">Impuestos Aplicables</h3>
                         <p className="text-sm text-gray-400">Selecciona uno o varios impuestos para este producto.</p>
                      </div>
                      <div className="bg-blue-50 px-4 py-2 rounded-xl text-blue-600 font-black text-lg">
                         Tasa Total: {(combinedTaxRate * 100).toFixed(2)}%
                      </div>
                   </div>
                   
                   <div className="space-y-3">
                      {config.taxes.map(tax => {
                         const isSelected = formData.appliedTaxIds?.includes(tax.id);
                         return (
                            <div 
                               key={tax.id}
                               onClick={() => toggleTax(tax.id)}
                               className={`flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all ${
                                  isSelected ? 'bg-blue-50 border-blue-500' : 'bg-gray-50 border-gray-100 hover:bg-gray-100'
                               }`}
                            >
                               <div className="flex items-center gap-3">
                                  <div className={`w-6 h-6 rounded border-2 flex items-center justify-center ${isSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'}`}>
                                     {isSelected && <Check size={14} className="text-white" />}
                                  </div>
                                  <div>
                                     <p className="font-bold text-gray-800">{tax.name}</p>
                                     <p className="text-xs text-gray-500 font-mono">{tax.type}</p>
                                  </div>
                               </div>
                               <span className="font-black text-lg text-gray-700">{(tax.rate * 100).toFixed(2)}%</span>
                            </div>
                         )
                      })}
                   </div>
                </div>
             </div>
          )}

          {/* TAB: PRICING (Tariff Management) */}
          {activeTab === 'PRICING' && (
             <div className="max-w-4xl mx-auto space-y-6 animate-in slide-in-from-right-4">
                <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm">
                   <div className="mb-6">
                      <h3 className="text-xl font-bold text-gray-800">Precios y Tarifas</h3>
                      <p className="text-sm text-gray-400">Administra el precio en cada lista disponible.</p>
                   </div>

                   <div className="space-y-4">
                      {availableTariffs.map(tariff => {
                         const tariffPrice = formData.tariffs.find(t => t.tariffId === tariff.id);
                         const isEnabled = !!tariffPrice;

                         return (
                            <div key={tariff.id} className={`p-6 rounded-2xl border-2 transition-all ${isEnabled ? 'bg-white border-purple-200 shadow-sm' : 'bg-gray-50 border-gray-200 opacity-70'}`}>
                               <div className="flex justify-between items-start mb-4">
                                  <div className="flex items-center gap-3">
                                     <button 
                                        onClick={() => handleToggleTariff(tariff)}
                                        className={`w-12 h-6 rounded-full relative transition-colors ${isEnabled ? 'bg-purple-600' : 'bg-gray-300'}`}
                                     >
                                        <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${isEnabled ? 'left-7' : 'left-1'}`} />
                                     </button>
                                     <div>
                                        <h4 className="font-bold text-gray-800">{tariff.name}</h4>
                                        <p className="text-xs text-gray-500">{tariff.currency} • {tariff.strategy.type}</p>
                                     </div>
                                  </div>
                                  {isEnabled && (
                                     <div className="text-right">
                                        <p className="text-[10px] text-gray-400 font-bold uppercase mb-1">Precio Final</p>
                                        <p className="text-2xl font-black text-purple-700">{config.currencySymbol}{tariffPrice.price.toFixed(2)}</p>
                                     </div>
                                  )}
                               </div>

                               {isEnabled && (
                                  <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-100">
                                     <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Precio Neto (Sin Imp.)</label>
                                        <div className="relative">
                                           <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-bold">$</span>
                                           <input 
                                              type="number" 
                                              value={(tariffPrice.price / (1 + (tariffPrice.tax || 0) / 100)).toFixed(2)}
                                              onChange={(e) => {
                                                 const net = parseFloat(e.target.value);
                                                 if (!isNaN(net)) {
                                                    const final = net * (1 + (tariffPrice.tax || 0) / 100);
                                                    updateTariffDetail(tariff.id, 'price', final);
                                                 }
                                              }}
                                              className="w-full p-2 pl-6 bg-gray-50 border border-gray-100 rounded-lg text-sm font-bold outline-none"
                                           />
                                        </div>
                                     </div>
                                     <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Margen %</label>
                                        <div className="relative">
                                           <input 
                                              type="number" 
                                              value={tariffPrice.margin?.toFixed(2) || 0}
                                              onChange={(e) => updateTariffDetail(tariff.id, 'margin', parseFloat(e.target.value))}
                                              className="w-full p-2 pr-6 bg-gray-50 border border-gray-100 rounded-lg text-sm font-bold outline-none"
                                           />
                                           <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-bold">%</span>
                                        </div>
                                     </div>
                                  </div>
                               )}
                            </div>
                         );
                      })}
                   </div>
                </div>
             </div>
          )}

          {/* TAB: VARIANTS (ATTRIBUTES) */}
          {activeTab === 'VARIANTS' && (
             <div className="max-w-4xl mx-auto space-y-6 animate-in slide-in-from-right-4">
                
                <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm">
                   <div className="flex justify-between items-center mb-6">
                      <h3 className="text-xl font-bold text-gray-800">Atributos del Producto</h3>
                      <div className="flex gap-2">
                         <button onClick={() => setIsTemplateModalOpen(true)} className="px-4 py-2 bg-pink-50 text-pink-600 rounded-xl text-sm font-bold hover:bg-pink-100 transition-colors">
                            Usar Plantilla
                         </button>
                         <button onClick={addAttribute} className="px-4 py-2 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800 transition-colors flex items-center gap-2">
                            <Plus size={16} /> Nuevo Atributo
                         </button>
                      </div>
                   </div>

                   <div className="space-y-6">
                      {formData.attributes?.map((attr, idx) => (
                         <div key={attr.id} className="p-6 rounded-2xl border-2 border-gray-100 bg-gray-50">
                            <div className="flex justify-between items-start mb-4">
                               <div className="flex-1 mr-4">
                                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nombre (Ej. Talla)</label>
                                  <input 
                                     type="text" 
                                     value={attr.name}
                                     onChange={(e) => setFormData(prev => ({
                                        ...prev,
                                        attributes: prev.attributes.map(a => a.id === attr.id ? { ...a, name: e.target.value } : a)
                                     }))}
                                     className="w-full p-2 bg-white border border-gray-200 rounded-lg font-bold text-gray-800 outline-none focus:border-pink-300"
                                  />
                               </div>
                               <button onClick={() => removeAttribute(attr.id)} className="p-2 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors">
                                  <Trash2 size={18} />
                               </button>
                            </div>

                            <div className="mb-4">
                               <label className="block text-[10px] font-bold text-gray-400 uppercase mb-2">Opciones</label>
                               <div className="flex flex-wrap gap-2 mb-3">
                                  {attr.options.map((opt, i) => (
                                     <div key={i} className="flex items-center gap-1 bg-white border border-gray-200 px-3 py-1 rounded-lg shadow-sm">
                                        <span className="text-sm font-medium text-gray-700">{opt}</span>
                                        <span className="text-[10px] text-gray-400 font-mono border-l pl-2 ml-1">{attr.optionCodes?.[i] || opt.substring(0,3)}</span>
                                        <button 
                                           onClick={() => {
                                              const newOpts = attr.options.filter((_, idx) => idx !== i);
                                              const newCodes = attr.optionCodes?.filter((_, idx) => idx !== i);
                                              setFormData(prev => ({
                                                 ...prev,
                                                 attributes: prev.attributes.map(a => a.id === attr.id ? { ...a, options: newOpts, optionCodes: newCodes } : a)
                                              }));
                                           }}
                                           className="ml-1 text-gray-300 hover:text-red-500"
                                        >
                                           <X size={12} />
                                        </button>
                                     </div>
                                  ))}
                               </div>
                               <div className="flex gap-2">
                                  <input 
                                     type="text" 
                                     placeholder="Nueva opción..." 
                                     value={optionInputs[attr.id] || ''}
                                     onChange={(e) => setOptionInputs(prev => ({ ...prev, [attr.id]: e.target.value }))}
                                     onKeyDown={(e) => { if(e.key === 'Enter') addOption(attr.id); }}
                                     className="flex-1 p-2 bg-white border border-gray-200 rounded-lg text-sm outline-none"
                                  />
                                  <button onClick={() => addOption(attr.id)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700">
                                     Agregar
                                  </button>
                               </div>
                            </div>
                         </div>
                      ))}
                      
                      {(!formData.attributes || formData.attributes.length === 0) && (
                         <div className="text-center py-10 text-gray-400 italic">No hay atributos definidos.</div>
                      )}
                   </div>

                   {formData.attributes.length > 0 && (
                      <div className="mt-8 pt-6 border-t border-gray-200">
                         <button 
                            onClick={generateVariants}
                            className="w-full py-4 bg-pink-600 text-white rounded-2xl font-bold shadow-lg hover:bg-pink-700 transition-all flex items-center justify-center gap-2"
                         >
                            <Layers size={20} /> Generar Combinaciones (Variantes)
                         </button>
                      </div>
                   )}
                </div>

                {/* Variants Preview */}
                {formData.variants && formData.variants.length > 0 && (
                   <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm">
                      <h3 className="text-xl font-bold text-gray-800 mb-6">Variantes Generadas ({formData.variants.length})</h3>
                      <div className="space-y-2">
                         {formData.variants.map((v, idx) => (
                            <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                               <div className="flex items-center gap-3">
                                  <span className="font-mono text-xs font-bold bg-white px-2 py-1 rounded border border-gray-200">{v.sku}</span>
                                  <div className="flex gap-2">
                                     {Object.entries(v.attributeValues).map(([key, val]) => (
                                        <span key={key} className="text-xs text-gray-600"><span className="text-gray-400">{key}:</span> {val}</span>
                                     ))}
                                  </div>
                               </div>
                               <input 
                                  type="number" 
                                  value={v.price} 
                                  onChange={(e) => {
                                     const newVars = [...formData.variants];
                                     newVars[idx].price = parseFloat(e.target.value);
                                     setFormData(prev => ({ ...prev, variants: newVars }));
                                  }}
                                  className="w-24 p-1 bg-white border rounded text-right text-sm"
                                  placeholder="Precio Override"
                               />
                            </div>
                         ))}
                      </div>
                   </div>
                )}
             </div>
          )}

          {/* TAB: STOCK MATRIX (NEW LOGISTICS TAB) */}
          {activeTab === 'LOGISTICS' && (
             <div className="flex flex-col gap-6 animate-in slide-in-from-right-4 h-full"> 
                
                {/* Header & Filters */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-2xl border border-gray-200 shadow-sm shrink-0 sticky top-0 z-20"> 
                   <div className="flex flex-col sm:flex-row items-center gap-4 flex-1 w-full">
                      <div className="relative w-full sm:max-w-md">
                         <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                         <input 
                            type="text" 
                            placeholder="Buscar almacén..." 
                            value={logisticsSearch}
                            onChange={(e) => setLogisticsSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-100 text-sm font-medium"
                         />
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer select-none whitespace-nowrap">
                         <input 
                            type="checkbox" 
                            checked={logisticsFilterStock}
                            onChange={(e) => setLogisticsFilterStock(e.target.checked)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" 
                         />
                         <span className="text-sm font-bold text-gray-600">Con stock físico</span>
                      </label>
                   </div>
                   <div className="text-right w-full sm:w-auto">
                      <p className="text-[10px] text-gray-400 font-bold uppercase">Total Global</p>
                      <p className="text-xl font-black text-gray-800">
                         {Object.values(formData.stockBalances || {}).reduce((a: number, b: number) => a + b, 0)} u.
                      </p>
                   </div>
                </div>

                {/* Table Container */}
                {/* Added overflow-x-auto for mobile responsiveness */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex-1 flex flex-col">
                   <div className="overflow-x-auto"> 
                      <table className="w-full text-left min-w-[800px] md:min-w-0"> {/* Min width to force scroll on small screens */}
                         <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                               <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider w-24">Activo</th>
                               <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider">Almacén</th>
                               <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">Existencia</th>
                               <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center hidden lg:table-cell">Logística</th>
                               <th className="px-6 py-4 text-xs font-bold text-gray-500 uppercase tracking-wider text-center">Reaprovisionamiento</th>
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-gray-100">
                            {(warehouses || []).filter(wh => {
                               if (logisticsSearch && !wh.name.toLowerCase().includes(logisticsSearch.toLowerCase())) return false;
                               if (logisticsFilterStock && (formData.stockBalances?.[wh.id] || 0) <= 0) return false;
                               return true;
                            }).map(wh => {
                               const isActive = formData.activeInWarehouses?.includes(wh.id);
                               const physical = formData.stockBalances?.[wh.id] || 0;
                               const reserved = 0; // Mock
                               const available = physical - reserved;
                               const min = warehouseSettings[wh.id]?.min || 0;
                               const max = warehouseSettings[wh.id]?.max || 0;
                               const isLowStock = physical < min;

                               return (
                                  <tr key={wh.id} className={`transition-all hover:bg-gray-50 ${!isActive ? 'bg-gray-50/50' : ''}`}>
                                     {/* A. Activación */}
                                     <td className="px-6 py-4">
                                        <div 
                                           onClick={() => toggleWarehouseActive(wh.id)}
                                           className={`w-12 h-6 rounded-full relative transition-colors cursor-pointer ${isActive ? 'bg-green-500' : 'bg-gray-300'}`}
                                        >
                                           <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${isActive ? 'left-7' : 'left-1'}`} />
                                        </div>
                                     </td>

                                     {/* B. Almacén */}
                                     <td className={`px-6 py-4 ${!isActive ? 'opacity-50' : ''}`}>
                                        <div className="flex flex-col">
                                           <span className="font-bold text-gray-800 text-sm">{wh.name}</span>
                                           <span className="text-[10px] text-gray-400 font-mono">{wh.code}</span>
                                        </div>
                                     </td>

                                     {/* C. Métricas Existencia */}
                                     <td className={`px-6 py-4 ${!isActive ? 'opacity-50' : ''}`}>
                                        <div className="flex justify-center gap-6 text-sm">
                                           <div className="text-center">
                                              <span className="block text-[10px] text-gray-400 font-bold uppercase">Físico</span>
                                              <span className={`font-bold ${isLowStock && isActive ? 'text-red-600 flex items-center gap-1' : 'text-gray-800'}`}>
                                                 {isLowStock && isActive && <AlertTriangle size={12} />}
                                                 {physical}
                                              </span>
                                           </div>
                                           <div className="text-center">
                                              <span className="block text-[10px] text-gray-400 font-bold uppercase">Reservado</span>
                                              <span className="font-medium text-gray-600">{reserved}</span>
                                           </div>
                                           <div className="text-center">
                                              <span className="block text-[10px] text-gray-400 font-bold uppercase">Disp.</span>
                                              <span className="font-black text-emerald-600 text-lg">{available}</span>
                                           </div>
                                        </div>
                                     </td>

                                     {/* D. Métricas Flujo */}
                                     <td className={`px-6 py-4 hidden lg:table-cell ${!isActive ? 'opacity-50' : ''}`}>
                                        <div className="flex justify-center gap-4 text-xs">
                                           <div className="flex items-center gap-2 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100 text-blue-700 font-medium">
                                              <Truck size={14} />
                                              <span>0 En tránsito</span>
                                           </div>
                                           <div className="flex items-center gap-2 bg-orange-50 px-3 py-1.5 rounded-lg border border-orange-100 text-orange-700 font-medium">
                                              <ArrowDownToLine size={14} />
                                              <span>0 Por recibir</span>
                                           </div>
                                        </div>
                                     </td>

                                     {/* E. Reaprovisionamiento */}
                                     <td className="px-6 py-4">
                                        <div className={`flex items-center justify-center gap-2 ${!isActive ? 'opacity-40 pointer-events-none' : ''}`}>
                                           <div className="flex flex-col items-center gap-1">
                                              <span className="text-[9px] text-gray-400 font-bold uppercase">Min</span>
                                              <input 
                                                 type="number" 
                                                 value={min || ''}
                                                 onChange={(e) => updateWarehouseSettings(wh.id, 'min', parseInt(e.target.value))}
                                                 placeholder="0"
                                                 className="w-16 p-1.5 bg-gray-50 border border-gray-200 rounded text-center text-sm font-bold outline-none focus:ring-1 focus:ring-blue-500"
                                              />
                                           </div>
                                           <div className="w-4 h-px bg-gray-300 mt-4"></div>
                                           <div className="flex flex-col items-center gap-1">
                                              <span className="text-[9px] text-gray-400 font-bold uppercase">Max</span>
                                              <input 
                                                 type="number" 
                                                 value={max || ''}
                                                 onChange={(e) => updateWarehouseSettings(wh.id, 'max', parseInt(e.target.value))}
                                                 placeholder="0"
                                                 className="w-16 p-1.5 bg-gray-50 border border-gray-200 rounded text-center text-sm font-bold outline-none focus:ring-1 focus:ring-blue-500"
                                              />
                                           </div>
                                        </div>
                                     </td>
                                  </tr>
                               );
                            })}
                         </tbody>
                      </table>
                   </div>
                   {(warehouses || []).length === 0 && (
                      <div className="p-10 text-center text-gray-400">No hay almacenes configurados o disponibles.</div>
                   )}
                </div>
             </div>
          )}

          {/* TAB: STOCKS (LEGACY/SIMPLE INIT) */}
          {activeTab === 'STOCKS' && (
             <div className="max-w-4xl mx-auto space-y-6 animate-in slide-in-from-right-4">
                <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm">
                   <h3 className="text-xl font-bold text-gray-800 mb-6">Inventario Inicial (Carga Rápida)</h3>
                   
                   {formData.variants && formData.variants.length > 0 ? (
                      <div className="space-y-3">
                         {formData.variants.map((v, idx) => (
                            <div key={idx} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
                               <div>
                                  <p className="font-bold text-gray-800 text-sm">{Object.values(v.attributeValues).join(' / ')}</p>
                                  <p className="text-xs text-gray-400 font-mono">{v.sku}</p>
                               </div>
                               <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 p-1">
                                  <button onClick={() => {
                                     const newVars = [...formData.variants];
                                     newVars[idx].initialStock = Math.max(0, (newVars[idx].initialStock || 0) - 1);
                                     setFormData(prev => ({ ...prev, variants: newVars }));
                                  }} className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-lg">-</button>
                                  <input 
                                     type="number" 
                                     value={v.initialStock || 0}
                                     onChange={(e) => {
                                        const newVars = [...formData.variants];
                                        newVars[idx].initialStock = parseInt(e.target.value);
                                        setFormData(prev => ({ ...prev, variants: newVars }));
                                     }}
                                     className="w-16 text-center font-bold outline-none"
                                  />
                                  <button onClick={() => {
                                     const newVars = [...formData.variants];
                                     newVars[idx].initialStock = (newVars[idx].initialStock || 0) + 1;
                                     setFormData(prev => ({ ...prev, variants: newVars }));
                                  }} className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-lg">+</button>
                               </div>
                            </div>
                         ))}
                      </div>
                   ) : (
                      <div className="flex items-center justify-between p-6 bg-blue-50 rounded-2xl border border-blue-100">
                         <div>
                            <h4 className="font-bold text-blue-900">Stock General</h4>
                            <p className="text-sm text-blue-600">Para productos sin variantes.</p>
                         </div>
                         <div className="flex items-center gap-2 bg-white rounded-xl border border-blue-200 p-2 shadow-sm">
                            <button onClick={() => setFormData(prev => ({ ...prev, stock: Math.max(0, (prev.stock || 0) - 1) }))} className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 rounded-lg font-bold text-lg">-</button>
                            <input 
                               type="number" 
                               value={formData.stock || 0}
                               onChange={(e) => setFormData(prev => ({ ...prev, stock: parseInt(e.target.value) }))}
                               className="w-24 text-center font-black text-2xl outline-none text-gray-800"
                            />
                            <button onClick={() => setFormData(prev => ({ ...prev, stock: (prev.stock || 0) + 1 }))} className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 rounded-lg font-bold text-lg">+</button>
                         </div>
                      </div>
                   )}
                </div>
             </div>
          )}

        </div>

        {/* FOOTER ACTIONS */}
        <div className="p-6 border-t bg-white flex justify-between items-center z-10 shrink-0">
           {hasHistory ? (
              <div className="flex items-center gap-2 text-xs text-orange-600 bg-orange-50 px-3 py-2 rounded-xl font-bold">
                 <ShieldAlert size={16} /> 
                 Producto con historial (Edición limitada)
              </div>
           ) : <div></div>}
           
           <div className="flex gap-3">
              <button onClick={onClose} className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors">
                 Cancelar
              </button>
              <button 
                 onClick={handleFinalSave}
                 className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2"
              >
                 <Save size={20} /> Guardar Producto
              </button>
           </div>
        </div>

        {/* QUICK ADD MODAL */}
        {quickAddState && (
           <div className="absolute inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
              <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl animate-in zoom-in-95">
                 <h3 className="text-xl font-black text-gray-800 mb-2">Nuevo {quickAddState.label}</h3>
                 <p className="text-sm text-gray-500 mb-6">Ingresa el nombre para crear el registro.</p>
                 
                 <input 
                    type="text" 
                    autoFocus
                    placeholder={`Nombre de ${quickAddState.label}`}
                    value={quickAddValue}
                    onChange={(e) => setQuickAddValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') confirmQuickAdd(); }}
                    className="w-full p-4 bg-gray-50 border-2 border-gray-200 rounded-xl font-bold text-gray-800 outline-none focus:border-blue-500 mb-6"
                 />
                 
                 <div className="flex gap-3">
                    <button 
                       onClick={() => setQuickAddState(null)} 
                       className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                    >
                       Cancelar
                    </button>
                    <button 
                       onClick={confirmQuickAdd}
                       disabled={!quickAddValue.trim()}
                       className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                       Crear
                    </button>
                 </div>
              </div>
           </div>
        )}

        {/* TEMPLATE MODAL */}
        {isTemplateModalOpen && (
           <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
              <div className="bg-white rounded-3xl w-full max-w-lg p-6 shadow-2xl">
                 <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-black text-gray-800">Elegir Plantilla</h3>
                    <button onClick={() => setIsTemplateModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full"><X size={20}/></button>
                 </div>
                 <div className="space-y-3">
                    {PREDEFINED_TEMPLATES.map(tpl => (
                       <button 
                          key={tpl.id}
                          onClick={() => applyTemplate(tpl)}
                          className="w-full text-left p-4 rounded-xl border-2 border-gray-100 hover:border-pink-300 hover:bg-pink-50 transition-all group"
                       >
                          <h4 className="font-bold text-gray-800 group-hover:text-pink-700">{tpl.name}</h4>
                          <p className="text-xs text-gray-500 mt-1">{tpl.options.join(', ')}</p>
                       </button>
                    ))}
                 </div>
              </div>
           </div>
        )}

      </div>
    </div>
  );
};

export default ProductForm;
