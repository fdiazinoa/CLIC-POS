
import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  X, Save, Barcode, DollarSign, Box, Plus, Trash2,
  Info, Layers, RefreshCw, CheckCircle2, Tag,
  Package, LayoutGrid, FileText, Settings2, Upload,
  Image as ImageIcon, Percent, ShoppingCart, Calculator, Download,
  ShieldAlert, AlertCircle, Check, LayoutTemplate, ClipboardList, ListTree,
  Truck, ArrowDownToLine, Building2, Search, Filter, AlertTriangle,
  Scale, Ban, ShieldCheck, Zap, History, MapPin, ChevronRight, Settings,
  Keyboard, BookOpen, ArrowUpRight, ArrowDownLeft, Calendar, Award
} from 'lucide-react';
import {
  Product, ProductAttribute, ProductVariant, BusinessConfig, Tariff, TariffPrice, TaxDefinition, Warehouse, ProductOperationalFlags, InventoryLedgerEntry
} from '../types';
import ProfitCalculator from './ProfitCalculator';
import { db } from '../utils/db';

interface ProductFormProps {
  initialData?: Product | null;
  config: BusinessConfig;
  availableTariffs: Tariff[];
  warehouses?: Warehouse[];
  hasHistory?: boolean;
  currentUser?: any;
  roles?: any[];
  onSave: (product: Product) => void;
  onClose: () => void;
}

type ProductTab = 'GENERAL' | 'CLASSIFICATION' | 'OPERATIVE' | 'TAXES' | 'PRICING' | 'VARIANTS' | 'LOGISTICS' | 'STOCKS' | 'KARDEX';

const DEFAULT_OPERATIONAL_FLAGS: ProductOperationalFlags = {
  isWeighted: false,
  trackInventory: true,
  autoPrintLabel: false,
  promptPrice: false,
  integersOnly: false,
  ageRestricted: false,
  allowNegativeStock: false,
  excludeFromPromotions: false,
  excludeFromLoyalty: false
};

const VARIANT_TEMPLATES = [
  { name: 'Tallas Ropa', attr: 'Talla', opts: ['S', 'M', 'L', 'XL'] },
  { name: 'Colores Básicos', attr: 'Color', opts: ['Blanco', 'Negro', 'Rojo', 'Azul'] },
  { name: 'Calzado US', attr: 'Número', opts: ['7', '8', '9', '10', '11'] },
  { name: 'Capacidad', attr: 'Memoria', opts: ['64GB', '128GB', '256GB'] }
];

