
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
   Package, Search, Plus, Edit2, Trash2, ArrowLeft,
   Filter, Tag, Image as ImageIcon, DollarSign,
   Calendar, CheckCircle2, XCircle, Layers, ClipboardList,
   ChevronDown, ChevronRight, Box, AlertCircle, MapPin, Grid, Sun,
   CheckSquare, Square, MoreHorizontal, Settings2, Activity, RefreshCw
} from 'lucide-react';
import { Product, BusinessConfig, Tariff, Transaction, ProductVariant, Warehouse, ProductGroup, Season, Watchlist, ProductStock, StockTransfer, Supplier, Room } from '../types';
import { calculateOptimalInventoryLevels } from '../utils/inventoryEngine';
import ProductForm from './ProductForm';
import TariffForm from './TariffForm';
import VariantManager from './VariantManager';
import GroupForm from './GroupForm';
import SeasonForm from './SeasonForm';
import BulkEditModal from './BulkEditModal';
import WatchlistMonitor from './WatchlistMonitor';
import { db } from '../utils/db';
import { syncManager } from '../services/sync/SyncManager';
import { permissionService } from '../services/sync/PermissionService';
import ClassificationManager from './ClassificationManager';
import ErrorBoundary from './ErrorBoundary';
import { getWarehouseScopedNumber, isProductWarehouseActive } from '../utils/masterIdentity';
import {
   productIdMatchesInventoryReference,
   productIdentityCandidates,
   productReferenceCandidates,
   resolveInventoryProductStockRow,
} from '../utils/productReferences';
import { resolveProductImageSrc } from '../utils/entityImage';

interface CatalogManagerProps {
   products: Product[];
   config: BusinessConfig;
   warehouses: Warehouse[];
   transactions: Transaction[];
   currentUser: any; // Using any to avoid circular dependency or import issues if User type isn't imported
   roles: any[];
   onUpdateProducts: (products: Product[]) => void;
   onUpdateConfig: (config: BusinessConfig) => void;
   onClose: () => void;
   isAdminMode?: boolean;
   terminalId?: string;
   initialProductId?: string;
   initialTab?: any;
   transfers?: StockTransfer[];
   purchaseOrders?: any[];
   suppliers?: Supplier[];
   rooms: Room[];
   onUpdateRooms: (rooms: Room[]) => void;
}

type CatalogViewMode = 'PRODUCTS' | 'TARIFFS' | 'VARIANTS' | 'STOCKS' | 'GROUPS' | 'SEASONS' | 'BI_MONITOR' | 'CLASSIFICATIONS' | 'SPACES';

const CATALOG_DESKTOP_VIEWS: Array<{ id: CatalogViewMode; label: string }> = [
   { id: 'PRODUCTS', label: 'Productos' },
   { id: 'BI_MONITOR', label: 'Monitor BI' },
   { id: 'VARIANTS', label: 'Variantes' },
   { id: 'CLASSIFICATIONS', label: 'Clasificaciones' },
   { id: 'GROUPS', label: 'Grupos' },
   { id: 'SEASONS', label: 'Temporadas' },
   { id: 'STOCKS', label: 'Stocks' },
   { id: 'TARIFFS', label: 'Tarifas' },
];

const hasMeaningfulConfigPayload = (config?: BusinessConfig | null) => {
   if (!config || typeof config !== 'object') return false;
   return Boolean(
      config.currencySymbol
      || config.companyInfo?.name
      || config.companyInfo?.rnc
      || config.terminals?.length
      || config.tariffs?.length
      || config.productGroups?.length
      || config.seasons?.length
   );
};

const pickRicherBusinessConfig = (primary?: BusinessConfig | null, secondary?: BusinessConfig | null): BusinessConfig | null => {
   const left = primary && typeof primary === 'object' ? primary : null;
   const right = secondary && typeof secondary === 'object' ? secondary : null;

   if (left && !right) return left;
   if (right && !left) return right;
   if (!left && !right) return null;

   const score = (config?: BusinessConfig | null) => {
      if (!config) return 0;
      let total = 0;
      if (config.companyInfo?.name) total += 3;
      if (config.companyInfo?.rnc) total += 4;
      if (config.currencySymbol) total += 1;
      if (config.terminals?.length) total += 2;
      if (config.tariffs?.length) total += 2;
      if (config.productGroups?.length) total += 2;
      if (config.seasons?.length) total += 2;
      const fiscal = config.fiscalCompliance;
      if (fiscal?.mode) total += 3;
      if (fiscal?.defaultProvider && fiscal.defaultProvider !== 'NONE') total += 5;
      if (Array.isArray(fiscal?.providers) && fiscal.providers.length > 0) {
         total += fiscal.providers.reduce((acc, provider) => acc + (provider.environment !== undefined ? 1 : 0) + (provider.credentialKey ? 3 : 0), 0);
      }
      return total;
   };

   const leftScore = score(left);
   const rightScore = score(right);
   if (rightScore > leftScore) return right;
   return left;
};

const buildStockSyncMarker = (product?: Partial<Product> | null): string => {
   if (!product) return 'NO_STOCK';

   return Object.entries(product.stockBalances || {})
      .map(([warehouseId, quantity]) => `${warehouseId}:${Number(quantity || 0)}`)
      .sort()
      .join('|') || 'NO_STOCK';
};

