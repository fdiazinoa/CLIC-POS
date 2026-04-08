
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  X, Save, Barcode, DollarSign, Box, Plus, Trash2,
  Info, Layers, RefreshCw, CheckCircle2, Tag,
  Package, LayoutGrid, FileText, Settings2, Upload, Monitor,
  Image as ImageIcon, Percent, ShoppingCart, Calculator, Download,
  ShieldAlert, AlertCircle, Check, LayoutTemplate, ClipboardList, ListTree,
  Truck, ArrowDownToLine, Building2, Search, Filter, AlertTriangle,
  Scale, Ban, ShieldCheck, Zap, History, MapPin, ChevronRight, ChevronDown, Settings,
  Keyboard, BookOpen, ArrowUpRight, ArrowDownLeft, Calendar, Award, Sparkles, TrendingUp, ScanBarcode, Printer
} from 'lucide-react';
import { calculateOptimalInventoryLevels, InventoryCalculation } from '../utils/inventoryEngine';
import {
  Product, ProductAttribute, ProductVariant, BusinessConfig, Tariff, TariffPrice, TaxDefinition, Warehouse, ProductOperationalFlags, InventoryLedgerEntry, ProductStock, StockTransfer, Season, Supplier
} from '../types';
import ProfitCalculator from './ProfitCalculator';
import RecipeManager from './RecipeManager';
import ProductionAreaManager from './ProductionAreaManager';
import { db } from '../utils/db';
import { permissionService } from '../services/sync/PermissionService';
import { inventorySyncService } from '../services/sync/InventorySyncService';
import { UnitSelector } from './UnitSelector';
import { ConversionHelper } from './ConversionHelper';
import { calculateCost, UNITS } from '../utils/units';
import LabelPrintModal from './LabelPrintModal';
import { normalizeTaxIdentifiersForSelection, taxIdentifierSetMatches } from '../utils/taxIdentity';
import {
  canonicalizeTariffEntries,
  canonicalizeWarehouseIds,
  canonicalizeWarehouseRecord,
  getWarehouseScopedNumber,
  resolveProductActiveWarehouseIds,
  resolveWarehouseId,
  tariffMatchesIdentifier,
} from '../utils/masterIdentity';

interface ProductFormProps {
  initialData?: Product | null;
  config: BusinessConfig;
  availableTariffs: Tariff[];
  warehouses?: Warehouse[];
  transfers?: StockTransfer[];
  purchaseOrders?: any[];
  hasHistory?: boolean;
  currentUser?: any;
  roles?: any[];
  onSave: (product: Product) => Promise<void> | void;
  onClose: () => void;
  suppliers?: Supplier[];
  seasons?: Season[];
  initialTab?: ProductTab;
  allProducts?: Product[]; // For recipe search
}

type ProductTab = 'GENERAL' | 'CLASSIFICATION' | 'LABELS' | 'OPERATIVE' | 'TAXES' | 'PRICING' | 'VARIANTS' | 'LOGISTICS' | 'STOCKS' | 'KARDEX' | 'RECIPE';

const DEFAULT_OPERATIONAL_FLAGS: ProductOperationalFlags = {
  isWeighted: false,
  trackInventory: true,
  autoPrintLabel: false,
  promptPrice: false,
  integersOnly: false,
  ageRestricted: false,
  allowNegativeStock: false,
  excludeFromPromotions: false,
  excludeFromLoyalty: false,
  usesLots: false,
  usesSerial: false
};

const VARIANT_TEMPLATES = [
  { name: 'Tallas Ropa', attr: 'Talla', opts: ['S', 'M', 'L', 'XL'] },
  { name: 'Colores Básicos', attr: 'Color', opts: ['Blanco', 'Negro', 'Rojo', 'Azul'] },
  { name: 'Calzado US', attr: 'Número', opts: ['7', '8', '9', '10', '11'] },
  { name: 'Capacidad', attr: 'Memoria', opts: ['64GB', '128GB', '256GB'] }
];