const ProductForm: React.FC<ProductFormProps> = ({ initialData, config, availableTariffs, warehouses = [], hasHistory = false, currentUser, roles = [], onSave, onClose }) => {
  const [activeTab, setActiveTab] = useState<ProductTab>('GENERAL');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- STATE ---
  const [showProfitCalc, setShowProfitCalc] = useState<string | null>(null);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [pendingOption, setPendingOption] = useState<Record<string, string>>({});

  // Kardex Filter State
  const [kardexWarehouse, setKardexWarehouse] = useState<string>('ALL');

  const [formData, setFormData] = useState<Product>(() => {
    const base = initialData || {
      id: `PRD_${Date.now()}`,
      name: '',
      type: 'PRODUCT',
      category: 'General',
      images: [],
      attributes: [],
      variants: [],
      tariffs: [],
      stockBalances: {},
      activeInWarehouses: warehouses.map(w => w.id),
      price: 0,
      barcode: '',
      appliedTaxIds: config.taxes?.[0] ? [config.taxes[0].id] : [],
      cost: 0,
      description: '',
      operationalFlags: DEFAULT_OPERATIONAL_FLAGS,
      warehouseSettings: {}
    };
    if (!base.tariffs) base.tariffs = [];
    if (!base.attributes) base.attributes = [];
    if (!base.variants) base.variants = [];
    if (!base.stockBalances) base.stockBalances = {};
    return base;
  });

  const [warehouseSettings, setWarehouseSettings] = useState<Record<string, { min: number, max: number }>>(initialData?.warehouseSettings || {});

  // Kardex Ledger Data (Fetched from DB)
  const [productLedger, setProductLedger] = useState<InventoryLedgerEntry[]>([]);

  useEffect(() => {
    const loadLedger = async () => {
      const allEntries = (await db.get('inventoryLedger') || []) as InventoryLedgerEntry[];
      const filtered = allEntries.filter(e => e.productId === formData.id)
        .filter(e => kardexWarehouse === 'ALL' || e.warehouseId === kardexWarehouse)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setProductLedger(filtered);
    };
    loadLedger();
  }, [formData.id, kardexWarehouse]);

  const hasPermission = (permission: string): boolean => {
    if (!currentUser) return false;
    const userRole = roles.find(r => r.id === currentUser.role);
    if (!userRole) return false;
    if (userRole.permissions.includes('ALL')) return true;
    return userRole.permissions.includes(permission);
  };

  const canViewCost = hasPermission('CATALOG_VIEW_COST') || hasPermission('CATALOG_MANAGE');

  // --- LOGIC: Variants & Attributes ---
  const addAttribute = () => {
    const newAttr: ProductAttribute = {
      id: `attr_${Date.now()}`,
      name: 'Nuevo Atributo',
      options: [],
      optionCodes: []
    };
    setFormData({ ...formData, attributes: [...formData.attributes, newAttr] });
  };

  const loadTemplate = (template: typeof VARIANT_TEMPLATES[0]) => {
    const newAttr: ProductAttribute = {
      id: `attr_${Date.now()}`,
      name: template.attr,
      options: [...template.opts],
      optionCodes: template.opts.map(o => o.substring(0, 3).toUpperCase())
    };
    setFormData({ ...formData, attributes: [...formData.attributes, newAttr] });
    setShowTemplateMenu(false);
  };

  const handleOptionKeyDown = (e: React.KeyboardEvent, attrId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = pendingOption[attrId]?.trim();
      if (!val) return;

      setFormData(prev => ({
        ...prev,
        attributes: prev.attributes.map(a => {
          if (a.id === attrId && !a.options.includes(val)) {
            return {
              ...a,
              options: [...a.options, val],
              optionCodes: [...a.optionCodes, val.substring(0, 3).toUpperCase()]
            };
          }
          return a;
        })
      }));
      setPendingOption({ ...pendingOption, [attrId]: '' });
    }
  };

  const removeOption = (attrId: string, optIndex: number) => {
    setFormData(prev => ({
      ...prev,
      attributes: prev.attributes.map(a => {
        if (a.id === attrId) {
          const newOpts = [...a.options];
          const newCodes = [...a.optionCodes];
          newOpts.splice(optIndex, 1);
          newCodes.splice(optIndex, 1);
          return { ...a, options: newOpts, optionCodes: newCodes };
        }
        return a;
      })
    }));
  };

  const generateAllVariants = () => {
    if (formData.attributes.length === 0) return alert("Debe definir al menos un atributo con opciones.");
    const cartesian = (arrays: any[][]) => arrays.reduce((a, b) => a.flatMap(d => b.map(e => [d, e].flat())));
    const attributeArrays = formData.attributes.map(a => a.options.map(o => ({ attr: a.name, val: o })));
    if (attributeArrays.some(arr => arr.length === 0)) return alert("Todos los atributos deben tener al menos una opción.");
    const combinations = formData.attributes.length === 1 ? attributeArrays[0].map(item => [item]) : cartesian(attributeArrays);
    const newVariants: ProductVariant[] = combinations.map((combo: any[]) => {
      const attrValues: Record<string, string> = {};
      let skuSuffix = "";
      combo.forEach((c: any) => {
        attrValues[c.attr] = c.val;
        skuSuffix += `-${c.val.substring(0, 3).toUpperCase()}`;
      });
      const baseBarcode = formData.barcode || formData.id.substring(0, 8);
      const variantSku = `${baseBarcode}${skuSuffix}`;
      return { sku: variantSku, barcode: [variantSku], attributeValues: attrValues, price: formData.price, initialStock: 0 };
    });
    setFormData({ ...formData, variants: newVariants });
  };

  const removeAttribute = (id: string) => {
    setFormData({ ...formData, attributes: formData.attributes.filter(a => a.id !== id) });
  };

  const updateStockBalance = (whId: string, value: number) => {
    setFormData({ ...formData, stockBalances: { ...(formData.stockBalances || {}), [whId]: value } });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setFormData(prev => ({ ...prev, image: reader.result as string }));
      reader.readAsDataURL(file);
    }
  };

  const handleToggleTariff = (tariffId: string) => {
    const isPresent = formData.tariffs.some(t => t.tariffId === tariffId);
    if (isPresent) {
      setFormData(prev => ({ ...prev, tariffs: prev.tariffs.filter(t => t.tariffId !== tariffId) }));
    } else {
      const tariff = availableTariffs.find(t => t.id === tariffId);
      setFormData(prev => ({
        ...prev,
        tariffs: [...prev.tariffs, {
          tariffId: tariffId,
          name: tariff?.name,
          price: prev.price,
          costBase: prev.cost,
          margin: prev.cost > 0 ? ((prev.price / (1 + config.taxRate)) - prev.cost) / prev.cost * 100 : 30
        }]
      }));
    }
  };

  const handleFinalSave = () => {
    if (!formData.name.trim()) return alert("Debe asignar un nombre al artículo.");
    onSave({ ...formData, warehouseSettings });
  };

  const OperationalSwitch = ({ label, description, checked, onChange, icon: Icon }: any) => (
    <div
      onClick={() => onChange(!checked)}
      className={`p-4 rounded-2xl border-2 cursor-pointer flex items-center justify-between transition-all ${checked ? 'bg-blue-50 border-blue-500 shadow-sm' : 'bg-white border-gray-100 hover:border-gray-200'}`}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-xl ${checked ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
          <Icon size={18} />
        </div>
        <div>
          <p className={`text-sm font-bold ${checked ? 'text-blue-900' : 'text-gray-700'}`}>{label}</p>
          <p className="text-[10px] text-gray-400 font-medium mt-0.5">{description}</p>
        </div>
      </div>
      <div className={`w-10 h-5 rounded-full relative transition-colors ${checked ? 'bg-blue-600' : 'bg-gray-300'}`}>
        <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${checked ? 'left-6' : 'left-1'}`} />
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-[2.5rem] w-full max-w-5xl h-[90vh] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 relative">

        {/* Header */}
        <div className="p-6 border-b flex justify-between items-center bg-gray-50/50 shrink-0">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-600 text-white rounded-2xl shadow-lg"><Package size={24} /></div>
            <div>
              <h2 className="text-xl font-black text-gray-800">{initialData ? 'Editar Artículo' : 'Nuevo Artículo'}</h2>
              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Gestión Centralizada</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><X size={24} /></button>
        </div>

        {/* Tabs Navigation */}
        <div className="flex flex-wrap px-4 border-b bg-white shrink-0 gap-1 overflow-x-auto no-scrollbar">
          {[
            { id: 'GENERAL', label: 'General', icon: Info },
            { id: 'CLASSIFICATION', label: 'Clasificación', icon: ListTree },
            { id: 'OPERATIVE', label: 'Operativa', icon: Settings2 },
            { id: 'PRICING', label: 'Tarifas', icon: Tag },
            { id: 'VARIANTS', label: 'Variantes', icon: Layers },
            { id: 'STOCKS', label: 'Existencias', icon: ClipboardList },
            { id: 'KARDEX', label: 'Kardex', icon: BookOpen },
            { id: 'LOGISTICS', label: 'Logística', icon: Truck },
            { id: 'TAXES', label: 'Impuestos', icon: Percent },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as ProductTab)}
              className={`flex items-center gap-2 py-4 px-4 font-bold text-xs transition-all border-b-4 whitespace-nowrap shrink-0 ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
            >
              <tab.icon size={14} /> {tab.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-8 bg-gray-50/30 no-scrollbar">

          {/* TAB: KARDEX (IMPLEMENTATION) */}
          {activeTab === 'KARDEX' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
              <div className="flex justify-between items-center bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">Libro Mayor de Inventario</h3>
                  <p className="text-sm text-gray-500">Historial transaccional y valoración CPP.</p>
                </div>
                <div className="flex gap-4">
                  <div className="relative">
                    <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">Filtrar Almacén</label>
                    <select
                      value={kardexWarehouse}
                      onChange={(e) => setKardexWarehouse(e.target.value)}
                      className="p-2.5 bg-gray-100 border-none rounded-xl text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      <option value="ALL">Todos los almacenes</option>
                      {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-[2rem] border border-gray-100 overflow-hidden shadow-sm">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-gray-400 font-bold uppercase text-[10px] tracking-widest">
                    <tr>
                      <th className="p-4">Fecha / Hora</th>
                      <th className="p-4">Concepto / Ref</th>
                      <th className="p-4 text-center">Entrada</th>
                      <th className="p-4 text-center">Salida</th>
                      <th className="p-4 text-center">Saldo</th>
                      {canViewCost && <th className="p-4 text-right">Costo Unit.</th>}
                      {canViewCost && <th className="p-4 text-right">Valorizado</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {productLedger.map((entry) => (
                      <tr key={entry.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className="font-bold text-gray-800">{new Date(entry.createdAt).toLocaleDateString()}</span>
                            <span className="text-[10px] text-gray-400">{new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className={`font-black text-[10px] uppercase ${entry.qtyIn > 0 ? 'text-emerald-600' : 'text-orange-600'}`}>{entry.concept}</span>
                            <span className="text-[11px] font-mono text-gray-500">{entry.documentRef}</span>
                          </div>
                        </td>
                        <td className="p-4 text-center font-bold text-emerald-600">
                          {entry.qtyIn > 0 ? `+${entry.qtyIn}` : '-'}
                        </td>
                        <td className="p-4 text-center font-bold text-orange-600">
                          {entry.qtyOut > 0 ? `-${entry.qtyOut}` : '-'}
                        </td>
                        <td className="p-4 text-center">
                          <span className="px-2 py-1 bg-gray-100 rounded-lg font-black text-gray-700">{entry.balanceQty}</span>
                        </td>
                        {canViewCost && (
                          <td className="p-4 text-right font-mono text-gray-600">
                            {config.currencySymbol}{entry.unitCost.toFixed(2)}
                          </td>
                        )}
                        {canViewCost && (
                          <td className="p-4 text-right">
                            <div className="flex flex-col items-end">
                              <span className="font-black text-gray-800">{config.currencySymbol}{(entry.balanceQty * entry.balanceAvgCost).toFixed(2)}</span>
                              <span className="text-[9px] text-gray-400 uppercase">CPP: {entry.balanceAvgCost.toFixed(2)}</span>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                    {productLedger.length === 0 && (
                      <tr>
                        <td colSpan={canViewCost ? 7 : 5} className="p-12 text-center">
                          <div className="flex flex-col items-center opacity-30">
                            <History size={48} className="mb-2" />
                            <p className="font-bold">No hay movimientos registrados para este criterio.</p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {canViewCost && (
                  <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex flex-col items-center">
                    <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Costo Promedio (CPP)</p>
                    <p className="text-3xl font-black text-blue-600">{config.currencySymbol}{formData.cost?.toFixed(2)}</p>
                  </div>
                )}
                {canViewCost && (
                  <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex flex-col items-center text-center">
                    <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Inversión Total</p>
                    <p className="text-3xl font-black text-gray-800">{config.currencySymbol}{((formData.stock || 0) * (formData.cost || 0)).toFixed(2)}</p>
                  </div>
                )}
                <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex flex-col items-center">
                  <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Unidades en Red</p>
                  <p className="text-3xl font-black text-emerald-600">{formData.stock || 0}</p>
                </div>
              </div>
            </div>
          )}

          {/* Resto de las pestañas permanecen iguales */}
          {activeTab === 'GENERAL' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="md:col-span-1 space-y-4">
                  <label className="block text-[10px] font-black text-gray-500 uppercase ml-1">Imagen Principal</label>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onPaste={(e) => {
                      const items = e.clipboardData.items;
                      for (let i = 0; i < items.length; i++) {
                        if (items[i].type.indexOf("image") !== -1) {
                          const blob = items[i].getAsFile();
                          if (blob) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              setFormData(prev => ({ ...prev, image: event.target?.result as string }));
                            };
                            reader.readAsDataURL(blob);
                            e.preventDefault(); // Prevent default paste behavior
                            e.stopPropagation();
                          }
                        }
                      }
                    }}
                    tabIndex={0} // Make div focusable to receive paste events
                    className="aspect-square bg-white rounded-[2rem] border-4 border-dashed border-gray-200 flex flex-col items-center justify-center relative overflow-hidden group cursor-pointer hover:border-blue-400 transition-all outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                  >
                    {formData.image ? <img src={formData.image} className="w-full h-full object-cover" /> : (
                      <div className="flex flex-col items-center gap-2 text-gray-300">
                        <ImageIcon size={48} />
                        <span className="text-[10px] font-bold uppercase">Click o Pegar (Ctrl+V)</span>
                      </div>
                    )}
                    <input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />

                    {/* Web Search Button Overlay */}
                    <div className="absolute bottom-4 right-4 flex gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation(); // Prevent file input trigger
                          const term = encodeURIComponent(formData.name || formData.category || 'producto');
                          window.open(`https://www.google.com/search?tbm=isch&q=${term}`, '_blank');
                        }}
                        className="p-3 bg-white text-blue-600 rounded-xl shadow-lg hover:scale-110 active:scale-95 transition-all border border-gray-100"
                        title="Buscar en Google Imágenes"
                      >
                        <Search size={20} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="md:col-span-2 space-y-6">
                  <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 space-y-4">
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase mb-1 ml-1">Nombre Comercial</label>
                      <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full p-4 bg-gray-50 border-2 border-transparent rounded-2xl text-lg font-bold text-gray-800 focus:bg-white focus:border-blue-200 transition-all" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-1 ml-1">Código Barra / SKU</label>
                        <input type="text" value={formData.barcode || ''} onChange={e => setFormData({ ...formData, barcode: e.target.value })} className="w-full p-3 bg-white border-2 border-gray-100 rounded-xl font-mono text-sm" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-1 ml-1">Costo Unitario (CPP)</label>
                        <div className="relative">
                          <input disabled type={canViewCost ? "number" : "password"} value={canViewCost ? (formData.cost || 0) : '******'} className="w-full p-3 bg-gray-100 border-2 border-transparent rounded-xl font-bold text-gray-500 cursor-not-allowed" />
                          {!canViewCost && <div className="absolute inset-0 flex items-center justify-center"><span className="text-xs text-gray-400 font-bold bg-gray-100 px-2 rounded">Oculto</span></div>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'VARIANTS' && (
            <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in">
              <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm space-y-8">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-xl font-bold text-gray-800">Atributos y Variantes</h3>
                    <p className="text-sm text-gray-500">Define múltiples opciones para un mismo producto.</p>
                  </div>
                  <div className="flex gap-2 relative">
                    <button onClick={() => setShowTemplateMenu(!showTemplateMenu)} className="px-4 py-2 bg-purple-50 text-purple-600 rounded-xl font-bold text-xs flex items-center gap-2 hover:bg-purple-100">
                      <LayoutTemplate size={16} /> Cargar Plantillas
                    </button>
                    {showTemplateMenu && (
                      <div className="absolute top-full mt-2 right-0 w-48 bg-white rounded-xl shadow-xl border border-gray-100 p-2 z-[90] animate-in zoom-in-95 duration-100">
                        {VARIANT_TEMPLATES.map((t, idx) => (
                          <button
                            key={idx}
                            onClick={() => loadTemplate(t)}
                            className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 text-xs font-bold text-gray-600 flex justify-between items-center group"
                          >
                            {t.name}
                            <ChevronRight size={14} className="opacity-0 group-hover:opacity-100" />
                          </button>
                        ))}
                      </div>
                    )}
                    <button onClick={addAttribute} className="px-4 py-2 bg-blue-50 text-blue-600 rounded-xl font-bold text-xs flex items-center gap-2 hover:bg-blue-100">
                      <Plus size={16} /> Añadir Atributo
                    </button>
                  </div>
                </div>

                {/* Attributes Editor */}
                <div className="space-y-4">
                  {formData.attributes.map((attr, idx) => (
                    <div key={attr.id} className="p-5 bg-gray-50/50 rounded-3xl border border-gray-100 flex flex-col gap-4">
                      <div className="flex gap-4 items-end">
                        <div className="w-1/3">
                          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Nombre Atributo</label>
                          <input
                            type="text"
                            placeholder="Ej: Talla o Color"
                            value={attr.name}
                            onChange={(e) => {
                              const newAttrs = [...formData.attributes];
                              newAttrs[idx].name = e.target.value;
                              setFormData({ ...formData, attributes: newAttrs });
                            }}
                            className="w-full p-3 bg-white border rounded-xl text-sm font-bold shadow-sm"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Opciones (Presione ENTER para agregar)</label>
                          <div className="flex flex-wrap items-center gap-2 p-1.5 bg-white border rounded-xl shadow-sm min-h-[46px] focus-within:ring-2 focus-within:ring-blue-100">
                            {attr.options.map((opt, optIdx) => (
                              <span key={optIdx} className="bg-blue-50 text-blue-700 px-2 py-1 rounded-lg text-xs font-bold border border-blue-100 flex items-center gap-1 group">
                                {opt}
                                <button onClick={() => removeOption(attr.id, optIdx)} className="hover:text-red-500"><X size={12} /></button>
                              </span>
                            ))}
                            <input
                              type="text"
                              value={pendingOption[attr.id] || ''}
                              onChange={(e) => setPendingOption({ ...pendingOption, [attr.id]: e.target.value })}
                              onKeyDown={(e) => handleOptionKeyDown(e, attr.id)}
                              placeholder={attr.options.length === 0 ? "Escribe y pulsa Enter..." : ""}
                              className="flex-1 min-w-[120px] bg-transparent text-sm outline-none px-2"
                            />
                          </div>
                        </div>
                        <button onClick={() => removeAttribute(attr.id)} className="p-3 text-red-400 hover:bg-red-50 rounded-xl transition-colors"><Trash2 size={20} /></button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="h-px bg-gray-100"></div>

                {/* Variants Table */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="font-bold text-gray-700 flex items-center gap-2"><Layers size={18} className="text-blue-500" /> Lista de Variantes</h4>
                    <button onClick={generateAllVariants} className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-100 flex items-center gap-2">
                      <Zap size={14} /> Generar Variantes Combinadas
                    </button>
                  </div>

                  <div className="overflow-hidden border border-gray-100 rounded-[2rem] bg-white">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-gray-50 text-gray-400 font-bold uppercase text-[10px]">
                        <tr>
                          <th className="p-4">SKU / Barcode</th>
                          <th className="p-4">Valores (Combinación)</th>
                          <th className="p-4 text-right">Precio de Venta</th>
                          <th className="p-4"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {formData.variants.map((v, vIdx) => (
                          <tr key={vIdx} className="hover:bg-gray-50/50 group">
                            <td className="p-4">
                              <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-gray-100 rounded-lg text-gray-400 group-hover:text-blue-500 transition-colors">
                                  <Barcode size={14} />
                                </div>
                                <input
                                  type="text"
                                  value={v.sku}
                                  onChange={(e) => {
                                    const newV = [...formData.variants];
                                    newV[vIdx].sku = e.target.value;
                                    newV[vIdx].barcode = [e.target.value];
                                    setFormData({ ...formData, variants: newV });
                                  }}
                                  className="bg-transparent font-mono text-xs font-bold outline-none focus:text-blue-600 w-full"
                                />
                              </div>
                            </td>
                            <td className="p-4">
                              <div className="flex gap-1.5">
                                {Object.entries(v.attributeValues).map(([key, val], idx) => (
                                  <span key={idx} className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-[10px] font-bold">
                                    <span className="opacity-40">{key}:</span> {val}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="p-4 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-[10px] font-bold text-gray-300">{config.currencySymbol}</span>
                                <input
                                  type="number"
                                  value={v.price}
                                  onChange={(e) => {
                                    const newV = [...formData.variants];
                                    newV[vIdx].price = parseFloat(e.target.value) || 0;
                                    setFormData({ ...formData, variants: newV });
                                  }}
                                  className="w-24 text-right font-black text-gray-700 outline-none bg-gray-50/50 rounded-lg px-2 py-1 focus:bg-white transition-all"
                                />
                              </div>
                            </td>
                            <td className="p-4 text-right">
                              <button onClick={() => setFormData({ ...formData, variants: formData.variants.filter((_, i) => i !== vIdx) })} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {formData.variants.length === 0 && (
                      <div className="p-12 text-center text-gray-300 flex flex-col items-center gap-3">
                        <Layers size={48} strokeWidth={1} className="opacity-20" />
                        <p className="italic text-xs font-medium">No hay variantes generadas. Añada atributos arriba y use el generador.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'STOCKS' && (
            <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in">
              <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm space-y-6">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-xl font-bold text-gray-800">Existencias por Almacén</h3>
                    <p className="text-sm text-gray-500">Visualización y ajuste del stock físico actual.</p>
                  </div>
                  <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center gap-2">
                    <CheckCircle2 size={20} />
                    <span className="text-xs font-bold uppercase tracking-widest">Sincronizado</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {warehouses.map(wh => {
                    const stock = formData.stockBalances?.[wh.id] || 0;
                    const isActive = formData.activeInWarehouses?.includes(wh.id);

                    return (
                      <div key={wh.id} className={`p-6 rounded-2xl border-2 flex items-center justify-between transition-all ${isActive ? 'bg-white border-gray-100' : 'bg-gray-50 border-transparent opacity-50 grayscale'}`}>
                        <div className="flex items-center gap-4">
                          <div className={`p-3 rounded-xl ${isActive ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-400'}`}>
                            <Building2 size={24} />
                          </div>
                          <div>
                            <h4 className="font-bold text-gray-800">{wh.name}</h4>
                            <p className="text-xs text-gray-400 font-mono">{wh.code} • {wh.type}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-8">
                          <div className="text-center">
                            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Estado</p>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${stock > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {stock > 0 ? 'Con Stock' : 'Sin Stock'}
                            </span>
                          </div>
                          <div className="text-right">
                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 text-right">Balance Actual</label>
                            <div className="flex items-center gap-3">
                              <input
                                type="number"
                                disabled={!isActive}
                                value={stock}
                                onChange={(e) => updateStockBalance(wh.id, parseFloat(e.target.value) || 0)}
                                className="w-24 p-2 bg-gray-50 border border-gray-200 rounded-xl text-center font-black text-xl text-blue-600 outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
                              />
                              <span className="text-xs font-bold text-gray-400">unidades</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="bg-orange-50 p-4 rounded-2xl border border-orange-100 flex items-start gap-3">
                  <AlertTriangle className="text-orange-500 shrink-0" size={20} />
                  <p className="text-xs text-orange-800 leading-relaxed">
                    <strong>Nota:</strong> Los cambios manuales en este panel afectan directamente al balance del inventario. Para entradas masivas o compras, utilice el módulo de <strong>Abastecimiento</strong>.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'PRICING' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
              <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="text-xl font-bold text-gray-800">Tarifas y Márgenes</h3>
                    <p className="text-sm text-gray-500">Configura precios específicos para cada lista de precios.</p>
                  </div>
                  {canViewCost && (
                    <div className="text-right">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Costo Actual (CPP)</p>
                      <p className="text-2xl font-black text-blue-600">{config.currencySymbol}{formData.cost?.toFixed(2)}</p>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  {availableTariffs.length > 0 ? availableTariffs.map(tariff => {
                    const tariffData = formData.tariffs.find(t => t.tariffId === tariff.id);
                    const isEnabled = !!tariffData;

                    return (
                      <div key={tariff.id} className={`p-6 rounded-2xl border-2 transition-all ${isEnabled ? 'bg-white border-purple-200 shadow-sm' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
                        <div className="flex flex-col md:flex-row justify-between gap-6 items-center">
                          <div className="flex items-center gap-4">
                            <button
                              onClick={() => handleToggleTariff(tariff.id)}
                              className={`w-12 h-6 rounded-full relative transition-colors ${isEnabled ? 'bg-purple-600' : 'bg-gray-300'}`}
                            >
                              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${isEnabled ? 'left-7' : 'left-1'}`} />
                            </button>
                            <div>
                              <h4 className="font-bold text-gray-800">{tariff.name}</h4>
                              <p className="text-xs text-gray-500">{tariff.currency} • {isEnabled ? 'Personalizado' : 'Heredado'}</p>
                            </div>
                          </div>

                          {isEnabled && (
                            <div className="flex items-center gap-6">
                              {canViewCost && (
                                <div className="text-center">
                                  <p className="text-[10px] font-bold text-gray-400 uppercase">Margen Neto</p>
                                  <p className={`font-black text-sm ${tariffData.margin! > 20 ? 'text-emerald-600' : 'text-orange-500'}`}>
                                    {tariffData.margin?.toFixed(1)}%
                                  </p>
                                </div>
                              )}
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">{config.currencySymbol}</span>
                                <input
                                  type="number"
                                  value={tariffData.price}
                                  onChange={(e) => {
                                    const newPrice = parseFloat(e.target.value) || 0;
                                    setFormData({
                                      ...formData,
                                      tariffs: formData.tariffs.map(t => t.tariffId === tariff.id ? { ...t, price: newPrice } : t)
                                    });
                                  }}
                                  className="w-32 pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl font-black text-purple-700 outline-none focus:ring-2 focus:ring-purple-200"
                                />
                              </div>
                              {canViewCost && (
                                <button
                                  onClick={() => setShowProfitCalc(tariff.id)}
                                  className="p-2 bg-purple-50 text-purple-600 rounded-lg hover:bg-purple-100"
                                  title="Abrir Calculadora"
                                >
                                  <Calculator size={20} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="text-center py-12 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 text-gray-400">
                      <AlertCircle className="mx-auto mb-2 opacity-50" size={32} />
                      <p>No hay tarifas configuradas en el sistema.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'OPERATIVE' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <OperationalSwitch label="¿Es Producto Pesado?" description="Activa lectura de Balanza y etiquetas." checked={formData.operationalFlags?.isWeighted} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, isWeighted: v } })} icon={Scale} />
                <OperationalSwitch label="Controlar Stock" description="Valida existencias y descuenta del almacén." checked={formData.operationalFlags?.trackInventory} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, trackInventory: v } })} icon={Box} />
                <OperationalSwitch label="Generar Etiqueta al Recibir" description="Imprime ticket al entrar mercancía." checked={formData.operationalFlags?.autoPrintLabel} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, autoPrintLabel: v } })} icon={Zap} />
                <OperationalSwitch label="Solicitar Precio en Caja" description="Precio Abierto al momento de marcar." checked={formData.operationalFlags?.promptPrice} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, promptPrice: v } })} icon={DollarSign} />
                <OperationalSwitch label="Venta Solo Enteros" description="Bloquea decimales en la cantidad." checked={formData.operationalFlags?.integersOnly} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, integersOnly: v } })} icon={Ban} />
                <OperationalSwitch label="Verificación Edad (+18)" description="Validación obligatoria de cédula." checked={formData.operationalFlags?.ageRestricted} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, ageRestricted: v } })} icon={ShieldCheck} />
                <OperationalSwitch label="Permitir Venta Negativa" description="Vende aunque no haya stock." checked={formData.operationalFlags?.allowNegativeStock} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, allowNegativeStock: v } })} icon={AlertCircle} />
                <OperationalSwitch label="Excluir de Promociones" description="Ignora cupones y descuentos globales." checked={formData.operationalFlags?.excludeFromPromotions} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, excludeFromPromotions: v } })} icon={Tag} />
                <OperationalSwitch label="Excluir de Puntos" description="Este producto no genera puntos de lealtad." checked={formData.operationalFlags?.excludeFromLoyalty} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, excludeFromLoyalty: v } })} icon={Award} />
              </div>
            </div>
          )}

          {activeTab === 'CLASSIFICATION' && (
            <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in">
              <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Jerarquía de Almacén</label>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-2">Departamento</label>
                        <select
                          value={formData.departmentId || ''}
                          onChange={(e) => setFormData({ ...formData, departmentId: e.target.value })}
                          className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">-- Sin Definir --</option>
                          <option value="DEP_01">Alimentos</option>
                          <option value="DEP_02">Hogar</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-2">Sección</label>
                        <select
                          value={formData.sectionId || ''}
                          onChange={(e) => setFormData({ ...formData, sectionId: e.target.value })}
                          className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">-- Sin Definir --</option>
                          <option value="SEC_01">Abarrotes</option>
                          <option value="SEC_02">Frescos</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Clasificación Comercial</label>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-2">Categoría POS</label>
                        <input
                          type="text"
                          value={formData.category}
                          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                          className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-medium"
                          placeholder="Ej: Bebidas"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-2">Marca</label>
                        <select
                          value={formData.brandId || ''}
                          onChange={(e) => setFormData({ ...formData, brandId: e.target.value })}
                          className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">-- Sin Marca --</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'LOGISTICS' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 px-2"><Truck className="text-blue-500" /> Alcance y Límites de Stock</h3>
              <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-gray-400 font-bold uppercase text-[10px] tracking-widest">
                    <tr>
                      <th className="p-4">Almacén / Ubicación</th>
                      <th className="p-4 text-center">Estado</th>
                      <th className="p-4 text-center">Mínimo</th>
                      <th className="p-4 text-center">Máximo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {warehouses.map(wh => {
                      const isActive = formData.activeInWarehouses?.includes(wh.id);
                      const settings = warehouseSettings[wh.id] || { min: 0, max: 0 };
                      return (
                        <tr key={wh.id} className={isActive ? 'bg-white' : 'bg-gray-50/50 opacity-60'}>
                          <td className="p-4">
                            <p className="font-bold text-gray-800">{wh.name}</p>
                            <p className="text-[10px] text-gray-400">{wh.type}</p>
                          </td>
                          <td className="p-4 text-center">
                            <button onClick={() => {
                              const current = formData.activeInWarehouses || [];
                              const isAct = current.includes(wh.id);
                              setFormData({ ...formData, activeInWarehouses: isAct ? current.filter(id => id !== wh.id) : [...current, wh.id] });
                            }} className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase transition-all ${isActive ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                              {isActive ? 'Activo' : 'Inactivo'}
                            </button>
                          </td>
                          <td className="p-4">
                            <input type="number" disabled={!isActive} value={settings.min} onChange={e => setWarehouseSettings({ ...warehouseSettings, [wh.id]: { ...(warehouseSettings[wh.id] || { min: 0, max: 0 }), min: parseInt(e.target.value) || 0 } })} className="w-20 mx-auto block p-2 bg-gray-50 border border-gray-200 rounded-lg text-center font-bold text-blue-600 disabled:opacity-30" />
                          </td>
                          <td className="p-4">
                            <input type="number" disabled={!isActive} value={settings.max} onChange={e => setWarehouseSettings({ ...warehouseSettings, [wh.id]: { ...(warehouseSettings[wh.id] || { min: 0, max: 0 }), max: parseInt(e.target.value) || 0 } })} className="w-20 mx-auto block p-2 bg-gray-50 border border-gray-200 rounded-lg text-center font-bold text-gray-700 disabled:opacity-30" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'TAXES' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
              <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm">
                <h3 className="text-xl font-bold text-gray-800 mb-6">Impuestos Aplicables</h3>
                <div className="space-y-3">
                  {config.taxes.map(tax => {
                    const isSelected = formData.appliedTaxIds?.includes(tax.id);
                    return (
                      <div
                        key={tax.id}
                        onClick={() => {
                          const current = formData.appliedTaxIds || [];
                          setFormData({ ...formData, appliedTaxIds: isSelected ? current.filter(id => id !== tax.id) : [...current, tax.id] });
                        }}
                        className={`flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all ${isSelected ? 'bg-blue-50 border-blue-500' : 'bg-gray-50 border-gray-100'}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-6 h-6 rounded border-2 flex items-center justify-center ${isSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'}`}>
                            {isSelected && <Check size={14} className="text-white" />}
                          </div>
                          <div><p className="font-bold text-gray-800">{tax.name}</p></div>
                        </div>
                        <span className="font-black text-lg text-gray-700">{(tax.rate * 100).toFixed(2)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t bg-white flex justify-between items-center shrink-0">
          <div>{hasHistory && <span className="flex items-center gap-2 text-xs text-orange-600 bg-orange-50 px-3 py-2 rounded-xl font-bold"><ShieldAlert size={16} /> Producto con historial</span>}</div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors">Cancelar</button>
            <button onClick={handleFinalSave} className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-700 active:scale-95 flex items-center gap-2"><Save size={20} /> Guardar Producto</button>
          </div>
        </div>

        {/* PROFIT CALCULATOR MODAL */}
        {showProfitCalc && (
          <ProfitCalculator
            initialCost={formData.tariffs.find(t => t.tariffId === showProfitCalc)?.costBase || formData.cost || 0}
            initialPrice={formData.tariffs.find(t => t.tariffId === showProfitCalc)?.price || formData.price}
            initialMargin={formData.tariffs.find(t => t.tariffId === showProfitCalc)?.margin || 30}
            taxRate={config.taxRate}
            currencySymbol={config.currencySymbol}
            onClose={() => setShowProfitCalc(null)}
            onApply={(values) => {
              setFormData(prev => ({
                ...prev,
                tariffs: prev.tariffs.map(t => t.tariffId === showProfitCalc ? { ...t, price: values.price, margin: values.margin, costBase: values.cost } : t)
              }));
              setShowProfitCalc(null);
            }}
          />
        )}
      </div>
    </div>
  );
};

export default ProductForm;
