import { deleteLocalProduct, saveLocalProducts } from '../services/sync/saveLocalCatalog';

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
   Package, Search, Plus, Edit2, Trash2, ArrowLeft,
   Filter, Tag, Image as ImageIcon, DollarSign,
   Calendar, CheckCircle2, XCircle, Layers, ClipboardList,
   ChevronDown, ChevronRight, ChevronLeft, Box, AlertCircle, MapPin, Grid, Sun,
   CheckSquare, Square, MoreHorizontal, Settings2, Activity, RefreshCw,
   List, ScanBarcode, Copy, SlidersHorizontal, X, Archive, Eye
} from 'lucide-react';
import { Product, BusinessConfig, Tariff, Transaction, ProductVariant, Warehouse, ProductGroup, Season, Watchlist, ProductStock, StockTransfer, Supplier, Room, ProductPrice } from '../types';
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
import { getWarehouseScopedNumber, isProductWarehouseActive, tariffMatchesIdentifier } from '../utils/masterIdentity';
import {
   productIdMatchesInventoryReference,
   productIdentityCandidates,
   productReferenceCandidates,
   resolveInventoryProductStockRow,
} from '../utils/productReferences';
import { resolveProductImageSrc } from '../utils/entityImage';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { createNumberedMaster } from '../services/sync/MasterNumberRangeService';
import { buildProductEditorSyncMarker } from '../utils/productEditorSync';

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
type ProductDisplayMode = 'CARDS' | 'TABLE';
type ProductSortMode = 'NAME_ASC' | 'NAME_DESC' | 'PRICE_ASC' | 'PRICE_DESC' | 'STOCK_ASC' | 'STOCK_DESC' | 'RECENT';
type ProductQuickFilter = 'OUT_OF_STOCK' | 'LOW_STOCK' | 'NO_PRICE' | 'NO_IMAGE' | 'INACTIVE';

const PRODUCT_VIEW_STORAGE_KEY = 'clic-pos.catalog.product-view';

const CATALOG_DESKTOP_VIEWS: Array<{ id: CatalogViewMode; label: string }> = [
   { id: 'PRODUCTS', label: 'Productos' },
   { id: 'BI_MONITOR', label: 'Monitor BI' },
   { id: 'VARIANTS', label: 'Variantes' },
   { id: 'CLASSIFICATIONS', label: 'Clasificaciones' },
   { id: 'GROUPS', label: 'Grupos' },
   { id: 'SEASONS', label: 'Temporadas' },
   { id: 'STOCKS', label: 'Existencias' },
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

const normalizeCategoryOption = (entry: unknown): { id: string; name: string } | null => {
   if (typeof entry === 'string') {
      const name = entry.trim();
      return name ? { id: name, name } : null;
   }
   if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
   const record = entry as Record<string, unknown>;
   const name = String(
      record.name ||
      record.nombre ||
      record.label ||
      record.description ||
      record.descripcion ||
      record.code ||
      record.id ||
      ''
   ).trim();
   if (!name) return null;
   const id = String(record.id || record.code || name).trim();
   return { id: id || name, name };
};

const buildProductPriceRowsForProduct = (product: Product, tariffs: Tariff[]): ProductPrice[] => {
   const now = new Date().toISOString();
   return (Array.isArray(product.tariffs) ? product.tariffs : [])
      .map((entry) => {
         const tariff = tariffs.find((candidate) =>
            tariffMatchesIdentifier(candidate, entry.tariffId) ||
            tariffMatchesIdentifier(candidate, (entry as any).tariffCode) ||
            tariffMatchesIdentifier(candidate, (entry as any).id) ||
            tariffMatchesIdentifier(candidate, entry.name)
         );
         const tariffId = String(tariff?.id || entry.tariffId || (entry as any).tariffCode || (entry as any).id || entry.name || '').trim();
         const price = Number(entry.price);
         if (!product.id || !tariffId || !Number.isFinite(price)) return null;
         return {
            id: `${product.id}_${tariffId}`,
            productId: product.id,
            tariffId,
            tariffCode: String((tariff as any)?.code || (entry as any)?.tariffCode || '').trim() || undefined,
            tariffName: String(tariff?.name || entry.name || '').trim() || undefined,
            price,
            currency: String(tariff?.currency || (entry as any)?.currency || '').trim() || undefined,
            updatedAt: product.updatedAt || now,
         } as ProductPrice;
      })
      .filter(Boolean) as ProductPrice[];
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
      product.reference,
      product.referenceCode,
      product.reference_code,
   ]
      .map((value) => (value == null ? '' : String(value).trim()))
      .filter(Boolean);
};

const productIsActive = (product: Product) => product.is_active !== false;

const productStockTotal = (product?: Product | null): number => {
   if (!product?.stockBalances) return Number(product?.stock || 0);
   return Object.values(product.stockBalances).reduce((total, quantity) => total + Number(quantity || 0), 0);
};

const productStockForWarehouse = (product: Product, warehouseId: string) => {
   if (warehouseId !== 'ALL') return Number(product.stockBalances?.[warehouseId] || 0);
   return productStockTotal(product);
};

const productStockStatus = (product: Product, warehouseId: string) => {
   const stock = productStockForWarehouse(product, warehouseId);
   const minimum = warehouseId !== 'ALL'
      ? Number(product.warehouseSettings?.[warehouseId]?.min ?? product.minStock)
      : Number(product.minStock);
   if (stock <= 0) return { label: 'Sin stock', tone: 'red' as const };
   if (Number.isFinite(minimum) && minimum > 0 && stock <= minimum) return { label: 'Stock bajo', tone: 'amber' as const };
   return { label: 'En stock', tone: 'green' as const };
};