const ProductForm: React.FC<ProductFormProps> = ({ initialData, config, availableTariffs, warehouses = [], transfers = [], purchaseOrders = [], hasHistory = false, currentUser, roles = [], onSave, onClose, suppliers = [], seasons = [], initialTab = 'GENERAL', allProducts = [] }) => {
  const MAX_IMAGE_BYTES = 700 * 1024; // ~700 KB to avoid oversized base64 blobs blocking saves
  const isNativeAndroidRuntime = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  const [activeTab, setActiveTab] = useState<ProductTab>(initialTab || 'GENERAL');
  const [showConversionHelper, setShowConversionHelper] = useState(false);
  const [kardexWarehouse, setKardexWarehouse] = useState<string>(
    config.inventoryScope?.visibleWarehouseIds?.[0] || 'ALL'
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastInitialSyncRef = useRef<string>('');

  // --- STATE ---
  const [showProfitCalc, setShowProfitCalc] = useState<string | null>(null);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPastingImage, setIsPastingImage] = useState(false);
  const [pendingOption, setPendingOption] = useState<Record<string, string>>({});

  // Kardex Filter State
  const [kardexTerminal, setKardexTerminal] = useState<string>('ALL');

  // Transit Popover state (warehouseId or null)
  const [openTransitPopover, setOpenTransitPopover] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState<string | null>(null); // whId or null
  const [calcResult, setCalcResult] = useState<(InventoryCalculation & { warehouseId: string }) | null>(null);

  function normalizeProductActivationState(product: Product): Product {
    const normalizedWarehouseSettings = canonicalizeWarehouseRecord(product.warehouseSettings || {}, warehouses);
    const normalizedStockBalances = canonicalizeWarehouseRecord(product.stockBalances || {}, warehouses);

    return {
      ...product,
      tariffs: canonicalizeTariffEntries(product.tariffs || [], availableTariffs),
      stockBalances: normalizedStockBalances,
      warehouseSettings: normalizedWarehouseSettings,
      activeInWarehouses: resolveProductActiveWarehouseIds(
        {
          ...product,
          warehouseSettings: normalizedWarehouseSettings,
          stockBalances: normalizedStockBalances,
        },
        warehouses
      ),
    };
  }

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
    if (!base.images) base.images = [];
    if (!base.appliedTaxIds) base.appliedTaxIds = config.taxes?.[0] ? [config.taxes[0].id] : [];
    if (!base.stockBalances) base.stockBalances = {};
    return normalizeProductActivationState(base);
  });

  const [warehouseSettings, setWarehouseSettings] = useState<Record<string, { min: number, max: number }>>(
    () => canonicalizeWarehouseRecord(initialData?.warehouseSettings || {}, warehouses)
  );

  const normalizedFormTariffs = useMemo(() => canonicalizeTariffEntries(formData.tariffs || [], availableTariffs), [formData.tariffs, availableTariffs]);
  const normalizedWarehouseSettings = useMemo(
    () => canonicalizeWarehouseRecord(warehouseSettings, warehouses),
    [warehouseSettings, warehouses]
  );
  const normalizedActiveWarehouseIds = useMemo(
    () => resolveProductActiveWarehouseIds({
      activeInWarehouses: formData.activeInWarehouses,
      warehouseSettings: normalizedWarehouseSettings,
    }, warehouses),
    [formData.activeInWarehouses, normalizedWarehouseSettings, warehouses]
  );


  // Kardex Ledger Data (Fetched from DB)
  const [productLedger, setProductLedger] = useState<InventoryLedgerEntry[]>([]);
  const [detailedStocks, setDetailedStocks] = useState<ProductStock[]>([]);
  const [productionAreas, setProductionAreas] = useState<any[]>([]);
  const [productionAreasLoaded, setProductionAreasLoaded] = useState(false);

  useEffect(() => {
    const shouldLoadProductionAreas =
      config?.operational?.usa_modulos_cocina === true &&
      activeTab === 'OPERATIVE' &&
      !productionAreasLoaded;

    if (!shouldLoadProductionAreas) return;

    fetch('http://localhost:8001/api/produccion/areas')
      .then(r => r.json())
      .then(data => {
        setProductionAreas(Array.isArray(data) ? data : []);
        setProductionAreasLoaded(true);
      })
      .catch((err) => {
        console.warn('⚠️ Producción: servicio no disponible. No se cargaron áreas.', err);
        setProductionAreasLoaded(true);
      });
  }, [config?.operational?.usa_modulos_cocina, activeTab, productionAreasLoaded]);

  // --- SYNC STATE WITH PROPS (For Real-time Sync Updates) ---
  useEffect(() => {
    if (!initialData) return;

    const initialTimestamp = initialData.updatedAt || (initialData as any).createdAt || (initialData as any).created_at || 'NO_TS';
    const syncMarker = `${initialData.id || 'NO_ID'}::${initialTimestamp}`;
    if (lastInitialSyncRef.current === syncMarker) {
      return;
    }

    console.log(`🔄 ProductForm: Syncing internal state with updated initialData for ${initialData.id}`);
    setFormData(normalizeProductActivationState({
      ...initialData,
      tariffs: initialData.tariffs || [],
      attributes: initialData.attributes || [],
      variants: initialData.variants || [],
      stockBalances: initialData.stockBalances || {}
    }));
    setWarehouseSettings(canonicalizeWarehouseRecord(initialData.warehouseSettings || {}, warehouses));
    lastInitialSyncRef.current = syncMarker;
  }, [initialData?.id, initialData?.updatedAt, (initialData as any)?.createdAt, (initialData as any)?.created_at]);

  useEffect(() => {
    setFormData(prev => normalizeProductActivationState(prev));
    setWarehouseSettings(prev => canonicalizeWarehouseRecord(prev, warehouses));
  }, [availableTariffs, warehouses]);

  useEffect(() => {
    const loadLedger = async () => {
      let allEntries: InventoryLedgerEntry[] = [];

      if (permissionService.isMasterTerminal()) {
        allEntries = (await db.get('inventoryLedger') || []) as InventoryLedgerEntry[];
      } else {
        allEntries = await inventorySyncService.fetchKardexOnDemand(formData.id);
      }

      const filtered = allEntries.filter(e => e.productId === formData.id)
        .filter(e => kardexWarehouse === 'ALL' || e.warehouseId === kardexWarehouse)
        .filter(e => kardexTerminal === 'ALL' || (e.terminalId || 'LOCAL') === kardexTerminal)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      setProductLedger(filtered);
    };
    loadLedger();

    // Listen for sync events to refresh Kardex in real-time
    const handleSync = () => {
      loadLedger();
    };
    window.addEventListener('ledgerSynced', handleSync);
    window.addEventListener('transactionSynced', handleSync);

    // Listen for productStocks updates
    const handleStockSync = async () => {
      const allStocks = await db.get('productStocks') as ProductStock[] || [];
      const myStocks = allStocks.filter(s => s.productId === formData.id);
      setDetailedStocks(myStocks);
    };
    window.addEventListener('productStocksUpdated', handleStockSync);

    // Initial fetch of detailed stocks
    handleStockSync();

    return () => {
      window.removeEventListener('ledgerSynced', handleSync);
      window.removeEventListener('transactionSynced', handleSync);
      window.removeEventListener('productStocksUpdated', handleStockSync);
    };
  }, [formData.id, kardexWarehouse, kardexTerminal]);

  // --- DYNAMIC LEDGER SUMMARY (For Cards & Table) ---
  const { entriesWithDynamicBalance, currentViewStock, currentViewCost } = useMemo(() => {
    // 1. Sort clones chronologically (productLedger is newest first)
    const chronological = [...productLedger].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    let runningBalance = 0;
    const withDynamic = chronological.map(entry => {
      runningBalance += (entry.qtyIn - entry.qtyOut);
      return { ...entry, dynamicBalance: runningBalance };
    });

    const reversed = [...withDynamic].reverse();
    const latestEntry = reversed[0];

    return {
      entriesWithDynamicBalance: reversed,
      currentViewStock: latestEntry ? latestEntry.dynamicBalance : 0,
      currentViewCost: latestEntry ? latestEntry.balanceAvgCost : formData.cost || 0
    };
  }, [productLedger, formData.cost]);

  // --- KARDEX GROUPING LOGIC ---
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

  const groupedLedger = useMemo(() => {
    const groups: any[] = [];
    const groupMap = new Map();

    entriesWithDynamicBalance.forEach(entry => {
      // Key: Group by DocumentRef. If empty/initial, don't group.
      const isGroupable = entry.documentRef && entry.documentRef !== 'INITIAL' && !entry.documentRef.startsWith('SINGLE');
      const key = isGroupable ? entry.documentRef : `_SINGLE_${entry.id}`;

      if (!groupMap.has(key)) {
        // Initialize Group Master
        const group = {
          id: key,
          isGroup: isGroupable,
          entries: [],
          master: {
            ...entry,
            qtyIn: 0,
            qtyOut: 0,
            // Keep latest balance (since entries are sorted Newest -> Oldest, first seen is latest)
            dynamicBalance: entry.dynamicBalance,
            trackingCode: entry.trackingCode, // Ensure tracking info is pulled into master when group has 1 item
            trackingId: entry.trackingId,
            variantName: entry.variantName,
            variantId: entry.variantId
          }
        };
        groups.push(group);
        groupMap.set(key, group);
      }

      const group = groupMap.get(key);
      group.entries.push(entry);
      group.master.qtyIn += entry.qtyIn;
      group.master.qtyOut += entry.qtyOut;
    });

    return groups;
  }, [entriesWithDynamicBalance]);

  const toggleGroup = (id: string) => {
    const next = new Set(expandedGroupIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedGroupIds(next);
  };


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
      }),
      updatedAt: new Date().toISOString()
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

  const imageTooHeavy = (bytes: number) => bytes > MAX_IMAGE_BYTES;
  const estimateDataUrlBytes = (dataUrl: string) => dataUrl.length * 0.75;
  const canReadClipboardProgrammatically =
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard &&
    (typeof navigator.clipboard.read === 'function' || typeof navigator.clipboard.readText === 'function');
  const canUseNativeClipboardBridge =
    typeof window !== 'undefined' &&
    typeof (window as Window & { AndroidPrinter?: { readClipboard?: () => string } }).AndroidPrinter?.readClipboard === 'function';
  const canUseExplicitPaste = canUseNativeClipboardBridge || canReadClipboardProgrammatically;
  const imagePlaceholderText = isNativeAndroidRuntime ? 'Toca para subir imagen' : 'Click o Pegar (Ctrl+V)';

  const applyImageDataUrl = (dataUrl: string) => {
    if (!dataUrl?.startsWith('data:image/')) {
      alert('El contenido pegado no es una imagen válida.');
      return;
    }
    if (imageTooHeavy(estimateDataUrlBytes(dataUrl))) {
      alert(`La imagen pegada supera el límite (~${(MAX_IMAGE_BYTES / 1024).toFixed(0)} KB).`);
      return;
    }
    setFormData(prev => ({ ...prev, image: dataUrl }));
  };

  const blobToDataUrl = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string) || '');
      reader.onerror = () => reject(reader.error || new Error('No se pudo leer la imagen pegada.'));
      reader.readAsDataURL(blob);
    });
  };

  const extractImageFromHtml = (html: string): string | null => {
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return match?.[1] || null;
  };

  const processClipboardBlob = async (blob: Blob, sourceLabel = 'La imagen pegada') => {
    if (!blob) {
      throw new Error('No se pudo leer la imagen del portapapeles.');
    }

    if (imageTooHeavy(blob.size)) {
      alert(`${sourceLabel} es muy pesada (${(blob.size / 1024).toFixed(0)} KB). Máximo ${(MAX_IMAGE_BYTES / 1024).toFixed(0)} KB.`);
      return true;
    }

    const dataUrl = await blobToDataUrl(blob);
    applyImageDataUrl(dataUrl);
    return true;
  };

  const processClipboardTextPayload = async (html?: string, plainText?: string) => {
    const imageSource = extractImageFromHtml(html || '') || plainText?.trim();

    if (!imageSource) {
      alert('No se detectó una imagen para pegar. Use "Copiar imagen" desde el navegador o suba un archivo.');
      return true;
    }

    if (imageSource.startsWith('data:image/')) {
      applyImageDataUrl(imageSource);
      return true;
    }

    if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
      try {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 3000);

        const response = await fetch(imageSource, {
          signal: controller.signal,
          mode: 'cors',
          cache: 'no-cache'
        });
        window.clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) {
          throw new Error('La URL no apunta a una imagen válida');
        }

        await processClipboardBlob(blob, 'La imagen en URL');
        return true;
      } catch (fetchError: any) {
        console.error('❌ Error fetching image from URL:', fetchError);
        const errorMsg = fetchError.name === 'AbortError'
          ? 'La descarga de la imagen tardó demasiado (>3s). Descárguela manualmente y súbala.'
          : 'No se pudo descargar la imagen desde esa URL (CORS/bloqueado). Descárguela y súbala como archivo.';
        alert(errorMsg);
        return true;
      }
    }

    alert('Formato de portapapeles no soportado. Use "Copiar imagen" o suba un archivo desde su equipo.');
    return true;
  };

  const readClipboardFromNativeBridge = async (): Promise<boolean> => {
    if (!canUseNativeClipboardBridge) return false;

    const runtimeWindow = window as Window & {
      AndroidPrinter?: { readClipboard?: () => string };
    };

    const raw = runtimeWindow.AndroidPrinter?.readClipboard?.();
    if (!raw) return false;

    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Respuesta inválida del portapapeles Android.');
    }

    if (parsed?.success === false) {
      throw new Error(parsed?.message || 'No se pudo leer el portapapeles Android.');
    }

    if (typeof parsed?.imageDataUrl === 'string' && parsed.imageDataUrl.startsWith('data:image/')) {
      applyImageDataUrl(parsed.imageDataUrl);
      return true;
    }

    return processClipboardTextPayload(parsed?.html, parsed?.text);
  };

  const readClipboardFromNavigator = async (): Promise<boolean> => {
    if (!canReadClipboardProgrammatically || !navigator.clipboard) return false;

    const clipboardAny = navigator.clipboard as Clipboard & {
      read?: () => Promise<Array<{ types: readonly string[]; getType: (type: string) => Promise<Blob> }>>;
    };

    if (typeof clipboardAny.read === 'function') {
      const clipboardItems = await clipboardAny.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find(type => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          return processClipboardBlob(blob);
        }
      }

      let html = '';
      let text = '';
      for (const item of clipboardItems) {
        if (!html && item.types.includes('text/html')) {
          html = await (await item.getType('text/html')).text();
        }
        if (!text && item.types.includes('text/plain')) {
          text = await (await item.getType('text/plain')).text();
        }
      }

      if (html || text) {
        return processClipboardTextPayload(html, text);
      }
    }

    if (typeof navigator.clipboard.readText === 'function') {
      const text = await navigator.clipboard.readText();
      return processClipboardTextPayload('', text);
    }

    return false;
  };

  const handleImagePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    // Prevent concurrent paste operations
    if (isPastingImage) {
      console.warn('⚠️ Paste already in progress, ignoring');
      return;
    }

    setIsPastingImage(true);

    try {
      // Priority 1: Check for direct image files in clipboard
      const fromFiles = Array.from(e.clipboardData.files || []).find(f => f.type.startsWith('image/'));
      if (fromFiles) {
        await processClipboardBlob(fromFiles);
        return;
      }

      // Priority 2: Check for image items (screenshot, copy image)
      const items = Array.from(e.clipboardData.items || []);
      const imageItem = items.find(item => item.type.startsWith('image/'));
      if (imageItem) {
        const blob = imageItem.getAsFile();
        await processClipboardBlob(blob as Blob);
        return;
      }

      // Priority 3: Check for HTML/URL content
      const html = e.clipboardData.getData('text/html');
      const plainText = e.clipboardData.getData('text/plain')?.trim();
      await processClipboardTextPayload(html, plainText);

    } catch (error: any) {
      console.error('❌ Error inesperado al pegar imagen:', error);
      alert(`Error al procesar la imagen: ${error?.message || 'Error desconocido'}. Intente subir el archivo directamente.`);
    } finally {
      // Always release the lock
      setIsPastingImage(false);
    }
  };

  const handlePasteFromClipboard = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (isPastingImage) return;

    setIsPastingImage(true);
    try {
      const handledByNative = await readClipboardFromNativeBridge();
      if (handledByNative) return;

      const handledByNavigator = await readClipboardFromNavigator();
      if (handledByNavigator) return;

      alert('Este dispositivo no permite leer imágenes del portapapeles desde la app. Use Galería/Archivo.');
    } catch (error: any) {
      console.error('❌ Error leyendo portapapeles:', error);
      alert(`No se pudo pegar la imagen: ${error?.message || 'Error desconocido'}. Use Galería/Archivo.`);
    } finally {
      setIsPastingImage(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (imageTooHeavy(file.size)) {
        alert(`La imagen es muy pesada (${(file.size / 1024).toFixed(0)} KB). Máximo permitido: ${(MAX_IMAGE_BYTES / 1024).toFixed(0)} KB.`);
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        if (result && imageTooHeavy(estimateDataUrlBytes(result))) {
          alert(`La imagen es muy pesada para guardar. Súbela reducida (máx ${(MAX_IMAGE_BYTES / 1024).toFixed(0)} KB).`);
          return;
        }
        setFormData(prev => ({ ...prev, image: result }));
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleCalculateInventory = async (whId: string) => {
    if (!formData.id) return;
    setIsCalculating(whId);
    try {
      const result = await calculateOptimalInventoryLevels(formData, whId, seasons, suppliers);
      setCalcResult({ ...result, warehouseId: whId });
    } catch (error) {
      console.error("Calculation failed", error);
    } finally {
      setIsCalculating(null);
    }
  };

  const applyCalculation = () => {
    if (!calcResult) return;

    // Apply suggested min/max ONLY to the specific warehouse
    const newSettings = { ...warehouseSettings };
    newSettings[calcResult.warehouseId] = {
      min: calcResult.suggestedMin,
      max: calcResult.suggestedMax
    };

    setWarehouseSettings(newSettings);
    setCalcResult(null);
  };

  const handleToggleTariff = (tariffId: string) => {
    const isPresent = normalizedFormTariffs.some(t => tariffMatchesIdentifier(t, tariffId));
    if (isPresent) {
      setFormData(prev => ({ ...prev, tariffs: prev.tariffs.filter(t => !tariffMatchesIdentifier(t, tariffId)) }));
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

  const updateWarehouseSetting = (warehouseId: string, patch: Partial<{ min: number; max: number }>) => {
    const resolvedWarehouseId = resolveWarehouseId(warehouseId, warehouses);
    if (!resolvedWarehouseId) return;

    setWarehouseSettings(prev => {
      const normalized = canonicalizeWarehouseRecord(prev, warehouses);
      return {
        ...normalized,
        [resolvedWarehouseId]: {
          ...(normalized[resolvedWarehouseId] || { min: 0, max: 0 }),
          ...patch,
        },
      };
    });
  };

  const handleToggleWarehouseActivation = (warehouseId: string) => {
    const resolvedWarehouseId = resolveWarehouseId(warehouseId, warehouses);
    if (!resolvedWarehouseId) return;

    const currentActive = canonicalizeWarehouseIds(formData.activeInWarehouses || [], warehouses);
    const isActive = currentActive.includes(resolvedWarehouseId);
    const nextActive = isActive
      ? currentActive.filter(id => id !== resolvedWarehouseId)
      : [...currentActive, resolvedWarehouseId];

    setFormData(prev => ({ ...prev, activeInWarehouses: nextActive }));
    setWarehouseSettings(prev => {
      const normalized = canonicalizeWarehouseRecord(prev, warehouses);
      if (isActive) {
        const { [resolvedWarehouseId]: _removed, ...rest } = normalized;
        return rest;
      }
      return {
        ...normalized,
        [resolvedWarehouseId]: normalized[resolvedWarehouseId] || { min: 0, max: 0 },
      };
    });
  };

  const handleFinalSave = async () => {
    if (isSaving) return;
    if (!formData.name.trim()) return alert("Debe asignar un nombre al artículo.");
    if (formData.image && estimateDataUrlBytes(formData.image) > MAX_IMAGE_BYTES) { // rough bytes estimate
      alert(`La imagen pegada/suelta supera el límite (~${(MAX_IMAGE_BYTES / 1024).toFixed(0)} KB). Súbela reducida o quítala e inténtalo de nuevo.`);
      return;
    }

    const activeWarehouses = canonicalizeWarehouseIds((formData.activeInWarehouses || []).filter(Boolean), warehouses);
    const requiresWarehouseAssignment = formData.is_sellable !== false || formData.operationalFlags?.trackInventory;
    if (requiresWarehouseAssignment && activeWarehouses.length === 0) {
      alert("Debe asignar al menos un almacén al artículo antes de guardarlo.");
      return;
    }

    // Ensure updatedAt is set for Delta Sync
    const finalWarehouseSettings = Object.fromEntries(
      Object.entries(canonicalizeWarehouseRecord(warehouseSettings, warehouses))
        .filter(([warehouseId]) => activeWarehouses.includes(warehouseId))
    );
    const updatedProduct = {
      ...formData,
      tariffs: canonicalizeTariffEntries(formData.tariffs || [], availableTariffs),
      stockBalances: canonicalizeWarehouseRecord(formData.stockBalances || {}, warehouses),
      activeInWarehouses: activeWarehouses,
      warehouseSettings: finalWarehouseSettings,
      updatedAt: new Date().toISOString()
    };

    try {
      setIsSaving(true);
      await Promise.resolve(onSave(updatedProduct));
    } catch (error) {
      console.error('❌ Error saving product:', error);
      alert('No se pudo guardar el producto. Verifique su conexión y vuelva a intentar.');
    } finally {
      setIsSaving(false);
    }
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
        <div className="mobile-tab-scroller no-scrollbar px-4 border-b bg-white shrink-0">
          {[
            { id: 'GENERAL', label: 'General', icon: Info },
            { id: 'CLASSIFICATION', label: 'Clasificación', icon: ListTree },
            { id: 'LABELS', label: 'Etiquetas', icon: Printer },
            { id: 'OPERATIVE', label: 'Operativa', icon: Settings2 },
            { id: 'PRICING', label: 'Tarifas', icon: Tag },
            { id: 'VARIANTS', label: 'Variantes', icon: Layers },
            { id: 'STOCKS', label: 'Existencias', icon: ClipboardList },
            { id: 'KARDEX', label: 'Kardex', icon: BookOpen },
            { id: 'RECIPE', label: 'Receta / Kit', icon: Layers }, // Using Layers or similar
            { id: 'LOGISTICS', label: 'Logística', icon: Truck },
            { id: 'TAXES', label: 'Impuestos', icon: Percent },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as ProductTab)}
              className={`mobile-tab-item flex items-center gap-2 py-4 font-bold text-xs transition-all border-b-4 ${activeTab === tab.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
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
                  {permissionService.isSlaveTerminal() && (
                    <div className="mt-2 flex items-center gap-2 text-[10px] font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full w-fit">
                      <Info size={12} />
                      MODO CONSULTA: El Kardex local es parcial. El saldo se sincroniza del Master.
                    </div>
                  )}
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
                  <div className="relative">
                    <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">Filtrar Terminal</label>
                    <select
                      value={kardexTerminal}
                      onChange={(e) => setKardexTerminal(e.target.value)}
                      className="p-2.5 bg-gray-100 border-none rounded-xl text-xs font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      <option value="ALL">Todas las terminales</option>
                      {config.terminals.map(t => <option key={t.id} value={t.id}>{t.id}</option>)}
                      <option value="LOCAL">Local (Legacy)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-[2rem] border border-gray-100 overflow-hidden shadow-sm">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 text-gray-400 font-bold uppercase text-[10px] tracking-widest">
                    <tr>
                      <th className="p-4">Fecha / Hora</th>
                      <th className="p-4">Origen</th>
                      <th className="p-4">Concepto / Ref</th>
                      <th className="p-4 text-center">Entrada</th>
                      <th className="p-4 text-center">Salida</th>
                      <th className="p-4 text-center">Saldo</th>
                      {canViewCost && <th className="p-4 text-right">Costo Unit.</th>}
                      {canViewCost && <th className="p-4 text-right">Valorizado</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {groupedLedger.map((group) => {
                      const entry = group.master;
                      const isExpanded = expandedGroupIds.has(group.id);

                      const renderMasterRow = () => (
                        <tr
                          key={group.id}
                          onClick={() => group.isGroup && toggleGroup(group.id)}
                          className={`${group.isGroup ? 'cursor-pointer hover:bg-blue-50/50 bg-blue-50/10' : 'hover:bg-gray-50/50'} transition-colors border-b border-gray-50`}
                        >
                          <td className="p-4">
                            <div className="flex flex-col">
                              <span className="font-bold text-gray-800">{new Date(entry.createdAt).toLocaleDateString()}</span>
                              <span className="text-[10px] text-gray-400">{new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </td>
                          <td className="p-4">
                            <span className="px-2 py-1 bg-gray-100 rounded-lg text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                              {entry.terminalId || 'LOCAL'}
                            </span>
                          </td>
                          <td className="p-4">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-2">
                                <span className={`font-black text-[10px] uppercase ${entry.qtyIn > 0 ? 'text-emerald-600' : 'text-orange-600'}`}>
                                  {entry.concept}
                                </span>
                                {group.isGroup && (
                                  <span className="text-[9px] font-bold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                                    {group.entries.length} vars
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] font-mono text-gray-500 flex items-center gap-1 mt-0.5">
                                {group.isGroup && (isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />)}
                                {entry.documentRef}
                              </span>
                              {!group.isGroup && (entry.trackingCode || entry.variantName) && (
                                <span className="text-[10px] font-bold text-gray-600 flex items-center gap-1 mt-0.5">
                                  {entry.trackingCode ? (
                                    <span className="flex items-center gap-1">
                                      <span className="text-[8px] bg-indigo-50 text-indigo-600 px-1 py-0.5 rounded font-black uppercase tracking-tighter">
                                        {formData.operationalFlags?.usesLots && !formData.operationalFlags?.usesSerial ? 'Lote' : 'Serie'}
                                      </span>
                                      {entry.trackingCode}
                                    </span>
                                  ) : (
                                    <span className="text-[9px] text-gray-500">{entry.variantName}</span>
                                  )}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-4 text-center font-bold text-emerald-600">
                            {entry.qtyIn > 0 ? `+${entry.qtyIn}` : '-'}
                          </td>
                          <td className="p-4 text-center font-bold text-orange-600">
                            {entry.qtyOut > 0 ? `-${entry.qtyOut}` : '-'}
                          </td>
                          <td className="p-4 text-center">
                            <span className="px-2 py-1 bg-gray-100 rounded-lg font-black text-gray-700">{entry.dynamicBalance} {formData.measurementUnit}</span>
                            {/* SMART VIEW: Show purchase unit equivalent */}
                            {formData.conversionFactor && formData.conversionFactor > 1 && formData.purchaseUnit && (
                              <p className="text-[9px] text-gray-400 mt-1 font-medium">
                                ≈ {(entry.dynamicBalance / formData.conversionFactor).toFixed(2)} {formData.purchaseUnit}
                              </p>
                            )}
                          </td>
                          {canViewCost && (
                            <td className="p-4 text-right font-mono text-gray-600">
                              {/* Show range or avg if group? For now logic keeps unit cost of latest */}
                              {config.currencySymbol}{(entry.unitCost || 0).toFixed(2)}
                            </td>
                          )}
                          {canViewCost && (
                            <td className="p-4 text-right">
                              <div className="flex flex-col items-end">
                                <span className="font-black text-gray-800">
                                  {config.currencySymbol}
                                  {calculateCost(
                                    entry.dynamicBalance || 0,
                                    formData.measurementUnit || 'un',
                                    entry.balanceAvgCost || 0,
                                    formData.purchaseUnit || 'un'
                                  ).toFixed(2)}
                                </span>
                                <span className="text-[9px] text-gray-400 uppercase">CPP: {(entry.balanceAvgCost || 0).toFixed(2)} / {UNITS[formData.purchaseUnit || 'un']?.name || formData.purchaseUnit}</span>
                                {formData.measurementUnit !== formData.purchaseUnit && (
                                  <span className="text-[9px] text-blue-400 italic">
                                    (Conv. {formData.measurementUnit} → {formData.purchaseUnit})
                                  </span>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      );

                      if (!group.isGroup) return renderMasterRow();

                      return (
                        <React.Fragment key={group.id}>
                          {renderMasterRow()}
                          {isExpanded && group.entries.map((child: any, idx: number) => (
                            <tr key={`${child.id}_child_${idx}`} className="bg-gray-50/50 animate-in slide-in-from-top-1 duration-200">
                              <td colSpan={2} className="p-0"></td>
                              <td className="p-3 pl-6 border-l-2 border-blue-200">
                                <div className="flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-gray-300"></div>
                                  <div className="flex flex-col">
                                    <span className="font-bold text-gray-700 text-xs">
                                      {child.trackingCode ? (
                                        <span className="flex items-center gap-1.5">
                                          <span className="text-[9px] bg-indigo-50 text-indigo-600 px-1 py-0.5 rounded font-black uppercase tracking-tighter">
                                            {formData.operationalFlags?.usesLots && !formData.operationalFlags?.usesSerial ? 'Lote' : 'Serie'}
                                          </span>
                                          {child.trackingCode}
                                        </span>
                                      ) : (child.variantName || 'Principal')}
                                    </span>
                                    {(child.variantId && !child.trackingCode) && (
                                      <span className="text-[9px] text-gray-400 font-mono scale-90 origin-left">
                                        ID: {child.variantId}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="p-3 text-center text-xs font-medium text-emerald-600">
                                {child.qtyIn > 0 ? `+${child.qtyIn}` : ''}
                              </td>
                              <td className="p-3 text-center text-xs font-medium text-orange-600">
                                {child.qtyOut > 0 ? `-${child.qtyOut}` : ''}
                              </td>
                              <td className="p-3 text-center text-xs text-gray-300">-</td>
                              {canViewCost && (
                                <td className="p-3 text-right text-xs font-mono text-gray-500">
                                  {config.currencySymbol}{child.unitCost.toFixed(2)}
                                </td>
                              )}
                              {canViewCost && <td className="p-3"></td>}
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
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
                    <p className="text-3xl font-black text-blue-600">
                      {config.currencySymbol}{currentViewCost.toFixed(2)}
                    </p>
                  </div>
                )}
                {canViewCost && (
                  <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex flex-col items-center text-center">
                    <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Inversión Total</p>
                    <p className="text-3xl font-black text-gray-800">
                      {config.currencySymbol}{(currentViewStock * currentViewCost).toFixed(2)}
                    </p>
                  </div>
                )}
                <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex flex-col items-center relative overflow-hidden">
                  {permissionService.isSlaveTerminal() && (
                    <div className="absolute top-0 right-0 bg-blue-600 text-white text-[8px] font-black px-2 py-0.5 rounded-bl-lg uppercase">Sincronizado</div>
                  )}
                  <p className="text-[10px] font-black text-gray-400 uppercase mb-1">
                    {kardexWarehouse === 'ALL' ? (kardexTerminal === 'ALL' ? 'Unidades en Red' : 'Stock en Terminal') : 'Stock en Almacén'}
                  </p>
                  <p className="text-3xl font-black text-emerald-600">
                    {currentViewStock}
                  </p>
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
                    onPaste={handleImagePaste}
                    tabIndex={0} // Make div focusable to receive paste events
                    className="aspect-square bg-white rounded-[2rem] border-4 border-dashed border-gray-200 flex flex-col items-center justify-center relative overflow-hidden group cursor-pointer hover:border-blue-400 transition-all outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                  >
                    {formData.image ? <img src={formData.image} className="w-full h-full object-cover" /> : (
                      <div className="flex flex-col items-center gap-2 text-gray-300">
                        <ImageIcon size={48} />
                        <span className="text-[10px] font-bold uppercase">{imagePlaceholderText}</span>
                        {canUseExplicitPaste && (
                          <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">
                            O usa el botón Pegar
                          </span>
                        )}
                      </div>
                    )}

                    {/* Loading Overlay */}
                    {isPastingImage && (
                      <div className="absolute inset-0 bg-blue-50/95 backdrop-blur-sm flex flex-col items-center justify-center z-10 animate-in fade-in duration-200">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                          <p className="text-sm font-bold text-blue-700">Procesando imagen...</p>
                          <p className="text-[10px] text-blue-500 font-medium">Por favor espere</p>
                        </div>
                      </div>
                    )}

                    <input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />

                    <div className="absolute bottom-4 left-4 flex gap-2 z-20">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                        className="px-3 py-2 bg-white text-blue-600 rounded-xl shadow-lg active:scale-95 transition-all border border-gray-100 inline-flex items-center gap-2"
                        title="Subir desde galería o archivo"
                      >
                        <Upload size={18} />
                        <span className="text-xs font-bold">{isNativeAndroidRuntime ? 'Galería' : 'Archivo'}</span>
                      </button>
                      {canUseExplicitPaste && (
                        <button
                          onClick={handlePasteFromClipboard}
                          className="px-3 py-2 bg-white text-emerald-600 rounded-xl shadow-lg active:scale-95 transition-all border border-gray-100 inline-flex items-center gap-2"
                          title="Pegar imagen desde portapapeles"
                        >
                          <ClipboardList size={18} />
                          <span className="text-xs font-bold">Pegar</span>
                        </button>
                      )}
                    </div>

                    {/* Web Search Button Overlay */}
                    <div className="absolute bottom-4 right-4 flex gap-2 z-20">
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
                      <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} onPaste={(e) => e.stopPropagation()} className="w-full p-4 bg-gray-50 border-2 border-transparent rounded-2xl text-lg font-bold text-gray-800 focus:bg-white focus:border-blue-200 transition-all select-text" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-1 ml-1">Código Barra / SKU</label>
                        <input type="text" value={formData.barcode || ''} onChange={e => setFormData({ ...formData, barcode: e.target.value })} onPaste={(e) => e.stopPropagation()} className="w-full p-3 bg-white border-2 border-gray-100 rounded-xl font-mono text-sm select-text" />
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

                  {/* UOM Configuration */}
                  <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 space-y-4">
                    <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                      <Scale size={16} className="text-blue-600" />
                      Unidades y Medidas
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <UnitSelector
                          label="Unidad de Compra"
                          value={formData.purchaseUnit || ''}
                          onChange={val => setFormData({ ...formData, purchaseUnit: val })}
                          config={config}
                          onConfigUpdate={newConfig => {
                            // In a real app we might want to lift this state up or save globally immediately
                            // But since ProductForm receives config as prop, we can verify if we need to call a parent handler.
                            // For now, we trust UnitSelector's internal fetch, but we should ideally update the local config context if possible.
                            console.log('Config updated with new unit:', newConfig.units);
                          }}
                        />
                      </div>
                      <div>
                        <UnitSelector
                          label="Unidad de Inventario (Base)"
                          value={formData.measurementUnit || ''}
                          onChange={val => setFormData({ ...formData, measurementUnit: val })}
                          config={config}
                          onConfigUpdate={newConfig => {
                            console.log('Config updated with new unit:', newConfig.units);
                          }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[10px] font-black text-gray-500 uppercase mb-1 ml-1">Factor de Conversión</label>
                        <div className="flex gap-2 items-center">
                          <div className="relative flex-1">
                            <input
                              type="number"
                              placeholder="1"
                              value={formData.conversionFactor || ''}
                              onChange={e => setFormData({ ...formData, conversionFactor: parseFloat(e.target.value) })}
                              className="w-full p-3 bg-gray-50 border-2 border-transparent rounded-xl text-sm font-medium focus:bg-white focus:border-blue-200"
                            />
                            <div className="absolute right-3 top-3 text-xs text-gray-400 font-bold">Base / Compra</div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setShowConversionHelper(true);
                            }}
                            className="p-3 bg-blue-100 hover:bg-blue-200 text-blue-600 rounded-xl transition-colors cursor-pointer shadow-sm border border-blue-200 h-full aspect-square flex items-center justify-center"
                            title="Calculadora de Conversión"
                          >
                            <Calculator size={18} />
                          </button>
                        </div>
                        {formData.purchaseUnit && formData.measurementUnit && formData.conversionFactor && (formData.conversionFactor > 1) && (
                          <p className="text-[10px] text-blue-600 mt-1 pl-1">
                            1 {formData.purchaseUnit} = {formData.conversionFactor} {formData.measurementUnit}
                          </p>
                        )}
                      </div>

                      {/* Yield Field for Recipes */}
                      {formData.type === 'RECETA' && (
                        <div>
                          <label className="block text-[10px] font-black text-gray-500 uppercase mb-1 ml-1">Rendimiento de Bachada</label>
                          <input
                            type="number"
                            placeholder="1"
                            value={formData.batchYield || ''}
                            onChange={e => setFormData({ ...formData, batchYield: parseFloat(e.target.value) })}
                            className="w-full p-3 bg-blue-50 border-2 border-blue-100 rounded-xl text-sm font-bold text-blue-800 focus:border-blue-300"
                          />
                          <p className="text-[10px] text-gray-400 mt-1 pl-1">Unidades producidas por esta receta</p>
                        </div>
                      )}
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
                    // Try to get stock from detailed collection first, fallback to product embedded balances
                    const detailedStock = detailedStocks.find(s => s.warehouseId === wh.id);

                    // DEBUG: Log what the UI sees
                    console.log(`UI Rendering Stocks for: ${formData.id} in ${wh.id}`, {
                      detailedStock,
                      allDetailedStocks: detailedStocks,
                      fallback: formData.stockBalances?.[wh.id]
                    });

                    const stock = detailedStock ? detailedStock.quantity : getWarehouseScopedNumber(formData.stockBalances || {}, wh.id, warehouses, 0);
                    const isActive = normalizedActiveWarehouseIds.includes(wh.id);

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
                    const tariffData = normalizedFormTariffs.find(t => tariffMatchesIdentifier(t, tariff.id) || tariffMatchesIdentifier(t, (tariff as any).code));
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
                                    const isGeneralTariff = tariff.id === 'trf-gen';

                                    setFormData({
                                      ...formData,
                                      price: isGeneralTariff ? newPrice : formData.price,
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
                <OperationalSwitch
                  label="Disponible para la Venta"
                  description="Muestra este producto en el POS para facturación."
                  checked={formData.is_sellable !== false}
                  onChange={(v: boolean) => setFormData({ ...formData, is_sellable: v })}
                  icon={ShoppingCart}
                />
                <OperationalSwitch label="¿Es Producto Pesado?" description="Activa lectura de Balanza y etiquetas." checked={formData.operationalFlags?.isWeighted} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, isWeighted: v } })} icon={Scale} />
                <OperationalSwitch label="Controlar Stock" description="Valida existencias y descuenta del almacén." checked={formData.operationalFlags?.trackInventory} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, trackInventory: v } })} icon={Box} />
                <OperationalSwitch label="Generar Etiqueta al Recibir" description="Imprime ticket al entrar mercancía." checked={formData.operationalFlags?.autoPrintLabel} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, autoPrintLabel: v } })} icon={Zap} />
                <OperationalSwitch label="Solicitar Precio en Caja" description="Precio Abierto al momento de marcar." checked={formData.operationalFlags?.promptPrice} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, promptPrice: v } })} icon={DollarSign} />
                <OperationalSwitch label="Venta Solo Enteros" description="Bloquea decimales en la cantidad." checked={formData.operationalFlags?.integersOnly} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, integersOnly: v } })} icon={Ban} />
                <OperationalSwitch label="Verificación Edad (+18)" description="Validación obligatoria de cédula." checked={formData.operationalFlags?.ageRestricted} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, ageRestricted: v } })} icon={ShieldCheck} />
                <OperationalSwitch label="Permitir Venta Negativa" description="Vende aunque no haya stock." checked={formData.operationalFlags?.allowNegativeStock} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, allowNegativeStock: v } })} icon={AlertCircle} />
                <OperationalSwitch label="Excluir de Promociones" description="Ignora cupones y descuentos globales." checked={formData.operationalFlags?.excludeFromPromotions} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, excludeFromPromotions: v } })} icon={Tag} />
                <OperationalSwitch label="Excluir de Puntos" description="Este producto no genera puntos de lealtad." checked={formData.operationalFlags?.excludeFromLoyalty} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, excludeFromLoyalty: v } })} icon={Award} />
                <OperationalSwitch label="Usa Lotes / Vencimiento" description="Trazabilidad por lote y fecha de expiración." checked={formData.operationalFlags?.usesLots} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, usesLots: v } })} icon={Calendar} />
                <OperationalSwitch label="Usa Números de Serie" description="Trazabilidad por código único por unidad." checked={formData.operationalFlags?.usesSerial} onChange={(v: boolean) => setFormData({ ...formData, operationalFlags: { ...formData.operationalFlags!, usesSerial: v } })} icon={ScanBarcode} />
              </div>

              {/* ROUTING SECTION */}
              {config?.operational?.usa_modulos_cocina && (
                <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm space-y-4 mt-6">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-blue-100 text-blue-600 rounded-xl">
                      <Monitor size={18} />
                    </div>
                    <div>
                      <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">Ruteo de Producción</h4>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Enrutamiento de Comanda</p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-gray-500 uppercase mb-2 ml-1">Centro de Producción Destino</label>
                    <select
                      value={formData.production_area_id || ''}
                      onChange={e => setFormData({ ...formData, production_area_id: e.target.value })}
                      className="w-full p-4 bg-gray-50 border-2 border-transparent rounded-2xl text-sm font-bold text-gray-800 focus:bg-white focus:border-blue-200 transition-all outline-none"
                    >
                      <option value="">Ninguno (No enviar a cocina)</option>
                      {productionAreas.map(pa => (
                        <option key={pa.id} value={pa.id}>{pa.nombre} ({pa.modo_salida})</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'CLASSIFICATION' && (
            <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in">
              <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
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
                            {config.departments?.map(d => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
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
                            {config.sections?.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest ml-1">Clasificación Comercial</label>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-700 mb-2">Categoría POS</label>
                          {/* We use a datalist to allow both standardized selection and free text if needed, or just strict Select */}
                          <div className="relative">
                            <input
                              list="pos-categories-list"
                              type="text"
                              value={formData.category}
                              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-medium"
                              placeholder="Ej: Bebidas"
                            />
                            <datalist id="pos-categories-list">
                              {config.posCategories?.map(c => (
                                <option key={c.id} value={c.name} />
                              ))}
                            </datalist>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-1 pl-1">Seleccione de la lista o escriba una nueva.</p>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-700 mb-2">Marca</label>
                          <select
                            value={formData.brandId || ''}
                            onChange={(e) => setFormData({ ...formData, brandId: e.target.value })}
                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">-- Sin Marca --</option>
                            {config.brands?.map(b => (
                              <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'LABELS' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
              <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm space-y-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-bold text-gray-800">Etiquetas del Articulo</h3>
                    <p className="text-sm text-gray-500">
                      Imprime etiquetas desde el modulo de articulos usando las plantillas guardadas.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsLabelModalOpen(true)}
                    className="px-5 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-md hover:bg-blue-700 transition-colors flex items-center gap-2 w-fit"
                  >
                    <Printer size={18} /> Imprimir Etiquetas
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100">
                    <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Articulo</p>
                    <p className="font-bold text-gray-800 break-words">{formData.name || 'Sin nombre'}</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100">
                    <p className="text-[10px] font-black text-gray-400 uppercase mb-1">SKU / Codigo</p>
                    <p className="font-mono text-sm text-gray-700 break-words">{formData.barcode || formData.id}</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100">
                    <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Precio Actual</p>
                    <p className="font-black text-blue-700">{config.currencySymbol}{(formData.price || 0).toFixed(2)}</p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl border border-blue-100 bg-blue-50">
                  <p className="text-xs text-blue-700 font-semibold">
                    Consejo: puedes seleccionar plantilla, copias y filtros avanzados dentro del modal de impresion.
                  </p>
                </div>
              </div>
            </div>
          )}

          {
            activeTab === 'LOGISTICS' && (
              <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
                <div className="flex justify-between items-center px-2">
                  <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Truck className="text-blue-500" /> Alcance y Límites de Stock</h3>

                  {/* SUGGESTION MODAL */}
                  {calcResult && (
                    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
                      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-sm p-8 animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-start mb-6">
                          <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
                            <TrendingUp size={24} />
                          </div>
                          <button onClick={() => setCalcResult(null)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><X size={20} /></button>
                        </div>

                        <div className="mb-6">
                          <h4 className="text-xl font-black text-gray-800">Sugerencia Magic</h4>
                          <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-1">
                            Sede: {warehouses.find(w => w.id === calcResult.warehouseId)?.name}
                          </p>
                        </div>

                        {calcResult.hasInsufficientData ? (
                          <div className="bg-orange-50 p-6 rounded-2xl border border-orange-100 mb-6 text-orange-700 text-sm text-center italic">
                            No hay datos suficientes de ventas o traspasos en los últimos 30 días para generar una sugerencia confiable para este almacén.
                          </div>
                        ) : (
                          <>
                            <div className="grid grid-cols-2 gap-4 mb-6">
                              <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                                <p className="text-[10px] font-black text-blue-400 uppercase mb-1">Stock Mínimo</p>
                                <p className="text-3xl font-black text-blue-700">{calcResult.suggestedMin}</p>
                              </div>
                              <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100">
                                <p className="text-[10px] font-black text-indigo-400 uppercase mb-1">Stock Máximo</p>
                                <p className="text-3xl font-black text-indigo-700">{calcResult.suggestedMax}</p>
                              </div>
                            </div>

                            <div className="space-y-3 mb-8 text-xs border-t border-gray-100 pt-6">
                              <div className="flex justify-between items-center whitespace-nowrap">
                                <span className="text-gray-500">Venta Media (VMD)</span>
                                <span className="font-bold text-gray-800">{calcResult.breakdown.baseVmd} u/día</span>
                              </div>
                              {calcResult.breakdown.transferDemandVmd !== undefined && calcResult.breakdown.transferDemandVmd > 0 && (
                                <div className="flex justify-between items-center whitespace-nowrap">
                                  <span className="text-gray-500">Demanda Traspasos (CD)</span>
                                  <span className="font-bold text-indigo-600">+{calcResult.breakdown.transferDemandVmd} u/día</span>
                                </div>
                              )}
                              <div className="flex justify-between items-center whitespace-nowrap">
                                <span className="text-gray-500">Factor Temporada</span>
                                <span className="font-bold text-yellow-600">x{calcResult.breakdown.seasonMultiplier}</span>
                              </div>
                              <div className="flex justify-between items-center whitespace-nowrap">
                                <span className="text-gray-500 font-medium">Lead Time Proveedor</span>
                                <span className="font-bold text-gray-800">{calcResult.breakdown.leadTimeDays} días</span>
                              </div>
                            </div>

                            <button
                              onClick={applyCalculation}
                              type="button"
                              className="w-full py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-2xl font-black shadow-xl shadow-blue-200 hover:shadow-blue-400 transition-all active:scale-95 flex items-center justify-center gap-2"
                            >
                              <Check size={20} strokeWidth={3} /> Aplicar a este Almacén
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-gray-400 font-bold uppercase text-[10px] tracking-widest">
                      <tr>
                        <th className="p-4">Almacén / Ubicación</th>
                        <th className="p-4 text-center">Estado</th>
                        <th className="p-4 text-center">En Tránsito</th>
                        <th className="p-4 text-center">Por Recibir</th>
                        <th className="p-4 text-center">Mínimo</th>
                        <th className="p-4 text-center">Máximo</th>
                        <th className="p-4 text-center w-10">Magic</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {warehouses.map(wh => {
                        const isActive = normalizedActiveWarehouseIds.includes(wh.id);
                        const settings = normalizedWarehouseSettings[wh.id] || { min: 0, max: 0 };

                        // Calculate In Transit quantity for this warehouse
                        const inTransitQty = transfers
                          .filter(t =>
                            t.status === 'IN_TRANSIT' &&
                            t.destinationWarehouseId === wh.id &&
                            t.items.some(item => item.productId === formData.id)
                          )
                          .reduce((sum, transfer) => {
                            const item = transfer.items.find(i => i.productId === formData.id);
                            return sum + (item?.quantity || 0);
                          }, 0);

                        // Calculate On Order quantity for this warehouse  
                        const onOrderQty = purchaseOrders
                          .filter(po =>
                            po.status === 'APPROVED' &&
                            po.destinationWarehouseId === wh.id &&
                            po.items.some(item => item.productId === formData.id)
                          )
                          .reduce((sum, order) => {
                            const item = order.items.find(i => i.productId === formData.id);
                            return sum + (item?.quantityOrdered || 0) - (item?.quantityReceived || 0);
                          }, 0);

                        // Get transfers for this warehouse (for popover)
                        const warehouseTransfers = transfers.filter(t =>
                          t.status === 'IN_TRANSIT' &&
                          t.destinationWarehouseId === wh.id &&
                          t.items.some(item => item.productId === formData.id)
                        );

                        const showPopover = openTransitPopover === wh.id;

                        return (
                          <tr key={wh.id} className={isActive ? 'bg-white' : 'bg-gray-50/50 opacity-60'}>
                            <td className="p-4">
                              <p className="font-bold text-gray-800 flex items-center gap-2">
                                {wh.name}
                                {wh.isMain && <span className="text-[8px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-black uppercase tracking-tight">CD</span>}
                              </p>
                              <p className="text-[10px] text-gray-400">{wh.type}</p>
                            </td>
                            <td className="p-4 text-center">
                              <button onClick={() => handleToggleWarehouseActivation(wh.id)} className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase transition-all ${isActive ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                                {isActive ? 'Activo' : 'Inactivo'}
                              </button>
                            </td>

                            {/* IN TRANSIT COLUMN */}
                            <td className="p-4 text-center relative">
                              {inTransitQty > 0 ? (
                                <div className="relative inline-block">
                                  <button
                                    onClick={() => setOpenTransitPopover(showPopover ? null : wh.id)}
                                    className="font-bold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer transition-colors"
                                  >
                                    {inTransitQty} u.
                                  </button>

                                  {/* POPOVER */}
                                  {showPopover && (
                                    <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-72 bg-white rounded-xl border border-gray-200 shadow-2xl animate-in zoom-in-95 duration-100">
                                      <div className="p-4 border-b bg-gray-50 rounded-t-xl">
                                        <p className="text-xs font-black text-gray-700 uppercase tracking-wide flex items-center gap-2">
                                          <Truck size={14} className="text-blue-600" />
                                          Traspasos en Tránsito
                                        </p>
                                      </div>
                                      <div className="p-3 max-h-64 overflow-y-auto">
                                        {warehouseTransfers.map(transfer => {
                                          const item = transfer.items.find(i => i.productId === formData.id);
                                          const sourceWarehouse = warehouses.find(w => w.id === transfer.sourceWarehouseId);
                                          return (
                                            <div key={transfer.id} className="p-3 bg-gray-50 rounded-lg mb-2 last:mb-0">
                                              <div className="flex justify-between items-start mb-1">
                                                <p className="text-xs font-bold text-gray-800">#{transfer.displayId || transfer.id}</p>
                                                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{item?.quantity} u.</span>
                                              </div>
                                              <p className="text-[10px] text-gray-500">
                                                <span className="font-medium">Desde:</span> {sourceWarehouse?.name || 'Desconocido'}
                                              </p>
                                              <p className="text-[10px] text-gray-400 mt-1">
                                                {new Date(transfer.createdAt).toLocaleDateString()}
                                              </p>
                                            </div>
                                          );
                                        })}
                                      </div>
                                      <div className="p-2 border-t bg-gray-50 rounded-b-xl">
                                        <button
                                          onClick={() => setOpenTransitPopover(null)}
                                          className="w-full text-center text-[10px] font-bold text-gray-500 hover:text-gray-700"
                                        >
                                          Cerrar
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {/* Backdrop to close popover */}
                                  {showPopover && (
                                    <div
                                      className="fixed inset-0 z-40"
                                      onClick={() => setOpenTransitPopover(null)}
                                    />
                                  )}
                                </div>
                              ) : (
                                <span className="text-gray-300">-</span>
                              )}
                            </td>

                            {/* ON ORDER COLUMN */}
                            <td className="p-4 text-center">
                              {onOrderQty > 0 ? (
                                <span className="font-bold text-gray-700">{onOrderQty} u.</span>
                              ) : (
                                <span className="text-gray-300">-</span>
                              )}
                            </td>

                            <td className="p-4">
                              <input type="number" disabled={!isActive} value={settings.min} onChange={e => updateWarehouseSetting(wh.id, { min: parseInt(e.target.value) || 0 })} className="w-16 mx-auto block p-2 bg-gray-50 border border-gray-200 rounded-lg text-center font-bold text-blue-600 disabled:opacity-30" />
                            </td>
                            <td className="p-4">
                              <input type="number" disabled={!isActive} value={settings.max} onChange={e => updateWarehouseSetting(wh.id, { max: parseInt(e.target.value) || 0 })} className="w-16 mx-auto block p-2 bg-gray-50 border border-gray-200 rounded-lg text-center font-bold text-gray-700 disabled:opacity-30" />
                            </td>
                            <td className="p-4 text-center">
                              {isActive && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.preventDefault(); handleCalculateInventory(wh.id); }}
                                  disabled={isCalculating === wh.id}
                                  className="p-2 hover:bg-blue-50 text-blue-600 rounded-xl transition-all active:scale-95 disabled:opacity-30"
                                  title="Calcular Magic Min/Max para este almacén"
                                >
                                  {isCalculating === wh.id ? <RefreshCw size={16} className="animate-spin" /> : <Sparkles size={16} />}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          }

          {
            activeTab === 'RECIPE' && (
              <RecipeManager
                product={formData}
                allProducts={allProducts}
                onUpdate={(updates) => {
                  setFormData(prev => {
                    const newData = { ...prev, ...updates };

                    // SYNC LOGIC: If price changed, update 'General' tariff (id: '1')
                    if (updates.price !== undefined) {
                      const generalTariffId = '1';
                      const tariffIndex = newData.tariffs?.findIndex(t => t.tariffId === generalTariffId);

                      if (tariffIndex !== undefined && tariffIndex >= 0 && newData.tariffs) {
                        const updatedTariffs = [...newData.tariffs];
                        updatedTariffs[tariffIndex] = {
                          ...updatedTariffs[tariffIndex],
                          price: updates.price,
                          // Recalculate margin for the tariff if cost exists
                          margin: newData.cost > 0
                            ? ((updates.price / (1 + (config.taxRate || 0.18))) - newData.cost) / newData.cost * 100
                            : 0
                        };
                        newData.tariffs = updatedTariffs;
                      }
                    }
                    return newData;
                  });
                }}
                currencySymbol={config.currencySymbol}
              />
            )
          }

          {
            activeTab === 'TAXES' && (
              <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in">
                <div className="bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm">
                  <h3 className="text-xl font-bold text-gray-800 mb-6">Impuestos Aplicables</h3>
                  <div className="space-y-3">
                    {config.taxes.map(tax => {
                      const isSelected = taxIdentifierSetMatches(formData.appliedTaxIds, tax);
                      return (
                        <div
                          key={tax.id}
                          onClick={() => {
                            const current = formData.appliedTaxIds || [];
                            const normalizedCurrent = normalizeTaxIdentifiersForSelection(current, tax);
                            setFormData({
                              ...formData,
                              appliedTaxIds: isSelected ? normalizedCurrent : [...normalizedCurrent, tax.id]
                            });
                          }}
                          className={`flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all ${isSelected ? 'bg-blue-50 border-blue-500' : 'bg-gray-50 border-gray-100'}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-6 h-6 rounded border-2 flex items-center justify-center ${isSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'}`}>
                              {isSelected && <Check size={14} className="text-white" />}
                            </div>
                            <div><p className="font-bold text-gray-800">{tax.name}</p></div>
                          </div>
                          <span className="font-black text-lg text-gray-700">{((tax.rate || 0) * 100).toFixed(2)}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )
          }

        </div >

        {/* Footer Actions */}
        < div className="p-6 border-t bg-white flex justify-between items-center shrink-0" >
          <div>{hasHistory && <span className="flex items-center gap-2 text-xs text-orange-600 bg-orange-50 px-3 py-2 rounded-xl font-bold"><ShieldAlert size={16} /> Producto con historial</span>}</div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors">Cancelar</button>
            <button
              onClick={handleFinalSave}
              disabled={isSaving}
              className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold shadow-lg hover:bg-blue-700 active:scale-95 flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
            >
              <Save size={20} /> {isSaving ? 'Guardando...' : 'Guardar Producto'}
            </button>
          </div>
        </div >

        {/* PROFIT CALCULATOR MODAL */}
        {
          showProfitCalc && (
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
          )
        }

        {isLabelModalOpen && (
          <LabelPrintModal
            isOpen={isLabelModalOpen}
            onClose={() => setIsLabelModalOpen(false)}
            config={config}
            items={[
              {
                productId: formData.id,
                productName: formData.name || formData.id,
                sku: formData.barcode || formData.id,
                price: formData.price || 0,
                quantityReceived: 1
              }
            ]}
            sourceTitle={`Articulo ${formData.id}`}
            defaultProductId={formData.id}
            defaultTemplateCategory="ARTICLE"
            defaultQuantityMode="FIXED"
          />
        )}

        {/* CONVERSION HELPER MODAL */}
        {
          showConversionHelper && (
            <ConversionHelper
              fromUnit={formData.purchaseUnit || ''}
              toUnit={formData.measurementUnit || ''}
              currentFactor={formData.conversionFactor || 0}
              onApply={factor => setFormData({ ...formData, conversionFactor: factor })}
              onClose={() => setShowConversionHelper(false)}
            />
          )
        }
      </div >
    </div >
  );
};

export default ProductForm;