const productTimestamp = (product?: Product | null): number => {
   const raw = (product as any)?.updatedAt || (product as any)?.updated_at || (product as any)?.createdAt || (product as any)?.created_at || '';
   const parsed = new Date(raw).getTime();
   return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeCatalogIdentityValue = (value: unknown): string => {
   if (value === null || value === undefined) return '';
   return String(value).trim().toLowerCase();
};

const catalogFieldValues = (product: Product | null | undefined, fields: string[]): string[] => {
   if (!product) return [];
   const record = product as unknown as Record<string, unknown>;
   const values: string[] = [];
   for (const field of fields) {
      const normalized = normalizeCatalogIdentityValue(record[field]);
      if (normalized) values.push(normalized);
   }
   return Array.from(new Set(values));
};

const productImageVersion = (product?: Product | null): number => {
   const raw = (product as any)?.imageVersion || (product as any)?.image_version || '';
   const parsed = Number(String(raw).replace(/[^\d.-]/g, ''));
   return Number.isFinite(parsed) ? parsed : 0;
};

const productPositiveStockWarehouses = (product?: Product | null): number => {
   return Object.values(product?.stockBalances || {})
      .filter((quantity) => Number(quantity || 0) > 0)
      .length;
};

const catalogEditorIdentityKeys = (product?: Product | null): string[] => {
   if (!product) return [];
   const keys = new Set<string>();
   const addKey = (prefix: string, value: unknown) => {
      const normalized = normalizeCatalogIdentityValue(value);
      if (normalized) keys.add(`${prefix}:${normalized}`);
   };

   for (const value of catalogFieldValues(product, [
      'sourceItemId',
      'source_item_id',
      'itemId',
      'item_id',
      'erpProductId',
      'erp_product_id',
      'sourceProductId',
      'source_product_id',
      'productId',
      'product_id',
   ])) {
      addKey('operational', value);
   }

   for (const value of catalogFieldValues(product, [
      'sku',
      'item_code',
      'code',
      'barcode',
      'barcode_2',
      'barcode2',
      'barcode_3',
      'barcode3',
   ])) {
      addKey('commerce', value);
   }

   if (Array.isArray((product as any).barcodes)) {
      for (const barcodeEntry of (product as any).barcodes) {
         if (barcodeEntry && typeof barcodeEntry === 'object' && !Array.isArray(barcodeEntry)) {
            addKey('commerce', (barcodeEntry as any).barcode);
            addKey('commerce', (barcodeEntry as any).code);
            addKey('commerce', (barcodeEntry as any).value);
         } else {
            addKey('commerce', barcodeEntry);
         }
      }
   }

   productReferenceCandidates(product).forEach((value) => addKey('reference', value));
   productIdentityCandidates(product).forEach((value) => addKey('canonical', value));

   const name = normalizeCatalogIdentityValue(product.name);
   const category = normalizeCatalogIdentityValue((product as any).category);
   if (name) addKey('namecat', `${name}::${category}`);

   addKey('id', product.id);

   return Array.from(keys);
};

const productCompletenessScore = (product?: Product | null): number => {
   if (!product) return 0;
   let score = 0;
   if (product.name) score += 4;
   if (product.barcode) score += 2;
   if ((product as any).sku || (product as any).code || (product as any).item_code) score += 2;
   if (resolveProductImageSrc(product)) score += 3;
   if (Array.isArray(product.images) && product.images.length > 0) score += 3;
   if (productImageVersion(product) > 0) score += 1;
   if (Array.isArray(product.tariffs) && product.tariffs.length > 0) score += 3;
   if (Array.isArray(product.variants) && product.variants.length > 0) score += 1;
   score += Object.keys(product.stockBalances || {}).length;
   score += productPositiveStockWarehouses(product);
   return score;
};

const dedupeCatalogProducts = (items: Product[]): Product[] => {
   type CatalogRankEntry = { product: Product; keys: Set<string> };
   const byIdentity = new Map<string, CatalogRankEntry>();

   for (const product of items) {
      const identityKeys = catalogEditorIdentityKeys(product);
      if (identityKeys.length === 0) continue;

      const matchedEntries = Array.from(
         new Set(identityKeys.map((key) => byIdentity.get(key)).filter(Boolean) as CatalogRankEntry[])
      );
      if (matchedEntries.length === 0) {
         const entry = { product, keys: new Set(identityKeys) };
         identityKeys.forEach((key) => byIdentity.set(key, entry));
         continue;
      }

      const existingEntry = matchedEntries
         .sort((left, right) => {
            const scoreDiff = productCompletenessScore(right.product) - productCompletenessScore(left.product);
            if (scoreDiff !== 0) return scoreDiff;
            return productTimestamp(right.product) - productTimestamp(left.product);
         })[0];
      const existing = existingEntry.product;
      const existingScore = productCompletenessScore(existing);
      const incomingScore = productCompletenessScore(product);
      const existingImageVersion = productImageVersion(existing);
      const incomingImageVersion = productImageVersion(product);
      const shouldReplace =
         incomingScore > existingScore
         || (
            incomingScore === existingScore
            && (
               incomingImageVersion > existingImageVersion
               || (incomingImageVersion === existingImageVersion && productTimestamp(product) >= productTimestamp(existing))
            )
         );

      const winner: CatalogRankEntry = shouldReplace
         ? { product, keys: new Set(identityKeys) }
         : existingEntry;
      const mergedKeys = new Set<string>(identityKeys);
      for (const entry of matchedEntries) {
         entry.keys.forEach((key) => mergedKeys.add(key));
      }
      winner.keys = mergedKeys;
      for (const key of mergedKeys) {
         byIdentity.set(key, winner);
      }
   }

   return Array.from(new Set(byIdentity.values())).map((entry) => entry.product);
};

const productBarcodeValues = (product?: Product | null): string[] => {
   if (!product) return [];
   const values: string[] = [];
   const addValue = (value: unknown) => {
      const normalized = normalizeCatalogIdentityValue(value);
      if (normalized) values.push(String(value).trim());
   };

   addValue(product.barcode);
   addValue((product as any).barcode_2);
   addValue((product as any).barcode2);
   addValue((product as any).barcode_3);
   addValue((product as any).barcode3);

   if (Array.isArray((product as any).barcodes)) {
      for (const entry of (product as any).barcodes) {
         if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            addValue((entry as any).barcode);
            addValue((entry as any).code);
            addValue((entry as any).value);
         } else {
            addValue(entry);
         }
      }
   }

   const seen = new Set<string>();
   return values.filter((value) => {
      const key = normalizeCatalogIdentityValue(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
   });
};

const productSkuValues = (product?: Product | null): string[] => {
   if (!product) return [];
   return [
      (product as any).sku,
      (product as any).item_code,
      (product as any).code,
   ]
      .map((value) => (value == null ? '' : String(value).trim()))
      .filter(Boolean);
};

const productStockTotal = (product?: Product | null): number => {
   if (!product?.stockBalances) return Number(product?.stock || 0);
   return Object.values(product.stockBalances).reduce((total, quantity) => total + Number(quantity || 0), 0);
};

// --- SUB-COMPONENT: STOCK ROW ---
const StockRow: React.FC<{ product: Product; warehouseId: string; warehouses: Warehouse[]; productStocks: ProductStock[]; allProducts: Product[] }> = ({ product, warehouseId, warehouses, productStocks, allProducts }) => {
   const [isExpanded, setIsExpanded] = useState(false);
   const hasVariants = product.variants && product.variants.length > 0;

   // Get stock from detailed collection
   const detailedStock = resolveInventoryProductStockRow(product, warehouseId, productStocks, allProducts);
   const sourceStock = getWarehouseScopedNumber(product.stockBalances || {}, warehouseId, warehouses, Number.NaN);
   const warehouseStock = Number.isFinite(sourceStock) ? sourceStock : (detailedStock ? detailedStock.quantity : 0);

   const getStatusBadge = (qty: number) => {
      if (qty > 10) return <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full"><CheckCircle2 size={12} /> Disponible</span>;
      if (qty > 0) return <span className="inline-flex items-center gap-1 text-xs font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded-full"><AlertCircle size={12} /> Bajo Stock</span>;
      return <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 px-2 py-1 rounded-full"><XCircle size={12} /> Agotado</span>;
   };

   const toggleExpand = () => {
      if (hasVariants) setIsExpanded(!isExpanded);
   };

   return (
      <>
         <tr
            onClick={toggleExpand}
            className={`group border-b border-gray-100 transition-colors ${hasVariants ? 'cursor-pointer hover:bg-gray-50' : ''}`}
         >
            <td className="p-4">
               <div className="flex items-center gap-3">
                  <div className={`w-6 flex justify-center text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-90 text-blue-500' : ''}`}>
                     {hasVariants && <ChevronRight size={18} />}
                  </div>

                  <div className="w-10 h-10 rounded-lg bg-gray-100 overflow-hidden border border-gray-200 shrink-0 relative">
                     {resolveProductImageSrc(product) ? <img src={resolveProductImageSrc(product)} className="w-full h-full object-cover" /> : <ImageIcon className="m-2 text-gray-300" />}
                     {hasVariants && (
                        <div className="absolute bottom-0 right-0 bg-blue-500 text-white p-0.5 rounded-tl-md">
                           <Layers size={8} />
                        </div>
                     )}
                  </div>
                  <div>
                     <p className="font-bold text-gray-800 text-sm line-clamp-1">{product.name}</p>
                     <p className="text-xs text-gray-400 font-mono">{product.barcode || '---'}</p>
                  </div>
               </div>
            </td>
            <td className="p-4">
               {hasVariants ? (
                  <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100">
                     {product.variants.length} Variantes
                  </span>
               ) : (
                  <span className="text-xs text-gray-400 italic">N/A</span>
               )}
            </td>
            <td className="p-4 text-center font-mono font-bold text-gray-700 text-sm">
               {warehouseStock}
            </td>
            <td className="p-4 text-right">
               {getStatusBadge(warehouseStock)}
            </td>
         </tr>
         {hasVariants && isExpanded && product.variants.map((variant, idx) => (
            <tr key={`${product.id}-var-${idx}`} className="bg-slate-50/80 border-b border-gray-100 animate-in slide-in-from-top-1">
               <td className="p-3 pl-16">
                  <div className="flex items-center gap-2 relative">
                     <div className="absolute -left-6 top-1/2 w-4 h-px bg-gray-300"></div>
                     <div className="absolute -left-6 -top-1/2 bottom-1/2 w-px bg-gray-300"></div>
                     <span className="font-mono text-xs text-gray-500 bg-white px-1.5 py-0.5 rounded border border-gray-200">
                        {variant.sku}
                     </span>
                  </div>
               </td>
               <td className="p-3">
                  <div className="flex gap-1 flex-wrap">
                     {Object.entries(variant.attributeValues).map(([k, v]) => (
                        <span key={k} className="text-xs text-gray-600">
                           <span className="font-bold text-gray-400">{k}:</span> {v}
                        </span>
                     ))}
                  </div>
               </td>
               <td className="p-3 text-center text-sm font-medium text-gray-600">-</td>
               <td className="p-3 text-right">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-gray-500 bg-gray-200`}>Ver Global</span>
               </td>
            </tr>
         ))}
      </>
   );
};

// --- WAREHOUSE CARD CONTAINER ---
const WarehouseStockCard: React.FC<{ warehouse: Warehouse; filteredProducts: Product[]; productStocks: ProductStock[]; allProducts: Product[] }> = ({ warehouse, filteredProducts, productStocks, allProducts }) => {
   const [isCardExpanded, setIsCardExpanded] = useState(false);
   const warehouseProducts = filteredProducts.filter(p => isProductWarehouseActive(p, warehouse.id, [warehouse]));

   const totalValue = warehouseProducts.reduce((acc, p) => {
      const detailedStock = resolveInventoryProductStockRow(p, warehouse.id, productStocks, allProducts);
      const sourceStock = getWarehouseScopedNumber(p.stockBalances || {}, warehouse.id, [warehouse], Number.NaN);
      const qty = Number.isFinite(sourceStock) ? sourceStock : (detailedStock ? detailedStock.quantity : 0);
      return acc + (qty * (p.cost || 0));
   }, 0);
   const itemCount = warehouseProducts.length;

   return (
      <div className={`bg-white rounded-2xl border transition-all overflow-hidden ${isCardExpanded ? 'shadow-lg border-emerald-300 ring-1 ring-emerald-100' : 'shadow-sm border-gray-200 hover:border-emerald-200'} ${!warehouse.allowPosSale ? 'opacity-70 border-dashed bg-gray-50' : ''}`}>
         <div className="p-6 flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
            <div className="flex items-center gap-4">
               <div className={`p-4 rounded-2xl ${warehouse.allowPosSale ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-200 text-gray-400'}`}>
                  <Box size={24} />
               </div>
               <div>
                  <div className="flex items-center gap-2">
                     <h3 className="font-bold text-lg text-gray-800">{warehouse.name}</h3>
                     {!warehouse.allowPosSale && <span className="text-[10px] font-bold bg-gray-200 text-gray-500 px-2 py-0.5 rounded">VENTA DESACTIVADA</span>}
                  </div>
                  <p className="text-sm text-gray-500 flex items-center gap-1 mt-1"><MapPin size={12} /> {warehouse.address}</p>
               </div>
            </div>
            <div className="flex items-center gap-8 w-full md:w-auto justify-between md:justify-end">
               <div className="text-right">
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Valorizado</p>
                  <p className="text-lg font-black text-gray-800">${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
               </div>
               <div className="text-right">
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Artículos</p>
                  <p className="text-lg font-black text-gray-800">{itemCount}</p>
               </div>
               <button onClick={() => setIsCardExpanded(!isCardExpanded)} className={`p-2 rounded-full border transition-colors ${isCardExpanded ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-white text-gray-400 border-gray-200 hover:bg-gray-50'}`}>
                  <ChevronDown size={20} className={isCardExpanded ? 'rotate-180 transition-transform' : ''} />
               </button>
            </div>
         </div>
         {isCardExpanded && (
            <div className="border-t border-gray-100 bg-gray-50/30 p-6 animate-in slide-in-from-top-2 duration-200">
               <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                  <table className="w-full text-left text-sm">
                     <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-bold text-xs uppercase">
                        <tr><th className="p-4 w-[40%]">Artículo</th><th className="p-4">Variante / Atributo</th><th className="p-4 text-center">Stock Físico</th><th className="p-4 text-right">Estado</th></tr>
                     </thead>
                     <tbody className="divide-y divide-gray-100">
                        {warehouseProducts.map(product => <StockRow key={product.id} product={product} warehouseId={warehouse.id} warehouses={[warehouse]} productStocks={productStocks} allProducts={allProducts} />)}
                     </tbody>
                  </table>
               </div>
            </div>
         )}
      </div>
   );
};

// --- MAIN CATALOG COMPONENT ---
const CatalogManager: React.FC<CatalogManagerProps> = ({
   products: productsProp, config: configProp, warehouses, transactions, currentUser, roles, onUpdateProducts, onUpdateConfig,
   onClose,
   isAdminMode,
   terminalId,
   initialProductId,
   initialTab,
   transfers = [],
   purchaseOrders = [],
   suppliers = []
}) => {
   const resolveViewportWidth = () => (typeof window !== 'undefined' ? window.innerWidth : 1440);

   const [catalogProducts, setCatalogProducts] = useState<Product[]>(productsProp || []);
   const [catalogConfig, setCatalogConfig] = useState<BusinessConfig>(configProp);
   const [catalogWarehouses, setCatalogWarehouses] = useState<Warehouse[]>(Array.isArray(warehouses) ? warehouses : []);
   const [catalogTransactions, setCatalogTransactions] = useState<Transaction[]>(Array.isArray(transactions) ? transactions : []);
   const [viewMode, setViewMode] = useState<CatalogViewMode>('PRODUCTS');
   const [searchTerm, setSearchTerm] = useState('');
   const [categoryFilter, setCategoryFilter] = useState('ALL');
   const [editingProduct, setEditingProduct] = useState<Product | null | 'NEW'>(null);
   const [productStocks, setProductStocks] = useState<ProductStock[]>([]);
   const [viewportWidth, setViewportWidth] = useState(resolveViewportWidth());
   const consumedInitialProductIdRef = useRef<string | null>(null);

   // SELECTION & BULK STATE
   const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
   const [showBulkModal, setShowBulkModal] = useState(false);

   // Watchlists State
   const [watchlists, setWatchlists] = useState<Watchlist[]>([]);

   const products = useMemo(() => {
      const localProducts = Array.isArray(catalogProducts)
         ? catalogProducts.filter((entry): entry is Product => Boolean(entry && typeof entry === 'object' && (entry as any).id))
         : [];
      const propProducts = Array.isArray(productsProp)
         ? productsProp.filter((entry): entry is Product => Boolean(entry && typeof entry === 'object' && (entry as any).id))
         : [];
      return dedupeCatalogProducts(localProducts.length > 0 ? localProducts : propProducts);
   }, [catalogProducts, productsProp]);
   const config = useMemo(
      () => pickRicherBusinessConfig(catalogConfig, configProp) || catalogConfig || configProp,
      [catalogConfig, configProp]
   );
   const runtimeWarehouses = useMemo(() => {
      const localWarehouses = Array.isArray(catalogWarehouses)
         ? catalogWarehouses.filter((entry): entry is Warehouse => Boolean(entry && typeof entry === 'object' && (entry as any).id))
         : [];
      const propWarehouses = Array.isArray(warehouses)
         ? warehouses.filter((entry): entry is Warehouse => Boolean(entry && typeof entry === 'object' && (entry as any).id))
         : [];
      return localWarehouses.length > 0 ? localWarehouses : propWarehouses;
   }, [catalogWarehouses, warehouses]);
   const runtimeTransactions = useMemo(() => {
      const localTransactions = Array.isArray(catalogTransactions)
         ? catalogTransactions.filter((entry): entry is Transaction => Boolean(entry && typeof entry === 'object' && (entry as any).id))
         : [];
      const propTransactions = Array.isArray(transactions)
         ? transactions.filter((entry): entry is Transaction => Boolean(entry && typeof entry === 'object' && (entry as any).id))
         : [];
      return localTransactions.length > 0 ? localTransactions : propTransactions;
   }, [catalogTransactions, transactions]);

   const hasPermission = (permission: string): boolean => {
      if (!currentUser) return false;
      const userRole = roles.find(r => r.id === currentUser.role);
      if (!userRole) return false;
      if (userRole.permissions.includes('ALL')) return true;
      return userRole.permissions.includes(permission);
   };

   const canManage = hasPermission('CATALOG_MANAGE');
   const isTablet = viewportWidth >= 1024 && viewportWidth < 1280;
   const isDesktop = viewportWidth >= 1280;
   const isLargeCatalogLayout = isTablet || isDesktop;

   useEffect(() => {
      setCatalogProducts((previous) => {
         const incoming = Array.isArray(productsProp) ? productsProp : [];
         if (incoming.length === 0 && previous.length > 0) return previous;
         return dedupeCatalogProducts(incoming.filter((entry): entry is Product => Boolean(entry && typeof entry === 'object' && (entry as any).id)));
      });
   }, [productsProp]);

   useEffect(() => {
      setCatalogConfig((previous) => {
         const incoming = configProp;
         return pickRicherBusinessConfig(previous, incoming) || previous || incoming;
      });
   }, [configProp]);

   useEffect(() => {
      setCatalogWarehouses((previous) => {
         const incoming = Array.isArray(warehouses) ? warehouses : [];
         if (incoming.length === 0 && previous.length > 0) return previous;
         return incoming;
      });
   }, [warehouses]);

   useEffect(() => {
      setCatalogTransactions((previous) => {
         const incoming = Array.isArray(transactions) ? transactions : [];
         if (incoming.length === 0 && previous.length > 0) return previous;
         return incoming;
      });
   }, [transactions]);

   useEffect(() => {
      if (!editingProduct || editingProduct === 'NEW') return;

      const refreshedProduct = products.find((product) =>
         productIdMatchesInventoryReference(product, editingProduct, products)
      );
      if (!refreshedProduct) return;

      const currentMarker = `${editingProduct.id || 'NO_ID'}::${editingProduct.updatedAt || (editingProduct as any).createdAt || 'NO_TS'}::${buildStockSyncMarker(editingProduct)}`;
      const nextMarker = `${refreshedProduct.id || 'NO_ID'}::${refreshedProduct.updatedAt || (refreshedProduct as any).createdAt || 'NO_TS'}::${buildStockSyncMarker(refreshedProduct)}`;
      if (currentMarker !== nextMarker) {
         setEditingProduct(refreshedProduct);
      }
   }, [editingProduct, products]);

   useEffect(() => {
      const handleResize = () => {
         setViewportWidth(resolveViewportWidth());
      };
      window.addEventListener('resize', handleResize);

      const loadWatchlists = async () => {
         const lists = (await db.get('watchlists') || []) as Watchlist[];
         setWatchlists((Array.isArray(lists) ? lists.filter((entry): entry is Watchlist => Boolean(entry && typeof entry === 'object' && (entry as any).id)) : []));
      };
      const loadCatalogRuntime = async () => {
         const [rawProducts, rawConfig, rawWarehouses, rawTransactions] = await Promise.all([
            db.get('products'),
            db.get('config'),
            db.get('warehouses'),
            db.get('transactions'),
         ]);

         const storedProducts = (Array.isArray(rawProducts) ? rawProducts : []) as Product[];
         if (storedProducts.length > 0) {
            setCatalogProducts(dedupeCatalogProducts(storedProducts));
         }

         const storedConfig = Array.isArray(rawConfig)
            ? (rawConfig.find((entry: any) => entry?.id === 'current') || rawConfig[0] || null)
            : rawConfig;

         if (storedConfig && typeof storedConfig === 'object') {
            setCatalogConfig((previous) => pickRicherBusinessConfig(previous, storedConfig as BusinessConfig) || previous || (storedConfig as BusinessConfig));
         }

         if (Array.isArray(rawWarehouses)) {
            setCatalogWarehouses(rawWarehouses as Warehouse[]);
         }

         if (Array.isArray(rawTransactions)) {
            setCatalogTransactions(rawTransactions as Transaction[]);
         }
      };
      loadWatchlists();
      loadCatalogRuntime().catch((error) => console.warn('[CatalogManager] loadCatalogRuntime', error));

      const handleConfigUpdate = async () => {
         const rawConfig = await db.get('config');
         const storedConfig = Array.isArray(rawConfig)
            ? (rawConfig.find((entry: any) => entry?.id === 'current') || rawConfig[0] || null)
            : rawConfig;
         if (storedConfig && typeof storedConfig === 'object') {
            setCatalogConfig((previous) => pickRicherBusinessConfig(previous, storedConfig as BusinessConfig) || previous || (storedConfig as BusinessConfig));
         }
      };
      const handleProductsUpdate = async () => {
         const rawProducts = await db.get('products');
         setCatalogProducts((previous) => {
            const nextProducts = (Array.isArray(rawProducts) ? rawProducts : []) as Product[];
            if (nextProducts.length === 0 && previous.length > 0) return previous;
            return dedupeCatalogProducts(nextProducts);
         });
      };
      const handleTransactionsUpdate = async () => {
         const rawTransactions = await db.get('transactions');
         setCatalogTransactions((previous) => {
            const nextTransactions = (Array.isArray(rawTransactions) ? rawTransactions : []) as Transaction[];
            if (nextTransactions.length === 0 && previous.length > 0) return previous;
            return nextTransactions;
         });
      };
      window.addEventListener('configUpdated', handleConfigUpdate as EventListener);
      window.addEventListener('productsUpdated', handleProductsUpdate as EventListener);
      window.addEventListener('transactionsUpdated', handleTransactionsUpdate as EventListener);

      return () => {
         window.removeEventListener('resize', handleResize);
         window.removeEventListener('configUpdated', handleConfigUpdate as EventListener);
         window.removeEventListener('productsUpdated', handleProductsUpdate as EventListener);
         window.removeEventListener('transactionsUpdated', handleTransactionsUpdate as EventListener);
      };
   }, [products]);

   useEffect(() => {
      if (viewMode !== 'STOCKS') return;

      const loadStocks = async () => {
         const stocks = (await db.get('productStocks') || []) as ProductStock[];
         setProductStocks(stocks);
      };

      const handleStockUpdate = async () => {
         const stocks = (await db.get('productStocks') || []) as ProductStock[];
         setProductStocks(stocks);
      };

      loadStocks();
      window.addEventListener('productStocksUpdated', handleStockUpdate);

      return () => {
         window.removeEventListener('productStocksUpdated', handleStockUpdate);
      };
   }, [viewMode]);

   useEffect(() => {
      if (!initialProductId) {
         consumedInitialProductIdRef.current = null;
         return;
      }

      if (consumedInitialProductIdRef.current === initialProductId) {
         return;
      }

      const prod = products.find((entry) => entry.id === initialProductId);
      if (!prod) return;

      consumedInitialProductIdRef.current = initialProductId;
      setEditingProduct(prod);
   }, [initialProductId, products]);

   const tariffs = useMemo(
      () => (Array.isArray(config?.tariffs) ? config.tariffs.filter((entry): entry is Tariff => Boolean(entry && typeof entry === 'object' && (entry as any).id)) : []),
      [config]
   );
   const currentProductGroups = useMemo(
      () => (Array.isArray(config?.productGroups) ? config.productGroups.filter((entry): entry is ProductGroup => Boolean(entry && typeof entry === 'object' && (entry as any).id)) : []),
      [config]
   );
   const currentSeasons = useMemo(
      () => (Array.isArray(config?.seasons) ? config.seasons.filter((entry): entry is Season => Boolean(entry && typeof entry === 'object' && (entry as any).id)) : []),
      [config]
   );
   const [editingTariff, setEditingTariff] = useState<Tariff | null | 'NEW'>(null);
   const [editingGroup, setEditingGroup] = useState<ProductGroup | null | 'NEW'>(null);
   const [editingSeason, setEditingSeason] = useState<Season | null | 'NEW'>(null);

   const categories = useMemo(
      () => ['ALL', ...Array.from(new Set(products.map((p) => p?.category || 'Sin categoría').filter(Boolean)))],
      [products]
   );
   const filteredProducts = useMemo(() => {
      return products.filter(p => {
         const normalizedSearch = searchTerm.trim().toLowerCase();
         const searchableText = [
            p.name,
            p.category,
            ...productBarcodeValues(p),
            ...productSkuValues(p),
         ]
            .map((value) => String(value || '').trim().toLowerCase())
            .filter(Boolean)
            .join(' ');
         const normalizedCategory = typeof p.category === 'string' ? p.category : 'Sin categoría';
         const matchesSearch = !normalizedSearch || searchableText.includes(normalizedSearch);
         const matchesCategory = categoryFilter === 'ALL' || normalizedCategory === categoryFilter;
         return matchesSearch && matchesCategory;
      });
   }, [products, searchTerm, categoryFilter]);

   const emptyStateByView: Record<'PRODUCTS' | 'BI_MONITOR' | 'STOCKS' | 'TARIFFS' | 'GROUPS' | 'SEASONS', { title: string; description: string }> = {
      PRODUCTS: {
         title: 'Todavía no hay artículos visibles.',
         description: 'Seguimos mostrando el buscador, las categorías y el acceso de creación para que esta vista no quede en blanco.',
      },
      BI_MONITOR: {
         title: 'Aún no hay tableros BI.',
         description: 'Crea una lista de seguimiento para empezar a monitorear rotación, dormancia y cobertura.',
      },
      STOCKS: {
         title: 'No hay almacenes cargados.',
         description: 'Cuando la terminal tenga almacenes sincronizados, aquí verás existencias y valorización.',
      },
      TARIFFS: {
         title: 'No hay tarifas disponibles.',
         description: 'Puedes crear una lista nueva o esperar el próximo refresh del snapshot de terminal.',
      },
      GROUPS: {
         title: 'No hay grupos configurados.',
         description: 'Los grupos sirven para promociones, filtros y edición por conjunto.',
      },
      SEASONS: {
         title: 'No hay temporadas configuradas.',
         description: 'Las temporadas permiten reglas comerciales y cálculo de demanda por calendario.',
      },
   };

   const renderEmptyState = (mode: keyof typeof emptyStateByView) => (
      <div className="rounded-[2.5rem] border border-dashed border-gray-200 bg-gray-50/70 px-8 py-10 text-center">
         <h3 className="text-2xl font-black text-gray-800 mb-3">{emptyStateByView[mode].title}</h3>
         <p className="text-base font-medium text-gray-500 max-w-2xl mx-auto">{emptyStateByView[mode].description}</p>
      </div>
   );

   const toggleSelection = (id: string) => {
      const newSet = new Set(selectedIds);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      setSelectedIds(newSet);
   };

   const toggleAllSelection = () => {
      if (selectedIds.size === filteredProducts.length) {
         setSelectedIds(new Set());
      } else {
         setSelectedIds(new Set(filteredProducts.map(p => p.id)));
      }
   };

   const handleBulkUpdate = async (changes: any) => {
      setShowBulkModal(false);

      try {
         const touchedIds = Array.from(selectedIds);
         // Call persistent bulk API instead of local state mutation
         await db.bulkUpdateProducts(
            touchedIds,
            changes,
            currentUser?.id,
            currentUser?.name
         );

         // Force refresh from database to ensure UI is in sync with server/IndexedDB
         const refreshedProducts = await db.get('products') as Product[];
         setCatalogProducts(refreshedProducts || products);
         onUpdateProducts(refreshedProducts);

         for (const id of touchedIds) {
            const doc = refreshedProducts.find((p) => p.id === id);
            if (doc) {
               syncManager.broadcastChange('products', doc, 'UPDATE').catch((err) =>
                  console.warn('[CatalogManager] broadcastChange products', err)
               );
            }
         }

         setSelectedIds(new Set());

         setTimeout(() => {
            alert("Operación masiva completada con éxito.");
         }, 200);
      } catch (error: any) {
         console.error('❌ CatalogManager: Bulk update failed', error);
         alert(`Error al procesar la actualización masiva: ${error.message || 'Error desconocido'}`);
      }
   };

   const handleUpdateWatchlists = async (newLists: Watchlist[]) => {
      setWatchlists(newLists);
      await db.save('watchlists', newLists);
   };

   const handleBulkRecalculate = async (season: Season) => {
      if (!confirm(`¿Recalcular niveles mínimos y máximos para los ${season.productIds.length} productos de "${season.name}"?`)) return;

      const updatedProducts = [...products];
      let updatedCount = 0;

      for (const p of updatedProducts) {
         // Check if product is in season OR in affected category
         const isProductInSeason = season.productIds.includes(p.id);
         const isCategoryAffected = season.affectedCategories?.includes(p.category);

         if (isProductInSeason || isCategoryAffected) {
            try {
               const baselineWhId = runtimeWarehouses[0]?.id || 'wh_central';
               const calc = await calculateOptimalInventoryLevels(p, baselineWhId, config.seasons || [], suppliers);
               p.minStock = calc.suggestedMin;
               // We also update warehouse-specific mins if they exist
               // For simplicity in bulk, we just set the global minStock which the system uses as default
               updatedCount++;
            } catch (err) {
               console.error(`Error calculating for ${p.id}`, err);
            }
         }
      }

      onUpdateProducts(updatedProducts);
      alert(`¡Listo! Se actualizaron ${updatedCount} productos.`);
   };

   if (viewMode === 'VARIANTS') return <VariantManager onClose={() => setViewMode('PRODUCTS')} />;
   if (editingProduct) return <ProductForm key={editingProduct === 'NEW' ? 'NEW' : editingProduct.id} initialData={editingProduct === 'NEW' ? null : editingProduct} config={config} warehouses={runtimeWarehouses} availableTariffs={tariffs} hasHistory={runtimeTransactions?.some(t => t.items?.some(item => item.id === (editingProduct as any).id)) ?? false} currentUser={currentUser} roles={roles} onSave={handleSaveProduct} onClose={() => setEditingProduct(null)} transfers={transfers} purchaseOrders={purchaseOrders} suppliers={suppliers} seasons={config.seasons || []} initialTab={initialTab} allProducts={products} />
   if (editingTariff) return <TariffForm initialData={editingTariff === 'NEW' ? null : editingTariff} products={products} config={config} availableTariffs={tariffs} onSave={handleSaveTariff} onUpdateProducts={onUpdateProducts} onClose={() => setEditingTariff(null)} />;
   if (editingGroup) return <GroupForm initialData={editingGroup === 'NEW' ? null : editingGroup} products={products} onSave={handleSaveGroup} onClose={() => setEditingGroup(null)} />;
   if (editingSeason) return <SeasonForm initialData={editingSeason === 'NEW' ? null : editingSeason} products={products} onSave={handleSaveSeason} onClose={() => setEditingSeason(null)} />;
   if (viewMode === 'CLASSIFICATIONS') return <ClassificationManager config={config} onUpdateConfig={onUpdateConfig} onClose={() => setViewMode('PRODUCTS')} />;

   async function handleSaveProduct(savedProduct: Product) {
      try {
         const oldProduct = products.find(p => p.id === savedProduct.id);
         const exists = !!oldProduct;

         // 1. Persist ONLY the modified product
         await db.saveDocument('products', savedProduct);

         // Update local state for UI
         const currentProducts = products;
         let updatedProductsList;
         if (exists) {
            updatedProductsList = currentProducts.map(p => p.id === savedProduct.id ? { ...p, ...savedProduct } : p);
         } else {
            updatedProductsList = [...currentProducts, savedProduct];
         }

         // Detect stock changes and record movements
         if (exists) {
            const whIds = Array.from(new Set([
               ...Object.keys(oldProduct.stockBalances || {}),
               ...Object.keys(savedProduct.stockBalances || {})
            ]));

            for (const whId of whIds) {
               const oldQty = oldProduct.stockBalances?.[whId] || 0;
               const newQty = savedProduct.stockBalances?.[whId] || 0;
               if (oldQty !== newQty) {
                  const diff = newQty - oldQty;
                  await db.recordInventoryMovement(
                     whId,
                     savedProduct.id,
                     diff > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA',
                     'AJUSTE MANUAL',
                     diff,
                     savedProduct.cost,
                     terminalId || 'LOCAL'
                  );
               }
            }

            // Reload from DB to get the correct stock values after movement recording (which updates products again)
            const freshProducts = await db.get('products') as Product[];
            setCatalogProducts(freshProducts || products);
            onUpdateProducts(freshProducts || products);
         } else {
            // New product with initial stock
            for (const [whId, qty] of Object.entries(savedProduct.stockBalances || {})) {
               if (qty !== 0) {
                  await db.recordInventoryMovement(
                     whId,
                     savedProduct.id,
                     'INICIAL',
                     'CARGA INICIAL',
                     qty as number,
                     savedProduct.cost,
                     terminalId || 'LOCAL'
                  );
               }
            }

            // For new products, reload to get accurate stock after movement recording
            const freshProducts = await db.get('products') as Product[];
            setCatalogProducts(freshProducts || products);
            onUpdateProducts(freshProducts || products);
         }
         setEditingProduct(null);

         // Broadcast change to other terminals (if master)
         syncManager.broadcastChange('products', savedProduct, exists ? 'UPDATE' : 'CREATE').catch(console.error);
      } catch (error) {
         console.error('❌ CatalogManager: Error saving product', error);
         alert('No se pudo guardar el producto. Revise la consola para más detalle.');
      }
   }

   async function handleDeleteProduct(product: Product) {
      if (!canManage || !product?.id) return;
      const label = product.name || product.id;
      if (!confirm(`¿Eliminar el artículo "${label}" del catálogo local?`)) return;

      try {
         await db.deleteDocument('products' as any, product.id);
         const updatedProductsList = products.filter((entry) => entry.id !== product.id);
         setCatalogProducts(updatedProductsList);
         onUpdateProducts(updatedProductsList);
         setSelectedIds((previous) => {
            const next = new Set(previous);
            next.delete(product.id);
            return next;
         });
         syncManager.broadcastChange('products', product, 'DELETE').catch((error) =>
            console.warn('[CatalogManager] broadcast delete products', error)
         );
      } catch (error) {
         console.error('❌ CatalogManager: Error deleting product', error);
         alert('No se pudo eliminar el producto. Revise la consola para más detalle.');
      }
   }

   function handleSaveTariff(savedTariff: Tariff) {
      const exists = tariffs.some(t => t.id === savedTariff.id);
      const nextConfig = { ...config, tariffs: exists ? tariffs.map(t => t.id === savedTariff.id ? savedTariff : t) : [...tariffs, savedTariff] };
      setCatalogConfig(nextConfig);
      onUpdateConfig(nextConfig);
      setEditingTariff(null);
   }

   function handleSaveGroup(savedGroup: ProductGroup) {
      const exists = currentProductGroups.some(g => g.id === savedGroup.id);
      const nextConfig = { ...config, productGroups: exists ? currentProductGroups.map(g => g.id === savedGroup.id ? savedGroup : g) : [...currentProductGroups, savedGroup] };
      setCatalogConfig(nextConfig);
      onUpdateConfig(nextConfig);
      setEditingGroup(null);
   }

   function handleSaveSeason(savedSeason: Season) {
      const exists = currentSeasons.some(s => s.id === savedSeason.id);
      const nextConfig = { ...config, seasons: exists ? currentSeasons.map(s => s.id === savedSeason.id ? savedSeason : s) : [...currentSeasons, savedSeason] };
      setCatalogConfig(nextConfig);
      onUpdateConfig(nextConfig);
      setEditingSeason(null);
   }

   function handleDeleteGroup(groupId: string) {
      const group = currentProductGroups.find((entry) => entry.id === groupId);
      if (!group) return;
      if (!confirm(`¿Eliminar el grupo "${group.name}"?`)) return;
      const nextConfig = {
         ...config,
         productGroups: currentProductGroups.filter((entry) => entry.id !== groupId),
      };
      setCatalogConfig(nextConfig);
      onUpdateConfig(nextConfig);
   }

   function handleDeleteSeason(seasonId: string) {
      const season = currentSeasons.find((entry) => entry.id === seasonId);
      if (!season) return;
      if (!confirm(`¿Eliminar la temporada "${season.name}"?`)) return;
      const nextConfig = {
         ...config,
         seasons: currentSeasons.filter((entry) => entry.id !== seasonId),
      };
      setCatalogConfig(nextConfig);
      onUpdateConfig(nextConfig);
   }

   return (
      <div className={`responsive-shell flex min-h-0 h-full bg-white animate-in fade-in slide-in-from-right-10 duration-300 relative ${isTablet ? 'flex-row' : 'flex-col'}`}>

         {/* SIDEBAR - Tablet Only */}
         {isTablet && (
            <div className="w-[300px] bg-[#f2f4f7] border-r border-gray-100 flex flex-col p-8 shrink-0 h-full">
               <div className="flex items-center gap-4 mb-16">
                  <div className="p-3 bg-blue-600 rounded-2xl text-white shadow-lg shadow-blue-200">
                     <Package size={24} strokeWidth={2.5} />
                  </div>
                  <div>
                     <h2 className="text-xl font-black text-gray-900 leading-[1.1] tracking-tight">Archivo <br/> de Catálogo</h2>
                  </div>
               </div>

               <nav className="flex-1 space-y-3">
                  <SidebarItem label="Productos" icon={<Package size={22} />} active={viewMode === 'PRODUCTS'} onClick={() => setViewMode('PRODUCTS')} />
                  <SidebarItem label="Monitor BI" icon={<Activity size={22} />} active={viewMode === 'BI_MONITOR'} onClick={() => setViewMode('BI_MONITOR')} />
                  {canManage && <SidebarItem label="Variantes" icon={<Layers size={22} />} active={(viewMode as string) === 'VARIANTS'} onClick={() => setViewMode('VARIANTS')} />}
                  <SidebarItem label="Clasificaciones" icon={<Grid size={22} />} active={(viewMode as string) === 'CLASSIFICATIONS'} onClick={() => setViewMode('CLASSIFICATIONS')} />
                  <SidebarItem label="Grupos" icon={<Grid size={22} />} active={viewMode === 'GROUPS'} onClick={() => setViewMode('GROUPS')} />
                  <SidebarItem label="Temporadas" icon={<Sun size={22} />} active={viewMode === 'SEASONS'} onClick={() => setViewMode('SEASONS')} />
                  <SidebarItem label="Stocks" icon={<ClipboardList size={22} />} active={viewMode === 'STOCKS'} onClick={() => setViewMode('STOCKS')} />
                  <SidebarItem label="Tarifas" icon={<Tag size={22} />} active={viewMode === 'TARIFFS'} onClick={() => setViewMode('TARIFFS')} />
               </nav>

               <div className="mt-auto pt-8 border-t border-gray-200">
                  <div className="bg-white rounded-[2rem] p-6 shadow-xl shadow-gray-200/50 border border-gray-100">
                     <div className="flex justify-between items-center mb-3">
                        <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest leading-none">Estado del Sistema</span>
                     </div>
                     <div className="w-full bg-[#f2f4f7] h-2.5 rounded-full overflow-hidden mb-3">
                        <div className="bg-blue-600 h-full w-[85%] rounded-full shadow-[0_0_8px_rgba(37,99,235,0.4)]"></div>
                     </div>
                     <p className="text-[11px] text-gray-400 font-bold">Sincronizado hace 2 min</p>
                  </div>
               </div>

               <button
                  onClick={onClose}
                  className="mt-8 flex items-center justify-center gap-3 w-full py-4 bg-white hover:bg-gray-100 border border-gray-200 rounded-2xl text-gray-700 font-black transition-all active:scale-95 shadow-sm"
               >
                  <ArrowLeft size={20} strokeWidth={3} /> Salir
               </button>
            </div>
         )}

         <div className="flex-1 h-full min-h-0 min-w-0 flex flex-col overflow-hidden">
            {/* TOP BAR / Header */}
            {!isLargeCatalogLayout ? (
               <div className="bg-white px-4 pt-4 pb-0 border-b border-gray-200 shrink-0">
                  <div className="flex flex-col gap-4 w-full">
                     <div className="flex justify-between items-center w-full">
                        <div className="flex items-center gap-3">
                           <button onClick={onClose} className="p-2 bg-gray-100 rounded-full text-gray-600"><ArrowLeft size={20} /></button>
                           <h1 className="text-xl font-black text-gray-800">Catálogo</h1>
                        </div>
                     </div>
                     <div className="mobile-tab-scroller no-scrollbar -mx-4 px-4 overflow-x-auto whitespace-nowrap bg-white">
                        <div className="inline-flex items-center gap-2 min-w-max pb-1">
                           <button onClick={() => setViewMode('PRODUCTS')} className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-bold rounded-t-2xl border-b-4 transition-colors ${viewMode === 'PRODUCTS' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-400 bg-white'}`}>Productos</button>
                           <button onClick={() => setViewMode('BI_MONITOR')} className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-bold rounded-t-2xl border-b-4 transition-colors ${viewMode === 'BI_MONITOR' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-400 bg-white'}`}>Monitor</button>
                           {canManage && <button onClick={() => setViewMode('VARIANTS')} className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-bold rounded-t-2xl border-b-4 transition-colors ${(viewMode as string) === 'VARIANTS' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-400 bg-white'}`}>Variantes</button>}
                           <button onClick={() => setViewMode('CLASSIFICATIONS')} className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-bold rounded-t-2xl border-b-4 transition-colors ${(viewMode as string) === 'CLASSIFICATIONS' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-400 bg-white'}`}>Clasificaciones</button>
                           <button onClick={() => setViewMode('GROUPS')} className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-bold rounded-t-2xl border-b-4 transition-colors ${viewMode === 'GROUPS' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-400 bg-white'}`}>Grupos</button>
                           <button onClick={() => setViewMode('SEASONS')} className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-bold rounded-t-2xl border-b-4 transition-colors ${viewMode === 'SEASONS' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-400 bg-white'}`}>Temporadas</button>
                           <button onClick={() => setViewMode('STOCKS')} className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-bold rounded-t-2xl border-b-4 transition-colors ${viewMode === 'STOCKS' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-400 bg-white'}`}>Stocks</button>
                           <button onClick={() => setViewMode('TARIFFS')} className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-bold rounded-t-2xl border-b-4 transition-colors ${viewMode === 'TARIFFS' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-400 bg-white'}`}>Tarifas</button>
                        </div>
                     </div>
                  </div>
               </div>
            ) : isTablet ? (
               <div className="bg-white p-8 border-b border-gray-100 flex items-center justify-between gap-8 shrink-0">
                  <div className="flex items-center gap-4 flex-1 max-w-2xl">
                     <button
                        onClick={onClose}
                        className="h-16 px-6 bg-white border border-gray-200 text-gray-700 rounded-[1.75rem] font-black shadow-sm hover:bg-gray-50 transition-all flex items-center gap-3 shrink-0"
                     >
                        <ArrowLeft size={22} strokeWidth={2.8} /> Salir
                     </button>
                     <div className="flex-1 relative shadow-2xl shadow-gray-100">
                        <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400" size={24} />
                        <input
                           type="text"
                           placeholder="Buscar en catálogo..."
                           value={searchTerm}
                           onChange={(e) => setSearchTerm(e.target.value)}
                           className="w-full pl-16 pr-6 py-5 bg-[#f2f4f7] border-none rounded-3xl outline-none focus:ring-4 focus:ring-blue-500/10 transition-all font-bold text-lg text-gray-700 placeholder:text-gray-300"
                        />
                     </div>
                  </div>
                  {canManage && (
                     <button
                        onClick={() => {
                           if (viewMode === 'PRODUCTS') setEditingProduct('NEW');
                           else if (viewMode === 'TARIFFS') setEditingTariff('NEW');
                           else if (viewMode === 'GROUPS') setEditingGroup('NEW');
                           else if (viewMode === 'SEASONS') setEditingSeason('NEW');
                        }}
                        className="px-8 py-5 bg-blue-600 text-white rounded-[2rem] font-black text-lg shadow-[0_20px_40px_rgba(37,99,235,0.25)] hover:shadow-[0_25px_50px_rgba(37,99,235,0.35)] hover:-translate-y-1 active:translate-y-0.5 active:scale-95 transition-all flex items-center gap-3 group"
                     >
                        <Plus size={28} strokeWidth={4} className="group-hover:rotate-90 transition-transform duration-300" /> Nuevo Artículo
                     </button>
                  )}
               </div>
            ) : (
               <div className="bg-white border-b border-gray-100 shrink-0">
                  <div className="px-8 py-6 flex items-center gap-4">
                     <button
                        onClick={onClose}
                        className="h-16 px-6 shrink-0 bg-white border border-gray-200 text-gray-700 rounded-2xl font-black shadow-sm hover:bg-gray-50 transition-all flex items-center gap-3"
                     >
                        <ArrowLeft size={22} strokeWidth={2.8} /> Salir
                     </button>
                     {canManage && viewMode === 'PRODUCTS' && (
                        <button
                           onClick={toggleAllSelection}
                           className={`h-16 w-16 shrink-0 rounded-2xl border flex items-center justify-center transition-all shadow-sm ${
                              selectedIds.size > 0
                                 ? 'bg-blue-600 border-blue-600 text-white'
                                 : 'bg-white border-gray-200 text-blue-600 hover:border-blue-200'
                           }`}
                           aria-label={selectedIds.size === filteredProducts.length && filteredProducts.length > 0 ? 'Quitar seleccion masiva' : 'Seleccionar articulos'}
                        >
                           <CheckSquare size={24} strokeWidth={2.5} />
                        </button>
                     )}
                     <div className="relative flex-1 max-w-3xl">
                        <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-300" size={22} />
                        <input
                           type="text"
                           placeholder="Buscar productos..."
                           value={searchTerm}
                           onChange={(e) => setSearchTerm(e.target.value)}
                           className="h-16 w-full rounded-3xl border border-gray-200 bg-white pl-14 pr-5 text-base font-semibold text-gray-700 outline-none transition-all focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
                        />
                     </div>
                     {canManage && (
                        <button
                           onClick={() => {
                              if (viewMode === 'PRODUCTS') setEditingProduct('NEW');
                              else if (viewMode === 'TARIFFS') setEditingTariff('NEW');
                              else if (viewMode === 'GROUPS') setEditingGroup('NEW');
                              else if (viewMode === 'SEASONS') setEditingSeason('NEW');
                           }}
                           className="h-16 px-7 bg-blue-600 text-white rounded-2xl font-black text-base shadow-[0_20px_40px_rgba(37,99,235,0.22)] hover:shadow-[0_25px_50px_rgba(37,99,235,0.32)] hover:-translate-y-0.5 active:translate-y-0 active:scale-95 transition-all flex items-center gap-3"
                        >
                           <Plus size={22} strokeWidth={3} /> Nuevo
                        </button>
                     )}
                  </div>
                  <div className="px-8 pb-4 overflow-x-auto no-scrollbar">
                     <div className="inline-flex items-center gap-3 min-w-max">
                        {CATALOG_DESKTOP_VIEWS.map((item) => (
                           <button
                              key={item.id}
                              onClick={() => setViewMode(item.id)}
                              className={`px-5 py-3 rounded-2xl text-sm font-black transition-all whitespace-nowrap ${
                                 viewMode === item.id
                                    ? 'bg-blue-600 text-white shadow-[0_15px_30px_rgba(37,99,235,0.2)]'
                                    : 'bg-white text-gray-500 border border-gray-200 hover:border-blue-200 hover:text-blue-600'
                              }`}
                           >
                              {item.label}
                           </button>
                        ))}
                     </div>
                  </div>
               </div>
            )}

            {/* BULK ACTION BAR */}
            {selectedIds.size > 0 && viewMode === 'PRODUCTS' && (
               <div className="fixed inset-x-3 bottom-6 md:inset-x-auto md:bottom-12 md:left-1/2 md:-translate-x-1/2 z-[100] animate-in slide-in-from-bottom-10 fade-in duration-500">
                  <div className="mx-auto w-full bg-gray-900/98 text-white px-10 py-6 rounded-[3rem] shadow-[0_40px_80px_rgba(0,0,0,0.5)] flex items-center gap-10 border border-white/10 backdrop-blur-3xl">
                     <div className="flex items-center gap-5 border-r border-white/10 pr-10">
                        <div className="bg-blue-600 px-5 py-2 rounded-2xl text-lg font-black shadow-lg shadow-blue-500/40">{selectedIds.size}</div>
                        <span className="text-sm font-black uppercase tracking-[0.2em] text-gray-400">Seleccionados</span>
                     </div>
                     <div className="flex gap-6 items-center">
                        {canManage && (
                           <button
                              onClick={() => setShowBulkModal(true)}
                              className="px-8 py-3 bg-blue-600 hover:bg-blue-500 rounded-[1.5rem] font-black text-sm uppercase tracking-widest transition-all flex items-center gap-3 shadow-xl shadow-blue-500/20 active:scale-95"
                           >
                              <Settings2 size={20} /> Editar Propiedades
                           </button>
                        )}
                        <button
                           onClick={() => setSelectedIds(new Set())}
                           className="px-6 py-3 hover:bg-white/10 rounded-[1.5rem] font-black text-sm uppercase tracking-widest text-gray-400 transition-all"
                        >
                           Cancelar
                        </button>
                     </div>
                  </div>
               </div>
            )}

            <div className="responsive-content flex-1 min-h-0 overflow-hidden bg-white">
               <ErrorBoundary componentName="CatalogManager Content">
                  <div className="h-full overflow-y-auto custom-scrollbar">
               {viewMode === 'PRODUCTS' && (
                  <div className="min-h-full p-10 md:p-16 max-w-[1600px] mx-auto w-full">
                     {isTablet && (
                        <div className="flex justify-between items-start mb-14">
                           <div>
                              <h1 className="text-6xl font-black text-gray-900 mb-4 leading-none tracking-tight">Gestión de <br/> Productos</h1>
                              <p className="text-xl text-gray-400 font-bold">Explora y organiza tu inventario con precisión.</p>
                           </div>
                           <div className="flex items-center gap-3 bg-[#f2f4f7] p-2 rounded-[2rem] border border-gray-100 shadow-inner">
                              <button className="p-3 bg-white text-gray-900 rounded-[1.25rem] shadow-xl border border-gray-100"><Grid size={28} strokeWidth={2.5} /></button>
                              <button className="p-3 text-gray-400 hover:text-gray-900 transition-all hover:bg-white/50 rounded-[1.25rem]"><MoreHorizontal size={28} strokeWidth={2.5} /></button>
                           </div>
                        </div>
                     )}

                     {isDesktop && (
                        <div className="mb-8">
                           <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
                              {categories.map(c => (
                                 <button
                                    key={c}
                                    onClick={() => setCategoryFilter(c)}
                                    className={`px-8 py-3.5 rounded-full text-lg font-black transition-all whitespace-nowrap ${categoryFilter === c ? 'bg-blue-600 text-white shadow-[0_15px_30px_rgba(37,99,235,0.25)] scale-105' : 'bg-white text-gray-400 border-2 border-gray-50 hover:border-gray-100 hover:bg-gray-50'}`}
                                 >
                                    {c === 'ALL' ? 'Todos' : c}
                                 </button>
                              ))}
                           </div>
                        </div>
                     )}

                     {!isLargeCatalogLayout && (
                        <div className="mb-8 flex items-center gap-3">
                           {canManage && (
                              <button
                                 onClick={toggleAllSelection}
                                 className={`h-14 w-14 shrink-0 rounded-2xl border flex items-center justify-center transition-all shadow-sm ${
                                    selectedIds.size > 0
                                       ? 'bg-blue-600 border-blue-600 text-white'
                                       : 'bg-white border-gray-200 text-blue-600'
                                 }`}
                                 aria-label={selectedIds.size === filteredProducts.length && filteredProducts.length > 0 ? 'Quitar seleccion masiva' : 'Seleccionar articulos'}
                              >
                                 <CheckSquare size={22} strokeWidth={2.5} />
                              </button>
                           )}
                           <div className="relative flex-1">
                              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300" size={20} />
                              <input
                                 type="text"
                                 placeholder="Buscar productos..."
                                 value={searchTerm}
                                 onChange={(e) => setSearchTerm(e.target.value)}
                                 className="h-14 w-full rounded-2xl border border-gray-200 bg-white pl-12 pr-4 text-base font-semibold text-gray-700 outline-none transition-all focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
                              />
                           </div>
                        </div>
                     )}

                     {!isDesktop && (
                        <div className="flex gap-4 overflow-x-auto no-scrollbar mb-14 pb-2">
                           {categories.map(c => (
                              <button
                                 key={c}
                                 onClick={() => setCategoryFilter(c)}
                                 className={`px-8 py-3.5 rounded-full text-lg font-black transition-all whitespace-nowrap ${categoryFilter === c ? 'bg-blue-600 text-white shadow-[0_15px_30px_rgba(37,99,235,0.25)] scale-105' : 'bg-white text-gray-400 border-2 border-gray-50 hover:border-gray-100 hover:bg-gray-50'}`}
                              >
                                 {c === 'ALL' ? 'Todos' : c}
                              </button>
                           ))}
                        </div>
                     )}

                     {filteredProducts.length === 0 ? renderEmptyState('PRODUCTS') : (
                        <div className="space-y-4 pb-60">
                           {filteredProducts.map(product => {
                              const isSelected = selectedIds.has(product.id);
                              const imageSrc = resolveProductImageSrc(product);
                              const categoryLabel = typeof product.category === 'string' && product.category.trim() ? product.category : 'Sin categoría';
                              const barcodes = productBarcodeValues(product);
                              const skuValues = productSkuValues(product);
                              const totalStock = productStockTotal(product);
                              const activeTariffCount = Array.isArray(product.tariffs) ? product.tariffs.length : 0;
                              const isSellable = product.is_sellable !== false;
                              const primaryCode = skuValues[0] || barcodes[0] || product.id;

                              return (
                                 <div
                                    key={product.id}
                                    onClick={() => {
                                       if (selectedIds.size > 0) toggleSelection(product.id);
                                       else if (isLargeCatalogLayout) setEditingProduct(product);
                                    }}
                                    className={`group rounded-[2rem] border bg-white p-4 shadow-sm transition-all ${
                                       isSelected
                                          ? 'border-blue-500 ring-4 ring-blue-50'
                                          : 'border-gray-100 hover:border-blue-100 hover:shadow-[0_18px_45px_rgba(15,23,42,0.08)]'
                                    }`}
                                 >
                                    <div className="flex flex-col gap-4 md:flex-row md:items-center">
                                       <div className="flex items-center gap-4 min-w-0 flex-1">
                                          {canManage && (
                                             <button
                                                onClick={(e) => { e.stopPropagation(); toggleSelection(product.id); }}
                                                className={`h-11 w-11 shrink-0 rounded-2xl border flex items-center justify-center transition-all ${
                                                   isSelected
                                                      ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-100'
                                                      : 'bg-white border-gray-200 text-gray-300 hover:text-blue-600 hover:border-blue-200'
                                                }`}
                                                aria-label={isSelected ? 'Quitar selección' : 'Seleccionar artículo'}
                                             >
                                                {isSelected ? <CheckSquare size={20} strokeWidth={3} /> : <Square size={20} strokeWidth={2.5} />}
                                             </button>
                                          )}

                                          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-[1.4rem] bg-gray-50 border border-gray-100 flex items-center justify-center p-3">
                                             {imageSrc ? (
                                                <img src={imageSrc} alt={product.name} className="h-full w-full object-contain" />
                                             ) : (
                                                <ImageIcon className="text-gray-200" size={38} strokeWidth={1.5} />
                                             )}
                                          </div>

                                          <div className="min-w-0 flex-1">
                                             <div className="mb-2 flex flex-wrap items-center gap-2">
                                                <span className="rounded-full bg-gray-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-gray-500">
                                                   {categoryLabel}
                                                </span>
                                                <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${
                                                   isSellable ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                                                }`}>
                                                   {isSellable ? 'Activo venta' : 'No vendible'}
                                                </span>
                                                {product.type && (
                                                   <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-blue-700">
                                                      {product.type}
                                                   </span>
                                                )}
                                             </div>

                                             <h3 className="truncate text-xl md:text-2xl font-black leading-tight text-gray-900 group-hover:text-blue-600">
                                                {product.name}
                                             </h3>
                                             <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm font-bold text-gray-400">
                                                <span className="font-mono">SKU: {primaryCode || '---'}</span>
                                                <span>Barcodes: {barcodes.length > 0 ? barcodes.slice(0, 3).join(' / ') : '---'}</span>
                                                <span>Tarifas: {activeTariffCount}</span>
                                                <span>Stock: {totalStock.toLocaleString()}</span>
                                             </div>
                                          </div>
                                       </div>

                                       <div className="flex shrink-0 items-center justify-between gap-4 md:min-w-[330px] md:justify-end">
                                          <div className="text-left md:text-right">
                                             <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-300">Precio base</p>
                                             <p className="text-2xl font-black text-blue-600">
                                                {config.currencySymbol}{(Number(product.price) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                             </p>
                                          </div>

                                          {canManage && (
                                             <div className="flex items-center gap-2">
                                                <button
                                                   onClick={(e) => { e.stopPropagation(); setEditingProduct(product); }}
                                                   className="h-12 w-12 rounded-2xl border border-blue-100 bg-blue-50 text-blue-700 shadow-sm transition-all hover:bg-blue-600 hover:text-white active:scale-95 flex items-center justify-center"
                                                   aria-label={`Editar ${product.name}`}
                                                >
                                                   <Edit2 size={20} strokeWidth={2.6} />
                                                </button>
                                                <button
                                                   onClick={(e) => { e.stopPropagation(); handleDeleteProduct(product); }}
                                                   className="h-12 w-12 rounded-2xl border border-red-100 bg-red-50 text-red-600 shadow-sm transition-all hover:bg-red-600 hover:text-white active:scale-95 flex items-center justify-center"
                                                   aria-label={`Eliminar ${product.name}`}
                                                >
                                                   <Trash2 size={20} strokeWidth={2.6} />
                                                </button>
                                             </div>
                                          )}
                                       </div>
                                    </div>
                                 </div>
                              );
                           })}
                        </div>
                     )}
                  </div>
               )}

               {viewMode === 'BI_MONITOR' && (
                  (watchlists.length === 0 ? renderEmptyState('BI_MONITOR') : <WatchlistMonitor
                     products={products}
                     transactions={runtimeTransactions}
                     watchlists={watchlists}
                     config={config}
                     warehouses={runtimeWarehouses}
                     onUpdateWatchlists={handleUpdateWatchlists}
                     onOpenKardex={(p) => setEditingProduct(p)}
                     onOpenPromo={(p) => alert(`Abriendo diseñador de ofertas para: ${p.name}`)}
                  />)
               )}

               {viewMode === 'STOCKS' && (
                  <div className="p-16 max-w-[1400px] mx-auto w-full flex-1 flex flex-col overflow-hidden">
                     <div className="mb-14 flex justify-between items-end">
                        <div>
                           <h2 className="text-5xl font-black text-gray-900 mb-4 tracking-tight">Inventario Físico</h2>
                           <p className="text-xl text-gray-400 font-bold">Existencias físicas y valorización global por almacén.</p>
                        </div>
                        <span className="text-sm bg-emerald-50 text-emerald-700 px-6 py-3 rounded-full font-black border-2 border-emerald-100 flex items-center gap-3 shadow-lg shadow-emerald-100/50">
                           <CheckCircle2 size={20} strokeWidth={3} /> EN TIEMPO REAL
                        </span>
                     </div>
                     <div className="flex-1 space-y-12 pb-40 custom-scrollbar overflow-y-auto pr-4">
                        {runtimeWarehouses.length === 0 ? renderEmptyState('STOCKS') : runtimeWarehouses.map(warehouse => <WarehouseStockCard key={warehouse.id} warehouse={warehouse} filteredProducts={filteredProducts} productStocks={productStocks} allProducts={products} />)}
                     </div>
                  </div>
               )}

               {viewMode === 'TARIFFS' && (
                  <div className="p-16 max-w-[1600px] mx-auto w-full flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-10 pb-40">
                     {tariffs.length === 0 && !canManage ? renderEmptyState('TARIFFS') : null}
                     {tariffs.map(tariff => (
                        <div key={tariff.id} className="bg-white rounded-[3rem] p-10 shadow-sm border-2 border-transparent hover:border-blue-500/20 hover:shadow-2xl hover:shadow-blue-500/5 transition-all relative overflow-hidden group">
                           <div className="flex justify-between items-start mb-10">
                              <div className={`p-6 rounded-[2.5rem] ${tariff.active ? 'bg-blue-50 text-blue-600' : 'bg-gray-50 text-gray-300'} transition-colors group-hover:scale-110 duration-500`}>
                                 <Tag size={40} strokeWidth={2.5} />
                              </div>
                              <div className="flex gap-3">
                                 <button onClick={() => setEditingTariff(tariff)} className="p-4 bg-[#f2f4f7] text-gray-400 hover:text-blue-600 hover:bg-white hover:shadow-xl rounded-[1.5rem] transition-all"><Edit2 size={24} strokeWidth={2.5} /></button>
                              </div>
                           </div>
                           <h3 className="text-3xl font-black text-gray-900 mb-4 tracking-tight">{tariff.name}</h3>
                           <div className="flex items-center gap-4 mb-10">
                              <span className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest ${tariff.active ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200' : 'bg-gray-200 text-gray-400'}`}>
                                 {tariff.active ? 'Activa' : 'Inactive'}
                              </span>
                              <span className="text-sm text-gray-300 font-bold font-mono">{tariff.strategy.type}</span>
                           </div>
                           <div className="space-y-6 pt-10 border-t border-gray-50">
                              <div className="flex items-center gap-4 text-lg text-gray-400 font-bold">
                                 <Calendar size={24} className="text-blue-200" />
                                 <span>{tariff.schedule.daysOfWeek.length === 7 ? 'Semana completa' : `${tariff.schedule.daysOfWeek.length} días activos`}</span>
                              </div>
                              <div className="flex items-center gap-4 text-lg text-gray-400 font-bold">
                                 <DollarSign size={24} className="text-blue-200" />
                                 <span>{tariff.currency}</span>
                              </div>
                           </div>
                        </div>
                     ))}
                     <button onClick={() => setEditingTariff('NEW')} className="bg-gray-50 rounded-[3rem] p-10 border-4 border-dashed border-gray-100 hover:border-blue-200 hover:bg-white transition-all flex flex-col items-center justify-center text-gray-300 hover:text-blue-600 gap-8 group">
                        <div className="p-8 bg-white rounded-full shadow-2xl text-blue-600 group-hover:scale-110 transition-transform duration-500"><Plus size={60} strokeWidth={4} /></div>
                        <span className="text-2xl font-black">Nueva Lista</span>
                     </button>
                  </div>
               )}

               {viewMode === 'GROUPS' && (
                  <div className="p-16 max-w-[1600px] mx-auto w-full pb-40">
                     <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
                        <div>
                           <h2 className="text-5xl font-black text-gray-900 mb-4 tracking-tight">Grupos de Artículos</h2>
                           <p className="text-xl text-gray-400 font-bold">Colecciones para promociones, filtros y edición por conjunto.</p>
                        </div>
                        <span className="text-sm bg-orange-50 text-orange-700 px-6 py-3 rounded-full font-black border-2 border-orange-100">
                           {currentProductGroups.length} grupo{currentProductGroups.length === 1 ? '' : 's'}
                        </span>
                     </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                        {currentProductGroups.length === 0 && !canManage ? renderEmptyState('GROUPS') : null}
                        {currentProductGroups.map((group) => (
                           <div key={group.id} className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm hover:shadow-xl transition-all">
                              <div className="flex items-start justify-between gap-4 mb-6">
                                 <div className="flex items-center gap-4">
                                    <div className={`w-5 h-5 rounded-full ${group.color || 'bg-blue-500'} shadow-sm`} />
                                    <div>
                                       <p className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">{group.code}</p>
                                       <h3 className="text-2xl font-black text-gray-900">{group.name}</h3>
                                    </div>
                                 </div>
                                 {canManage && (
                                    <div className="flex items-center gap-2">
                                       <button onClick={() => setEditingGroup(group)} className="p-3 rounded-2xl bg-gray-50 text-gray-500 hover:text-blue-600 hover:bg-white hover:shadow-lg transition-all">
                                          <Edit2 size={18} />
                                       </button>
                                       <button onClick={() => handleDeleteGroup(group.id)} className="p-3 rounded-2xl bg-gray-50 text-gray-400 hover:text-red-600 hover:bg-white hover:shadow-lg transition-all">
                                          <Trash2 size={18} />
                                       </button>
                                    </div>
                                 )}
                              </div>
                              <p className="text-sm text-gray-500 font-medium min-h-[3rem] mb-6">{group.description || 'Sin descripción registrada.'}</p>
                              <div className="flex items-center justify-between pt-6 border-t border-gray-100">
                                 <span className="text-sm font-black text-gray-400 uppercase tracking-[0.18em]">Productos vinculados</span>
                                 <span className="text-3xl font-black text-blue-600">{group.productIds.length}</span>
                              </div>
                           </div>
                        ))}
                        {canManage && (
                           <button onClick={() => setEditingGroup('NEW')} className="bg-gray-50 rounded-[2.5rem] p-8 border-4 border-dashed border-gray-100 hover:border-blue-200 hover:bg-white transition-all flex flex-col items-center justify-center text-gray-300 hover:text-blue-600 gap-6 min-h-[260px]">
                              <div className="p-6 bg-white rounded-full shadow-xl text-blue-600"><Plus size={42} strokeWidth={3.5} /></div>
                              <span className="text-xl font-black">Nuevo Grupo</span>
                           </button>
                        )}
                     </div>
                  </div>
               )}

               {viewMode === 'SEASONS' && (
                  <div className="p-16 max-w-[1600px] mx-auto w-full pb-40">
                     <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
                        <div>
                           <h2 className="text-5xl font-black text-gray-900 mb-4 tracking-tight">Temporadas</h2>
                           <p className="text-xl text-gray-400 font-bold">Calendarios comerciales para demanda, promociones y reglas por categoría.</p>
                        </div>
                        <span className="text-sm bg-yellow-50 text-yellow-700 px-6 py-3 rounded-full font-black border-2 border-yellow-100">
                           {currentSeasons.length} temporada{currentSeasons.length === 1 ? '' : 's'}
                        </span>
                     </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                        {currentSeasons.length === 0 && !canManage ? renderEmptyState('SEASONS') : null}
                        {currentSeasons.map((season) => (
                           <div key={season.id} className="bg-white rounded-[2.5rem] p-8 border border-gray-100 shadow-sm hover:shadow-xl transition-all">
                              <div className="flex items-start justify-between gap-4 mb-6">
                                 <div>
                                    <div className="flex items-center gap-3 mb-3">
                                       <span className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-[0.16em] ${season.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                                          {season.isActive ? 'Activa' : 'Inactiva'}
                                       </span>
                                       <span className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">{season.code}</span>
                                    </div>
                                    <h3 className="text-2xl font-black text-gray-900">{season.name}</h3>
                                 </div>
                                 {canManage && (
                                    <div className="flex items-center gap-2">
                                       <button onClick={() => setEditingSeason(season)} className="p-3 rounded-2xl bg-gray-50 text-gray-500 hover:text-blue-600 hover:bg-white hover:shadow-lg transition-all">
                                          <Edit2 size={18} />
                                       </button>
                                       <button onClick={() => handleDeleteSeason(season.id)} className="p-3 rounded-2xl bg-gray-50 text-gray-400 hover:text-red-600 hover:bg-white hover:shadow-lg transition-all">
                                          <Trash2 size={18} />
                                       </button>
                                    </div>
                                 )}
                              </div>
                              <div className="grid grid-cols-2 gap-4 mb-6">
                                 <div className="rounded-2xl bg-gray-50 p-4">
                                    <p className="text-xs font-black uppercase tracking-[0.16em] text-gray-400 mb-2">Vigencia</p>
                                    <p className="text-sm font-bold text-gray-700">{new Date(season.startDate).toLocaleDateString()} - {new Date(season.endDate).toLocaleDateString()}</p>
                                 </div>
                                 <div className="rounded-2xl bg-gray-50 p-4">
                                    <p className="text-xs font-black uppercase tracking-[0.16em] text-gray-400 mb-2">Multiplicador</p>
                                    <p className="text-2xl font-black text-blue-600">{season.multiplier.toFixed(1)}x</p>
                                 </div>
                              </div>
                              <div className="flex items-center justify-between gap-4 pt-6 border-t border-gray-100">
                                 <div>
                                    <p className="text-xs font-black uppercase tracking-[0.16em] text-gray-400 mb-1">Productos</p>
                                    <p className="text-2xl font-black text-gray-900">{season.productIds.length}</p>
                                 </div>
                                 <div>
                                    <p className="text-xs font-black uppercase tracking-[0.16em] text-gray-400 mb-1">Categorías</p>
                                    <p className="text-2xl font-black text-gray-900">{season.affectedCategories?.length || 0}</p>
                                 </div>
                                 {canManage && (
                                    <button onClick={() => handleBulkRecalculate(season)} className="px-5 py-3 rounded-2xl bg-yellow-50 text-yellow-700 font-black hover:bg-yellow-100 transition-all flex items-center gap-2">
                                       <RefreshCw size={16} /> Recalcular
                                    </button>
                                 )}
                              </div>
                           </div>
                        ))}
                        {canManage && (
                           <button onClick={() => setEditingSeason('NEW')} className="bg-gray-50 rounded-[2.5rem] p-8 border-4 border-dashed border-gray-100 hover:border-blue-200 hover:bg-white transition-all flex flex-col items-center justify-center text-gray-300 hover:text-blue-600 gap-6 min-h-[300px]">
                              <div className="p-6 bg-white rounded-full shadow-xl text-blue-600"><Plus size={42} strokeWidth={3.5} /></div>
                              <span className="text-xl font-black">Nueva Temporada</span>
                           </button>
                        )}
                     </div>
                  </div>
               )}
                  </div>
               </ErrorBoundary>
            </div>
         </div>

         {/* Floating Action Button for Mobile */}
         {!isLargeCatalogLayout && canManage && viewMode === 'PRODUCTS' && (
            <button
               onClick={() => setEditingProduct('NEW')}
               className="fixed bottom-8 right-8 w-20 h-20 bg-blue-600 text-white rounded-[2rem] shadow-[0_25px_50px_rgba(37,99,235,0.4)] flex items-center justify-center z-50 active:scale-90 transition-all"
            >
               <Plus size={40} strokeWidth={4} />
            </button>
         )}

         {showBulkModal && (
            <BulkEditModal
               config={config}
               warehouses={runtimeWarehouses}
               products={products}
               seasons={config.seasons || []}
               groups={config.productGroups || []}
               selectedCount={selectedIds.size}
               onClose={() => setShowBulkModal(false)}
               onSave={handleBulkUpdate}
            />
         )}
      </div>
   );
};

interface SidebarItemProps {
   label: string;
   icon: React.ReactNode;
   active: boolean;
   onClick: () => void;
}

const SidebarItem: React.FC<SidebarItemProps> = ({ label, icon, active, onClick }) => (
   <button
      onClick={onClick}
      className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all font-bold ${active ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:bg-white/50 hover:text-gray-800'}`}
   >
      <span className={active ? 'text-blue-600' : 'text-gray-400'}>{icon}</span>
      <span className="text-[15px]">{label}</span>
      {active && <div className="ml-auto w-1.5 h-6 bg-blue-600 rounded-full"></div>}
   </button>
);

export default CatalogManager;