const formatProductType = (product: Product) => {
   const value = String(product.product_type || product.type || '').trim();
   if (!value) return '';
   return ({ PRODUCT: 'Producto', SIMPLE: 'Producto', SERVICE: 'Servicio', COMBO: 'Combo', FRACTIONABLE: 'Fraccionable' } as Record<string, string>)[value.toUpperCase()] || value;
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
   const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
   const [categoryFilter, setCategoryFilter] = useState('ALL');
   const [warehouseFilter, setWarehouseFilter] = useState('ALL');
   const [quickFilters, setQuickFilters] = useState<Set<ProductQuickFilter>>(new Set());
   const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
   const [productSort, setProductSort] = useState<ProductSortMode>('NAME_ASC');
   const [pageSize, setPageSize] = useState(25);
   const [currentPage, setCurrentPage] = useState(1);
   const [productDisplayMode, setProductDisplayMode] = useState<ProductDisplayMode>(() => {
      if (typeof window === 'undefined') return 'CARDS';
      return window.localStorage.getItem(PRODUCT_VIEW_STORAGE_KEY) === 'TABLE' ? 'TABLE' : 'CARDS';
   });
   const [openActionsId, setOpenActionsId] = useState<string | null>(null);
   const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
   const [scannerFeedback, setScannerFeedback] = useState<string | null>(null);
   const [catalogLoadError, setCatalogLoadError] = useState<string | null>(null);
   const [isCatalogLoading, setIsCatalogLoading] = useState((productsProp || []).length === 0);
   const [editingProduct, setEditingProduct] = useState<Product | null | 'NEW'>(null);
   const [quickPriceProduct, setQuickPriceProduct] = useState<Product | null>(null);
   const [quickPriceValue, setQuickPriceValue] = useState('');
   const [isSavingQuickPrice, setIsSavingQuickPrice] = useState(false);
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
      const timer = window.setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
      return () => window.clearTimeout(timer);
   }, [searchTerm]);

   useEffect(() => {
      window.localStorage.setItem(PRODUCT_VIEW_STORAGE_KEY, productDisplayMode);
   }, [productDisplayMode]);

   const handleCatalogScan = useCallback((rawCode: string) => {
      const code = rawCode.trim();
      if (!code) return;
      const normalized = normalizeCatalogIdentityValue(code);
      const match = products.find((product) => [
         ...productBarcodeValues(product),
         ...productSkuValues(product),
      ].some((value) => normalizeCatalogIdentityValue(value) === normalized));
      setCategoryFilter('ALL');
      setQuickFilters(new Set());
      setCurrentPage(1);
      setSearchTerm(code);
      setDebouncedSearchTerm(code);
      setScannerFeedback(match ? `Producto encontrado: ${match.name}` : 'No se encontró un producto con este código');
      window.setTimeout(() => setScannerFeedback(null), 3000);
   }, [products]);

   useBarcodeScanner({
      onScan: handleCatalogScan,
      enabled: viewMode === 'PRODUCTS' && !editingProduct && !quickPriceProduct && !showBulkModal,
   });

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

      const currentMarker = `${editingProduct.id || 'NO_ID'}::${buildProductEditorSyncMarker(editingProduct)}`;
      const nextMarker = `${refreshedProduct.id || 'NO_ID'}::${buildProductEditorSyncMarker(refreshedProduct)}`;
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
      loadCatalogRuntime()
         .then(() => setCatalogLoadError(null))
         .catch((error) => {
            console.warn('[CatalogManager] loadCatalogRuntime', error);
            setCatalogLoadError('No pudimos cargar los productos');
         })
         .finally(() => setIsCatalogLoading(false));

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
   const [erpCategoryOptions, setErpCategoryOptions] = useState<Array<{ id: string; name: string }>>([]);

   const categories = useMemo(
      () => {
         const names = new Set<string>();
         const addOption = (entry: unknown) => {
            const option = normalizeCategoryOption(entry);
            if (option?.name) names.add(option.name);
         };

         products.forEach((p) => addOption(p?.category || 'Sin categoría'));
         (config.posCategories || []).forEach(addOption);
         (config as any).categories?.forEach?.(addOption);
         (config.productGroups || []).forEach(addOption);
         (config as any).productCategories?.forEach?.(addOption);
         erpCategoryOptions.forEach(addOption);

         return ['ALL', ...Array.from(names).filter(Boolean).sort((left, right) => left.localeCompare(right))];
      },
      [config, erpCategoryOptions, products]
   );

   const categoryCounts = useMemo(() => {
      const counts = new Map<string, number>([['ALL', products.length]]);
      for (const product of products) {
         const category = typeof product.category === 'string' && product.category.trim() ? product.category : 'Sin categoría';
         counts.set(category, (counts.get(category) || 0) + 1);
      }
      return counts;
   }, [products]);

   useEffect(() => {
      let cancelled = false;
      const loadCategories = async () => {
         try {
            const [rawCategories, rawProductCategories, rawProductGroups, rawCollections] = await Promise.all([
               db.get('categories' as any).catch(() => []),
               db.get('productCategories' as any).catch(() => []),
               db.get('productGroups' as any).catch(() => []),
               db.get('collections' as any).catch(() => []),
            ]);
            if (cancelled) return;
            const normalized = [
               ...(Array.isArray(rawCategories) ? rawCategories : []),
               ...(Array.isArray(rawProductCategories) ? rawProductCategories : []),
               ...(Array.isArray(rawProductGroups) ? rawProductGroups : []),
               ...(Array.isArray(rawCollections) ? rawCollections : []),
            ]
               .map(normalizeCategoryOption)
               .filter(Boolean) as Array<{ id: string; name: string }>;
            setErpCategoryOptions(normalized);
         } catch (error) {
            console.warn('[CatalogManager] No se pudieron cargar clasificaciones ERP:', error);
         }
      };
      const handleCategoriesUpdated = () => {
         void loadCategories();
      };

      void loadCategories();
      window.addEventListener('categoriesUpdated', handleCategoriesUpdated);
      return () => {
         cancelled = true;
         window.removeEventListener('categoriesUpdated', handleCategoriesUpdated);
      };
   }, []);
   const quickFilterCounts = useMemo(() => {
      const counts: Record<ProductQuickFilter, number> = {
         OUT_OF_STOCK: 0,
         LOW_STOCK: 0,
         NO_PRICE: 0,
         NO_IMAGE: 0,
         INACTIVE: 0,
      };
      for (const product of products) {
         const stockStatus = productStockStatus(product, warehouseFilter);
         if (stockStatus.tone === 'red') counts.OUT_OF_STOCK++;
         if (stockStatus.tone === 'amber') counts.LOW_STOCK++;
         if (!(Number(product.price) > 0)) counts.NO_PRICE++;
         if (!resolveProductImageSrc(product)) counts.NO_IMAGE++;
         if (!productIsActive(product)) counts.INACTIVE++;
      }
      return counts;
   }, [products, warehouseFilter]);

   const filteredProducts = useMemo(() => {
      return products.filter(p => {
         const normalizedSearch = debouncedSearchTerm.trim().toLowerCase();
         const searchableText = [
            p.name,
            p.description,
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
         const matchesWarehouse = warehouseFilter === 'ALL' || isProductWarehouseActive(p, warehouseFilter, runtimeWarehouses);
         const stockStatus = productStockStatus(p, warehouseFilter);
         const matchesQuickFilters = Array.from(quickFilters).every((filter) => {
            if (filter === 'OUT_OF_STOCK') return stockStatus.tone === 'red';
            if (filter === 'LOW_STOCK') return stockStatus.tone === 'amber';
            if (filter === 'NO_PRICE') return !(Number(p.price) > 0);
            if (filter === 'NO_IMAGE') return !resolveProductImageSrc(p);
            if (filter === 'INACTIVE') return !productIsActive(p);
            return true;
         });
         return matchesSearch && matchesCategory && matchesWarehouse && matchesQuickFilters;
      });
   }, [products, debouncedSearchTerm, categoryFilter, warehouseFilter, runtimeWarehouses, quickFilters]);

   const sortedProducts = useMemo(() => {
      const next = [...filteredProducts];
      next.sort((left, right) => {
         if (productSort === 'NAME_ASC') return left.name.localeCompare(right.name);
         if (productSort === 'NAME_DESC') return right.name.localeCompare(left.name);
         if (productSort === 'PRICE_ASC') return Number(left.price || 0) - Number(right.price || 0);
         if (productSort === 'PRICE_DESC') return Number(right.price || 0) - Number(left.price || 0);
         if (productSort === 'STOCK_ASC') return productStockForWarehouse(left, warehouseFilter) - productStockForWarehouse(right, warehouseFilter);
         if (productSort === 'STOCK_DESC') return productStockForWarehouse(right, warehouseFilter) - productStockForWarehouse(left, warehouseFilter);
         return productTimestamp(right) - productTimestamp(left);
      });
      return next;
   }, [filteredProducts, productSort, warehouseFilter]);

   const totalPages = Math.max(1, Math.ceil(sortedProducts.length / pageSize));
   const pagedProducts = useMemo(
      () => sortedProducts.slice((currentPage - 1) * pageSize, currentPage * pageSize),
      [sortedProducts, currentPage, pageSize]
   );

   useEffect(() => {
      setCurrentPage(1);
   }, [debouncedSearchTerm, categoryFilter, warehouseFilter, quickFilters, pageSize, productSort]);

   useEffect(() => {
      if (currentPage > totalPages) setCurrentPage(totalPages);
   }, [currentPage, totalPages]);

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
      const visibleIds = pagedProducts.map((product) => product.id);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
      setSelectedIds((previous) => {
         const next = new Set(previous);
         visibleIds.forEach((id) => allVisibleSelected ? next.delete(id) : next.add(id));
         return next;
      });
   };

   const toggleQuickFilter = (filter: ProductQuickFilter) => {
      setQuickFilters((previous) => {
         const next = new Set(previous);
         if (next.has(filter)) next.delete(filter);
         else next.add(filter);
         return next;
      });
   };

   const clearProductFilters = () => {
      setSearchTerm('');
      setDebouncedSearchTerm('');
      setCategoryFilter('ALL');
      setWarehouseFilter('ALL');
      setQuickFilters(new Set());
   };

   const copyProductValue = async (value: string, label: string) => {
      if (!value) return;
      try {
         await navigator.clipboard.writeText(value);
         setCopyFeedback(`${label} copiado`);
         window.setTimeout(() => setCopyFeedback(null), 1800);
      } catch {
         setCopyFeedback('No se pudo copiar');
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
         await saveLocalProducts(refreshedProducts.filter(product => touchedIds.includes(product.id)), currentUser?.id, products);
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
      if (!await clicConfirm(`¿Recalcular niveles mínimos y máximos para los ${season.productIds.length} productos de "${season.name}"?`)) return;

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
   if (editingTariff) return <TariffForm initialData={editingTariff === 'NEW' ? null : editingTariff} products={products} config={config} availableTariffs={tariffs} actorId={currentUser?.id} onSave={handleSaveTariff} onUpdateProducts={onUpdateProducts} onClose={() => setEditingTariff(null)} />;
   if (editingGroup) return <GroupForm initialData={editingGroup === 'NEW' ? null : editingGroup} products={products} onSave={handleSaveGroup} onClose={() => setEditingGroup(null)} />;
   if (editingSeason) return <SeasonForm initialData={editingSeason === 'NEW' ? null : editingSeason} products={products} onSave={handleSaveSeason} onClose={() => setEditingSeason(null)} />;
   if (viewMode === 'CLASSIFICATIONS') return (
      <ClassificationManager
         actorId={currentUser?.id}
         config={config}
         products={products}
         onUpdateProducts={onUpdateProducts}
         onUpdateConfig={(nextConfig) => {
            setCatalogConfig(nextConfig);
            onUpdateConfig(nextConfig);
         }}
         onClose={() => setViewMode('PRODUCTS')}
      />
   );

   async function handleSaveProduct(savedProduct: Product) {
      try {
         const oldProduct = products.find(p => p.id === savedProduct.id);
         const exists = !!oldProduct;

         if (!exists) {
            savedProduct = await createNumberedMaster('ITEM', 'products', savedProduct, terminalId);
            await saveLocalProducts([savedProduct], currentUser?.id, []);
         }

         // 1. Persist ONLY the modified product
         if (exists && oldProduct) {
            await saveLocalProducts([savedProduct], currentUser?.id, [oldProduct]);
         }
         const productPriceRows = buildProductPriceRowsForProduct(savedProduct, tariffs);
         const existingProductPrices = await db.get('productPrices' as any).catch(() => []) as ProductPrice[];
         const nextProductPrices = [
            ...(Array.isArray(existingProductPrices) ? existingProductPrices : []).filter((priceRow) => priceRow.productId !== savedProduct.id),
            ...productPriceRows,
         ];
         await db.save('productPrices' as any, nextProductPrices);

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
         window.dispatchEvent(new CustomEvent('productPricesUpdated'));
      } catch (error) {
         console.error('❌ CatalogManager: Error saving product', error);
         alert(error instanceof Error ? error.message : 'No se pudo guardar el producto. Revise la consola para más detalle.');
      }
   }

   const defaultPosTariff = (() => {
      const terminal = (config.terminals || []).find((entry) => entry.id === terminalId) || config.terminals?.[0];
      const tariffId = terminal?.config?.pricing?.defaultTariffId || tariffs[0]?.id;
      return tariffs.find((tariff) => tariff.id === tariffId) || tariffs[0];
   })();

   const openQuickPriceEditor = (product: Product) => {
      const tariffPrice = (product.tariffs || []).find((entry) => entry.tariffId === defaultPosTariff?.id);
      setQuickPriceValue(String(Number(tariffPrice?.price ?? product.price ?? 0)));
      setQuickPriceProduct(product);
   };

   const appendQuickPriceKey = (key: string) => {
      setQuickPriceValue((previous) => {
         if (key === 'BACKSPACE') return previous.slice(0, -1);
         if (key === '.' && previous.includes('.')) return previous;
         if (key === '.' && !previous) return '0.';
         return `${previous}${key}`.replace(/^0(?=\d)/, '');
      });
   };

   const saveQuickPrice = async () => {
      if (!quickPriceProduct || !defaultPosTariff || isSavingQuickPrice) return;
      const nextPrice = Number(quickPriceValue.replace(',', '.'));
      if (!Number.isFinite(nextPrice) || nextPrice < 0) {
         alert('Ingrese un precio válido.');
         return;
      }
      setIsSavingQuickPrice(true);
      try {
         const tariffRows = Array.isArray(quickPriceProduct.tariffs) ? quickPriceProduct.tariffs : [];
         const hasDefaultRow = tariffRows.some((entry) => entry.tariffId === defaultPosTariff.id);
         const updatedProduct: Product = {
            ...quickPriceProduct,
            price: nextPrice,
            tariffs: hasDefaultRow
               ? tariffRows.map((entry) => entry.tariffId === defaultPosTariff.id ? { ...entry, price: nextPrice, name: entry.name || defaultPosTariff.name } : entry)
               : [...tariffRows, { tariffId: defaultPosTariff.id, name: defaultPosTariff.name, price: nextPrice }],
            updatedAt: new Date().toISOString(),
         };
         await handleSaveProduct(updatedProduct);
         setQuickPriceProduct(null);
      } finally {
         setIsSavingQuickPrice(false);
      }
   };

   async function handleDeleteProduct(product: Product) {
      if (!canManage || !product?.id) return;
      const label = product.name || product.id;
      if (!await clicConfirm(`¿Eliminar el artículo "${label}"? El ERP impedirá la baja si tiene ventas, movimientos, existencias o recetas asociadas.`)) return;

      try {
         const updatedProductsList = products.filter((entry) => entry.id !== product.id);
         await deleteLocalProduct(product, updatedProductsList, currentUser?.id);
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

   async function handleDeleteGroup(groupId: string) {
      const group = currentProductGroups.find((entry) => entry.id === groupId);
      if (!group) return;
      if (!await clicConfirm(`¿Eliminar el grupo "${group.name}"?`)) return;
      const nextConfig = {
         ...config,
         productGroups: currentProductGroups.filter((entry) => entry.id !== groupId),
      };
      setCatalogConfig(nextConfig);
      onUpdateConfig(nextConfig);
   }

   async function handleDeleteSeason(seasonId: string) {
      const season = currentSeasons.find((entry) => entry.id === seasonId);
      if (!season) return;
      if (!await clicConfirm(`¿Eliminar la temporada "${season.name}"?`)) return;
      const nextConfig = {
         ...config,
         seasons: currentSeasons.filter((entry) => entry.id !== seasonId),
      };
      setCatalogConfig(nextConfig);
      onUpdateConfig(nextConfig);
   }

   const renderProductActions = (product: Product) => (
      <ProductRowActions
         product={product}
         canManage={canManage}
         isOpen={openActionsId === product.id}
         onToggle={() => setOpenActionsId((id) => id === product.id ? null : product.id)}
         onPrice={() => openQuickPriceEditor(product)}
         onEdit={() => setEditingProduct(product)}
         onStock={() => setViewMode('STOCKS')}
         onDelete={() => void handleDeleteProduct(product)}
      />
   );

   const renderProductCatalog = () => (
      <div className="min-h-full w-full max-w-[1800px] mx-auto p-4 md:p-6 xl:p-8">
         <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="shrink-0">
               <h1 className="text-3xl font-black tracking-tight text-gray-900">Productos</h1>
               <p className="mt-1 text-sm font-semibold text-gray-500">Administra tu catálogo de artículos</p>
            </div>
            <div className="flex flex-1 flex-wrap items-center gap-2 xl:justify-end">
               <div className="relative min-w-[250px] flex-1 xl:max-w-2xl">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={19} />
                  <input type="search" data-barcode-scanner-target="true" placeholder="Buscar por nombre, SKU, referencia o código de barras..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} className="h-12 w-full rounded-2xl border border-gray-200 bg-white pl-11 pr-4 text-sm font-semibold text-gray-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100" />
               </div>
               <button type="button" onClick={() => document.querySelector<HTMLInputElement>('[data-barcode-scanner-target=\"true\"]')?.focus({ preventScroll: true })} className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 hover:bg-blue-100 focus-visible:ring-4 focus-visible:ring-blue-100" aria-label="Escanear código de barras" title="Escanear código de barras"><ScanBarcode size={22} /></button>
               <button type="button" onClick={() => setShowAdvancedFilters((value) => !value)} className={`flex h-12 items-center gap-2 rounded-2xl border px-4 text-sm font-black transition ${showAdvancedFilters ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-700 hover:border-blue-200'}`}><SlidersHorizontal size={18} /> Filtros</button>
               <select value={warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value)} className="h-12 max-w-[220px] rounded-2xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 outline-none focus:border-blue-400" aria-label="Filtrar por almacén"><option value="ALL">Todos los almacenes</option>{runtimeWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select>
               {canManage && <button type="button" onClick={() => setEditingProduct('NEW')} className="flex h-12 items-center gap-2 rounded-2xl bg-blue-600 px-5 text-sm font-black text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700 active:scale-95"><Plus size={20} /> Nuevo producto</button>}
            </div>
         </div>

         {scannerFeedback && <div className={`mb-4 rounded-xl border px-4 py-3 text-sm font-bold ${scannerFeedback.startsWith('Producto encontrado') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`} role="status">{scannerFeedback}</div>}

         {showAdvancedFilters && <div className="mb-4 grid gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-black uppercase tracking-wide text-gray-500">Estado<select value={quickFilters.has('INACTIVE') ? 'INACTIVE' : 'ALL'} onChange={(event) => setQuickFilters((previous) => { const next = new Set(previous); event.target.value === 'INACTIVE' ? next.add('INACTIVE') : next.delete('INACTIVE'); return next; })} className="mt-1 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold normal-case tracking-normal text-gray-700"><option value="ALL">Todos</option><option value="INACTIVE">Inactivos</option></select></label>
            <label className="text-xs font-black uppercase tracking-wide text-gray-500">Categoría<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold normal-case tracking-normal text-gray-700">{categories.map((category) => <option key={category} value={category}>{category === 'ALL' ? 'Todas' : category}</option>)}</select></label>
            <label className="text-xs font-black uppercase tracking-wide text-gray-500">Existencia<select value={quickFilters.has('OUT_OF_STOCK') ? 'OUT_OF_STOCK' : quickFilters.has('LOW_STOCK') ? 'LOW_STOCK' : 'ALL'} onChange={(event) => setQuickFilters((previous) => { const next = new Set(previous); next.delete('OUT_OF_STOCK'); next.delete('LOW_STOCK'); if (event.target.value !== 'ALL') next.add(event.target.value as ProductQuickFilter); return next; })} className="mt-1 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold normal-case tracking-normal text-gray-700"><option value="ALL">Todas</option><option value="OUT_OF_STOCK">Sin stock</option><option value="LOW_STOCK">Stock bajo</option></select></label>
            <div className="flex items-end"><button type="button" onClick={clearProductFilters} className="h-11 w-full rounded-xl border border-gray-200 bg-white px-4 text-sm font-black text-gray-600 hover:text-blue-600">Limpiar filtros</button></div>
         </div>}

         <div className="mb-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">{categories.map((category) => <button key={category} type="button" onClick={() => setCategoryFilter(category)} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-black transition ${categoryFilter === category ? 'bg-blue-600 text-white shadow-md shadow-blue-100' : 'border border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-200'}`}>{category === 'ALL' ? 'Todos' : category} <span className={categoryFilter === category ? 'text-blue-100' : 'text-gray-400'}>({categoryCounts.get(category) || 0})</span></button>)}</div>

         <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
            <div className="flex flex-wrap gap-2">{([
               ['OUT_OF_STOCK', 'Sin stock', 'bg-red-500'], ['LOW_STOCK', 'Stock bajo', 'bg-amber-500'], ['NO_PRICE', 'Sin precio', 'bg-slate-400'], ['NO_IMAGE', 'Sin imagen', 'bg-slate-400'], ['INACTIVE', 'Inactivos', 'bg-slate-400'],
            ] as Array<[ProductQuickFilter, string, string]>).map(([id, label, dot]) => <button key={id} type="button" onClick={() => toggleQuickFilter(id)} className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black transition ${quickFilters.has(id) ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600'}`}><span className={`h-2 w-2 rounded-full ${dot}`} />{label} ({quickFilterCounts[id]})</button>)}</div>
            <div className="flex items-center gap-2 text-sm font-bold text-gray-500"><span>Vista:</span><button type="button" onClick={() => setProductDisplayMode('CARDS')} className={`flex h-10 items-center gap-2 rounded-xl px-3 ${productDisplayMode === 'CARDS' ? 'bg-blue-600 text-white' : 'border border-gray-200 bg-white'}`}><Grid size={17} /> Tarjetas</button><button type="button" onClick={() => setProductDisplayMode('TABLE')} className={`flex h-10 items-center gap-2 rounded-xl px-3 ${productDisplayMode === 'TABLE' ? 'bg-blue-600 text-white' : 'border border-gray-200 bg-white'}`}><List size={17} /> Tabla</button></div>
         </div>

         <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            {canManage && <button type="button" onClick={toggleAllSelection} className="flex h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-black text-gray-700"><CheckSquare size={18} className="text-blue-600" /> Seleccionar página</button>}
            <label className="ml-auto flex items-center gap-2 text-sm font-bold text-gray-500">Ordenar por:<select value={productSort} onChange={(event) => setProductSort(event.target.value as ProductSortMode)} className="h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 outline-none"><option value="NAME_ASC">Nombre A-Z</option><option value="NAME_DESC">Nombre Z-A</option><option value="PRICE_ASC">Precio menor-mayor</option><option value="PRICE_DESC">Precio mayor-menor</option><option value="STOCK_ASC">Stock menor-mayor</option><option value="STOCK_DESC">Stock mayor-menor</option><option value="RECENT">Más recientes</option></select></label>
         </div>

         {copyFeedback && <div className="fixed right-6 top-6 z-[150] rounded-xl bg-gray-900 px-4 py-3 text-sm font-bold text-white shadow-xl" role="status">{copyFeedback}</div>}

         {isCatalogLoading && products.length === 0 ? <div className="space-y-2" aria-label="Cargando productos">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl border border-gray-100 bg-gray-50" />)}</div>
         : catalogLoadError && products.length === 0 ? <div className="rounded-2xl border border-red-100 bg-red-50 p-8 text-center"><h3 className="text-xl font-black text-gray-900">No pudimos cargar los productos</h3><button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-blue-600 px-5 py-3 font-black text-white">Reintentar</button></div>
         : sortedProducts.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center"><Package className="mx-auto mb-3 text-gray-300" size={36} /><h3 className="text-xl font-black text-gray-900">{products.length === 0 ? 'No hay productos registrados' : 'No encontramos productos para estos filtros'}</h3><p className="mt-2 text-sm font-semibold text-gray-500">{products.length === 0 ? 'Crea el primer artículo para comenzar tu catálogo.' : 'Prueba otra búsqueda o limpia los filtros activos.'}</p><button type="button" onClick={products.length === 0 ? () => setEditingProduct('NEW') : clearProductFilters} className="mt-5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white">{products.length === 0 ? '+ Nuevo producto' : 'Limpiar filtros'}</button></div>
         : productDisplayMode === 'TABLE' && isLargeCatalogLayout ? <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="sticky top-0 z-10 bg-gray-50 text-[11px] font-black uppercase tracking-wider text-gray-500"><tr><th className="p-3"><span className="sr-only">Seleccionar</span></th><th className="p-3">Producto</th><th className="p-3">Referencia / SKU</th><th className="p-3">Código de barras</th><th className="p-3">Categoría</th><th className="p-3">Stock</th><th className="p-3">Precio</th><th className="p-3">Estado</th><th className="p-3 text-right">Acciones</th></tr></thead><tbody className="divide-y divide-gray-100">{pagedProducts.map((product) => {
            const sku = productSkuValues(product)[0] || product.id; const barcode = productBarcodeValues(product)[0] || ''; const stock = productStockForWarehouse(product, warehouseFilter); const status = productStockStatus(product, warehouseFilter);
            return <tr key={product.id} className={`hover:bg-blue-50/30 ${selectedIds.has(product.id) ? 'bg-blue-50/60' : ''}`}><td className="p-3"><button type="button" onClick={() => toggleSelection(product.id)} className="flex h-10 w-10 items-center justify-center" aria-label={`Seleccionar ${product.name}`}>{selectedIds.has(product.id) ? <CheckSquare className="text-blue-600" size={20} /> : <Square className="text-gray-300" size={20} />}</button></td><td className="p-3"><div className="flex min-w-[230px] items-center gap-3"><ProductThumbnail product={product} /><div className="min-w-0"><button type="button" onClick={() => setEditingProduct(product)} className="block max-w-[260px] truncate font-black text-gray-900 hover:text-blue-600">{product.name}</button><p className="max-w-[260px] truncate text-xs font-semibold text-gray-400">{product.description || formatProductType(product) || 'Artículo de catálogo'}</p></div></div></td><td className="p-3"><CopyableCode value={sku} label="referencia" onCopy={copyProductValue} /></td><td className="p-3"><CopyableCode value={barcode} label="código de barras" onCopy={copyProductValue} /></td><td className="p-3 font-bold text-gray-600">{product.category || 'Sin categoría'}</td><td className="p-3"><StockIndicator value={stock} status={status} onClick={() => setViewMode('STOCKS')} /></td><td className="p-3"><ProductPriceBlock product={product} currency={config.currencySymbol} /></td><td className="p-3"><ActiveBadge active={productIsActive(product)} sellable={product.is_sellable !== false} /></td><td className="p-3">{renderProductActions(product)}</td></tr>;
         })}</tbody></table></div>
         : <div className="overflow-visible rounded-2xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">{pagedProducts.map((product) => {
            const sku = productSkuValues(product)[0] || product.id; const barcode = productBarcodeValues(product)[0] || ''; const stock = productStockForWarehouse(product, warehouseFilter); const status = productStockStatus(product, warehouseFilter);
            return <article key={product.id} className={`relative grid gap-3 p-3 transition md:grid-cols-[auto_minmax(250px,1.7fr)_minmax(140px,.9fr)_100px_145px_95px_auto] md:items-center ${selectedIds.has(product.id) ? 'bg-blue-50/60' : 'hover:bg-gray-50/70'}`}>{canManage && <button type="button" onClick={() => toggleSelection(product.id)} className="flex h-11 w-11 items-center justify-center rounded-xl" aria-label={`${selectedIds.has(product.id) ? 'Quitar selección de' : 'Seleccionar'} ${product.name}`}>{selectedIds.has(product.id) ? <CheckSquare className="text-blue-600" size={21} /> : <Square className="text-gray-300" size={21} />}</button>}<div className="flex min-w-0 items-center gap-3"><ProductThumbnail product={product} /><div className="min-w-0"><button type="button" onClick={() => setEditingProduct(product)} className="block max-w-full truncate text-left text-base font-black text-gray-900 hover:text-blue-600">{product.name}</button><p className="mt-0.5 line-clamp-1 text-xs font-semibold text-gray-500">{product.description || formatProductType(product) || 'Artículo de catálogo'}</p><div className="mt-1.5 flex flex-wrap gap-1.5"><span className="rounded-lg bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700">{product.category || 'Sin categoría'}</span><ActiveBadge active={productIsActive(product)} sellable={product.is_sellable !== false} compact /></div></div></div><div className="space-y-1 border-gray-100 md:border-l md:pl-4"><CopyableCode value={sku} label="referencia" onCopy={copyProductValue} strong /><CopyableCode value={barcode} label="código de barras" onCopy={copyProductValue} /></div><div className="border-gray-100 md:border-l md:pl-4"><StockIndicator value={stock} status={status} onClick={() => setViewMode('STOCKS')} /></div><div className="border-gray-100 md:border-l md:pl-4"><ProductPriceBlock product={product} currency={config.currencySymbol} /></div><div className="hidden md:block"><ActiveBadge active={productIsActive(product)} sellable={product.is_sellable !== false} /></div>{renderProductActions(product)}</article>;
         })}</div>}

         {sortedProducts.length > 0 && <div className="mt-5 flex flex-col items-center justify-between gap-3 pb-28 text-sm font-semibold text-gray-500 sm:flex-row"><span>Mostrando {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, sortedProducts.length)} de {sortedProducts.length.toLocaleString()} productos</span><div className="flex items-center gap-2"><button type="button" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 disabled:opacity-40" aria-label="Página anterior"><ChevronLeft size={18} /></button><span className="rounded-xl bg-blue-600 px-4 py-2.5 font-black text-white">{currentPage}</span><span>de {totalPages}</span><button type="button" disabled={currentPage === totalPages} onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 disabled:opacity-40" aria-label="Página siguiente"><ChevronRight size={18} /></button><select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="h-10 rounded-xl border border-gray-200 bg-white px-3 font-bold"><option value={25}>25 por página</option><option value={50}>50 por página</option><option value={100}>100 por página</option></select></div></div>}
      </div>
   );

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
                  <SidebarItem label="Existencias" icon={<ClipboardList size={22} />} active={viewMode === 'STOCKS'} onClick={() => setViewMode('STOCKS')} />
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
                           <button onClick={() => setViewMode('STOCKS')} className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-bold rounded-t-2xl border-b-4 transition-colors ${viewMode === 'STOCKS' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-400 bg-white'}`}>Existencias</button>
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
                     {viewMode !== 'PRODUCTS' && <div className="flex-1 relative shadow-2xl shadow-gray-100">
                        <Search className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400" size={24} />
                        <input
                           type="text"
                           placeholder="Buscar en catálogo..."
                           value={searchTerm}
                           onChange={(e) => setSearchTerm(e.target.value)}
                           className="w-full pl-16 pr-6 py-5 bg-[#f2f4f7] border-none rounded-3xl outline-none focus:ring-4 focus:ring-blue-500/10 transition-all font-bold text-lg text-gray-700 placeholder:text-gray-300"
                        />
                     </div>}
                  </div>
                  {canManage && viewMode !== 'PRODUCTS' && (
                     <button
                        onClick={() => {
                           if (viewMode === 'TARIFFS') setEditingTariff('NEW');
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
                     {false && canManage && viewMode === 'PRODUCTS' && (
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
                     {viewMode !== 'PRODUCTS' && <div className="relative flex-1 max-w-3xl">
                        <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-300" size={22} />
                        <input
                           type="text"
                           placeholder="Buscar productos..."
                           value={searchTerm}
                           onChange={(e) => setSearchTerm(e.target.value)}
                           className="h-16 w-full rounded-3xl border border-gray-200 bg-white pl-14 pr-5 text-base font-semibold text-gray-700 outline-none transition-all focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
                        />
                     </div>}
                     {canManage && viewMode !== 'PRODUCTS' && (
                        <button
                           onClick={() => {
                              if (viewMode === 'TARIFFS') setEditingTariff('NEW');
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
               <div className="fixed inset-x-3 bottom-4 z-[100] animate-in slide-in-from-bottom-6 fade-in duration-300 md:inset-x-auto md:bottom-8 md:left-1/2 md:-translate-x-1/2">
                  <div className="mx-auto flex w-full items-center gap-4 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-gray-900 shadow-2xl">
                     <div className="flex items-center gap-3 border-r border-gray-200 pr-4">
                        <div className="rounded-xl bg-blue-600 px-3 py-1.5 text-sm font-black text-white">{selectedIds.size}</div>
                        <span className="whitespace-nowrap text-sm font-black">seleccionados</span>
                     </div>
                     <div className="flex items-center gap-2">
                        {canManage && (
                           <button
                              onClick={() => setShowBulkModal(true)}
                              className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-blue-700 active:scale-95"
                           >
                              <Settings2 size={18} /> Editar propiedades
                           </button>
                        )}
                        <button
                           onClick={() => setSelectedIds(new Set())}
                           className="rounded-xl px-3 py-2.5 text-sm font-black text-gray-500 transition hover:bg-gray-100"
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
               {viewMode === 'PRODUCTS' && renderProductCatalog()}
               {false && viewMode === 'PRODUCTS' && (
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
                                                   onClick={(e) => { e.stopPropagation(); openQuickPriceEditor(product); }}
                                                   className="h-12 w-12 rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-700 shadow-sm transition-all hover:bg-emerald-600 hover:text-white active:scale-95 flex items-center justify-center"
                                                   aria-label={`Modificar precio de ${product.name}`}
                                                >
                                                   <DollarSign size={20} strokeWidth={2.8} />
                                                </button>
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

         {quickPriceProduct && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={() => setQuickPriceProduct(null)}>
               <div className="w-full max-w-sm rounded-[2rem] bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                  <div className="mb-5 flex items-start justify-between gap-4">
                     <div>
                        <p className="text-xs font-black uppercase tracking-widest text-emerald-600">Tarifa por defecto · {defaultPosTariff?.name}</p>
                        <h3 className="mt-1 text-xl font-black text-slate-900">{quickPriceProduct.name}</h3>
                     </div>
                     <button type="button" onClick={() => setQuickPriceProduct(null)} className="rounded-xl bg-slate-100 p-2 text-slate-500"><XCircle size={20} /></button>
                  </div>
                  <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-right text-3xl font-black text-slate-900">
                     {config.currencySymbol}{quickPriceValue || '0'}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                     {['1','2','3','4','5','6','7','8','9','.','0','BACKSPACE'].map((key) => (
                        <button key={key} type="button" onClick={() => appendQuickPriceKey(key)} className="h-14 rounded-2xl bg-slate-100 text-xl font-black text-slate-800 active:scale-95">
                           {key === 'BACKSPACE' ? '⌫' : key}
                        </button>
                     ))}
                  </div>
                  <button type="button" disabled={isSavingQuickPrice || !defaultPosTariff} onClick={() => void saveQuickPrice()} className="mt-4 w-full rounded-2xl bg-emerald-600 px-5 py-4 font-black text-white disabled:opacity-50">
                     {isSavingQuickPrice ? 'Guardando…' : 'Guardar precio'}
                  </button>
               </div>
            </div>
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

const ProductThumbnail: React.FC<{ product: Product }> = React.memo(({ product }) => {
   const image = resolveProductImageSrc(product);
   return <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-100 bg-gray-50 p-1.5">
      {image ? <img src={image} alt="" loading="lazy" className="h-full w-full object-contain" /> : <ImageIcon size={26} className="text-gray-300" aria-hidden="true" />}
   </div>;
});

const CopyableCode: React.FC<{ value: string; label: string; strong?: boolean; onCopy: (value: string, label: string) => void }> = ({ value, label, strong, onCopy }) => (
   <button type="button" disabled={!value} onClick={() => onCopy(value, label)} title={`Copiar ${label}`} className={`flex min-h-6 max-w-full items-center gap-1.5 text-left font-mono text-xs hover:text-blue-600 disabled:text-gray-300 ${strong ? 'font-black text-gray-800' : 'font-semibold text-gray-500'}`}>
      <span className="truncate">{value || '—'}</span>{value && <Copy size={14} className="shrink-0" aria-hidden="true" />}
   </button>
);

const StockIndicator: React.FC<{ value: number; status: ReturnType<typeof productStockStatus>; onClick: () => void }> = ({ value, status, onClick }) => {
   const tone = status.tone === 'red' ? 'text-red-600' : status.tone === 'amber' ? 'text-amber-600' : 'text-emerald-600';
   return <button type="button" onClick={onClick} className="min-h-11 text-left" title="Abrir existencias">
      <span className="block text-[11px] font-semibold text-gray-400">Stock</span>
      <strong className="block text-lg leading-5 text-gray-900">{value.toLocaleString()}</strong>
      <span className={`text-xs font-bold ${tone}`}>{status.label}</span>
   </button>;
};

const ProductPriceBlock: React.FC<{ product: Product; currency: string }> = ({ product, currency }) => {
   const price = Number(product.price);
   const cost = Number(product.cost);
   const validPrice = Number.isFinite(price) && price >= 0;
   const validCost = Number.isFinite(cost) && cost >= 0;
   const margin = validPrice && price > 0 && validCost ? ((price - cost) / price) * 100 : null;
   return <div>
      <strong className="block whitespace-nowrap text-base font-black text-gray-900">{currency}{(validPrice ? price : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
      {validCost && <span className="block whitespace-nowrap text-xs font-semibold text-gray-500">Costo: {currency}{cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
      {margin !== null && Number.isFinite(margin) && <span className="block text-xs font-semibold text-gray-500">Margen: <b className={margin >= 0 ? 'text-emerald-600' : 'text-red-600'}>{margin.toFixed(1)}%</b></span>}
   </div>;
};

const ActiveBadge: React.FC<{ active: boolean; sellable?: boolean; compact?: boolean }> = ({ active, sellable = true, compact }) => (
   <span className="inline-flex flex-wrap gap-1">
      <span className={`inline-flex items-center gap-1.5 rounded-lg font-black ${compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-2 text-xs'} ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}><span className={`h-2 w-2 rounded-full ${active ? 'bg-emerald-500' : 'bg-gray-400'}`} />{active ? 'Activo' : 'Inactivo'}</span>
      {!sellable && <span className={`rounded-lg bg-amber-50 font-black text-amber-700 ${compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-2 text-xs'}`}>No vendible</span>}
   </span>
);

interface ProductRowActionsProps {
   product: Product;
   canManage: boolean;
   isOpen: boolean;
   onToggle: () => void;
   onPrice: () => void;
   onEdit: () => void;
   onStock: () => void;
   onDelete: () => void;
}

const ProductRowActions: React.FC<ProductRowActionsProps> = ({ product, canManage, isOpen, onToggle, onPrice, onEdit, onStock, onDelete }) => {
   if (!canManage) return null;
   return <div className="relative flex justify-end gap-1.5">
      <button type="button" onClick={onPrice} className="flex h-11 min-w-11 flex-col items-center justify-center rounded-xl border border-gray-200 px-2 text-blue-600 hover:bg-blue-50" aria-label={`Tarifas de ${product.name}`} title="Tarifas"><DollarSign size={18} /><span className="hidden text-[10px] font-bold xl:block">Tarifas</span></button>
      <button type="button" onClick={onEdit} className="flex h-11 min-w-11 flex-col items-center justify-center rounded-xl border border-gray-200 px-2 text-blue-600 hover:bg-blue-50" aria-label={`Editar ${product.name}`} title="Editar"><Edit2 size={17} /><span className="hidden text-[10px] font-bold xl:block">Editar</span></button>
      <button type="button" onClick={onToggle} className="flex h-11 min-w-11 flex-col items-center justify-center rounded-xl border border-gray-200 px-2 text-gray-700 hover:bg-gray-50" aria-label={`Más acciones para ${product.name}`} aria-expanded={isOpen} title="Más acciones"><MoreHorizontal size={19} /><span className="hidden text-[10px] font-bold xl:block">Más</span></button>
      {isOpen && <div className="absolute right-0 top-12 z-30 w-52 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 text-sm font-bold shadow-xl">
         <button type="button" onClick={onEdit} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-gray-700 hover:bg-gray-50"><Eye size={16} /> Ver detalle / editar</button>
         <button type="button" onClick={onStock} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-gray-700 hover:bg-gray-50"><Archive size={16} /> Existencias</button>
         <button type="button" onClick={onPrice} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-gray-700 hover:bg-gray-50"><DollarSign size={16} /> Tarifas</button>
         <div className="my-1 border-t border-gray-100" />
         <button type="button" onClick={onDelete} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-red-600 hover:bg-red-50"><Trash2 size={16} /> Eliminar</button>
      </div>}
   </div>;
};

export default CatalogManager;
