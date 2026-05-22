import React, { useState, useMemo, useEffect, useRef, useCallback, useDeferredValue } from 'react';
import { Capacitor } from '@capacitor/core';
import {
   Search, Trash2, MoreVertical,
   CreditCard, User, Tag, Grid, Save,
   Settings, Users, History, Wallet,
   UserPlus, PlusCircle, X, Percent, ArrowLeft, ChevronRight,
   Scale as ScaleIcon, PauseCircle, LogOut, Minus, Plus, Edit3,
   ArrowRightLeft, Globe, DollarSign, Split,
   ChevronDown, Check, AlertCircle, Layers,
   ShoppingBag, ScanBarcode, ArrowRight, Clock, Camera, AlertTriangle,
   MessageSquare, PlayCircle, Download, Lock, ArrowUpRight, Landmark,
   UserCheck, StickyNote, Inbox, Printer, QrCode, Box, Package, MapPin,
   Cloud, RefreshCw, CloudOff, Layout, ChefHat, Building2, ClipboardCheck, Undo2


} from 'lucide-react';
import { Html5Qrcode } from "html5-qrcode";
import {
   BusinessConfig, User as UserType, RoleDefinition,
   Customer, Product, CartItem, Transaction, ParkedTicket, Warehouse, NCFType, FiscalDocumentCode,
   PaymentEntry, Table, Reservation, ZReport, Room, Permission, ProductPrice, RedeemedCouponRef, ProductVariant
} from '../types';
import { hasProductPromotion } from '../utils/promotionEngine';
import { getDefaultFiscalProvider, getEffectiveFiscalComplianceConfig, getFiscalReserveAlert, mapElectronicFiscalCodeToLegacy, resolveCreditNoteFiscalCode, resolveSaleFiscalCode } from '../utils/fiscal/fiscalHelpers';
import { calculateTransactionTaxSummary } from '../utils/taxSummary';
import UnifiedPaymentModal from './PaymentModal';
import {
   evaluateCreditSupervisorGate,
   paymentEntryIsCxCCredit,
   sumCreditPaymentsBase
} from '../utils/creditRules';
import TicketOptionsModal from './TicketOptionsModal';
import CartItemOptionsModal from './CartItemOptionsModal';
import ProductVariantSelector from './ProductVariantSelector';
import ScaleModal from './ScaleModal';
import GlobalDiscountModal from './GlobalDiscountModal';
import LoyaltyScanModal from './LoyaltyScanModal';
import TrackingSelectionModal from './TrackingSelectionModal';
import { db } from '../utils/db';
import { validateTerminalDocument } from '../utils/validation';
import { isSessionExpired } from '../utils/session';
import { FiscalRangeDGII } from '../types';
import { parseScaleBarcode } from '../utils/barcodeParser';
import { transactionService } from '../services/transactionService';
import { validateTerminalSeries } from '../utils/seriesValidation';
import { applyPromotions } from '../utils/promotionEngine';
import { calculatePointsEarned, getPrimaryLoyaltyCard } from '../utils/loyaltyEngine';
import { couponService } from '../utils/couponService';
import { calculateInventoryDeductions, resolveInventoryConsumptionMode, transferStockToCommitted } from '../utils/inventoryEngine';
import { useSupervisorAuth } from '../hooks/useSupervisorAuth';
import SupervisorModal from './SupervisorModal';
import { useIsMobile } from '../hooks/useIsMobile';
import { useBottomSafeOffset } from '../hooks/useBottomSafeOffset';
import MobileConfigModal from './MobileConfigModal';
import ReturnModal from './ReturnModal';
import PromoBottomSheet from './PromoBottomSheet';
import { backgroundSyncManager, SyncState } from '../services/sync/BackgroundSyncManager';
import ProductTableSupermarket from './ProductTableSupermarket';
import BarcodeScannerModal from './BarcodeScannerModal';
import { printComanda, printPrecuenta } from '../utils/printer';
import ModifierModal from './ModifierModal';
import { productHasRestaurantConfiguration, resolveRestaurantProductConfig } from '../utils/restaurantProductConfig';
import { visorSync } from '../utils/visorSync';
import { maybeAutoLaunchCustomerDisplay } from '../utils/customerDisplay';
import ProductQuickActions from './ProductQuickActions';
import ActionGrid from './ActionGrid';
import SupervisorAuthModal from './SupervisorAuthModal';
import VirtualKeyboard from './VirtualKeyboard';
import SafetyGateModal from './SafetyGateModal';
import { printReservation } from '../utils/printer';
import MobileCartButton from './MobileCartButton';
import { calculateTaxBreakdownFromItems, formatTaxLineLabel, resolveEffectiveTaxIds } from '../utils/fiscalBreakdown';
import { formatCurrency } from '../utils/format';
import { persistStandaloneRefundTransaction, persistStandaloneSaleHistory } from '../services/localRefundPersistence';
import { resolveCustomerImageSrc, resolveProductImageSrc } from '../utils/entityImage';
import { resolveProductActiveWarehouseIds } from '../utils/masterIdentity';
import { buildTransactionSettlementFields } from '../utils/paymentSettlement';
import SplitTicketModal from './SplitTicketModal';
import { getTerminalSnapshotSellers, resolveTerminalSellerName } from '../utils/terminalSnapshotSellers';
import { productIdentityCandidates, productReferenceCandidates, resolveOperationalProductId } from '../utils/productReferences';
import { resolveKdsBaseUrl } from '../utils/kdsRouting';
import {
   confirmUberEatsPosInvoice,
   fetchUberEatsOrderDraft,
   fetchUberEatsPendingOrders,
   resolveUberEatsPosContext,
   type UberEatsPendingOrder,
   type UberEatsPosDraft,
} from '../services/uberEatsPosService';

// ... existing imports

export interface POSInterfaceProps {
   config: BusinessConfig;
   currentUser: UserType;
   roles: RoleDefinition[];
   users: UserType[];
   customers: Customer[];
   products: Product[];
   warehouses: Warehouse[];
   cart: CartItem[];
   transactions: Transaction[];
   zReports: ZReport[];
   onUpdateCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
   selectedCustomer: Customer | null;
   onSelectCustomer: (customer: Customer | null) => void;
   parkedTickets: ParkedTicket[];
   onUpdateParkedTickets: (tickets: ParkedTicket[]) => void;
   onLogout: () => void;
   onOpenSettings: (initialView?: string, initialData?: any) => void;
   onOpenCustomers: () => void;
   onOpenHistory: () => void;
   onOpenFinance: () => void;
   onOpenZReport?: () => void;
   onOpenInventoryTracking: (productId?: string) => void;
   onOpenAudit?: () => void;
   onOpenTableMap?: () => void;
   onOpenAgenda?: () => void;
   onTransactionComplete: (txn: Transaction) => void;
   onAddCustomer: (customer: Customer) => void;
   onUpdateConfig: (newConfig: BusinessConfig) => void;
   activeTerminalId: string;
   activeTable?: Table | null;
   onClearActiveTable?: () => void;
   onUpdateActiveTableGuests?: (guests: number) => void;
   onKioskPay?: () => void;
   internalSequences?: any[];
   rooms?: Room[];
   productPrices?: ProductPrice[];
}

type ProductionAreaConfig = {
   id: string;
   nombre?: string;
   modo_salida?: 'KDS' | 'PRINTER' | 'AMBOS' | string;
   target_terminal_id?: string;
   kds_host?: string;
   kds_port?: string | number;
   kds_warning_minutes?: number | string;
   kds_critical_minutes?: number | string;
   printer_ip?: string;
};

type KdsDispatchMeta = {
   areaId: string;
   orderId: string;
   itemIds: string[];
};

const buildModifierSignature = (modifiers?: unknown[]): string => {
   if (!Array.isArray(modifiers) || modifiers.length === 0) return '';
   return modifiers.map((modifier) => String(modifier ?? '')).sort().join('|');
};

const looksLikeDocumentScan = (code: string): boolean =>
   /^(TCK|INV|B0[1-4]|E3[1245]|NC|ZS|ZR|REC|TXN-)/i.test(code.trim());

const normalizeProductionMode = (value: unknown): 'KDS' | 'PRINTER' | 'AMBOS' => {
   const normalized = String(value || '').trim().toUpperCase();
   if (normalized === 'PRINTER' || normalized === 'TICKET') return 'PRINTER';
   if (normalized === 'AMBOS' || normalized === 'BOTH') return 'AMBOS';
   return 'KDS';
};

const postJsonWithTimeout = async (url: string, payload: unknown, timeoutMs = 5000) => {
   const controller = new AbortController();
   const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

   try {
      const response = await fetch(url, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(payload),
         signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
         throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
      }
      return data;
   } finally {
      window.clearTimeout(timeoutId);
   }
};

const resolveProductionAreaId = (item: any): string => {
   const restaurantConfig = resolveRestaurantProductConfig(item);
   const direct =
      item?.production_area_id
      || item?.productionAreaId
      || item?.productionAreaID
      || item?.productionArea
      || item?.restaurantConfig?.production_area_id
      || restaurantConfig.production_area_id
      || item?.metadata?.production_area_id
      || item?.metadata?.productionAreaId;
   return String(direct || '').trim();
};

const normalizeKdsIdentity = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const collectKdsProductKeys = (item: any): string[] => {
   const keys = [
      item?.id,
      item?.productId,
      item?.product_id,
      item?.producto_id,
      item?.sourceProductId,
      item?.erpProductId,
      item?.operationalProductId,
      item?.sku,
      item?.code,
      item?.barcode,
      item?.variantSku,
      item?.metadata?.productId,
      item?.metadata?.sourceProductId,
      item?.metadata?.erpProductId,
   ];

   return Array.from(new Set(keys.map(normalizeKdsIdentity).filter(Boolean)));
};

const collectProductionAreaAssignedProductKeys = (area: ProductionAreaConfig): string[] => {
   const source = area as any;
   const rawLists = [
      source.productIds,
      source.product_ids,
      source.assignedProductIds,
      source.assigned_product_ids,
      source.products,
      source.items,
   ].filter(Boolean);
   const keys: string[] = [];

   rawLists.forEach((rawList) => {
      const list = Array.isArray(rawList) ? rawList : [rawList];
      list.forEach((entry) => {
         if (entry && typeof entry === 'object') {
            keys.push(...collectKdsProductKeys(entry));
            return;
         }
         const normalized = normalizeKdsIdentity(entry);
         if (normalized) keys.push(normalized);
      });
   });

   return Array.from(new Set(keys));
};

const buildProductionAreaResolver = (productionAreas: ProductionAreaConfig[], products: Product[]) => {
   const areaById = new Map(productionAreas.map(area => [String(area.id), area]));
   const productKeyToAreaId = new Map<string, string>();

   const assignKeysToArea = (keys: string[], areaId?: string) => {
      const normalizedAreaId = String(areaId || '').trim();
      if (!normalizedAreaId || !areaById.has(normalizedAreaId)) return;
      keys.forEach((key) => {
         if (!key || productKeyToAreaId.has(key)) return;
         productKeyToAreaId.set(key, normalizedAreaId);
      });
   };

   products.forEach((product) => {
      assignKeysToArea(collectKdsProductKeys(product), resolveProductionAreaId(product));
   });

   productionAreas.forEach((area) => {
      assignKeysToArea(collectProductionAreaAssignedProductKeys(area), area.id);
   });

   return (item: any): string => {
      const directAreaId = resolveProductionAreaId(item);
      if (directAreaId && areaById.has(directAreaId)) return directAreaId;

      const mappedAreaId = collectKdsProductKeys(item)
         .map((key) => productKeyToAreaId.get(key))
         .find((areaId): areaId is string => Boolean(areaId && areaById.has(areaId)));
      return mappedAreaId || directAreaId;
   };
};

const getCartDispatchKey = (item: CartItem): string => item.cartId || `${item.id}:${item.name}`;

const buildKdsItemIds = (orderId: string, areaId: string, item: CartItem, index: number): string[] => {
   const rawId = item.cartId || `${item.id}-${index}`;
   const nativeItemId = String(rawId).startsWith(orderId) ? String(rawId) : `${orderId}_${rawId}_${index}`;
   const serverItemId = `${orderId}_${areaId}_${rawId}_${index}`;
   return Array.from(new Set([serverItemId, nativeItemId]));
};

const isKdsReturnedCartItem = (item?: Partial<CartItem> | null): boolean => {
   const status = String((item as any)?.kdsStatus || '').trim().toUpperCase();
   return status === 'DEVUELTO' || Boolean((item as any)?.kdsReturnedAt);
};

const buildKdsDispatchItems = (items: CartItem[], areaId?: string) => items.map((item, index) => ({
   id: item.cartId || `${item.id}-${index}`,
   producto_id: item.id,
   productId: item.id,
   sku: (item as any).sku || (item as any).code || '',
   name: item.name,
   nombre: item.name,
   quantity: Number(item.quantity || 0),
   cantidad: Number(item.quantity || 0),
   modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
   modificadores: Array.isArray(item.modifiers) ? item.modifiers : [],
   note: item.note || '',
   production_area_id: areaId || resolveProductionAreaId(item),
   estado_cocina: 'PENDIENTE',
   variantInfo: item.variantInfo || '',
}));

const normalizeKdsMinutes = (value: unknown, fallback: number): number => {
   const parsed = Number(value);
   if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
   return Math.max(1, Math.floor(parsed));
};

const queuePendingKdsDispatch = async (payload: Record<string, unknown>) => {
   try {
      const existing = await db.get('kdsDispatchQueue' as any).catch(() => []) as any;
      const queue = Array.isArray(existing) ? existing : [];
      await db.save('kdsDispatchQueue' as any, [
         ...queue,
         {
            id: `kdsq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            status: 'PENDING',
            attempts: 0,
            createdAt: new Date().toISOString(),
            ...payload,
         }
      ]);
   } catch (error) {
      console.warn('No se pudo guardar la comanda KDS pendiente:', error);
   }
};

const productSalesIdentityKey = (product: Product): string => {
   const operationalId = resolveOperationalProductId(product);
   if (operationalId) return `op:${operationalId}`;

   const normalizedId = String(product.id || '').trim().toLowerCase();
   const identityCandidate = productIdentityCandidates(product)
      .map((value) => String(value || '').trim().toLowerCase())
      .find((value) => value && value !== normalizedId);
   if (identityCandidate) return `identity:${identityCandidate}`;

   const barcode = typeof product.barcode === 'string' ? product.barcode.trim().toLowerCase() : '';
   if (barcode) return `barcode:${barcode}`;

   const sku = typeof (product as any).sku === 'string' ? (product as any).sku.trim().toLowerCase() : '';
   if (sku) return `sku:${sku}`;

   const code = typeof (product as any).code === 'string' ? (product as any).code.trim().toLowerCase() : '';
   if (code) return `code:${code}`;

   const name = typeof product.name === 'string' ? product.name.trim().toLowerCase() : '';
   const category = typeof product.category === 'string' ? product.category.trim().toLowerCase() : '';
   if (name) return `namecat:${name}::${category}`;

   return `id:${String(product.id || '').trim().toLowerCase()}`;
};

const isSeedCatalogProduct = (product: Product): boolean => {
   const id = String(product.id || '').trim().toLowerCase();
   return /^prod-\d+$/.test(id) || /^p\d+$/.test(id) || /^f\d+$/.test(id);
};

const productBusinessKeys = (product: Product): string[] => {
   const keys = new Set<string>();
   const addKey = (prefix: string, value: unknown) => {
      const normalized = normalizeSearchToken(value);
      if (normalized) keys.add(`${prefix}:${normalized}`);
   };

   addKey('barcode', product.barcode);
   addKey('barcode', (product as any).barcode_2);
   addKey('barcode', (product as any).barcode2);
   addKey('barcode', (product as any).barcode_3);
   addKey('barcode', (product as any).barcode3);

   if (Array.isArray((product as any).barcodes)) {
      for (const barcodeEntry of (product as any).barcodes) {
         if (barcodeEntry && typeof barcodeEntry === 'object' && !Array.isArray(barcodeEntry)) {
            addKey('barcode', (barcodeEntry as any).barcode);
            addKey('barcode', (barcodeEntry as any).code);
            addKey('barcode', (barcodeEntry as any).value);
         } else {
            addKey('barcode', barcodeEntry);
         }
      }
   }

   const sku = typeof (product as any).sku === 'string' ? (product as any).sku.trim().toLowerCase() : '';
   const code = typeof (product as any).code === 'string' ? (product as any).code.trim().toLowerCase() : '';
   const itemCode = typeof (product as any).item_code === 'string' ? (product as any).item_code.trim().toLowerCase() : '';
   const name = typeof product.name === 'string' ? product.name.trim().toLowerCase() : '';
   const category = typeof product.category === 'string' ? product.category.trim().toLowerCase() : '';

   if (sku) keys.add(`sku:${sku}`);
   if (code) keys.add(`code:${code}`);
   if (itemCode) keys.add(`item_code:${itemCode}`);
   if (name) keys.add(`namecat:${name}::${category}`);

   return Array.from(keys);
};

const productSalesIdentityKeys = (product: Product): string[] => {
   const keys = new Set<string>();
   const addKey = (prefix: string, value: unknown) => {
      const normalized = normalizeSearchToken(value);
      if (normalized) keys.add(`${prefix}:${normalized}`);
   };

   productBusinessKeys(product).forEach((key) => keys.add(key));
   productReferenceCandidates(product).forEach((value) => addKey('reference', value));
   productIdentityCandidates(product).forEach((value) => addKey('identity', value));
   addKey('operational', resolveOperationalProductId(product));
   addKey('id', product.id);

   if (keys.size === 0) {
      keys.add(productSalesIdentityKey(product));
   }

   return Array.from(keys);
};

const scoreProductForSales = (product: Product, warehouses: Warehouse[]): number => {
   const activeWarehouses = resolveProductActiveWarehouseIds(product, warehouses).length;
   const stockBalanceCount = Object.keys(product.stockBalances || {}).length;
   const updatedAtScore = new Date((product as any).updatedAt || (product as any).createdAt || 0).getTime() || 0;
   const seedPenalty = isSeedCatalogProduct(product) ? -50_000 : 0;

   return (
      seedPenalty +
      activeWarehouses * 1000 +
      stockBalanceCount * 100 +
      (product.is_sellable !== false ? 10 : 0) +
      (Number.isFinite(Number(product.price)) ? 1 : 0) +
      updatedAtScore / 1_000_000_000_000
   );
};

const buildCartDigest = (items: CartItem[] = []): string =>
   items
      .map((item) =>
         [
            item.cartId || item.id || '',
            Number(item.quantity || 0),
            Number(item.price || 0),
            (item.modifiers || []).join('|'),
            item.orderNumber || '',
            item.tableDisplayLabel || ''
         ].join(':')
      )
      .join('||');

const extractFirstNumberToken = (value?: unknown): string => {
   const match = String(value || '').match(/\d+/);
   return match ? match[0] : '';
};

const buildTableContextLabels = (table?: Partial<Table> | null, rooms: Room[] = []) => {
   const tableName = String(table?.nombre || table?.name || '').trim();
   if (!tableName) {
      return {
         tableLabel: '',
         roomLabel: '',
         compactLabel: ''
      };
   }

   const room = table?.roomId
      ? rooms.find(candidate => String(candidate.id) === String(table.roomId))
      : undefined;
   const roomLabel = String(room?.nombre || room?.name || '').trim();
   const roomNumber = extractFirstNumberToken(roomLabel);
   const tableNumber = extractFirstNumberToken(tableName);
   const compactLabel = roomNumber && tableNumber
      ? `${roomNumber}-${tableNumber}`
      : roomLabel
         ? `${roomLabel} - ${tableName}`
         : tableName;

   return {
      tableLabel: tableName,
      roomLabel,
      compactLabel
   };
};

const readCartOrderNumber = (items: CartItem[] = []): string | undefined =>
   items
      .map(item => String(item.orderNumber || '').trim())
      .find(Boolean);

const normalizeOrderNumberSettings = (settings: any) => {
   const nextNumber = Math.max(1, Math.floor(Number(settings?.nextNumber || 1)));
   const padding = Math.max(0, Math.min(10, Math.floor(Number(settings?.padding ?? 3))));
   return {
      enabled: Boolean(settings?.enabled),
      nextNumber,
      prefix: String(settings?.prefix || '').trim(),
      padding,
   };
};

const formatOrderNumber = (settings: ReturnType<typeof normalizeOrderNumberSettings>): string => {
   const numeric = String(settings.nextNumber).padStart(settings.padding, '0');
   return `${settings.prefix}${numeric}`;
};

interface ProductGridCardProps {
   product: Product;
   usesSupermarketLayout: boolean;
   usesExpandedCatalog: boolean;
   isMobile: boolean;
   showProductImages: boolean;
   baseCurrencySymbol: string;
   isProductWarehouseBlockedForSale: (product: Product) => boolean;
   getTerminalWarehouseName: () => string;
   getProductPrice: (product: Product) => number;
   hasPromotionForProduct: (product: Product) => boolean;
   onProductClick: (product: Product) => void;
   onOpenPromotion: (product: Product) => void;
   onProductTouchStart: (product: Product, clientX: number, clientY: number) => void;
   onProductTouchMove: (clientX: number, clientY: number) => void;
   onProductTouchEnd: () => void;
   onProductContextMenu: (product: Product, event: React.MouseEvent<HTMLDivElement>) => void;
}

const ProductGridCard = React.memo(({
   product,
   usesSupermarketLayout,
   usesExpandedCatalog,
   isMobile,
   showProductImages,
   baseCurrencySymbol,
   isProductWarehouseBlockedForSale,
   getTerminalWarehouseName,
   getProductPrice,
   hasPromotionForProduct,
   onProductClick,
   onOpenPromotion,
   onProductTouchStart,
   onProductTouchMove,
   onProductTouchEnd,
   onProductContextMenu,
}: ProductGridCardProps) => {
   const productName = product.name || '';
   const isWeighted = product.type === 'SERVICE' || productName.toLowerCase().includes('(peso)');
   const hasVariants = (product.variants || []).length > 0 || (product.attributes || []).length > 0;
   const isCompactMobileCard = isMobile && !usesExpandedCatalog;
   const warehouseSaleBlocked = isProductWarehouseBlockedForSale(product);
   const imageSrc = showProductImages ? resolveProductImageSrc(product) : '';
   const hasPromotion = hasPromotionForProduct(product);
   const price = getProductPrice(product);

   const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
      const touch = e.touches[0];
      if (!touch) return;
      onProductTouchStart(product, touch.clientX, touch.clientY);
   }, [onProductTouchStart, product]);

   const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
      const touch = e.touches[0];
      if (!touch) return;
      onProductTouchMove(touch.clientX, touch.clientY);
   }, [onProductTouchMove]);

   const handlePromoClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      onOpenPromotion(product);
   }, [onOpenPromotion, product]);

   return (
      <div
         title={
            warehouseSaleBlocked
               ? `No vendible en ${getTerminalWarehouseName()}: habilite este artículo en el almacén de ventas de esta caja (ERP).`
               : undefined
         }
         onClick={() => onProductClick(product)}
         onContextMenu={(event) => onProductContextMenu(product, event)}
         onTouchStart={handleTouchStart}
         onTouchMove={handleTouchMove}
         onTouchEnd={onProductTouchEnd}
         onTouchCancel={onProductTouchEnd}
         style={{ touchAction: 'manipulation' }}
         className={`bg-white dark:bg-slate-800 dark:border-slate-700 border border-gray-100 transition-all group relative overflow-hidden ${
            warehouseSaleBlocked
               ? 'cursor-not-allowed opacity-[0.82] saturate-[0.72] ring-1 ring-inset ring-amber-300/50 dark:ring-amber-800/45 border-amber-100/90 dark:border-amber-900/30'
               : 'cursor-pointer hover:border-purple-300 hover:-translate-y-1 active:scale-95'
         } ${(usesSupermarketLayout && showProductImages) ? 'rounded-[1.75rem] p-3.5 shadow-[0_10px_26px_rgba(15,23,42,0.08)] min-h-[230px] grid grid-rows-[60%_40%]' : (usesExpandedCatalog && showProductImages) ? 'rounded-[1.6rem] p-3 shadow-[0_1px_6px_rgba(15,23,42,0.06)] h-[214px] grid grid-rows-[56%_44%]' : usesExpandedCatalog ? 'rounded-[1.6rem] p-3 shadow-[0_1px_6px_rgba(15,23,42,0.06)] min-h-[190px] flex flex-col h-full' : isCompactMobileCard ? `rounded-[2rem] p-3.5 min-h-[230px] shadow-sm flex flex-col ${warehouseSaleBlocked ? '' : 'hover:shadow-xl'}` : `rounded-[2rem] p-3 min-h-[214px] shadow-sm flex flex-col ${warehouseSaleBlocked ? '' : 'hover:shadow-xl'}`}`}
      >
         {showProductImages && (
            <div className={`${usesSupermarketLayout ? 'h-full rounded-[1.35rem] mb-0 p-2.5' : usesExpandedCatalog ? 'h-full rounded-[1.25rem] mb-0 p-2' : isCompactMobileCard ? 'h-[8.5rem] rounded-[1.5rem] mb-2.5 p-2.5' : 'h-28 md:h-32 rounded-[1.5rem] mb-2.5'} bg-gray-50 dark:bg-slate-800 overflow-hidden relative flex items-center justify-center`}>
               {imageSrc ? <img src={imageSrc} className={`w-full h-full ${usesSupermarketLayout || usesExpandedCatalog || isCompactMobileCard ? 'object-contain' : 'object-cover object-center'}`} /> : <div className="w-full h-full flex items-center justify-center text-gray-200 dark:text-slate-700"><Grid size={usesSupermarketLayout ? 56 : 48} strokeWidth={1} /></div>}

               {isWeighted && (
                  <div className="absolute top-2 left-2 bg-emerald-500 text-white p-1.5 rounded-lg shadow-lg z-10 animate-in zoom-in-50" title="Requiere Balanza">
                     <ScaleIcon size={14} strokeWidth={3} />
                  </div>
               )}
               {!isWeighted && hasVariants && (
                  <div className="absolute top-2 left-2 bg-blue-600 text-white p-1.5 rounded-lg shadow-lg z-10 animate-in zoom-in-50" title="Tiene Variantes">
                     <Layers size={14} strokeWidth={3} />
                  </div>
               )}

               {hasPromotion && (
                  <div
                     className="absolute top-0 right-0 cursor-pointer z-20"
                     onClick={handlePromoClick}
                  >
                     <div className="bg-red-500 text-white text-[10px] font-black px-2 py-1 rounded-bl-xl shadow-md flex items-center gap-1 animate-in slide-in-from-top-2 hover:bg-red-600 transition-colors">
                        <Tag size={10} className="fill-white" />
                        <span>OFERTA</span>
                     </div>
                  </div>
               )}
            </div>
         )}

         {!showProductImages && hasPromotion && (
            <div
               className="absolute top-0 right-0 cursor-pointer z-20"
               onClick={handlePromoClick}
            >
               <div className="bg-red-500 text-white text-[10px] font-black px-3 py-1.5 rounded-bl-2xl shadow-sm flex items-center gap-1 hover:bg-red-600 transition-colors">
                  <Tag size={12} className="fill-white" />
                  <span>OFERTA</span>
               </div>
            </div>
         )}
         <div className={`flex flex-col ${usesExpandedCatalog ? 'min-h-0 h-full pt-0.5 justify-between' : usesSupermarketLayout ? 'flex-1 gap-0.5' : 'flex-1 justify-between gap-2'}`}>
            <div className={usesSupermarketLayout ? 'space-y-1' : usesExpandedCatalog ? 'space-y-0.5' : 'space-y-1'}>
               <span className={`block font-bold text-purple-500 uppercase opacity-60 line-clamp-1 ${usesSupermarketLayout ? 'text-[11px]' : usesExpandedCatalog ? 'text-[10px]' : isCompactMobileCard ? 'text-[10px]' : 'text-[8px]'}`}>{product.category}</span>
               <h3 className={`font-bold text-gray-800 dark:text-white leading-tight line-clamp-2 ${usesSupermarketLayout ? 'text-[1.08rem] min-h-[1.7rem]' : usesExpandedCatalog ? 'text-[0.98rem] min-h-[1.8rem]' : isCompactMobileCard ? 'text-[1rem] min-h-[2.25rem]' : 'text-sm min-h-[2.1rem]'}`}>{product.name}</h3>
            </div>
            <div className={`${usesSupermarketLayout ? 'mt-0 pt-0' : usesExpandedCatalog ? 'mt-0.5 pt-0.5 border-t border-gray-100 dark:border-slate-700' : 'mt-auto pt-1.5 border-t border-gray-50 dark:border-slate-700'}`}>
               <span className={`font-black text-gray-900 dark:text-white leading-none ${usesSupermarketLayout ? 'text-[1.78rem]' : usesExpandedCatalog ? 'text-[1.5rem]' : isCompactMobileCard ? 'text-[1.75rem]' : 'text-lg'}`}>{baseCurrencySymbol}{price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
         </div>
         {warehouseSaleBlocked && (
            <div
               className="pointer-events-none absolute inset-x-0 bottom-0 z-[25] flex justify-center px-2 pb-2 pt-10 bg-gradient-to-t from-slate-900/10 to-transparent dark:from-black/25 rounded-b-[1.5rem]"
               aria-hidden
            >
               <span className="inline-flex max-w-[calc(100%-0.5rem)] items-center gap-1 truncate rounded-lg bg-amber-600 px-2 py-1 text-center text-[9px] font-black uppercase tracking-wide text-white shadow-md">
                  <MapPin size={10} strokeWidth={3} className="shrink-0 opacity-95" />
                  Sin almacén en esta caja
               </span>
            </div>
         )}
      </div>
   );
});

ProductGridCard.displayName = 'ProductGridCard';

type RecoverableOrderEntry =
   | { kind: 'RESERVATION'; reservation: Reservation }
   | { kind: 'UBER_EATS'; order: UberEatsPendingOrder };

const normalizeSearchToken = (value: unknown): string =>
   typeof value === 'string' ? value.trim().toLowerCase() : value != null ? String(value).trim().toLowerCase() : '';

const resolveActiveTariffPrice = (
   product: Product,
   activeTokens: ReadonlySet<string>,
   productPriceIndex: Map<string, number>
): number | null => {
   const productTokens = new Set(
      [
         product.id,
         resolveOperationalProductId(product),
         ...productIdentityCandidates(product),
      ]
         .map(normalizeSearchToken)
         .filter(Boolean)
   );

   for (const productToken of productTokens) {
      for (const activeToken of activeTokens) {
         const indexedPrice = productPriceIndex.get(`${productToken}::${activeToken}`);
         if (typeof indexedPrice === 'number' && Number.isFinite(indexedPrice)) {
            return indexedPrice;
         }
      }
   }

   const matchedEntry = (product.tariffs || []).find((entry: any) => {
      const entryTokens = [
         entry?.tariffId,
         entry?.tariff_id,
         entry?.id,
         entry?.code,
         entry?.tariffCode,
         entry?.tariff_code,
      ]
         .map(normalizeSearchToken)
         .filter(Boolean);

      return entryTokens.some((token) => activeTokens.has(token));
   });

   const tariffPrice = matchedEntry?.price;
   return typeof tariffPrice === 'number' && Number.isFinite(tariffPrice) ? tariffPrice : null;
};

type SalesCatalogProductEntry = {
   product: Product;
   displayCategory: string;
   hasActiveTariff: boolean;
   hasErpWarehouse: boolean;
   isSellable: boolean;
   normalizedCategory: string;
   searchText: string;
};

const isUberRecoveredReservation = (reservation: Reservation | null | undefined): boolean =>
   reservation?.sourceChannel === 'UBER_EATS' && Boolean(reservation?.sourceOrderId);

const buildUberRecoveredPayment = (reservation: Reservation, amount: number): PaymentEntry | null => {
   const prepaidPayment = reservation.prepaidPayment;
   if (!prepaidPayment) return null;

   return {
      id: `UBER-${reservation.sourceOrderId || reservation.id}-${Date.now()}`,
      method: prepaidPayment.method,
      methodLabel: prepaidPayment.label,
      amount: Math.max(0, Number(amount || prepaidPayment.amount || 0)),
      timestamp: new Date(),
   };
};

const POSInterface: React.FC<POSInterfaceProps> = ({
   config,
   currentUser,
   products,
   roles,
   users,
   customers,
   warehouses,
   cart,
   transactions,
   zReports,
   onUpdateCart,
   selectedCustomer,
   onSelectCustomer,
   parkedTickets,
   onUpdateParkedTickets,
   onLogout,
   onOpenSettings,
   onOpenCustomers,
   onOpenHistory,
   onOpenFinance,
   onOpenZReport,
   onOpenInventoryTracking,
   onOpenAudit,
   onOpenTableMap,
   onOpenAgenda,
   onTransactionComplete,
   onAddCustomer,
   onUpdateConfig,
   activeTerminalId,
   activeTable,
   onClearActiveTable,
   onUpdateActiveTableGuests,
   onKioskPay,
   internalSequences,
   rooms = [],
   productPrices: externalProductPrices = []
}) => {
   const cartEndRef = useRef<HTMLDivElement>(null);
   const posRootRef = useRef<HTMLDivElement>(null);
   const mobileFooterRef = useRef<HTMLDivElement>(null);
   const mobileCartButtonRef = useRef<HTMLButtonElement>(null);
   const desktopActionGridRef = useRef<HTMLDivElement>(null);
   const ticketAutoSyncTimeoutRef = useRef<number | null>(null);
   const quickActionTouchTimerRef = useRef<number | null>(null);
   const quickActionTouchStartRef = useRef<{ x: number; y: number; at: number } | null>(null);
   const lastTouchContextMenuAtRef = useRef(0);
   const lastProductTouchAtRef = useRef(0);
   const quickActionOpenedAtRef = useRef(0);
   const [productPrices, setProductPrices] = useState<ProductPrice[]>(externalProductPrices);

   useEffect(() => {
      setProductPrices(Array.isArray(externalProductPrices) ? externalProductPrices : []);
   }, [externalProductPrices]);

   useEffect(() => {
      let cancelled = false;

      const refreshProductPrices = async () => {
         try {
            const fresh = await db.get('productPrices') as ProductPrice[] | null;
            if (!cancelled && Array.isArray(fresh)) {
               setProductPrices(fresh);
            }
         } catch (error) {
            console.warn('⚠️ POSInterface: Could not load productPrices collection:', error);
         }
      };

      void refreshProductPrices();
      window.addEventListener('productPricesUpdated', refreshProductPrices);
      return () => {
         cancelled = true;
         window.removeEventListener('productPricesUpdated', refreshProductPrices);
      };
   }, []);

   const isMaster = useMemo(() => {
      const terminal = config.terminals?.find(t => t.id === activeTerminalId);
      return terminal?.config?.isPrimaryNode === true;
   }, [config.terminals, activeTerminalId]);
   const effectiveSelectedCustomer = useMemo(() => {
      if (!selectedCustomer?.id) return selectedCustomer;
      return customers.find(customer => customer.id === selectedCustomer.id) || selectedCustomer;
   }, [customers, selectedCustomer]);
   const [quickActionData, setQuickActionData] = useState<{ product: Product; x: number; y: number } | null>(null);
   const [successToast, setSuccessToast] = useState<string | null>(null);
   const [incomingUberToast, setIncomingUberToast] = useState<{ count: number; displayIds: string[] } | null>(null);
   const knownUberOrderIdsRef = useRef<Set<string>>(new Set());
   const uberOrdersMonitorPrimedRef = useRef(false);

   // --- SAFETY GATE STATE ---
   const [showSafetyGate, setShowSafetyGate] = useState(false);
   const [safetyAction, setSafetyAction] = useState<{ name: string, callback: () => void, isCritical: boolean } | null>(null);

   // --- TICKET TABS STRATEGY STATE ---
   const [rightSidebarTab, setRightSidebarTab] = useState<'CART' | 'ACTIONS'>('CART');

   const triggerSafetyGate = (name: string, callback: () => void) => {
      const isCritical = cart.length > 0 || parkedTickets.length > 0 || (activeTable !== null && activeTable !== undefined);
      setSafetyAction({ name, callback, isCritical });
      setShowSafetyGate(true);
   };

   useEffect(() => {
      if (successToast) {
         const timer = setTimeout(() => setSuccessToast(null), 3000);
         return () => clearTimeout(timer);
      }
   }, [successToast]);

   useEffect(() => {
      if (!incomingUberToast) return;
      const timer = window.setTimeout(() => setIncomingUberToast(null), 6500);
      return () => window.clearTimeout(timer);
   }, [incomingUberToast]);

   useEffect(() => () => {
      if (ticketAutoSyncTimeoutRef.current) {
         window.clearTimeout(ticketAutoSyncTimeoutRef.current);
         ticketAutoSyncTimeoutRef.current = null;
      }
   }, []);

   const activeTerminal = (config.terminals || []).find(t => t.id === activeTerminalId) || (config.terminals || [])[0];
   const activeTerminalConfig = activeTerminal?.config;
   const terminalId = activeTerminal?.id || 'T1';
   const activeTableContext = useMemo(
      () => buildTableContextLabels(activeTable, rooms),
      [activeTable, rooms]
   );
   const reserveNextOrderNumber = useCallback((): string | undefined => {
      const settings = normalizeOrderNumberSettings(activeTerminalConfig?.operational?.orderNumbers);
      if (!settings.enabled || !activeTerminal?.id) return undefined;

      const orderNumber = formatOrderNumber(settings);
      const nextConfig: BusinessConfig = {
         ...config,
         terminals: (config.terminals || []).map((terminal) => {
            if (terminal.id !== activeTerminal.id) return terminal;

            const terminalConfig = terminal.config;
            const operational = terminalConfig.operational;
            const currentSettings = normalizeOrderNumberSettings(operational.orderNumbers || settings);

            return {
               ...terminal,
               config: {
                  ...terminalConfig,
                  operational: {
                     ...operational,
                     orderNumbers: {
                        ...(operational.orderNumbers || {}),
                        enabled: true,
                        prefix: settings.prefix,
                        padding: settings.padding,
                        nextNumber: Math.max(currentSettings.nextNumber, settings.nextNumber) + 1,
                     },
                  },
               },
            };
         }),
      };

      onUpdateConfig(nextConfig);
      return orderNumber;
   }, [activeTerminal?.id, activeTerminalConfig, config, onUpdateConfig]);

   const applyOrderContextToItems = useCallback((items: CartItem[], orderNumber?: string): CartItem[] => {
      const tableDisplayLabel = activeTableContext.compactLabel || undefined;
      const tableRoomLabel = activeTableContext.roomLabel || undefined;

      return items.map(item => ({
         ...item,
         ...(orderNumber ? { orderNumber: item.orderNumber || orderNumber } : {}),
         ...(tableDisplayLabel ? { tableDisplayLabel } : {}),
         ...(tableRoomLabel ? { tableRoomLabel } : {}),
      }));
   }, [activeTableContext.compactLabel, activeTableContext.roomLabel]);
   const terminalDeliveryAlerts = activeTerminalConfig?.operational?.deliveryAlerts;
   const shouldShowUberToastAlerts = terminalDeliveryAlerts?.showUberEatsToast !== false;
   const shouldAutoOpenUberModal = Boolean(
      terminalDeliveryAlerts?.isDeliveryTerminal && terminalDeliveryAlerts?.autoOpenUberEatsModal
   );
   const productById = useMemo(() => {
      const index = new Map<string, Product>();
      for (const product of products || []) {
         if (product?.id) index.set(product.id, product);
      }
      return index;
   }, [products]);
   const marketplaceProductLookup = useMemo(() => {
      const byReference = new Map<string, Product>();
      const byName = new Map<string, Product>();
      const rankedProducts = [...(products || [])].sort(
         (left, right) => scoreProductForSales(right, warehouses) - scoreProductForSales(left, warehouses)
      );

      for (const product of rankedProducts) {
         const tokens = new Set<string>([
            ...productReferenceCandidates(product),
            ...productIdentityCandidates(product),
            resolveOperationalProductId(product),
            product.barcode || '',
            (product as any).sku || '',
            (product as any).code || '',
            (product as any).item_code || '',
         ].map(normalizeSearchToken).filter(Boolean));

         tokens.forEach((token) => {
            if (!byReference.has(token)) {
               byReference.set(token, product);
            }
         });

         const nameKey = normalizeSearchToken(product.name);
         if (nameKey && !byName.has(nameKey)) {
            byName.set(nameKey, product);
         }
      }

      return { byReference, byName };
   }, [products, warehouses]);
   const salesUsers = useMemo(() => getTerminalSnapshotSellers(config, terminalId), [config, terminalId]);
   const resolveSalespersonLabel = useCallback((salespersonId?: string | null) => {
      return resolveTerminalSellerName(salespersonId, config, terminalId, users) || 'Vendedor';
   }, [config, terminalId, users]);
   const terminalDisplaySource = activeTerminalConfig?.terminalName || activeTerminalConfig?.stationNumber || terminalId;
   const terminalDisplayLabel = useMemo(() => {
      const normalized = String(terminalDisplaySource || terminalId).trim();
      if (!normalized) return `T-${terminalId}`;
      return /^t-/i.test(normalized) ? normalized.toUpperCase() : `T-${normalized.toUpperCase()}`;
   }, [terminalDisplaySource, terminalId]);
   const defaultSalesWarehouseId = activeTerminalConfig?.inventoryScope?.defaultSalesWarehouseId;
   const uxConfig = activeTerminalConfig?.ux || { showProductImages: true, gridDensity: 'COMFORTABLE', theme: 'LIGHT', quickKeysLayout: 'A' };
   const normalizeScopeKey = useCallback((value: unknown) => {
      return typeof value === 'string' ? value.trim().toLowerCase() : '';
   }, []);
   const categoryLookup = useMemo(() => {
      const aliasToCanonical = new Map<string, string>();
      const canonicalToDisplay = new Map<string, string>();

      for (const category of config.posCategories || []) {
         const aliases = [category.id, category.code, category.name]
            .map((value) => normalizeScopeKey(value))
            .filter(Boolean);
         const canonical = normalizeScopeKey(category.name || category.code || category.id);
         const displayName = category.name || category.code || category.id;
         if (!canonical || !displayName) continue;

         canonicalToDisplay.set(canonical, displayName);
         aliases.forEach((alias) => aliasToCanonical.set(alias, canonical));
      }

      return { aliasToCanonical, canonicalToDisplay };
   }, [config.posCategories, normalizeScopeKey]);
   const canonicalizeCategory = useCallback((value: unknown) => {
      const normalized = normalizeScopeKey(value);
      return categoryLookup.aliasToCanonical.get(normalized) || normalized;
   }, [categoryLookup.aliasToCanonical, normalizeScopeKey]);
   const displayCategory = useCallback((value: unknown) => {
      const canonical = canonicalizeCategory(value);
      if (!canonical) return '';
      return categoryLookup.canonicalToDisplay.get(canonical) || (typeof value === 'string' ? value.trim() : canonical);
   }, [canonicalizeCategory, categoryLookup.canonicalToDisplay]);
   const warehouseAliasMap = useMemo(() => {
      const aliasMap = new Map<string, Set<string>>();
      const displayMap = new Map<string, string>();

      const registerWarehouse = (warehouse?: Partial<Warehouse> | null) => {
         if (!warehouse) return;
         const aliases = [warehouse.id, warehouse.code, warehouse.name]
            .map((value) => normalizeScopeKey(value))
            .filter(Boolean);
         if (aliases.length === 0) return;

         const mergedAliases = new Set(aliases);
         aliases.forEach((alias) => {
            const existing = aliasMap.get(alias);
            if (existing) {
               existing.forEach((item) => mergedAliases.add(item));
            }
         });

         aliases.forEach((alias) => {
            aliasMap.set(alias, new Set(mergedAliases));
            if (warehouse.name) {
               displayMap.set(alias, warehouse.name);
            }
         });
      };

      (warehouses || []).forEach(registerWarehouse);
      (activeTerminalConfig?.inventoryScope?.warehouses || []).forEach(registerWarehouse);
      registerWarehouse(activeTerminalConfig?.inventoryScope?.defaultWarehouse as Warehouse | undefined);

      return { aliasMap, displayMap };
   }, [
      warehouses,
      activeTerminalConfig?.inventoryScope?.warehouses,
      activeTerminalConfig?.inventoryScope?.defaultWarehouse,
      normalizeScopeKey
   ]);
   const effectiveWarehouseKeys = useMemo(() => {
      const keys = new Set<string>();
      const addWarehouseValue = (value: unknown) => {
         const normalized = normalizeScopeKey(value);
         if (!normalized) return;
         keys.add(normalized);
         const aliases = warehouseAliasMap.aliasMap.get(normalized);
         aliases?.forEach((alias) => keys.add(alias));
      };

      addWarehouseValue(defaultSalesWarehouseId);
      addWarehouseValue(activeTerminalConfig?.inventoryScope?.defaultWarehouse?.id);
      addWarehouseValue(activeTerminalConfig?.inventoryScope?.defaultWarehouse?.code);
      addWarehouseValue(activeTerminalConfig?.inventoryScope?.defaultWarehouse?.name);
      (activeTerminalConfig?.inventoryScope?.visibleWarehouseIds || []).forEach(addWarehouseValue);

      return keys;
   }, [
      activeTerminalConfig?.inventoryScope?.defaultWarehouse?.code,
      activeTerminalConfig?.inventoryScope?.defaultWarehouse?.id,
      activeTerminalConfig?.inventoryScope?.defaultWarehouse?.name,
      activeTerminalConfig?.inventoryScope?.visibleWarehouseIds,
      defaultSalesWarehouseId,
      normalizeScopeKey,
      warehouseAliasMap.aliasMap
   ]);
   const getTerminalWarehouseName = useCallback(() => {
      for (const key of effectiveWarehouseKeys) {
         const display = warehouseAliasMap.displayMap.get(key);
         if (display) return display;
      }
      return 'Almacén Actual';
   }, [effectiveWarehouseKeys, warehouseAliasMap.displayMap]);
   const productMatchesTerminalWarehouse = useCallback((product: Product) => {
      const activeWarehouses = resolveProductActiveWarehouseIds(product, warehouses)
         .map((warehouseId) => normalizeScopeKey(warehouseId))
         .filter(Boolean);
      if (activeWarehouses.length === 0) return false;
      if (effectiveWarehouseKeys.size === 0) return true;
      return activeWarehouses.some((warehouseId) => effectiveWarehouseKeys.has(warehouseId));
   }, [effectiveWarehouseKeys, normalizeScopeKey, warehouses]);
   /** Tarifa OK en ERP pero almacenes activos no intersectan la caja: se muestra atenuado y no deja vender. */
   const productWarehouseBlockedById = useMemo(() => {
      const index = new Map<string, boolean>();
      for (const product of products || []) {
         if (!product?.id) continue;
         index.set(product.id, !productMatchesTerminalWarehouse(product));
      }
      return index;
   }, [productMatchesTerminalWarehouse, products]);

   const isProductWarehouseBlockedForSale = useCallback(
      (product: Product) => {
         if (product?.id && productWarehouseBlockedById.has(product.id)) {
            return productWarehouseBlockedById.get(product.id) ?? true;
         }
         return !productMatchesTerminalWarehouse(product);
      },
      [productMatchesTerminalWarehouse, productWarehouseBlockedById]
   );
   const getScopedProductStock = useCallback((product: Product) => {
      const stockEntries = Object.entries(product.stockBalances || {});
      const matchedEntry = stockEntries.find(([warehouseId]) => effectiveWarehouseKeys.has(normalizeScopeKey(warehouseId)));
      if (matchedEntry) {
         return Number(matchedEntry[1] ?? 0);
      }
      return Number(product.stock ?? 0);
   }, [effectiveWarehouseKeys, normalizeScopeKey]);
   const effectiveAllowedCategorySet = useMemo(() => {
      const configuredCategories = new Set(
         (activeTerminalConfig?.catalog?.allowedCategories || [])
            .map((category) => canonicalizeCategory(category))
            .filter(Boolean)
      );
      if (configuredCategories.size === 0) return configuredCategories;

      const localSellableCategories = new Set(
         (products || [])
            .filter((product) => product && product.is_sellable !== false)
            .map((product) => canonicalizeCategory(product.category))
            .filter(Boolean)
      );

      const matchedCategories = Array.from(configuredCategories).filter((category) => localSellableCategories.has(category));
      return matchedCategories.length > 0 ? configuredCategories : new Set<string>();
   }, [activeTerminalConfig?.catalog?.allowedCategories, canonicalizeCategory, products]);

   const isRetailMode = activeTerminalConfig?.ux?.viewMode === 'RETAIL';
   const operationalVertical = String(activeTerminalConfig?.operational?.vertical_negocio || '');
   const isRestaurantMode =
      operationalVertical === 'RESTAURANT' ||
      operationalVertical === 'RESTAURANTE' ||
      config.vertical === 'RESTAURANT';
   const hideTableExtras = isRestaurantMode && !!activeTable;
   const reservationPolicy = activeTerminalConfig?.operational?.reservationPolicy || {
      validityDays: 7,
      printCopies: 1,
      requireAdvance: false,
      minimumAdvancePercent: 20
   };

   // --- UX EFFECTS ---
   useEffect(() => {
      if (uxConfig.theme === 'DARK') {
         document.documentElement.classList.add('dark');
      } else {
         document.documentElement.classList.remove('dark');
      }
   }, [uxConfig.theme]);



   // --- DETECT KIOSK / SELF CHECKOUT ---
   const isKioskMode = activeTerminalConfig?.deviceRole?.role === 'SELF_CHECKOUT';

   // --- AUTO-HYDRATION FOR TABLES ---
   // --- SMART TABLE HYDRATION ---
   // Automatically load order when entering via Table Map
   useEffect(() => {
      if (activeTable) {
         if (activeTable.currentOrderId) {
            console.log(`🤖 Smart Access: Hydrating table ${activeTable.nombre} (Order ${activeTable.currentOrderId})`);
            const ticket = parkedTickets.find(t => t.id === activeTable.currentOrderId);
            if (ticket) {
               // 1. Load Cart
               onUpdateCart(ticket.items || []);
               // 2. Load Customer
               if (ticket.customerId) {
                  const customer = customers.find(c => c.id === ticket.customerId);
                  if (customer) onSelectCustomer(customer);
               } else {
                  onSelectCustomer(null);
               }
               console.log(`✅ Loaded ${ticket.items.length} items from active table.`);
            } else {
               // Nunca dejar el carrito de la mesa anterior: si el ticket aún no está en memoria, vaciar hasta que llegue el sync.
               console.warn(`⚠️ Ticket ${activeTable.currentOrderId} not found in parked tickets. Clearing cart to avoid inheriting another table.`);
               onUpdateCart([]);
               onSelectCustomer(null);
            }
         } else {
            // Mesa sin orden activa: siempre carrito y cliente limpios (evita heredar la mesa previa).
            onUpdateCart([]);
            onSelectCustomer(null);
         }
      }
   }, [activeTable, parkedTickets]); // Re-run if table changes or tickets sync

   const isMobile = useIsMobile();
   const tariffSelectorRef = useRef<HTMLDivElement>(null);

   const userPermissions = useMemo(() => {
      const rolesSource = roles || config.roles || [];
      const role = rolesSource.find(r => r.id === currentUser.roleId || r.id === currentUser.role);
      return role?.permissions || [];
   }, [config.roles, currentUser.role, currentUser.roleId, roles]);

   const hasPermission = useCallback(
      (perm: Permission) => userPermissions.includes('ALL') || userPermissions.includes(perm),
      [userPermissions]
   );

   const canChangeTariff = hasPermission('POS_CHANGE_TARIFF');
   const canSellWithOpenZ = hasPermission('POS_ALLOW_SALES_WITH_OPEN_Z');

   const usesSupermarketLayout = useMemo(
      () => Boolean(!isMobile && isRetailMode),
      [isMobile, isRetailMode]
   );

   const usesExpandedCatalog = useMemo(
      () => Boolean(!isMobile && (isRetailMode || activeTerminalConfig?.operational?.expandTicket)),
      [activeTerminalConfig?.operational?.expandTicket, isMobile, isRetailMode]
   );

   const gridClass = useMemo(() => {
      if (usesSupermarketLayout) {
        return "grid [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))] gap-4 md:gap-5 content-start auto-rows-fr";
      }
      if (usesExpandedCatalog) {
        return "grid grid-cols-4 gap-x-4 gap-y-4 content-start auto-rows-fr";
      }
      if (uxConfig.gridDensity === 'COMPACT') {
         return "grid [grid-template-columns:repeat(auto-fill,minmax(145px,1fr))] gap-3 content-start";
      }
      return "grid [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))] gap-3 md:gap-4 content-start";
   }, [usesExpandedCatalog, usesSupermarketLayout, uxConfig.gridDensity]);

   const categoryContainerClass = useMemo(() => {
      if (usesSupermarketLayout) {
         return "hidden";
      }
      if (uxConfig.quickKeysLayout === 'B') {
         return "bg-white border-b border-gray-200 px-4 md:px-8 py-3 flex flex-wrap gap-2 shrink-0 max-h-32 overflow-y-auto custom-scrollbar";
      }
      return "bg-white border-b border-gray-200 px-4 md:px-8 py-3 flex gap-2 overflow-x-auto no-scrollbar shrink-0";
   }, [usesSupermarketLayout, uxConfig.quickKeysLayout]);

   const allowedTariffs = useMemo(() => {
      const allowedIds = activeTerminalConfig?.pricing?.allowedTariffIds || [];
      if (allowedIds.length === 0) return config.tariffs;
      const filteredTariffs = config.tariffs.filter(t => allowedIds.includes(t.id));
      return filteredTariffs.length > 0 ? filteredTariffs : config.tariffs;
   }, [config.tariffs, activeTerminalConfig]);

   const [activeTariffId, setActiveTariffId] = useState<string>(() => {
      return activeTerminalConfig?.pricing?.defaultTariffId || allowedTariffs[0]?.id || config.tariffs[0]?.id || '';
   });
   const desiredTariffId = useMemo(
      () => activeTerminalConfig?.pricing?.defaultTariffId || allowedTariffs[0]?.id || config.tariffs[0]?.id || '',
      [activeTerminalConfig?.pricing?.defaultTariffId, allowedTariffs, config.tariffs]
   );

   useEffect(() => {
      if (!desiredTariffId) return;

      const isCurrentAllowed = allowedTariffs.some((tariff) => tariff.id === activeTariffId);
      if (!activeTariffId || !isCurrentAllowed || activeTariffId !== desiredTariffId) {
         setActiveTariffId(desiredTariffId);
      }
   }, [activeTariffId, allowedTariffs, desiredTariffId]);

   const productPriceIndex = useMemo(() => {
      const index = new Map<string, number>();
      const normalizeToken = (value: unknown): string =>
         typeof value === 'string' ? value.trim().toLowerCase() : '';

      for (const record of productPrices) {
         if (!record || typeof record !== 'object') continue;
         const price = Number(record.price);
         if (!Number.isFinite(price)) continue;

         const productTokens = [
            record.productId,
            record.itemId,
            record.erpProductId,
            record.sourceProductId,
         ]
            .map(normalizeToken)
            .filter(Boolean);

         const tariffTokens = [
            record.tariffId,
            record.tariffCode,
         ]
            .map(normalizeToken)
            .filter(Boolean);

         for (const productToken of productTokens) {
            for (const tariffToken of tariffTokens) {
               index.set(`${productToken}::${tariffToken}`, price);
            }
         }
      }

      return index;
   }, [productPrices]);

   // FILTER: Only pending transactions (after latest Z close for this terminal)
   const terminalTransactions = useMemo(() => {
      const normalize = (value?: string | null) => (value || '').trim().toLowerCase();
      const terminalKey = normalize(terminalId);
      const isDefaultTerminal = terminalKey === 't1';

      const latestCloseTs = (zReports || [])
         .filter(r => normalize(r.terminalId) === terminalKey || (!r.terminalId && isDefaultTerminal))
         .map(r => new Date(r.closedAt).getTime())
         .filter((value) => Number.isFinite(value))
         .reduce((max, value) => value > max ? value : max, 0);

      return transactions
         .filter(t => {
            const belongsToTerminal = normalize(t.terminalId) === terminalKey || (!t.terminalId && isDefaultTerminal);
            if (!belongsToTerminal) return false;
            if (t.zReportId) return false;

            const txTime = new Date(t.date).getTime();
            if (!Number.isFinite(txTime)) return latestCloseTs <= 0;
            return latestCloseTs <= 0 || txTime > latestCloseTs;
         })
         .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
   }, [transactions, terminalId, zReports]);

   const canProceedWithOperationalSession = useCallback((): boolean => {
      if (!activeTerminalConfig || terminalTransactions.length === 0) return true;

      const sessionStartDate = terminalTransactions[0]?.date;
      if (!sessionStartDate) return true;

      if (!isSessionExpired(sessionStartDate, activeTerminalConfig)) return true;

      return confirm(
         "⚠️ ADVERTENCIA DE JORNADA\n\n" +
         "El sistema detecta que la jornada operativa ha cambiado (hay transacciones pendientes de jornadas anteriores).\n\n" +
         "¿Desea continuar facturando de todos modos?\n" +
         "(Seleccione 'Aceptar' para continuar, 'Cancelar' para ir a Cierre Z)"
      );
   }, [activeTerminalConfig, terminalTransactions]);

   const [showTariffSelector, setShowTariffSelector] = useState(false);
   const [productForModifiers, setProductForModifiers] = useState<Product | null>(null);
   const [isReturnMode, setIsReturnMode] = useState(false);
   const [errorToast, setErrorToast] = useState<string | null>(null);

   const ensureSalesWithOpenZPermission = useCallback((): boolean => {
      if (canSellWithOpenZ) return true;
      setErrorToast('Tu rol no permite vender con cierre Z abierto. Activa el permiso en Equipo y Roles.');
      window.setTimeout(() => setErrorToast(null), 3500);
      return false;
   }, [canSellWithOpenZ]);

   const activeTariff = useMemo(() => (config.tariffs || []).find(t => t.id === activeTariffId), [config.tariffs, activeTariffId]);

   const [searchTerm, setSearchTerm] = useState('');
   const deferredSearchTerm = useDeferredValue(searchTerm);
   const [categoryFilter, setCategoryFilter] = useState('ALL');
   const [mobileView, setMobileView] = useState<'PRODUCTS' | 'TICKET'>('PRODUCTS');

   const [showDiscountModal, setShowDiscountModal] = useState(false);
   const [showSplitModal, setShowSplitModal] = useState(false);
   const [showPaymentModal, setShowPaymentModal] = useState(false);
   const [showTicketOptions, setShowTicketOptions] = useState(false);
   const [showParkedList, setShowParkedList] = useState(false);
   const [showParkAliasModal, setShowParkAliasModal] = useState(false);
   const [parkTicketAlias, setParkTicketAlias] = useState('');
   const [showGlobalDiscount, setShowGlobalDiscount] = useState(false);
   const [showCouponModal, setShowCouponModal] = useState(false);
   const [couponCode, setCouponCode] = useState('');
   const [redeemedCoupon, setRedeemedCoupon] = useState<RedeemedCouponRef | null>(null);

   const [syncState, setSyncState] = useState<SyncState>(backgroundSyncManager.getState());

   useEffect(() => {
      return backgroundSyncManager.subscribe(setSyncState);
   }, []);

   useEffect(() => {
      if (!canChangeTariff && showTariffSelector) {
         setShowTariffSelector(false);
      }
   }, [canChangeTariff, showTariffSelector]);

   useEffect(() => {
      if (!showTariffSelector) return;

      const handlePointerDown = (event: MouseEvent) => {
         if (!tariffSelectorRef.current?.contains(event.target as Node)) {
            setShowTariffSelector(false);
         }
      };

      document.addEventListener('mousedown', handlePointerDown);
      return () => document.removeEventListener('mousedown', handlePointerDown);
   }, [showTariffSelector]);
   const [globalDiscount, setGlobalDiscount] = useState<{ type: 'PERCENT' | 'FIXED', value: number }>({ type: 'PERCENT', value: 0 });

   useEffect(() => {
      if (!activeTable?.currentOrderId || cart.length > 0) return;
      const parked = parkedTickets.find(t => t.id === activeTable.currentOrderId);
      if (parked?.items?.length) {
         onUpdateCart(parked.items);
         return;
      }
      const ord = (transactions || []).find(t => t.id === activeTable.currentOrderId);
      if (ord?.items?.length) {
         onUpdateCart(ord.items);
      }
   }, [activeTable, parkedTickets, transactions, onUpdateCart, cart.length]);

   const [editingItem, setEditingItem] = useState<CartItem | null>(null);
   const [activeCartItemId, setActiveCartItemId] = useState<string | null>(null);
   const [selectedProductForVariants, setSelectedProductForVariants] = useState<Product | null>(null);
   const [productForScale, setProductForScale] = useState<Product | null>(null);
   const [showLoyaltyModal, setShowLoyaltyModal] = useState(false);

   const [isScannerOpen, setIsScannerOpen] = useState(false);
   const scannerRef = useRef<Html5Qrcode | null>(null);
   const searchInputRef = useRef<HTMLInputElement>(null);
   const retailSearchInputRef = useRef<HTMLInputElement>(null);
   const parkAliasInputRef = useRef<HTMLInputElement>(null);
   const [showVirtualKeyboard, setShowVirtualKeyboard] = useState(false);

   const [fiscalStatus, setFiscalStatus] = useState<{
      type: FiscalDocumentCode;
      number?: string;
      rangeExpiry?: string;
      hasNCF: boolean;
      localBuffer: any;
      isUsingPool: boolean;
      isTerminalBlock?: boolean;
      remaining?: number;
      total?: number;
   }>({
      type: 'B02', hasNCF: false, localBuffer: null, isUsingPool: false
   });

   const [showSupervisorAuth, setShowSupervisorAuth] = useState(false);
   const [refundAuthorizedBy, setRefundAuthorizedBy] = useState<{ id: string, name: string } | null>(null);
   const [status, setStatus] = useState<{ isConnected: boolean, currentNCF: string, remaining: number, expiryDate: string, batteryLevel: number } | null>(null);

   // --- MOBILE ADAPTATION ---
   const bottomOverlayRefs = useMemo(
      () => [mobileFooterRef, mobileCartButtonRef, desktopActionGridRef],
      []
   );
   const posShellStyle = useMemo(
      () =>
         ({
            ['--bottom-bar-height' as string]: '0px',
            ['--bottom-safe-offset' as string]: '12px',
            ['--viewport-bottom-inset' as string]: '0px',
            ['--pos-viewport-height' as string]: '100dvh',
            height: 'var(--pos-viewport-height, 100dvh)',
            maxHeight: 'var(--pos-viewport-height, 100dvh)',
         }) as React.CSSProperties,
      []
   );
   const bottomAwareScrollStyle = useMemo(
      () =>
         ({
            paddingBottom: isMobile
               ? 'calc(var(--bottom-safe-offset, 12px) + env(safe-area-inset-bottom))'
               : usesExpandedCatalog
                  ? 'calc(var(--bottom-safe-offset, 12px) + 0.75rem)'
                  : '1.25rem',
         }) as React.CSSProperties,
      [isMobile, usesExpandedCatalog]
   );
   const mobileFooterStyle = useMemo(
      () =>
         ({
            bottom: 'var(--viewport-bottom-inset, 0px)',
            paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)',
         }) as React.CSSProperties,
      []
   );
   const mobileCartButtonStyle = useMemo(
      () =>
         ({
            bottom: 'calc(var(--viewport-bottom-inset, 0px) + env(safe-area-inset-bottom) + 1.5rem)',
         }) as React.CSSProperties,
      []
   );
   const [showMobileConfigModal, setShowMobileConfigModal] = useState(false);
   const [pendingProductToAdd, setPendingProductToAdd] = useState<Product | null>(null);
   const [pendingTrackingProduct, setPendingTrackingProduct] = useState<{ product: Product, quantity: number, price?: number, modifiers?: string[] } | null>(null);

   // --- SMART QR RETURNS ---
   const [showReturnModal, setShowReturnModal] = useState(false);
   const [returnInvoiceId, setReturnInvoiceId] = useState<string | null>(null);

   // --- PROMO BOTTOM SHEET ---
   const [showPromoSheet, setShowPromoSheet] = useState(false);
   const [selectedPromoProduct, setSelectedPromoProduct] = useState<Product | null>(null);

   const buildParkedTicketName = useCallback(() => {
      if (activeTable) {
         return `Mesa: ${activeTableContext.compactLabel || activeTable.nombre || activeTable.name}`;
      }

      if (selectedCustomer?.name) {
         return selectedCustomer.name;
      }

      return `Ticket #${(Array.isArray(parkedTickets) ? parkedTickets : []).length + 1}`;
   }, [activeTable, activeTableContext.compactLabel, selectedCustomer, parkedTickets]);

   const closeParkAliasModal = useCallback(() => {
      setShowParkAliasModal(false);
      setParkTicketAlias('');
   }, []);

   const openParkAliasModal = useCallback(() => {
      if (cart.length === 0) return;

      const existingParked = activeTable?.currentOrderId
         ? parkedTickets.find((ticket) => ticket.id === activeTable.currentOrderId)
         : undefined;

      setParkTicketAlias(existingParked?.alias || '');
      setShowParkAliasModal(true);
   }, [activeTable, cart.length, parkedTickets]);

   useEffect(() => {
      if (!showParkAliasModal) return;

      const focusTimer = window.setTimeout(() => {
         parkAliasInputRef.current?.focus();
         parkAliasInputRef.current?.select();
      }, 40);

      return () => window.clearTimeout(focusTimer);
   }, [showParkAliasModal]);

   // --- RESERVAS / PRE-FACTURACION ---
   const [reservations, setReservations] = useState<Reservation[]>([]);
   const [showReservationModal, setShowReservationModal] = useState(false);
   const [showReservationReceipt, setShowReservationReceipt] = useState<Reservation | null>(null);
   const [isPrintingReservationReceipt, setIsPrintingReservationReceipt] = useState(false);
   const [showRecoverReservationModal, setShowRecoverReservationModal] = useState(false);
   const [reservationCustomerId, setReservationCustomerId] = useState<string>('');
   const [reservationAdvanceInput, setReservationAdvanceInput] = useState<string>('0');
   const [reservationDeliveryDate, setReservationDeliveryDate] = useState<string>('');
   const [reservationSearchTerm, setReservationSearchTerm] = useState<string>('');
   const [reservationCustomerFilterId, setReservationCustomerFilterId] = useState<string | null>(null);
   const [activeRecoveredReservation, setActiveRecoveredReservation] = useState<Reservation | null>(null);
   const [uberPendingOrders, setUberPendingOrders] = useState<UberEatsPendingOrder[]>([]);
   const [isLoadingUberPendingOrders, setIsLoadingUberPendingOrders] = useState(false);
   const [uberPendingOrdersError, setUberPendingOrdersError] = useState<string | null>(null);
   const [committedByProduct, setCommittedByProduct] = useState<Record<string, number>>({});

   useBottomSafeOffset({
      rootRef: posRootRef,
      overlayRefs: bottomOverlayRefs,
      dependencyKey: `${isMobile}-${mobileView}-${usesExpandedCatalog}`,
   });

   // --- SUPERVISOR AUTH ---
   const { requestApproval, supervisorModalProps } = useSupervisorAuth({
      config,
      currentUser,
      roles,
      onUpdateConfig
   });

   // Credit Control (CxC) - Simple Check
   const isDelinquent = useMemo(() => {
      if (!effectiveSelectedCustomer) return false;
      const debt = effectiveSelectedCustomer.currentDebt || 0;
      const limit = effectiveSelectedCustomer.creditLimit || 0;
      // If limit is 0, meaningful credit check might be disabled or unlimited depending on business logic. 
      // Assuming strict: debt > limit and limit > 0
      if (limit > 0 && debt >= limit) return true;
      return false;
   }, [effectiveSelectedCustomer]);

   const reloadCommitments = useCallback(async () => {
      const commitments = await db.get('inventoryCommitments') as any[] || [];
      const map: Record<string, number> = {};
      (commitments || []).forEach(row => {
         if (defaultSalesWarehouseId && row.warehouseId && row.warehouseId !== defaultSalesWarehouseId) return;
         map[row.productId] = (map[row.productId] || 0) + Math.max(0, Number(row.qtyCommitted || 0));
      });
      setCommittedByProduct(map);
   }, [defaultSalesWarehouseId]);

   const reloadReservations = useCallback(async () => {
      const loaded = await db.get('reservations') as Reservation[] || [];
      setReservations((loaded || []).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      await reloadCommitments();
   }, [reloadCommitments]);

   const expireReservationsIfNeeded = useCallback(async () => {
      const loaded = await db.get('reservations') as Reservation[] || [];
      const now = Date.now();
      const expired = (loaded || []).filter(r => r.status === 'ACTIVE' && new Date(r.expiryDate).getTime() < now);
      if (expired.length === 0) {
         setReservations((loaded || []).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
         await reloadCommitments();
         return;
      }

      for (const reservation of expired) {
         const warehouseId = reservation.warehouseId || defaultSalesWarehouseId || 'wh_central';
         await transferStockToCommitted(reservation.items || [], warehouseId, products, 'RELEASE');
         await db.saveDocument('reservations', {
            ...reservation,
            status: 'EXPIRED',
            expiredAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
         });
      }

      const refreshed = await db.get('reservations') as Reservation[] || [];
      setReservations((refreshed || []).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      await reloadCommitments();
      setErrorToast(`${expired.length} reserva(s) vencida(s). Stock comprometido liberado.`);
      setTimeout(() => setErrorToast(null), 4000);
   }, [defaultSalesWarehouseId, products, reloadCommitments]);

   useEffect(() => {
      reloadReservations().catch(console.error);
      expireReservationsIfNeeded().catch(console.error);

      const timer = window.setInterval(() => {
         expireReservationsIfNeeded().catch(console.error);
      }, 60000);

      return () => window.clearInterval(timer);
   }, [reloadReservations, expireReservationsIfNeeded]);

   const closeRecoverReservationModal = useCallback(() => {
      setShowRecoverReservationModal(false);
      setReservationSearchTerm('');
      setReservationCustomerFilterId(null);
   }, []);

   const openRecoverReservationModal = useCallback(() => {
      setIncomingUberToast(null);
      setReservationSearchTerm('');
      setReservationCustomerFilterId(null);
      setShowRecoverReservationModal(true);
   }, []);

   const openRecoverReservationForSelectedCustomer = useCallback(() => {
      if (!selectedCustomer) {
         openRecoverReservationModal();
         return;
      }
      setReservationSearchTerm('');
      setReservationCustomerFilterId(selectedCustomer.id);
      setShowRecoverReservationModal(true);
   }, [selectedCustomer, openRecoverReservationModal]);

   const showShortErrorToast = useCallback((message: string) => {
      setErrorToast(message);
      window.setTimeout(() => setErrorToast(null), 4000);
   }, []);

   const blockRecoveredUberOrderMutation = useCallback((actionLabel: string) => {
      if (!isUberRecoveredReservation(activeRecoveredReservation)) return false;
      showShortErrorToast(`El pedido Uber Eats recuperado no permite ${actionLabel}. Factúralo directamente para mantener la trazabilidad.`);
      return true;
   }, [activeRecoveredReservation, showShortErrorToast]);

   const loadUberPendingOrders = useCallback(async (
      options?: { silent?: boolean }
   ): Promise<UberEatsPendingOrder[] | null> => {
      const silent = options?.silent === true;
      if (!silent) {
         setIsLoadingUberPendingOrders(true);
         setUberPendingOrdersError(null);
      }

      try {
         const context = resolveUberEatsPosContext(config, activeTerminalId);
         const orders = await fetchUberEatsPendingOrders(context, 25);
         setUberPendingOrders(orders);
         return orders;
      } catch (error: any) {
         console.warn('⚠️ POSInterface: No se pudieron cargar órdenes Uber Eats pendientes:', error);
         if (!silent) {
            setUberPendingOrders([]);
            setUberPendingOrdersError(error?.message || 'No se pudieron cargar los pedidos Uber Eats.');
         }
         return null;
      } finally {
         if (!silent) {
            setIsLoadingUberPendingOrders(false);
         }
      }
   }, [activeTerminalId, config]);

   const findUberTransactionByOrderId = useCallback((sourceOrderId: string): Transaction | undefined => {
      const normalizedOrderId = String(sourceOrderId || '').trim();
      if (!normalizedOrderId) return undefined;

      return (transactions || []).find((transaction) => {
         const orderId = String(transaction.marketplaceSourceOrderId || transaction.reservationId || '').trim();
         const channel = String(transaction.marketplaceSourceChannel || '').trim().toUpperCase();
         if (!orderId || orderId !== normalizedOrderId) return false;
         if (channel && channel !== 'UBER_EATS') return false;
         return true;
      });
   }, [transactions]);

   const resolveUberDraftProduct = useCallback((draftItem: UberEatsPosDraft['items'][number]): Product | null => {
      const rawItem = draftItem?.raw && typeof draftItem.raw === 'object' ? draftItem.raw : {};
      const externalDataRaw = typeof (rawItem as any).external_data === 'string'
         ? String((rawItem as any).external_data)
         : '';
      let externalData: Record<string, unknown> = {};

      if (externalDataRaw) {
         try {
            const parsed = JSON.parse(externalDataRaw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
               externalData = parsed as Record<string, unknown>;
            }
         } catch {
            // Ignore malformed external_data payloads.
         }
      }

      const candidateTokens = [
         draftItem.external_item_id,
         draftItem.erp_item_id,
         draftItem.sku,
         (rawItem as any).id,
         (rawItem as any).sku,
         (rawItem as any).code,
         (rawItem as any).item_code,
         externalData.item_id,
         externalData.erp_item_id,
         externalData.external_code,
         externalData.sku,
      ]
         .map(normalizeSearchToken)
         .filter(Boolean);

      for (const token of candidateTokens) {
         const matched = marketplaceProductLookup.byReference.get(token);
         if (matched) return matched;
      }

      return marketplaceProductLookup.byName.get(normalizeSearchToken(draftItem.name)) || null;
   }, [marketplaceProductLookup]);

   const persistUberConfirmationState = useCallback(async (
      transaction: Transaction,
      status: NonNullable<Transaction['erpConfirmationStatus']>,
      errorMessage?: string
   ) => {
      try {
         await db.saveDocument('transactions', {
            ...transaction,
            erpConfirmationStatus: status,
            erpConfirmationError: errorMessage,
            erpConfirmedAt: status === 'SYNCED' ? new Date().toISOString() : transaction.erpConfirmedAt,
         });
      } catch (error) {
         console.warn('⚠️ POSInterface: No se pudo persistir estado de confirmación Uber Eats:', error);
      }
   }, []);

   const confirmExistingUberTransaction = useCallback(async (
      sourceOrderId: string,
      transaction: Transaction
   ): Promise<boolean> => {
      try {
         const context = resolveUberEatsPosContext(config, activeTerminalId);
         await confirmUberEatsPosInvoice(context, sourceOrderId, {
            id: transaction.id,
            displayId: transaction.displayId,
         });
         await persistUberConfirmationState(transaction, 'SYNCED');
         setSuccessToast(`ERP confirmado para Uber Eats ${transaction.displayId || sourceOrderId}`);
         await loadUberPendingOrders();
         return true;
      } catch (error: any) {
         await persistUberConfirmationState(transaction, 'ERROR', error?.message || 'No se pudo confirmar la factura Uber Eats.');
         showShortErrorToast(error?.message || 'No se pudo confirmar la factura Uber Eats en ERP.');
         return false;
      }
   }, [activeTerminalId, config, loadUberPendingOrders, persistUberConfirmationState, showShortErrorToast]);

   const handleRecoverReservation = useCallback((reservation: Reservation) => {
      const hydratedItems = (reservation.items || []).map((item, idx) => ({
         ...item,
         cartId: `RSV-${reservation.id}-${idx}-${Date.now()}`
      }));

      onUpdateCart(hydratedItems);
      const customer = customers.find(c => c.id === reservation.customerId) || null;
      onSelectCustomer(customer);
      setActiveRecoveredReservation(reservation);
      closeRecoverReservationModal();
      setSuccessToast(`Reserva ${reservation.code} cargada`);
   }, [customers, onSelectCustomer, onUpdateCart, closeRecoverReservationModal]);

   const handleRecoverUberOrder = useCallback(async (order: UberEatsPendingOrder) => {
      const existingTransaction = findUberTransactionByOrderId(order.uberOrderId);
      if (existingTransaction) {
         const confirmed = await confirmExistingUberTransaction(order.uberOrderId, existingTransaction);
         if (confirmed) {
            closeRecoverReservationModal();
         }
         return;
      }

      setIsLoadingUberPendingOrders(true);
      try {
         const context = resolveUberEatsPosContext(config, activeTerminalId);
         const draft = await fetchUberEatsOrderDraft(context, order.uberOrderId);

         if (context.storeId && draft.store_id && context.storeId !== draft.store_id) {
            throw new Error('La orden Uber Eats pertenece a otra tienda ERP y no puede facturarse en esta caja.');
         }

         const unmatchedItems: string[] = [];
         const hydratedItems = draft.items.map((item, idx) => {
            const localProduct = resolveUberDraftProduct(item);
            if (!localProduct) {
               unmatchedItems.push(item.name || `Línea ${idx + 1}`);
               return null;
            }

            const modifierNames = Array.isArray(item.modifiers)
               ? item.modifiers.map((modifier) => String(modifier?.name || '').trim()).filter(Boolean)
               : [];

            return {
               ...localProduct,
               cartId: `UBER-${draft.source_order_id}-${idx}-${Date.now()}`,
               name: item.name || localProduct.name,
               price: Number(item.unit_price || localProduct.price || 0),
               originalPrice: Number(item.unit_price || localProduct.price || 0),
               quantity: Number(item.quantity || 0),
               note: `Uber Eats ${order.displayId || draft.source_order_id}`,
               modifiers: modifierNames,
            };
         }).filter(Boolean) as CartItem[];

         if (unmatchedItems.length > 0) {
            throw new Error(`Faltan artículos en POS para facturar Uber Eats: ${unmatchedItems.join(', ')}`);
         }

         const total = Number(draft.totals?.total || hydratedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0));
         const displayCode = order.displayId || draft.source_order_id.slice(-5).toUpperCase();
         const now = new Date().toISOString();
         const prepaidPayment = draft.payments?.[0];
         const recoveredOrder: Reservation = {
            id: `UBER-${draft.source_order_id}`,
            code: `UE-${displayCode}`,
            qrPayload: JSON.stringify({ type: 'UBER_EATS_ORDER', orderId: draft.source_order_id, displayId: displayCode }),
            customerId: draft.source_order_id,
            customerName: draft.customer?.name || 'Cliente Uber Eats',
            total,
            balancePaid: total,
            expiryDate: now,
            status: 'ACTIVE',
            items: hydratedItems,
            terminalId,
            createdById: currentUser.id,
            createdByName: currentUser.name,
            createdAt: now,
            updatedAt: now,
            sourceChannel: 'UBER_EATS',
            sourceOrderId: draft.source_order_id,
            sourceStoreId: draft.source_store_id,
            tenantId: draft.tenant_id,
            companyId: draft.company_id,
            storeId: draft.store_id,
            sourceStatus: draft.status,
            prepaidPayment: {
               method: 'UBER_EATS',
               label: prepaidPayment?.label || 'Uber Eats',
               amount: Number(prepaidPayment?.amount || total),
               externalReference: prepaidPayment?.external_reference || draft.source_order_id,
            },
         };

         onUpdateCart(hydratedItems);
         onSelectCustomer(null);
         setActiveRecoveredReservation(recoveredOrder);
         setRightSidebarTab('CART');
         closeRecoverReservationModal();
         setSuccessToast(`Pedido Uber Eats ${displayCode} cargado`);
      } catch (error: any) {
         showShortErrorToast(error?.message || 'No se pudo cargar la orden Uber Eats.');
      } finally {
         setIsLoadingUberPendingOrders(false);
      }
   }, [
      activeTerminalId,
      closeRecoverReservationModal,
      config,
      confirmExistingUberTransaction,
      currentUser.id,
      currentUser.name,
      onSelectCustomer,
      onUpdateCart,
      resolveUberDraftProduct,
      setRightSidebarTab,
      showShortErrorToast,
      terminalId,
      findUberTransactionByOrderId,
   ]);

   const activeReservations = useMemo(() => {
      return (reservations || []).filter(r => r.status === 'ACTIVE');
   }, [reservations]);

   useEffect(() => {
      if (!showRecoverReservationModal) return;
      loadUberPendingOrders().catch(console.error);
   }, [showRecoverReservationModal, loadUberPendingOrders]);

   useEffect(() => {
      knownUberOrderIdsRef.current = new Set();
      uberOrdersMonitorPrimedRef.current = false;
      setIncomingUberToast(null);
   }, [activeTerminalId]);

   useEffect(() => {
      let cancelled = false;
      let intervalId: number | null = null;

      const pollUberPendingOrders = async () => {
         const orders = await loadUberPendingOrders({ silent: true });
         if (cancelled || !orders) return;

         const currentIds = new Set(orders.map((order) => order.uberOrderId).filter(Boolean));
         if (!uberOrdersMonitorPrimedRef.current) {
            knownUberOrderIdsRef.current = currentIds;
            uberOrdersMonitorPrimedRef.current = true;
            return;
         }

         const newOrders = orders.filter((order) => !knownUberOrderIdsRef.current.has(order.uberOrderId));
         knownUberOrderIdsRef.current = currentIds;

         if (newOrders.length === 0) return;

         if (shouldShowUberToastAlerts) {
            setIncomingUberToast({
               count: newOrders.length,
               displayIds: newOrders.map((order) => order.displayId || order.uberOrderId).filter(Boolean).slice(0, 3),
            });
         }

         if (shouldAutoOpenUberModal && !showRecoverReservationModal) {
            openRecoverReservationModal();
         }
      };

      try {
         resolveUberEatsPosContext(config, activeTerminalId);
      } catch {
         return;
      }

      void pollUberPendingOrders();
      intervalId = window.setInterval(() => {
         void pollUberPendingOrders();
      }, 30000);

      return () => {
         cancelled = true;
         if (intervalId) window.clearInterval(intervalId);
      };
   }, [
      activeTerminalId,
      config,
      loadUberPendingOrders,
      openRecoverReservationModal,
      shouldAutoOpenUberModal,
      shouldShowUberToastAlerts,
      showRecoverReservationModal,
   ]);

   const activeReservationByScanCode = useMemo(() => {
      const index = new Map<string, Reservation>();
      for (const reservation of activeReservations || []) {
         if (reservation.id) index.set(String(reservation.id), reservation);
         if (reservation.code) index.set(String(reservation.code), reservation);
      }
      return index;
   }, [activeReservations]);

   const transactionByScanCode = useMemo(() => {
      const index = new Map<string, Transaction>();
      for (const transaction of transactions || []) {
         if (transaction.id) index.set(String(transaction.id), transaction);
         if (transaction.displayId) index.set(String(transaction.displayId), transaction);
         if ((transaction as any).ncf) index.set(String((transaction as any).ncf), transaction);
         if ((transaction as any).electronicNcf) index.set(String((transaction as any).electronicNcf), transaction);
      }
      return index;
   }, [transactions]);

   const selectedCustomerActiveReservationsCount = useMemo(() => {
      if (!selectedCustomer) return 0;
      return activeReservations.filter(r => r.customerId === selectedCustomer.id).length;
   }, [activeReservations, selectedCustomer]);

   const reservationFilterCustomerName = useMemo(() => {
      if (!reservationCustomerFilterId) return '';
      if (selectedCustomer?.id === reservationCustomerFilterId) return selectedCustomer.name;
      const fromCustomers = customers.find(c => c.id === reservationCustomerFilterId)?.name;
      if (fromCustomers) return fromCustomers;
      return activeReservations.find(r => r.customerId === reservationCustomerFilterId)?.customerName || 'Cliente';
   }, [reservationCustomerFilterId, selectedCustomer, customers, activeReservations]);

   const filteredActiveReservations = useMemo(() => {
      const scoped = reservationCustomerFilterId
         ? activeReservations.filter(r => r.customerId === reservationCustomerFilterId)
         : activeReservations;

      const term = reservationSearchTerm.trim().toLowerCase();
      if (!term) return scoped;
      return scoped.filter(r =>
         r.customerName.toLowerCase().includes(term) ||
         (r.customerId || '').toLowerCase().includes(term) ||
         r.code.toLowerCase().includes(term) ||
         r.id.toLowerCase().includes(term)
      );
   }, [activeReservations, reservationSearchTerm, reservationCustomerFilterId]);

   const filteredUberPendingOrders = useMemo(() => {
      if (reservationCustomerFilterId) return [];

      const term = reservationSearchTerm.trim().toLowerCase();
      if (!term) return uberPendingOrders;

      return uberPendingOrders.filter((order) => {
         return [
            order.customerName,
            order.displayId,
            order.uberOrderId,
            order.status,
         ].some((value) => normalizeSearchToken(value).includes(term));
      });
   }, [reservationCustomerFilterId, reservationSearchTerm, uberPendingOrders]);

   const recoverableOrders = useMemo<RecoverableOrderEntry[]>(() => {
      return [
         ...filteredUberPendingOrders.map((order) => ({ kind: 'UBER_EATS' as const, order })),
         ...filteredActiveReservations.map((reservation) => ({ kind: 'RESERVATION' as const, reservation })),
      ];
   }, [filteredActiveReservations, filteredUberPendingOrders]);

   const handleRedeemCoupon = () => {
      if (blockRecoveredUberOrderMutation('aplicar cupones')) return;

      const normalizedCouponCode = couponCode.trim().toUpperCase();
      if (!normalizedCouponCode) return;

      if (redeemedCoupon) {
         alert(`Ya hay un cupón aplicado en este ticket: ${redeemedCoupon.code}. Finalice o limpie el ticket antes de aplicar otro.`);
         return;
      }

      const cartSubtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const result = couponService.redeemCoupon(
         normalizedCouponCode,
         `TICKET-${Date.now()}`,
         terminalId,
         config,
         cartSubtotal,
         effectiveSelectedCustomer?.id
      );

      if (result.success) {
         if (result.updatedConfig) {
            onUpdateConfig(result.updatedConfig);
         }

         if (result.benefit) {
            if (result.benefit.type === 'PERCENT') {
               setGlobalDiscount({ type: 'PERCENT', value: result.benefit.value });
            } else if (result.benefit.type === 'FIXED_AMOUNT') {
               setGlobalDiscount({ type: 'FIXED', value: result.benefit.value });
            }
            if (result.coupon) {
               setRedeemedCoupon({
                  id: result.coupon.id,
                  code: result.coupon.code,
                  campaignId: result.coupon.campaignId,
                  assignedTo: result.coupon.assignedTo
               });
            }
            alert(`¡Cupón Canjeado!\n${result.benefit.description}`);
            setShowCouponModal(false);
            setCouponCode('');
         }
      } else {
         alert(`Error: ${result.error}`);
      }
   };

   const activeTariffTokens = useMemo(
      () => new Set([activeTariffId, activeTariff?.id, (activeTariff as any)?.code].map(normalizeSearchToken).filter(Boolean)),
      [activeTariffId, activeTariff]
   );

   const productTariffPriceById = useMemo(() => {
      const index = new Map<string, number | null>();
      for (const product of products || []) {
         if (!product?.id) continue;
         index.set(product.id, resolveActiveTariffPrice(product, activeTariffTokens, productPriceIndex));
      }
      return index;
   }, [activeTariffTokens, productPriceIndex, products]);

   const getTariffPrice = useCallback((p: Product) => {
      if (p?.id && productTariffPriceById.has(p.id)) {
         return productTariffPriceById.get(p.id) ?? null;
      }
      return resolveActiveTariffPrice(p, activeTariffTokens, productPriceIndex);
   }, [activeTariffTokens, productPriceIndex, productTariffPriceById]);

   const productHasActiveTariff = useCallback((p: Product) => getTariffPrice(p) !== null, [getTariffPrice]);

   const getProductPrice = useCallback((p: Product) => getTariffPrice(p) ?? 0, [getTariffPrice]);

   const productCodeIndex = useMemo(() => {
      const index = new Map<string, { product: Product; price: number; modifiers: string[]; selectedVariant?: ProductVariant; variantInfo?: string }>();
      const addCode = (code: unknown, value: { product: Product; price: number; modifiers: string[]; selectedVariant?: ProductVariant; variantInfo?: string }) => {
         if (Array.isArray(code)) {
            code.forEach((entry) => addCode(entry, value));
            return;
         }
         const normalized = String(code || '').trim();
         if (!normalized || index.has(normalized)) return;
         index.set(normalized, value);
      };

      for (const product of products || []) {
         if (!product || !productHasActiveTariff(product)) continue;
         const baseMatch = { product, price: getProductPrice(product), modifiers: [] as string[] };
         addCode(product.id, baseMatch);
         addCode(product.barcode, baseMatch);
         addCode((product as any).sku, baseMatch);
         addCode((product as any).item_code, baseMatch);
         addCode((product as any).code, baseMatch);

         for (const variant of product.variants || []) {
            const modifiersList = Object.values(variant.attributeValues || {}).map((value) => String(value || ''));
            const variantInfo = Object.entries(variant.attributeValues || {})
               .map(([key, value]) => `${key}: ${value}`)
               .join(' · ');
            const variantMatch = {
               product,
               price: variant.price || baseMatch.price,
               modifiers: modifiersList,
               selectedVariant: variant,
               variantInfo,
            };
            addCode(variant.sku, variantMatch);
            addCode(variant.barcode, variantMatch);
         }
      }

      return index;
   }, [getProductPrice, productHasActiveTariff, products]);

   const handleLoyaltyScan = useCallback((code: string) => {
      // Find customer by loyalty card or gift card
      const customer = (customers || []).find(c =>
         c.cards?.some(card => card.cardNumber === code && card.status === 'ACTIVE') ||
         c.loyalty?.cardNumber === code // Backward compatibility
      );

      if (customer) {
         onSelectCustomer(customer);
         setShowLoyaltyModal(false);
         // Optional: Show success toast/alert
         // alert(`Cliente asignado: ${customer.name}`);
      } else {
         alert("Tarjeta no encontrada o inactiva.");
      }
   }, [customers, onSelectCustomer]);

   const getCartInventoryDemandByProduct = useCallback((items: CartItem[]): Record<string, number> => {
      const demand: Record<string, number> = {};

      for (const cartItem of items || []) {
         const quantity = Number(cartItem.quantity || 0);
         if (quantity <= 0) continue;

         const deductions = calculateInventoryDeductions(cartItem, quantity, products);
         for (const deduction of deductions) {
            demand[deduction.productId] = (demand[deduction.productId] || 0) + Math.max(0, Number(deduction.quantityToDeduct || 0));
         }
      }

      return demand;
   }, [products]);

   const cartInventoryDemandByProduct = useMemo(
      () => getCartInventoryDemandByProduct(cart as CartItem[]),
      [cart, getCartInventoryDemandByProduct]
   );

   const cartQuantityByProduct = useMemo(() => {
      const quantities: Record<string, number> = {};
      for (const item of cart || []) {
         if (!item?.id) continue;
         quantities[item.id] = (quantities[item.id] || 0) + Number(item.quantity || 0);
      }
      return quantities;
   }, [cart]);

   const canAddItemToCart = useCallback((product: Product, quantityToAdd: number = 1): boolean => {
      // 0. Sellable check
      if (product.is_sellable === false) {
         setErrorToast(`Artículo no disponible para la venta (Insumo)`);
         setTimeout(() => setErrorToast(null), 3500);
         return false;
      }

      if (!productHasActiveTariff(product)) {
         setErrorToast('Artículo no disponible en la tarifa activa.');
         setTimeout(() => setErrorToast(null), 3500);
         return false;
      }

      const activeWarehouses = resolveProductActiveWarehouseIds(product, warehouses);
      if (activeWarehouses.length === 0) {
         setErrorToast('Artículo sin almacén asignado. Configure el producto antes de venderlo.');
         setTimeout(() => setErrorToast(null), 3500);
         return false;
      }

      // 1. Warehouse enablement check
      if (!productMatchesTerminalWarehouse(product)) {
         setErrorToast(`Artículo no habilitado en este almacén. (${getTerminalWarehouseName()})`);
         setTimeout(() => setErrorToast(null), 3500);
         return false;
      }

      // 2. Stock validation
      const trackInventory = product.operationalFlags?.trackInventory ?? config.features.stockTracking;
      if (trackInventory) {
         const consumptionMode = resolveInventoryConsumptionMode(product);
         if (consumptionMode === 'COMPONENTS' && quantityToAdd > 0) {
            const componentDeductions = calculateInventoryDeductions(product, quantityToAdd, products);
            const consolidatedDemand = componentDeductions.reduce<Record<string, number>>((acc, row) => {
               acc[row.productId] = (acc[row.productId] || 0) + Math.max(0, Number(row.quantityToDeduct || 0));
               return acc;
            }, {});

            for (const [componentId, qtyNeeded] of Object.entries(consolidatedDemand)) {
               const component = productById.get(componentId);
               if (!component) {
                  setErrorToast(`El kit ${product.name} no tiene completos sus componentes en POS.`);
                  setTimeout(() => setErrorToast(null), 3500);
                  return false;
               }

               const currentStock = getScopedProductStock(component);
               const committedQty = committedByProduct[componentId] || 0;
               const inCartQty = cartInventoryDemandByProduct[componentId] || 0;
               const availableStock = Math.max(0, currentStock - committedQty);
               const totalRequested = inCartQty + qtyNeeded;

               if (totalRequested > availableStock) {
                  setErrorToast(`Stock insuficiente en componente ${component.name}. Disponible: ${availableStock}. Requerido: ${totalRequested}`);
                  setTimeout(() => setErrorToast(null), 3500);
                  return false;
               }
            }

            return true;
         }

         const productAllowsNegative = product.operationalFlags?.allowNegativeStock ?? false;
         const terminalAllowsNegative = activeTerminalConfig?.workflow?.inventory?.allowNegativeStock ?? false;

         // If negative stock is NOT allowed (at either level), check availability
         if (!productAllowsNegative || !terminalAllowsNegative) {
            const currentStock = getScopedProductStock(product);
            const committedQty = committedByProduct[product.id] || 0;
            const availableStock = Math.max(0, currentStock - committedQty);
            const inCartQty = cartQuantityByProduct[product.id] || 0;
            const totalRequested = inCartQty + quantityToAdd;

            if (totalRequested > availableStock) {
               setErrorToast(`Stock insuficiente. Disponible: ${availableStock}. En carrito: ${inCartQty}`);
               setTimeout(() => setErrorToast(null), 3500);
               return false;
            }
         }
      }

      return true;
   }, [activeTerminalConfig, cartInventoryDemandByProduct, cartQuantityByProduct, committedByProduct, config.features.stockTracking, getScopedProductStock, getTerminalWarehouseName, productById, productHasActiveTariff, productMatchesTerminalWarehouse, products, warehouses]);

   const [lastAddedCartId, setLastAddedCartId] = useState<string | null>(null);

   const addToCart = useCallback((product: Product, quantity: number = 1, priceOverride?: number, modifiers?: string[], trackingData?: any[], selectedVariant?: ProductVariant, variantInfo?: string, note?: string, restaurantConfig?: CartItem['restaurantConfig']) => {
      if (blockRecoveredUberOrderMutation('agregar artículos adicionales')) return;
      if (quantity > 0 && !ensureSalesWithOpenZPermission()) return;
      if (!canAddItemToCart(product, quantity)) return;

      // TRACEABILITY INTERCEPTION
      const usesLots = product.operationalFlags?.usesLots;
      const usesSerial = product.operationalFlags?.usesSerial;
      if ((usesLots || usesSerial) && !trackingData) {
         setPendingTrackingProduct({ product, quantity, price: priceOverride, modifiers });
         return;
      }

      const finalPrice = priceOverride ?? selectedVariant?.price ?? getProductPrice(product);
      const modifiersString = buildModifierSignature(modifiers);
      const variantSku = selectedVariant?.sku;
      const effectiveTaxIds = resolveEffectiveTaxIds(product.appliedTaxIds, activeTerminalConfig);
      const taxSignature = effectiveTaxIds.slice().sort().join('|');
      const productRestaurantConfig = resolveRestaurantProductConfig(product);
      const productionAreaId = resolveProductionAreaId(product);
      const lineRestaurantConfig = restaurantConfig
         ? {
            ...restaurantConfig,
            product_type: restaurantConfig.product_type || productRestaurantConfig.product_type,
            production_area_id: restaurantConfig.production_area_id || productionAreaId || undefined,
         }
         : undefined;

      // We look for existing item in the stable 'cart' prop/state instead of inside the setter
      // to avoid using setter for logic that triggers side effects.
      const existing = (cart || []).find(i => {
         const iMods = buildModifierSignature(i.modifiers);
         const existingTaxSignature = resolveEffectiveTaxIds(i.appliedTaxIds, activeTerminalConfig).slice().sort().join('|');
         return i.id === product.id && (i.variantSku || '') === (variantSku || '') && iMods === modifiersString && i.price === finalPrice && existingTaxSignature === taxSignature;
      });

      let targetCartId: string;

      if (existing && !usesSerial && !existing.dispatched) {
         targetCartId = existing.cartId!;
         onUpdateCart(prev => {
            const updatedItem = {
               ...existing,
               quantity: existing.quantity + quantity,
               appliedTaxIds: effectiveTaxIds,
               production_area_id: resolveProductionAreaId(existing) || productionAreaId || undefined,
            };
            return [updatedItem, ...prev.filter(i => i.cartId !== existing.cartId)];
         });
      } else {
         const newCartId = Math.random().toString(36).substr(2, 9);
         targetCartId = newCartId;
         const newItem = {
            ...product,
            cartId: newCartId,
            quantity,
            price: finalPrice,
            modifiers,
            note,
            restaurantConfig: lineRestaurantConfig,
            selected_modifiers: lineRestaurantConfig?.selected_modifiers,
            selected_fraction_parts: lineRestaurantConfig?.selected_fraction_parts || lineRestaurantConfig?.fractions,
            selected_combo_items: lineRestaurantConfig?.selected_combo_items,
            product_type: productRestaurantConfig.product_type || product.product_type,
            variantSku,
            variantInfo,
            appliedTaxIds: effectiveTaxIds,
            production_area_id: productionAreaId || undefined,
            originalPrice: getProductPrice(product),
            trackingData
         };
         onUpdateCart(prev => [newItem, ...prev]);
      }

      // SIDE EFFECT: Move outside the state update sequence to avoid React "rendering update" warning
      setLastAddedCartId(targetCartId);
   }, [blockRecoveredUberOrderMutation, canAddItemToCart, ensureSalesWithOpenZPermission, getProductPrice, onUpdateCart, cart, activeTerminalConfig]); // Added cart to dependencies

   const handleProductClick = useCallback((product: Product) => {
      // MOBILE INTERCEPTION
      if (isMobile && !defaultSalesWarehouseId) {
         setPendingProductToAdd(product);
         setShowMobileConfigModal(true);
         return;
      }

      const productName = product.name || '';
      const isWeighted = product.type === 'SERVICE' || productName.toLowerCase().includes('(peso)');
      const hasVariants = (product.variants || []).length > 0 || (product.attributes || []).length > 0;
      const hasRestaurantConfig = productHasRestaurantConfiguration(product) || Boolean(
         (product.availableModifiers || []).length > 0
         || (product.modifier_groups || product.modifierGroups || []).length > 0
         || (product.combo_groups || product.comboGroups || []).length > 0
         || (product.fraction_rule || product.fractionRule)
         || (product.note_presets || product.notePresets || []).length > 0
      );
      const requiresConfigurationBeforeAdd = isWeighted || hasVariants || hasRestaurantConfig;

      if (!isReturnMode && !ensureSalesWithOpenZPermission()) return;
      if (requiresConfigurationBeforeAdd && !canAddItemToCart(product)) return;

      if (isWeighted) setProductForScale(product);
      else if (hasVariants) setSelectedProductForVariants(product);
      else if (hasRestaurantConfig) setProductForModifiers(product);
      else addToCart(product, isReturnMode ? -1 : 1);
   }, [isMobile, defaultSalesWarehouseId, ensureSalesWithOpenZPermission, canAddItemToCart, addToCart, isReturnMode]);

   const handleProductClickRef = useRef(handleProductClick);
   const quickActionDataRef = useRef(quickActionData);

   handleProductClickRef.current = handleProductClick;
   quickActionDataRef.current = quickActionData;

   const clearQuickActionTouchTimer = useCallback(() => {
      if (quickActionTouchTimerRef.current) {
         window.clearTimeout(quickActionTouchTimerRef.current);
         quickActionTouchTimerRef.current = null;
      }
      quickActionTouchStartRef.current = null;
      lastProductTouchAtRef.current = Date.now();
   }, []);

   const handleProductCardTouchStart = useCallback((product: Product, clientX: number, clientY: number) => {
      lastProductTouchAtRef.current = Date.now();
      quickActionTouchStartRef.current = { x: clientX, y: clientY, at: Date.now() };
      if (quickActionTouchTimerRef.current) {
         window.clearTimeout(quickActionTouchTimerRef.current);
      }
      quickActionTouchTimerRef.current = window.setTimeout(() => {
         quickActionOpenedAtRef.current = Date.now();
         lastTouchContextMenuAtRef.current = Date.now();
         setQuickActionData({ product, x: clientX, y: clientY });
         quickActionTouchTimerRef.current = null;
      }, 1200);
   }, []);

   const handleProductCardTouchMove = useCallback((clientX: number, clientY: number) => {
      const start = quickActionTouchStartRef.current;
      if (!start) return;
      const distance = Math.hypot(clientX - start.x, clientY - start.y);
      if (distance > 14) {
         clearQuickActionTouchTimer();
      }
   }, [clearQuickActionTouchTimer]);

   const handleProductCardClick = useCallback((product: Product) => {
      if (Date.now() - quickActionOpenedAtRef.current < 900) return;
      if (quickActionDataRef.current) return;
      handleProductClickRef.current(product);
   }, []);

   const handleProductCardContextMenu = useCallback((product: Product, event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const now = Date.now();
      if (now - lastProductTouchAtRef.current < 900) return;
      if (now - lastTouchContextMenuAtRef.current < 900) return;
      quickActionOpenedAtRef.current = now;
      setQuickActionData({ product, x: event.clientX, y: event.clientY });
   }, []);

   const hasPromotionForProduct = useCallback(
      (product: Product) => hasProductPromotion(product, config, activeTerminalId),
      [config, activeTerminalId]
   );

   const openProductPromotionSheet = useCallback((product: Product) => {
      setSelectedPromoProduct(product);
      setShowPromoSheet(true);
   }, []);

   // --- SEARCH LOGIC (Auto-Add Variantes) ---
   const findProductByAnyCode = useCallback((code: string) => {
      let quantity = 1;
      let searchCode = code.trim();

      // Multiplier Support: [Qty]*[SKU]
      if (searchCode.includes('*')) {
         const parts = searchCode.split('*');
         if (parts.length === 2 && !isNaN(Number(parts[0]))) {
            quantity = Number(parts[0]);
            searchCode = parts[1].trim();
         }
      }

      if (!searchCode) return null;

      const indexedMatch = productCodeIndex.get(searchCode);
      if (indexedMatch) {
         return {
            product: indexedMatch.product,
            quantity,
            price: indexedMatch.price,
            modifiers: indexedMatch.modifiers,
            selectedVariant: indexedMatch.selectedVariant,
            variantInfo: indexedMatch.variantInfo,
         };
      }

      for (const p of products) {
         // A. Check Variants (SKU or Barcode)
         if (p.variants && p.variants.length > 0) {
            for (const v of p.variants) {
               if ((v.sku === searchCode || (v.barcode && v.barcode.includes(searchCode))) && productHasActiveTariff(p)) {
                  // Map attribute values to a simple list of modifiers
                  const modifiersList = Object.entries(v.attributeValues || {}).map(([_, val]) => val);
                  const variantInfo = Object.entries(v.attributeValues || {})
                     .map(([key, value]) => `${key}: ${value}`)
                     .join(' · ');
                  return { product: p, quantity, price: v.price || getProductPrice(p), modifiers: modifiersList, selectedVariant: v, variantInfo };
               }
            }
         }

         const rootCodeCandidates = [
            typeof p.id === 'string' ? p.id.trim() : String(p.id || '').trim(),
            typeof p.barcode === 'string' ? p.barcode.trim() : String(p.barcode || '').trim(),
            typeof (p as any).sku === 'string' ? (p as any).sku.trim() : String((p as any).sku || '').trim(),
            typeof (p as any).item_code === 'string' ? (p as any).item_code.trim() : String((p as any).item_code || '').trim(),
            typeof (p as any).code === 'string' ? (p as any).code.trim() : String((p as any).code || '').trim(),
         ].filter(Boolean);

         // B. Check Parent (ID, SKU, Barcode, item_code, code)
         if (rootCodeCandidates.includes(searchCode) && productHasActiveTariff(p)) {
            return { product: p, quantity, price: getProductPrice(p), modifiers: [] };
         }
      }
      return null;
   }, [getProductPrice, productCodeIndex, productHasActiveTariff, products]);

   const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
         const rawValue = e.currentTarget.value || searchTerm || '';
         const match = findProductByAnyCode(rawValue);
         if (match) {
            addToCart(match.product, (isReturnMode ? -1 : 1) * match.quantity, match.price, match.modifiers, undefined, match.selectedVariant, match.variantInfo);
            setSearchTerm('');
            setErrorToast(null);
            // Ensure focus stays on search bar
            searchInputRef.current?.focus();
         } else if (rawValue.trim()) {
            setErrorToast("Código no encontrado");
            setTimeout(() => setErrorToast(null), 2000);
         }
      }
   }, [searchTerm, findProductByAnyCode, addToCart, isReturnMode]);

   // --- BARCODE SCANNER LOGIC ---
   const processBarcode = useCallback((code: string) => {
      const trimmed = code.trim();

      // 0. Try Smart QR (JSON)
      try {
         if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            const data = JSON.parse(trimmed);
            if (data.type === 'RESERVATION_NOTE' && (data.id || data.code)) {
               const found = activeReservationByScanCode.get(String(data.id || ''))
                  || activeReservationByScanCode.get(String(data.code || ''));
               if (found) {
                  handleRecoverReservation(found);
                  return;
               }
            }
            if (data.type === 'INVOICE_RETURN' && data.id) {
               setReturnInvoiceId(data.id);
               setShowReturnModal(true);
               return;
            }
         }
      } catch (e) {
         // Not a JSON or invalid
      }

      // 1. Try Scale Parser
      if (config.scaleLabelConfig?.isEnabled) {
         const scaleItem = parseScaleBarcode(trimmed, config.scaleLabelConfig);
         if (scaleItem) {
            const product = productCodeIndex.get(scaleItem.plu)?.product;

            if (product) {
               if (scaleItem.type === 'WEIGHT') {
                  addToCart(product, scaleItem.value);
                  setErrorToast(`⚖️ Peso: ${scaleItem.value.toFixed(3)}kg`);
               } else {
                  const unitPrice = getProductPrice(product);
                  if (unitPrice > 0) {
                     const weight = scaleItem.value / unitPrice;
                     addToCart(product, weight);
                     setErrorToast(`💲 Precio: $${scaleItem.value} (${weight.toFixed(3)}kg)`);
                  } else {
                     addToCart(product, 1, scaleItem.value);
                  }
               }
               setTimeout(() => setErrorToast(null), 3000);
               return;
            } else {
               setErrorToast(`Producto PLU ${scaleItem.plu} no encontrado`);
               setTimeout(() => setErrorToast(null), 3000);
               return;
            }
         }
      }

      // 2. Normal Barcode Search. Use the memoized code index instead of scanning
      // the whole catalog on every hardware scan.
      const match = findProductByAnyCode(trimmed);
      if (match) {
         const hasConfiguredVariant = Boolean(match.selectedVariant || match.modifiers?.length);
         if (!hasConfiguredVariant && ((match.product.variants || []).length > 0 || (match.product.attributes || []).length > 0)) {
            handleProductClick(match.product);
         } else {
            addToCart(match.product, match.quantity, match.price, match.modifiers, undefined, match.selectedVariant, match.variantInfo);
         }
         setErrorToast(`Producto agregado: ${match.product.name}`);
         setTimeout(() => setErrorToast(null), 1500);
         return;
      }

      // 3. Try Transaction Search only for document-looking scans. Product
      // barcodes should not pay the cost of scanning large ticket histories.
      if (looksLikeDocumentScan(trimmed)) {
         const txnFound = transactionByScanCode.get(trimmed);
         if (txnFound) {
            setReturnInvoiceId(txnFound.id);
            setShowReturnModal(true);
         }
      }
   }, [activeReservationByScanCode, addToCart, config.scaleLabelConfig, handleProductClick, getProductPrice, handleRecoverReservation, findProductByAnyCode, productCodeIndex, transactionByScanCode]);

   const isAnyModalOpen = !!(
      showPaymentModal ||
      showSplitModal ||
      showTicketOptions ||
      showParkedList ||
      showGlobalDiscount ||
      showCouponModal ||
      editingItem ||
      selectedProductForVariants ||
      productForScale ||
      showLoyaltyModal ||
      isScannerOpen ||
      showReturnModal ||
      showPromoSheet ||
      showMobileConfigModal ||
      showReservationModal ||
      !!showReservationReceipt ||
      showRecoverReservationModal ||
      supervisorModalProps.isOpen
   );

   useEffect(() => {
      if (isAnyModalOpen) return;

      const handleCentralBarcodeScan = (event: Event) => {
         const barcode = (event as CustomEvent<{ barcode?: string }>).detail?.barcode;
         if (!barcode) return;
         processBarcode(barcode);
      };

      window.addEventListener('barcodeScanned', handleCentralBarcodeScan as EventListener);
      return () => window.removeEventListener('barcodeScanned', handleCentralBarcodeScan as EventListener);
   }, [isAnyModalOpen, processBarcode]);

   const fiscalCompliance = useMemo(
      () => getEffectiveFiscalComplianceConfig(config, activeTerminalConfig),
      [config, activeTerminalConfig]
   );
   const fiscalCartGrossTotal = useMemo(
      () => (cart || []).reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0),
      [cart]
   );
   const fiscalThresholdBucket = useMemo(() => {
      const threshold = Number(activeTerminalConfig?.operational?.fiscalThreshold || 0);
      return threshold > 0 && fiscalCartGrossTotal > threshold ? 'OVER_THRESHOLD' : 'BASE';
   }, [activeTerminalConfig?.operational?.fiscalThreshold, fiscalCartGrossTotal]);
   const requiredSaleFiscalType = useMemo<FiscalDocumentCode>(() => {
      const customerFiscalType = selectedCustomer?.defaultNcfType;
      const baseLegacyType: NCFType = fiscalThresholdBucket === 'OVER_THRESHOLD'
         ? 'B01'
         : (
            customerFiscalType?.startsWith('E')
               ? mapElectronicFiscalCodeToLegacy(customerFiscalType as any) as NCFType
               : (customerFiscalType || (selectedCustomer?.requiresFiscalInvoice ? 'B01' : 'B02')) as NCFType
         );
      return resolveSaleFiscalCode(fiscalCompliance.mode, baseLegacyType);
   }, [
      fiscalCompliance.mode,
      fiscalThresholdBucket,
      selectedCustomer?.defaultNcfType,
      selectedCustomer?.requiresFiscalInvoice
   ]);

   useEffect(() => {
      let cancelled = false;

      const checkFiscalStatus = async () => {
         const type = requiredSaleFiscalType;
         const [buffers, allocations, ranges] = await Promise.all([
            db.get('localFiscalBuffer'),
            db.get('fiscalAllocations'),
            db.get('fiscalRanges'),
         ]);
         if (cancelled) return;

         const localBuffer: any = (Array.isArray(buffers) ? buffers : []).find((buffer: any) =>
            buffer?.type === type &&
            (!buffer?.terminalId || buffer?.terminalId === terminalId)
         );
         const activeAllocation: any = (Array.isArray(allocations) ? allocations : []).find((allocation: any) =>
            allocation?.ncfType === type &&
            allocation?.terminalId === terminalId &&
            (
               allocation?.status === 'ACTIVE' ||
               (
                  allocation?.status === 'EXHAUSTED' &&
                  Number(allocation?.nextNumber) <= Number(allocation?.reservedEnd)
               )
            )
         );
         const allocationRange: any = (Array.isArray(ranges) ? ranges : []).find((range: any) =>
            (activeAllocation?.fiscalRangeId && range?.id === activeAllocation.fiscalRangeId)
            || (!activeAllocation?.fiscalRangeId && range?.type === type && range?.isActive)
         );
         let fiscalRemaining = 0;
         let fiscalTotal = 0;

         const allocationNextNumber = activeAllocation
            ? Math.max(
               Number(activeAllocation.reservedStart || 0),
               Number(activeAllocation.nextNumber || activeAllocation.reservedStart || 0)
            )
            : 0;
         const localBufferCurrent = Number(localBuffer?.currentNumber || 0);
         const localBufferIsAligned =
            Boolean(localBuffer) &&
            (
               !activeAllocation ||
               (
                  localBufferCurrent >= allocationNextNumber &&
                  Number(localBuffer?.endNumber || 0) <= Number(activeAllocation.reservedEnd || 0)
               )
            );

         if (localBufferIsAligned && localBuffer && Number(localBuffer.currentNumber) <= Number(localBuffer.endNumber)) {
            const current = Number(localBuffer.currentNumber);
            const blockStart = Number(activeAllocation?.reservedStart || localBuffer.startNumber || current);
            const blockEnd = Number(activeAllocation?.reservedEnd || localBuffer.endNumber || current);
            const remaining = Math.max(0, blockEnd - current + 1);
            const total = Math.max(0, blockEnd - blockStart + 1);
            fiscalRemaining = remaining;
            fiscalTotal = total;

            setStatus({
               isConnected: true,
               currentNCF: `${localBuffer.prefix}${current.toString().padStart(8, '0')}`,
               remaining,
               expiryDate: localBuffer.expiryDate,
               batteryLevel: 100
            });
         } else if (activeAllocation && Number(activeAllocation.nextNumber) <= Number(activeAllocation.reservedEnd)) {
            const current = Number(activeAllocation.nextNumber);
            const remaining = Math.max(0, Number(activeAllocation.reservedEnd) - current + 1);
            const total = Math.max(0, Number(activeAllocation.reservedEnd) - Number(activeAllocation.reservedStart) + 1);
            const prefix = String(allocationRange?.prefix || type);
            fiscalRemaining = remaining;
            fiscalTotal = total;

            setStatus({
               isConnected: true,
               currentNCF: `${prefix}${current.toString().padStart(8, '0')}`,
               remaining,
               expiryDate: String(allocationRange?.expiryDate || ''),
               batteryLevel: 100
            });
         }

         const hasLocal = Boolean(localBuffer && Number(localBuffer.currentNumber) <= Number(localBuffer.endNumber));
         const allocationCanIssue = Boolean(activeAllocation && Number(activeAllocation.nextNumber) <= Number(activeAllocation.reservedEnd));
         const rangeCanIssue = Boolean(
            !activeAllocation &&
            (Array.isArray(ranges) ? ranges : []).some((range: any) =>
               range?.type === type &&
               range?.isActive &&
               Number(range?.currentGlobal || 0) < Number(range?.endNumber || 0)
            )
         );
         const canRequest = allocationCanIssue || rangeCanIssue;
         const hasNCF = hasLocal || canRequest;
         const isTerminalBlock = Boolean(activeAllocation || localBuffer?.allocationId);
         setFiscalStatus({ type, hasNCF, localBuffer: localBuffer || activeAllocation || null, isUsingPool: !hasLocal && canRequest, isTerminalBlock, remaining: fiscalRemaining, total: fiscalTotal });
      };
      checkFiscalStatus();
      return () => {
         cancelled = true;
      };
   }, [requiredSaleFiscalType, terminalId]);

   const fiscalReserveAlert = useMemo(() => {
      if (!fiscalStatus.hasNCF) return null;
      return getFiscalReserveAlert(fiscalStatus.remaining || 0, fiscalStatus.total || 0, fiscalCompliance);
   }, [fiscalCompliance, fiscalStatus.hasNCF, fiscalStatus.remaining, fiscalStatus.total]);

   const shouldShowFiscalReserveAlert = Boolean(
      fiscalReserveAlert &&
      cart.length === 0 &&
      searchTerm.trim().length === 0
   );

   const salesCatalogProducts = useMemo(() => {
      const nonSeedBusinessKeys = new Set<string>();

      for (const product of products) {
         if (!product || typeof product !== 'object' || Array.isArray(product)) continue;
         if (isSeedCatalogProduct(product)) continue;
         productBusinessKeys(product).forEach((key) => nonSeedBusinessKeys.add(key));
      }

      return products.filter((product) => {
         if (!product || typeof product !== 'object' || Array.isArray(product)) return false;
         if (!isSeedCatalogProduct(product)) return true;

         const businessKeys = productBusinessKeys(product);
         return !businessKeys.some((key) => nonSeedBusinessKeys.has(key));
      });
   }, [products]);

   const dedupedSalesCatalogProducts = useMemo(() => {
      type RankedProductEntry = { product: Product; score: number; keys: Set<string> };
      const rankedByIdentity = new Map<string, RankedProductEntry>();

      for (const product of salesCatalogProducts) {
         if (!product || typeof product !== 'object' || Array.isArray(product)) continue;

         const keys = productSalesIdentityKeys(product);
         const score = scoreProductForSales(product, warehouses);
         const matchedEntries = Array.from(
            new Set(keys.map((key) => rankedByIdentity.get(key)).filter(Boolean) as RankedProductEntry[])
         );
         const bestExisting = matchedEntries
            .sort((left, right) => right.score - left.score)[0];
         const incomingEntry: RankedProductEntry = { product, score, keys: new Set(keys) };
         const winner = !bestExisting || score > bestExisting.score ? incomingEntry : bestExisting;
         const mergedKeys = new Set<string>(keys);

         for (const entry of matchedEntries) {
            entry.keys.forEach((key) => mergedKeys.add(key));
         }

         winner.keys = mergedKeys;
         for (const key of mergedKeys) {
            rankedByIdentity.set(key, winner);
         }
      }

      const uniqueEntries = Array.from(new Set(rankedByIdentity.values()));
      return uniqueEntries.map((entry) => entry.product);
   }, [salesCatalogProducts, warehouses]);

   const salesCatalogProductEntries = useMemo<SalesCatalogProductEntry[]>(() => {
      return dedupedSalesCatalogProducts.map((product) => {
         const searchableCodes = [
            product.barcode,
            (product as any).sku,
            (product as any).item_code,
            (product as any).code,
         ];
         const variantCodes = Array.isArray((product as any).variants)
            ? (product as any).variants.flatMap((variant: any) => [variant?.sku, variant?.barcode])
            : [];

         return {
            product,
            displayCategory: displayCategory(product.category),
            hasActiveTariff: productHasActiveTariff(product),
            hasErpWarehouse: resolveProductActiveWarehouseIds(product, warehouses).length > 0,
            isSellable: product.is_sellable !== false,
            normalizedCategory: canonicalizeCategory(product.category),
            searchText: [product.name, ...searchableCodes, ...variantCodes]
               .map(normalizeSearchToken)
               .filter(Boolean)
               .join(' '),
         };
      });
   }, [canonicalizeCategory, dedupedSalesCatalogProducts, displayCategory, productHasActiveTariff, warehouses]);

   const filteredProducts = useMemo(() => {
      const normalizedCategoryFilter = categoryFilter === 'ALL'
         ? 'ALL'
         : canonicalizeCategory(categoryFilter);
      const normalizedSearch = deferredSearchTerm.trim().toLowerCase();

      const filtered = salesCatalogProductEntries.filter((entry) => {
         const matchSearch = !normalizedSearch
            || entry.searchText.includes(normalizedSearch);

         const matchCat = normalizedCategoryFilter === 'ALL' || entry.normalizedCategory === normalizedCategoryFilter;
         const matchAllowedCat = effectiveAllowedCategorySet.size === 0 || effectiveAllowedCategorySet.has(entry.normalizedCategory);

         // Tarifa activa de la caja debe existir en datos ERP; almacén en grid no tiene que coincidir con la terminal (la venta se bloquea en canAddItemToCart).
         return matchSearch && matchCat && matchAllowedCat && entry.isSellable && entry.hasActiveTariff && entry.hasErpWarehouse;
      });

      // Defensive: Ensure unique IDs to prevent React key warnings
      const seenIds = new Set();
         return filtered.map((entry) => entry.product).filter(p => {
            if (seenIds.has(p.id)) return false;
            seenIds.add(p.id);
            return true;
         });
   }, [salesCatalogProductEntries, categoryFilter, deferredSearchTerm, canonicalizeCategory, effectiveAllowedCategorySet]);

   const handleRetailSearchSubmit = useCallback((rawTerm?: string) => {
      const trimmed = (rawTerm ?? searchTerm ?? '').trim();
      if (!trimmed) {
         retailSearchInputRef.current?.focus();
         return;
      }

      const match = findProductByAnyCode(trimmed);
      if (match) {
         addToCart(match.product, (isReturnMode ? -1 : 1) * match.quantity, match.price, match.modifiers, undefined, match.selectedVariant, match.variantInfo);
         setSearchTerm('');
         setErrorToast(null);
         retailSearchInputRef.current?.focus();
         return;
      }

      if (filteredProducts.length === 1) {
         handleProductClick(filteredProducts[0]);
         setSearchTerm('');
         setErrorToast(null);
         retailSearchInputRef.current?.focus();
         return;
      }

      if (filteredProducts.length === 0) {
         setErrorToast("Código no encontrado");
         setTimeout(() => setErrorToast(null), 2000);
      }

      retailSearchInputRef.current?.focus();
   }, [searchTerm, findProductByAnyCode, addToCart, isReturnMode, filteredProducts, handleProductClick]);

   const categoryOptions = useMemo(() => {
      const allowedCategoryOptions = Array.from(effectiveAllowedCategorySet)
         .map((category) => ({
            id: canonicalizeCategory(category),
            label: displayCategory(category),
         }))
         .filter((category) => category.id && category.label);
      const availableProducts = salesCatalogProductEntries.filter((entry) => {
         if (!entry.isSellable || !entry.hasActiveTariff || !entry.hasErpWarehouse) return false;
         if (effectiveAllowedCategorySet.size > 0) {
            if (!effectiveAllowedCategorySet.has(entry.normalizedCategory)) return false;
         }
         return true;
      });

      const availableCategoryMap = new Map<string, string>();
      for (const entry of availableProducts) {
         const normalizedCategory = entry.normalizedCategory;
         const rawCategory = entry.displayCategory;
         if (!rawCategory || availableCategoryMap.has(normalizedCategory)) continue;
         availableCategoryMap.set(normalizedCategory, rawCategory);
      }

      const productCategories = Array.from(availableCategoryMap.entries())
         .map(([id, label]) => ({ id, label }))
         .sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));

      const scopedCategories = productCategories.length > 0
         ? productCategories
         : allowedCategoryOptions;

      const dedupedCategoryOptions = new Map<string, { id: string; label: string }>();
      for (const category of scopedCategories) {
         if (!category.id || dedupedCategoryOptions.has(category.id)) continue;
         dedupedCategoryOptions.set(category.id, category);
      }

      return [{ id: 'ALL', label: 'Todas' }, ...Array.from(dedupedCategoryOptions.values())];
   }, [canonicalizeCategory, displayCategory, effectiveAllowedCategorySet, salesCatalogProductEntries]);

   const categoryOptionIds = useMemo(() => categoryOptions.map((option) => option.id), [categoryOptions]);

   useEffect(() => {
      const selectedCategoryKey = categoryFilter === 'ALL' ? 'ALL' : canonicalizeCategory(categoryFilter);
      if (selectedCategoryKey !== 'ALL' && !categoryOptionIds.includes(selectedCategoryKey)) {
         setCategoryFilter('ALL');
      }
   }, [canonicalizeCategory, categoryFilter, categoryOptionIds]);

   // --- PROMOTION ENGINE INTEGRATION ---
   const processedCart = useMemo(() => {
      return applyPromotions(cart, config, activeTerminalId, selectedCustomer || undefined);
   }, [cart, config, activeTerminalId, selectedCustomer]);

   useEffect(() => {
      if (!activeCartItemId) return;
      const stillExists = processedCart.some((item) => item.cartId === activeCartItemId);
      if (!stillExists) {
         setActiveCartItemId(null);
      }
   }, [processedCart, activeCartItemId]);

   const toggleCartItemFocus = useCallback((cartId?: string | null) => {
      if (!cartId) return;
      setActiveCartItemId((current) => (current === cartId ? null : cartId));
   }, []);

   const renderTicketBrand = useCallback((compact = false) => (
      <div className={`inline-flex flex-col items-center ${compact ? 'gap-1.5' : 'gap-2.5'}`}>
         <div className={`inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-950 shadow-sm ${compact ? 'px-2.5 py-1.5' : 'px-4 py-2.5'}`}>
            <span className={`font-black uppercase tracking-[0.22em] text-slate-100 ${compact ? 'text-[0.72rem]' : 'text-[0.8rem]'}`}>CLIC</span>
            <span className={`font-black uppercase tracking-[0.22em] text-sky-400 ${compact ? 'text-[0.72rem]' : 'text-[0.8rem]'}`}>POS</span>
         </div>
      </div>
   ), []);
   const cartQuantity = useMemo(
      () => processedCart.reduce((sum, item) => sum + Math.abs(Number(item.quantity || 0)), 0),
      [processedCart]
   );

   const isTaxIncluded = activeTariff?.taxIncluded || false;
   const grossLineTotal = useMemo(
      () => processedCart.reduce((sum, item) => sum + (item.price * item.quantity), 0),
      [processedCart]
   );

   const discountAmount = useMemo(
      () => globalDiscount.type === 'PERCENT'
         ? grossLineTotal * (globalDiscount.value / 100)
         : Math.min(globalDiscount.value, grossLineTotal),
      [globalDiscount.type, globalDiscount.value, grossLineTotal]
   );

   const taxBreakdown = useMemo(() => {
      return calculateTaxBreakdownFromItems(processedCart, config, {
         discountAmount,
         isTaxIncluded,
         terminalConfig: activeTerminalConfig,
      });
   }, [processedCart, config, discountAmount, isTaxIncluded, activeTerminalConfig]);

   const displayTaxBreakdown = useMemo(() => {
      const grouped = new Map<string, { id: string; name: string; rate: number; amount: number }>();
      taxBreakdown.forEach((tax) => {
         const rateKey = String(Math.round((Number(tax.rate || 0) <= 1 ? Number(tax.rate || 0) * 100 : Number(tax.rate || 0)) * 1000) / 1000);
         const existing = grouped.get(rateKey);
         const normalizedName = (tax.name || '').toLowerCase();
         const displayName = normalizedName.includes('itbis') ? tax.name : existing?.name || tax.name;
         grouped.set(rateKey, {
            id: existing?.id || `tax-rate-${rateKey}`,
            name: displayName,
            rate: tax.rate,
            amount: (existing?.amount || 0) + tax.amount,
         });
      });
      return Array.from(grouped.values()).map((tax) => ({
         ...tax,
         amount: Math.round((tax.amount + Number.EPSILON) * 100) / 100,
      }));
   }, [taxBreakdown]);

   const cartTax = displayTaxBreakdown.reduce((sum, t) => sum + t.amount, 0);
   const primaryTaxLabel = useMemo(() => {
      if (displayTaxBreakdown.length === 1) {
         return formatTaxLineLabel(displayTaxBreakdown[0]);
      }
      return null;
   }, [displayTaxBreakdown]);
   const combinedTaxBreakdown = useMemo(() => {
      if (displayTaxBreakdown.length <= 1) return [];
      return displayTaxBreakdown.map((tax) => ({
         id: tax.id,
         label: formatTaxLineLabel(tax),
         amount: tax.amount,
      }));
   }, [displayTaxBreakdown]);

   const tipsConfig = config.tipsConfig;
   const serviceCharge = tipsConfig?.serviceCharge;

   const shouldApplyServiceCharge = useMemo(() => {
      if (!isRestaurantMode || !serviceCharge?.enabled) return false;

      const currentGross = grossLineTotal - discountAmount;
      const totalOver = serviceCharge.applyIfTotalOver || 0;
      const guestsOver = serviceCharge.applyIfGuestsOver || 0;

      const guestMatch = guestsOver > 0 && (activeTable?.guests || 0) >= guestsOver;
      const totalMatch = totalOver > 0 && currentGross >= totalOver;

      if (totalOver === 0 && guestsOver === 0) return true;
      return totalMatch || guestMatch;
   }, [isRestaurantMode, serviceCharge, grossLineTotal, discountAmount, activeTable]);

   const {
      legalTipRate,
      cartTip,
      cartTotalWithoutTip,
      netSubtotal,
      cartTotal,
   } = useMemo(() => {
      const nextLegalTipRate = shouldApplyServiceCharge ? (serviceCharge?.percentage || 0) / 100 : 0;
      const nextCartTip = (grossLineTotal - discountAmount) * nextLegalTipRate;

      let nextCartTotalWithoutTip = 0;
      let nextNetSubtotal = 0;

      if (isTaxIncluded) {
         nextCartTotalWithoutTip = grossLineTotal - discountAmount;
         nextNetSubtotal = nextCartTotalWithoutTip - cartTax;
      } else {
         nextNetSubtotal = grossLineTotal - discountAmount;
         nextCartTotalWithoutTip = nextNetSubtotal + cartTax;
      }

      return {
         legalTipRate: nextLegalTipRate,
         cartTip: nextCartTip,
         cartTotalWithoutTip: nextCartTotalWithoutTip,
         netSubtotal: nextNetSubtotal,
         cartTotal: nextCartTotalWithoutTip + nextCartTip,
      };
   }, [cartTax, discountAmount, grossLineTotal, isTaxIncluded, serviceCharge?.percentage, shouldApplyServiceCharge]);

   // Alias for compatibility if needed, though netSubtotal is what we usually display as "Subtotal"
   const cartSubtotal = grossLineTotal; // This represents the sum of list prices
   const baseCurrency = (config.currencies || []).find(c => c.isBase) || (config.currencies || [])[0];
   const getCartItemTaxSummary = useCallback((item: CartItem) => {
      const lineTaxBreakdown = calculateTaxBreakdownFromItems([item], config, {
         isTaxIncluded,
         terminalConfig: activeTerminalConfig,
         absoluteLineValues: true,
      });
      if (lineTaxBreakdown.length === 0) {
         return 'Sin impuestos';
      }
      const lineTaxAmount = Math.abs(lineTaxBreakdown.reduce((sum, tax) => sum + Number(tax.amount || 0), 0));
      return `${lineTaxBreakdown.map((tax) => formatTaxLineLabel(tax)).join(' + ')} (${baseCurrency.symbol}${lineTaxAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
   }, [config, isTaxIncluded, activeTerminalConfig, baseCurrency.symbol]);
   const isRecoveredUberOrder = isUberRecoveredReservation(activeRecoveredReservation);
   const reservationAdvanceApplied = activeRecoveredReservation
      ? (isRecoveredUberOrder
         ? Math.min(activeRecoveredReservation.prepaidPayment?.amount || activeRecoveredReservation.balancePaid || 0, cartTotal)
         : Math.min(activeRecoveredReservation.balancePaid || 0, cartTotal))
      : 0;
   const reservationBalanceDue = isRecoveredUberOrder
      ? 0
      : Math.max(0, cartTotal - reservationAdvanceApplied);
   const amountDueNow = activeRecoveredReservation
      ? (isRecoveredUberOrder ? 0 : reservationBalanceDue)
      : cartTotal;
   const checkoutActionLabel = !fiscalStatus.hasNCF
      ? 'Sin Secuencia'
      : isRecoveredUberOrder
         ? 'FACTURAR UBER'
         : activeRecoveredReservation
            ? 'COBRAR SALDO'
            : 'COBRAR';
   const editableRecoveredReservation = isRecoveredUberOrder ? null : activeRecoveredReservation;
   const isEditingRecoveredReservation = !!editableRecoveredReservation;

   useEffect(() => {
      const orderId = activeTable?.currentOrderId;
      if (!orderId) return;
      if (cart.length === 0) return;

      const existing = parkedTickets.find(ticket => ticket.id === orderId);
      const nextDigest = buildCartDigest(cart);
      const existingDigest = buildCartDigest(existing?.items || []);
      const sameCustomer = (existing?.customerId || '') === (selectedCustomer?.id || '');
      const sameCustomerName = (existing?.customerName || '') === (selectedCustomer?.name || '');
      const existingTotal = Number(existing?.total || 0);
      const sameFinalTotal = Math.abs(existingTotal - cartTotal) < 0.01;

      if (existingDigest === nextDigest && sameCustomer && sameCustomerName && sameFinalTotal) {
         return;
      }

      const syncedTicket: ParkedTicket = {
         id: orderId,
         name: existing?.name || `Mesa: ${activeTableContext.compactLabel || activeTable.nombre || activeTable.name || orderId}`,
         alias: existing?.alias,
         items: [...cart],
         total: cartTotal,
         customerId: selectedCustomer?.id,
         customerName: selectedCustomer?.name,
         timestamp: existing?.timestamp || new Date().toISOString(),
         orderNumber: readCartOrderNumber(cart) || existing?.orderNumber,
         tableDisplayLabel: activeTableContext.compactLabel || existing?.tableDisplayLabel,
         tableRoomLabel: activeTableContext.roomLabel || existing?.tableRoomLabel,
      };

      const nextTickets = [...parkedTickets.filter(ticket => ticket.id !== orderId), syncedTicket];

      if (ticketAutoSyncTimeoutRef.current) {
         window.clearTimeout(ticketAutoSyncTimeoutRef.current);
      }

      ticketAutoSyncTimeoutRef.current = window.setTimeout(() => {
         onUpdateParkedTickets(nextTickets);
         ticketAutoSyncTimeoutRef.current = null;
      }, 120);

      return () => {
         if (ticketAutoSyncTimeoutRef.current) {
            window.clearTimeout(ticketAutoSyncTimeoutRef.current);
            ticketAutoSyncTimeoutRef.current = null;
         }
      };
   }, [
      activeTable?.currentOrderId,
      activeTableContext.compactLabel,
      activeTableContext.roomLabel,
      activeTable?.nombre,
      activeTable?.name,
      cart,
      cartTotal,
      parkedTickets,
      selectedCustomer?.id,
      selectedCustomer?.name,
      onUpdateParkedTickets
   ]);

   const handleCreateReservation = async () => {
      if (cart.length === 0) {
         alert('No hay artículos en el ticket para reservar.');
         return;
      }

      const customer = customers.find(c => c.id === reservationCustomerId) || selectedCustomer;
      if (!customer) {
         alert(`Debe seleccionar un cliente para ${isEditingRecoveredReservation ? 'actualizar' : 'crear'} la reserva.`);
         return;
      }

      if (!reservationDeliveryDate) {
         alert('Debe indicar la fecha de entrega de la reserva.');
         return;
      }

      const advance = Math.max(0, parseFloat(reservationAdvanceInput || '0') || 0);
      const minAdvance = reservationPolicy.requireAdvance
         ? (cartTotal * (Math.max(0, reservationPolicy.minimumAdvancePercent || 0) / 100))
         : 0;

      if (reservationPolicy.requireAdvance && advance < minAdvance) {
         alert(`Anticipo insuficiente. Mínimo requerido: ${baseCurrency.symbol}${minAdvance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${reservationPolicy.minimumAdvancePercent}%).`);
         return;
      }

      if (advance > cartTotal) {
         alert('El abono no puede exceder el total de la reserva.');
         return;
      }

      const now = new Date();
      const expiryDate = new Date(now);
      expiryDate.setDate(expiryDate.getDate() + Math.max(1, reservationPolicy.validityDays || 7));

      const reservationId = editableRecoveredReservation?.id || `RSV-${Date.now()}`;
      const reservationCode = editableRecoveredReservation?.code || `RSV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const qrPayload = editableRecoveredReservation?.qrPayload || JSON.stringify({ type: 'RESERVATION_NOTE', id: reservationId, code: reservationCode });
      const warehouseId = editableRecoveredReservation?.warehouseId || defaultSalesWarehouseId || 'wh_central';
      const reservationItems = processedCart.filter(i => (i.quantity || 0) > 0).map(item => ({ ...item }));

      if (reservationItems.length === 0) {
         alert('La reserva requiere al menos una línea de venta positiva.');
         return;
      }

      const reservation: Reservation = {
         id: reservationId,
         code: reservationCode,
         qrPayload,
         customerId: customer.id,
         customerName: customer.name,
         total: cartTotal,
         balancePaid: advance,
         expiryDate: editableRecoveredReservation?.expiryDate || expiryDate.toISOString(),
         status: 'ACTIVE',
         items: reservationItems,
         warehouseId,
         deliveryDate: reservationDeliveryDate ? new Date(`${reservationDeliveryDate}T00:00:00`).toISOString() : undefined,
         terminalId,
         createdById: editableRecoveredReservation?.createdById || currentUser.id,
         createdByName: editableRecoveredReservation?.createdByName || currentUser.name,
         createdAt: editableRecoveredReservation?.createdAt || now.toISOString(),
         updatedAt: now.toISOString()
      };

      await db.saveDocument('reservations', reservation);
      if (editableRecoveredReservation) {
         const previousWarehouseId = editableRecoveredReservation.warehouseId || defaultSalesWarehouseId || 'wh_central';
         await transferStockToCommitted(editableRecoveredReservation.items || [], previousWarehouseId, products, 'RELEASE');
         await transferStockToCommitted(reservation.items, warehouseId, products, 'COMMIT');
      } else {
         await transferStockToCommitted(reservation.items, warehouseId, products, 'COMMIT');
      }
      await reloadReservations();

      setShowReservationModal(false);
      setShowReservationReceipt(reservation);
      setReservationAdvanceInput('0');
      setReservationDeliveryDate('');
      setReservationCustomerId('');
      onUpdateCart([]);
      onSelectCustomer(null);
      setActiveRecoveredReservation(null);
      setSuccessToast(`Reserva ${reservation.code} ${isEditingRecoveredReservation ? 'actualizada' : 'creada'}`);
   };

   const pointsEarned = useMemo(() => calculatePointsEarned(processedCart, config), [processedCart, config]);
   const primaryLoyaltyCard = selectedCustomer ? getPrimaryLoyaltyCard(selectedCustomer) : undefined;
   const currentPoints = primaryLoyaltyCard?.pointsBalance || 0;

   // --- VISOR SYNC ---
   useEffect(() => {
      const displayConfig = activeTerminalConfig?.hardware?.customerDisplay;
      // Always push state to visor if it's listening - the visor will only display if opened
      visorSync.pushState({
         cart: processedCart,
         subtotal: cartSubtotal,
         tax: cartTax,
         discountAmount: discountAmount,
         total: cartTotal,
         welcomeMessage: displayConfig?.welcomeMessage || '¡Bienvenidos!',
         ads: (displayConfig?.ads || []).filter(ad => ad.active),
         currencySymbol: baseCurrency.symbol
      });
   }, [processedCart, cartSubtotal, cartTax, discountAmount, cartTotal, activeTerminalConfig, baseCurrency]);

   useEffect(() => {
      const isVisorMode = new URLSearchParams(window.location.search).get('view') === 'VISOR';
      if (isVisorMode) return;
      void maybeAutoLaunchCustomerDisplay(
         activeTerminalConfig?.hardware?.customerDisplay,
         { contextKey: terminalId || activeTerminal?.id || 'default' },
      );
   }, [activeTerminal?.id, activeTerminalConfig?.hardware?.customerDisplay, terminalId]);

   useEffect(() => {
      if (cart.length > 0) {
         cartEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
   }, [cart.length]);

   useEffect(() => {
      if (cart.length === 0 && activeRecoveredReservation) {
         setActiveRecoveredReservation(null);
      }
   }, [cart.length, activeRecoveredReservation]);

   useEffect(() => {
      if (cart.length > 0 || !redeemedCoupon) return;
      setRedeemedCoupon(null);
      setCouponCode('');
      setGlobalDiscount({ type: 'PERCENT', value: 0 });
   }, [cart.length, redeemedCoupon]);



   const updateCartItem = async (updatedItem: CartItem | null, cartIdToDelete?: string) => {
      if (blockRecoveredUberOrderMutation('editar el pedido')) return;

      let newCart: CartItem[] = [];

      if (cartIdToDelete || updatedItem === null) {
         const targetCartId = cartIdToDelete || editingItem?.cartId;
         const originalItem = (cart || []).find(i => i.cartId === targetCartId);
         if (originalItem?.dispatched) {
            alert(isKdsReturnedCartItem(originalItem)
               ? 'Este artículo ya fue devuelto en cocina y queda bloqueado para auditoría.'
               : 'Este artículo ya fue enviado al KDS. Usa Devolver para marcarlo en cocina; no se puede borrar directamente.'
            );
            return;
         }

         // Void Line Check
         const authorized = await requestApproval({
            permission: 'POS_VOID_ITEM',
            actionDescription: 'Eliminar artículo del carrito',
            context: { itemId: targetCartId }
         });
         if (!authorized) return;

         newCart = cart.filter(i => i.cartId !== targetCartId);
      } else {
         // Update Check (Price Override / Discount)
         const originalItem = (cart || []).find(i => i.cartId === updatedItem.cartId);

         if (originalItem?.dispatched) {
            const originalQty = Number(originalItem.quantity || 0);
            const nextQty = Number(updatedItem.quantity || 0);
            if (Math.abs(nextQty - originalQty) > 0.0001) {
               alert(isKdsReturnedCartItem(originalItem)
                  ? 'Este artículo ya fue devuelto en cocina y queda bloqueado para auditoría.'
                  : 'Este artículo ya fue enviado al KDS. Para cancelar la preparación usa Devolver; para agregar más cantidad, agrega una línea nueva.'
               );
               return;
            }
         }

         // Stock Check (Quantity Increase)
         if (originalItem && updatedItem.quantity > originalItem.quantity) {
            const diff = updatedItem.quantity - originalItem.quantity;
            if (!canAddItemToCart(updatedItem, diff)) return;
         }
         newCart = cart.map(item => item.cartId === updatedItem.cartId ? updatedItem : item);
      }

      onUpdateCart(newCart);

      // KDS Sync (if active table)
      if (activeTable) {
         const ticketId = activeTable.currentOrderId;
         const total = newCart.reduce((sum, i) => sum + (i.price * i.quantity), 0);

         // Update Local Persistence
         if (onUpdateParkedTickets) {
            const updatedTickets = parkedTickets.map(p => p.id === ticketId ? { ...p, items: newCart } : p);
            onUpdateParkedTickets(updatedTickets);
         }

         // Update KDS
         try {
            fetch(`http://localhost:8001/api/ordenes/${ticketId}`, {
               method: 'PUT',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ items: newCart, total, status: 'OCCUPIED' })
            });
         } catch (e) {
            console.error("Auto-sync delete failed:", e);
         }
      }
   };


   const handlePaymentConfirm = async (payments: PaymentEntry[], voluntaryTip?: number): Promise<Transaction | null> => {
         const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, timeoutLabel: string): Promise<T> => {
         let timeoutHandle: number | undefined;
         try {
            return await Promise.race([
               promise,
               new Promise<T>((_, reject) => {
                  timeoutHandle = window.setTimeout(() => reject(new Error(timeoutLabel)), timeoutMs);
               })
            ]);
         } finally {
            if (timeoutHandle) window.clearTimeout(timeoutHandle);
         }
      };

      try {
         const terminalId = activeTerminalId || 't1';
         const fiscalCompliance = getEffectiveFiscalComplianceConfig(config, activeTerminalConfig);
         const uberRecoveredOrder = isUberRecoveredReservation(activeRecoveredReservation) ? activeRecoveredReservation : null;
         const customerForCheckout = uberRecoveredOrder ? null : effectiveSelectedCustomer;
         const couponAssignedTo = redeemedCoupon?.assignedTo?.trim();
         if (couponAssignedTo && couponAssignedTo !== customerForCheckout?.id) {
            alert('El cupón aplicado está asignado a un cliente específico. Seleccione ese cliente antes de finalizar la venta.');
            return null;
         }
         const couponSyncFields = redeemedCoupon
            ? {
               couponCode: redeemedCoupon.code,
               coupons: [{
                  id: redeemedCoupon.id,
                  code: redeemedCoupon.code,
                  campaignId: redeemedCoupon.campaignId
               }]
            }
            : {};
         const hasReturns = processedCart.some(i => i.quantity < 0);
         const hasSales = processedCart.some(i => i.quantity > 0);
         if (hasSales && !ensureSalesWithOpenZPermission()) return null;
         const productsById = new Map(products.map(product => [product.id, product] as const));
         const isRefundOnly = hasReturns && !hasSales;
         const refundSeriesId = activeTerminalConfig?.documentAssignments?.['REFUND'] || 'REFUND';
         const assignedSequenceId = activeTerminalConfig?.documentAssignments?.['TICKET']!;
         const normalizedRefundItems = processedCart
            .filter(i => i.quantity < 0)
            .map(item => ({ ...item, quantity: Math.abs(item.quantity) }));
         const sellableConditions = new Map<string, 'SELLABLE' | 'DAMAGED'>();
         normalizedRefundItems.forEach(item => sellableConditions.set(item.cartId, 'SELLABLE'));

         // --- FISCAL COMPLIANCE CHECK (DGII RNC VALIDATION) ---
         const isCreditFiscalDocument = !isRefundOnly && fiscalStatus && (fiscalStatus.type === 'B01' || fiscalStatus.type === 'E31');
         if (isCreditFiscalDocument) {
            const buyerTaxDigits = String(customerForCheckout?.taxId || '').replace(/\D/g, '');
            const hasValidBuyerTaxId = buyerTaxDigits.length === 9 || buyerTaxDigits.length === 11;
            if (!customerForCheckout || !hasValidBuyerTaxId) {
               alert(
                  `⛔ COMPROBANTE BLOQUEADO\n\n` +
                  `Para emitir Crédito Fiscal (${fiscalStatus.type}) debe seleccionar un cliente con RNC/Cédula válido.\n\n` +
                  `Acción requerida: complete el RNC/Cédula del cliente o cambie el tipo de comprobante a Consumo (${fiscalStatus.type === 'E31' ? 'E32' : 'B02'}).`
               );
               return null;
            }

            if (customerForCheckout.fiscalStatus && customerForCheckout.fiscalStatus !== 'ACTIVO') {
               alert(
                  `⛔ COMPROBANTE BLOQUEADO\n\n` +
                  `El contribuyente ${customerForCheckout.name} tiene estatus: ${customerForCheckout.fiscalStatus || 'DESCONOCIDO'}.\n` +
                  `No se puede emitir Crédito Fiscal (${fiscalStatus.type}) según normas de la DGII.\n\n` +
                  `Acción requerida: Cambie el tipo de comprobante a Consumo (${fiscalStatus.type === 'E31' ? 'E32' : 'B02'}) o seleccione otro cliente.`
               );
               return null;
            }
         }

         const validation = validateTerminalSeries(activeTerminalConfig, isRefundOnly ? 'REFUND' : 'TICKET');
         if (!validation.isValid) {
            alert(validation.message);
            return null;
         }

         if (hasReturns && hasSales) {
            const refundValidation = validateTerminalSeries(activeTerminalConfig, 'REFUND');
            if (!refundValidation.isValid) {
               alert(refundValidation.message);
               return null;
            }
         }

         for (const item of processedCart) {
            const sourceProduct = productsById.get(item.id);
            if (!sourceProduct) {
               alert(`No se pudo validar el artículo ${item.name}. Refresque la lista e intente nuevamente.`);
               return null;
            }
            if (!canAddItemToCart(sourceProduct, 0)) {
               alert(`El artículo "${sourceProduct.name}" no tiene un almacén válido para esta terminal. Corrija la ficha del producto antes de continuar.`);
               return null;
            }
         }

         let finalNcf: string | undefined;
         let finalNcfType: FiscalDocumentCode | undefined;

         if (isRefundOnly) {
            try {
               finalNcf = await withTimeout(
                  db.getNextNCF('B04', terminalId, activeTerminalConfig?.fiscal?.typeConfigs?.['B04']?.batchSize || 50),
                  8000,
                  'TIMEOUT_GET_REFUND_ONLY_NCF'
               );
               finalNcfType = finalNcf ? 'B04' : undefined;
            } catch (refundNcfError) {
               console.warn('No se pudo generar NCF B04 para devolución:', refundNcfError);
            }
         } else {
            finalNcf = await withTimeout(
               db.getNextNCF(fiscalStatus.type, terminalId, activeTerminalConfig?.fiscal?.typeConfigs?.[fiscalStatus.type]?.batchSize || 100),
               8000,
               'TIMEOUT_GET_NCF'
            );

            if (!finalNcf) {
               alert(`CRÍTICO: No hay NCF de ${fiscalStatus.type === 'B01' || fiscalStatus.type === 'E31' ? 'Crédito Fiscal' : 'Consumo'} disponible. Pool DGII agotado.`);
               return null;
            }

            finalNcfType = fiscalStatus.type;
         }

         const reservationAdvance = activeRecoveredReservation && !uberRecoveredOrder
            ? Math.min(activeRecoveredReservation.balancePaid || 0, cartTotal)
            : 0;
         const reservationAdvancePayment: PaymentEntry = {
            id: `ADV-${Date.now()}`,
            method: 'ADVANCE',
            amount: reservationAdvance,
            timestamp: new Date()
         };
         const paymentsForTransaction = reservationAdvance > 0
            ? [...payments, reservationAdvancePayment]
            : payments;
         const creditAmount = sumCreditPaymentsBase(paymentsForTransaction);
         const hasCreditOverrideApproval = paymentsForTransaction.some(
            (payment) => paymentEntryIsCxCCredit(payment) && payment.creditOverrideApproved
         );

         if (activeRecoveredReservation && hasReturns) {
            alert('La recuperación de reserva no admite líneas de devolución. Finalice la reserva y procese devoluciones por separado.');
            return null;
         }

         if (creditAmount > 0) {
            const creditGate = evaluateCreditSupervisorGate(customerForCheckout, 0, creditAmount);
            if (creditGate?.reason === 'NO_CUSTOMER') {
               alert('No se puede guardar un ticket con pago pendiente a crédito sin un cliente asociado.');
               onOpenCustomers();
               return null;
            }

            if (creditGate && !hasCreditOverrideApproval) {
               if (creditGate.reason === 'NO_LIMIT') {
                  alert('El cliente no tiene un límite de crédito configurado. Solicite autorización para guardar este ticket.');
               } else {
                  alert(`El cliente excede su límite de crédito (${baseCurrency.symbol}${creditGate.limit.toFixed(2)}). No se guardó el ticket.`);
               }
               return null;
            }
         }

         try {
            // If it's a mixed transaction, use the split endpoint
            if (hasReturns && hasSales) {
               const saleItems = processedCart.filter(i => i.quantity > 0);
               const returnItems = processedCart.filter(i => i.quantity < 0);

               // Calculate totals for each part
               const saleTotal = saleItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
               const normalizedSplitRefundItems = returnItems.map(item => ({ ...item, quantity: Math.abs(item.quantity) }));
               const returnTotal = normalizedSplitRefundItems.reduce((acc, i) => acc + (i.price * i.quantity), 0);
               const saleTaxBreakdown = calculateTaxBreakdownFromItems(saleItems, config, {
                  isTaxIncluded,
                  terminalConfig: activeTerminalConfig,
               });
               const saleTaxAmount = Math.round((
                  saleTaxBreakdown.reduce((sum, tax) => sum + Number(tax.amount || 0), 0)
                  + Number.EPSILON
               ) * 100) / 100;
               const saleNetAmount = isTaxIncluded
                  ? Math.round(((saleTotal - saleTaxAmount) + Number.EPSILON) * 100) / 100
                  : saleTotal;
               const salePayments = payments.filter(p => !['WALLET', 'ADVANCE'].includes(p.method));
               const saleSettlement = buildTransactionSettlementFields(salePayments, saleTotal, baseCurrency.code);

               // Prepare wallet operations
               const walletDepositAmount = payments.filter(p => p.method === 'ADVANCE').reduce((acc, p) => acc + p.amount, 0);
               const walletPaymentAmount = payments.filter(p => p.method === 'WALLET').reduce((acc, p) => acc + p.amount, 0);
               let refundNcf: string | undefined;

               if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
                  try {
                     refundNcf = await withTimeout(
                        db.getNextNCF('B04', terminalId, activeTerminalConfig?.fiscal?.typeConfigs?.['B04']?.batchSize || 50),
                        8000,
                        'TIMEOUT_GET_REFUND_NCF'
                     );
                  } catch (refundNcfError) {
                     console.warn('No se pudo generar NCF B04 para devolución mixta:', refundNcfError);
                  }
               }

               const splitPayload: Parameters<typeof transactionService.createSplitTransaction>[0] = {
                     saleTransaction: {
                        documentType: 'TICKET' as const,
                        seriesId: assignedSequenceId,
                        items: saleItems,
                        total: saleTotal + (voluntaryTip || 0),
                        payments: salePayments,
                        serviceChargeAmount: isRestaurantMode ? cartTip : undefined,
                        voluntaryTipAmount: voluntaryTip,
                        ...saleSettlement,
                        ...couponSyncFields,
                        userId: currentUser.id,
                        userName: currentUser.name,
                        terminalId: terminalId,
                        status: creditAmount > 0 ? 'PENDING' : 'COMPLETED',
                        customerId: customerForCheckout?.id,
                        customerName: customerForCheckout?.name,
                        ncf: finalNcf,
                        ncfType: fiscalStatus.type,
                        legacyNcf: fiscalStatus.type.startsWith('E') ? undefined : finalNcf,
                        electronicNcf: fiscalStatus.type.startsWith('E') ? finalNcf : undefined,
                        fiscalMode: fiscalCompliance.mode,
                        fiscalProvider: fiscalStatus.type.startsWith('E') ? getDefaultFiscalProvider(config, activeTerminalConfig) : 'NONE',
                        taxAmount: saleTaxAmount,
                        netAmount: saleNetAmount,
                        pendingBalance: creditAmount || undefined,
                        dueDate: creditAmount > 0 ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : undefined,
                        balanceDueAtSale: creditAmount > 0 ? creditAmount : undefined,
                        customerSnapshot: customerForCheckout ? {
                           name: customerForCheckout.name,
                           taxId: customerForCheckout.taxId
                        } : undefined,
                        walletPaymentAmount: walletPaymentAmount > 0 ? walletPaymentAmount : undefined
                     },
                     refundTransaction: {
                        documentType: 'REFUND' as const,
                        seriesId: refundSeriesId,
                        items: normalizedSplitRefundItems,
                        total: returnTotal,
                        userId: currentUser.id,
                        userName: currentUser.name,
                        terminalId: terminalId,
                        customerId: customerForCheckout?.id,
                        customerName: customerForCheckout?.name,
                        status: 'COMPLETED',
                        ncf: refundNcf,
                        ncfType: refundNcf ? 'B04' : undefined,
                        walletDepositAmount: walletDepositAmount > 0 ? walletDepositAmount : undefined,
                        walletPaymentAmount: walletPaymentAmount > 0 ? walletPaymentAmount : undefined,
                        serviceChargeAmount: isRestaurantMode ? cartTip : undefined,
                        voluntaryTipAmount: voluntaryTip,
                        authorizedById: refundAuthorizedBy?.id,
                        authorizedByName: refundAuthorizedBy?.name
                     },
                     walletDeposit: customerForCheckout?.id && walletDepositAmount > 0 ? { customerId: customerForCheckout.id, amount: walletDepositAmount } : undefined,
                     walletPayment: customerForCheckout?.id && walletPaymentAmount > 0 ? { customerId: customerForCheckout.id, amount: walletPaymentAmount } : undefined
                  };

               if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
                  const result = await withTimeout(
                     transactionService.createSplitTransaction(splitPayload),
                     25000,
                     'TIMEOUT_SPLIT_LOCAL'
                  );

                  if (result.sale) {
                     await persistStandaloneSaleHistory({
                        ...result.sale,
                        syncStatus: 'PENDING'
                     });
                  }

                  if (result.refund) {
                     await persistStandaloneRefundTransaction(
                        {
                           ...result.refund,
                           items: normalizedSplitRefundItems,
                           total: returnTotal,
                           ncf: refundNcf,
                           ncfType: refundNcf ? 'B04' : undefined,
                           status: 'REFUNDED',
                           refundReason: 'Devolución en transacción mixta',
                           authorizedById: refundAuthorizedBy?.id,
                           authorizedByName: refundAuthorizedBy?.name,
                           syncStatus: 'PENDING'
                        },
                        {
                           warehouseId: defaultSalesWarehouseId || 'wh_central',
                           terminalId
                        }
                     );
                  }

                  onUpdateCart([]);
                  if (redeemedCoupon) setGlobalDiscount({ type: 'PERCENT', value: 0 });
                  setRedeemedCoupon(null);
                  setCouponCode('');
                  onSelectCustomer(null);
                  setIsReturnMode(false);
                  setRefundAuthorizedBy(null);
                  return result.sale || result.refund || null;
               }

               const response = await withTimeout(fetch('/api/transactions/split', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(splitPayload)
               }), 25000, 'TIMEOUT_SPLIT_FETCH');

               const data = await withTimeout(response.json(), 4000, 'TIMEOUT_SPLIT_PARSE');
               if (data.success) {
                  onUpdateCart([]);
                  if (redeemedCoupon) setGlobalDiscount({ type: 'PERCENT', value: 0 });
                  setRedeemedCoupon(null);
                  setCouponCode('');
                  onSelectCustomer(null);
                  setIsReturnMode(false);
                  setRefundAuthorizedBy(null);
                  return data.result.sale || data.result.refund;
               } else {
                  alert(`Error en transacción: ${data.message}`);
                  return null;
               }
            } else {
               // Standard single transaction logic
               const taxAmount = cartTax;
               const netAmount = isTaxIncluded
                  ? (grossLineTotal - discountAmount - taxAmount)
                  : (grossLineTotal - discountAmount);

               const walletDepositAmount = payments.filter(p => p.method === 'ADVANCE').reduce((acc, p) => acc + p.amount, 0);
               const walletPaymentAmount = payments.filter(p => p.method === 'WALLET').reduce((acc, p) => acc + p.amount, 0);
               const refundDocumentTotal = normalizedRefundItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);
               const rawDocumentItems = isRefundOnly ? normalizedRefundItems : processedCart;
               const saleOrderNumber = !isRefundOnly
                  ? (readCartOrderNumber(processedCart) || reserveNextOrderNumber())
                  : undefined;
               const documentItems = !isRefundOnly
                  ? applyOrderContextToItems(rawDocumentItems, saleOrderNumber)
                  : rawDocumentItems;
               const documentTotal = (isRefundOnly ? refundDocumentTotal : cartTotal) + (voluntaryTip || 0);
               const transactionSettlement = buildTransactionSettlementFields(paymentsForTransaction, documentTotal, baseCurrency.code);

               const txn = await withTimeout(transactionService.createTransaction({
                  documentType: hasReturns ? 'REFUND' : 'TICKET',
                  seriesId: hasReturns
                     ? (activeTerminalConfig?.documentAssignments?.['REFUND'] || 'REFUND-GENERIC')
                     : assignedSequenceId,
                  date: new Date().toISOString(),
                  items: documentItems,
                  total: documentTotal,
                  payments: paymentsForTransaction,
                  ...transactionSettlement,
                  userId: currentUser.id,
                  userName: currentUser.name,
                  terminalId: terminalId,
                  status: !isRefundOnly && creditAmount > 0 ? 'PENDING' : 'COMPLETED',
                  customerId: customerForCheckout?.id,
                  customerName: customerForCheckout?.name || activeRecoveredReservation?.customerName,
                  orderNumber: saleOrderNumber,
                  tableDisplayLabel: activeTableContext.compactLabel || undefined,
                  tableRoomLabel: activeTableContext.roomLabel || undefined,
                  pendingBalance: creditAmount > 0 ? creditAmount : undefined,
                  dueDate: creditAmount > 0 ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : undefined, // Default 30 days
                  ncf: finalNcf,
                  ncfType: finalNcfType,
                  legacyNcf: finalNcfType?.startsWith('E') ? undefined : finalNcf,
                  electronicNcf: finalNcfType?.startsWith('E') ? finalNcf : undefined,
                  fiscalMode: fiscalCompliance.mode,
                  fiscalProvider: finalNcfType?.startsWith('E') ? getDefaultFiscalProvider(config, activeTerminalConfig) : 'NONE',
                  taxAmount: taxAmount,
                  netAmount: netAmount,
                  discountAmount: discountAmount,
                  ...(isRefundOnly ? {} : couponSyncFields),
                  customerSnapshot: customerForCheckout ? {
                     name: customerForCheckout.name,
                     taxId: customerForCheckout.taxId,
                     address: customerForCheckout.address,
                     phone: customerForCheckout.phone,
                     email: customerForCheckout.email
                  } : activeRecoveredReservation ? {
                     name: activeRecoveredReservation.customerName
                  } : undefined,
                  isTaxIncluded: isTaxIncluded,
                  authorizedById: hasReturns ? refundAuthorizedBy?.id : undefined,
                  authorizedByName: hasReturns ? refundAuthorizedBy?.name : undefined,
                  reservationId: uberRecoveredOrder?.sourceOrderId || activeRecoveredReservation?.id,
                  reservationCode: uberRecoveredOrder?.code || activeRecoveredReservation?.code,
                  priorAdvancePaid: reservationAdvance > 0 ? reservationAdvance : undefined,
                  balanceDueAtSale: creditAmount > 0
                     ? creditAmount
                     : activeRecoveredReservation ? reservationBalanceDue : undefined,
                  walletDepositAmount: walletDepositAmount > 0 ? walletDepositAmount : undefined,
                  walletPaymentAmount: walletPaymentAmount > 0 ? walletPaymentAmount : undefined,
                  serviceChargeAmount: isRestaurantMode ? cartTip : undefined,
                  voluntaryTipAmount: voluntaryTip,
                  marketplaceSourceChannel: uberRecoveredOrder ? 'UBER_EATS' : undefined,
                  marketplaceSourceOrderId: uberRecoveredOrder?.sourceOrderId,
                  marketplaceSourceStoreId: uberRecoveredOrder?.sourceStoreId,
                  marketplaceTenantId: uberRecoveredOrder?.tenantId,
                  marketplaceCompanyId: uberRecoveredOrder?.companyId,
                  marketplaceStoreId: uberRecoveredOrder?.storeId,
                  skipErpSaleSync: Boolean(uberRecoveredOrder),
                  erpConfirmationStatus: uberRecoveredOrder ? 'PENDING' : undefined,
                  observations: uberRecoveredOrder
                     ? `Uber Eats ${uberRecoveredOrder.code} / ${uberRecoveredOrder.sourceOrderId}`
                     : undefined
               }), 25000, 'TIMEOUT_CREATE_TRANSACTION');

               // Ensure seriesId is preserved (Backend might not return it in the root object)
               const finalTxn = {
                  ...txn,
                  seriesId: txn.seriesId || (isRefundOnly ? refundSeriesId : assignedSequenceId)
               };

               if (isRefundOnly) {
                  await persistStandaloneRefundTransaction(
                     {
                        ...finalTxn,
                        items: normalizedRefundItems,
                        total: refundDocumentTotal,
                        status: 'REFUNDED',
                        ncf: finalNcf,
                        ncfType: finalNcfType,
                        refundReason: 'Devolución POS',
                        authorizedById: refundAuthorizedBy?.id,
                        authorizedByName: refundAuthorizedBy?.name,
                        syncStatus: 'PENDING'
                     },
                     {
                        warehouseId: defaultSalesWarehouseId || 'wh_central',
                        terminalId,
                        conditions: sellableConditions
                     }
                  );
               } else {
                  onTransactionComplete(finalTxn);
               }

               if (activeRecoveredReservation && !uberRecoveredOrder) {
                  const warehouseId = activeRecoveredReservation.warehouseId || defaultSalesWarehouseId || 'wh_central';
                  await withTimeout(
                     transferStockToCommitted(activeRecoveredReservation.items || [], warehouseId, products, 'RELEASE'),
                     10000,
                     'TIMEOUT_RELEASE_COMMITTED'
                  );
                  await withTimeout(db.saveDocument('reservations', {
                     ...activeRecoveredReservation,
                     status: 'INVOICED',
                     invoicedAt: new Date().toISOString(),
                     invoicedTransactionId: txn.id,
                     updatedAt: new Date().toISOString()
                  }), 6000, 'TIMEOUT_SAVE_RESERVATION_INVOICE');
                  await withTimeout(reloadReservations(), 6000, 'TIMEOUT_RELOAD_RESERVATIONS');
               }

               if (uberRecoveredOrder?.sourceOrderId) {
                  await confirmExistingUberTransaction(uberRecoveredOrder.sourceOrderId, finalTxn);
                  await loadUberPendingOrders();
               }

               // --- CRITICAL: Ticket Closing Logic ---
               if (activeTable) {
                  try {
                     // 1. Free table in the main API so status/currentOrderId are reset.
                     const controller = new AbortController();
                     const timeoutId = window.setTimeout(() => controller.abort(), 4000);
                     try {
                        const releaseRes = await fetch('/api/mesas/liberar', {
                           method: 'POST',
                           headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({ tableId: activeTable.id }),
                           signal: controller.signal
                        });
                        if (!releaseRes.ok) {
                           throw new Error(`HTTP ${releaseRes.status}`);
                        }
                        const releaseData = await releaseRes.json().catch(() => null);
                        if (releaseData && releaseData.success === false) {
                           throw new Error(releaseData.message || 'No se pudo liberar la mesa');
                        }
                     } finally {
                        window.clearTimeout(timeoutId);
                     }

                     // 2. Remove from Parked Tickets (Local Persistence)
                     if (activeTable.currentOrderId) {
                        const remaining = parkedTickets.filter(p => p.id !== activeTable.currentOrderId);
                        onUpdateParkedTickets(remaining);
                     }
                  } catch (e) {
                     console.error("Failed to free table:", e);
                  }
                  // 3. Clear Active Table in UI
                  if (onClearActiveTable) onClearActiveTable();
               } else {
                  // If not a table (e.g. Counter Sale), check if it was a parked ticket we just recovered
                  // Heuristic: If we have a selected customer or just checking if the current cart matches a parked ID?
                  // For now, mostly relevant for Tables.
               }

               onUpdateCart([]);
               if (redeemedCoupon) setGlobalDiscount({ type: 'PERCENT', value: 0 });
               setRedeemedCoupon(null);
               setCouponCode('');
               onSelectCustomer(null);
               setIsReturnMode(false);
               setRefundAuthorizedBy(null);
               setActiveRecoveredReservation(null);
               return txn;
            }
         } catch (error: any) {
            console.error('Split Transaction Error:', error);
            alert(`Error de red: ${error.message}`);
            return null;
         }
      } catch (error: any) {
         console.error('Payment confirm error:', error);
         alert(`Error al finalizar venta: ${error?.message || 'Error desconocido'}`);
         return null;
      }
   };

   const handleSplitConfirm = (remainingItems: CartItem[], newTicketItems: CartItem[], extraNewTickets: CartItem[][] = [], splitCount = 2) => {
      onUpdateCart(remainingItems);

      const baseName = activeTable?.name || activeTable?.nombre || 'Mesa';
      const now = Date.now();
      const splitGroups = [newTicketItems, ...extraNewTickets].filter(items => items.length > 0);
      const newTickets: ParkedTicket[] = splitGroups.map((items, index) => ({
         id: `split-${now}-${index + 2}`,
         tableId: activeTable?.id || 'manual',
         name: `${baseName} - Cuenta ${index + 2}/${splitCount}`,
         alias: `${baseName} - Cuenta ${index + 2}/${splitCount}`,
         items,
         total: items.reduce((acc, item) => acc + (Number(item.price || 0) * Number(item.quantity || 0)), 0),
         timestamp: new Date().toISOString()
      }));

      onUpdateParkedTickets([...parkedTickets, ...newTickets]);
      setShowSplitModal(false);
      setSuccessToast(`Cuenta dividida en ${splitCount}: cuentas guardadas en Tickets en Espera`);
   };

   const proceedToCheckout = () => {
      const hasSaleLines = cart.some(item => Number(item.quantity || 0) > 0);
      if (hasSaleLines && !ensureSalesWithOpenZPermission()) return;

      const threshold = activeTerminalConfig?.operational?.fiscalThreshold || 0;
      if (threshold > 0 && cartTotal > threshold && !selectedCustomer) {
         alert(`ATENCIÓN: El monto de la venta (${baseCurrency.symbol}${cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}) excede el umbral fiscal permitido para facturas de consumo (${baseCurrency.symbol}${threshold.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}).\n\nEs obligatorio identificar al cliente y emitir una Factura de Crédito Fiscal (B01).`);
         onOpenCustomers();
         return;
      }

      if (activeRecoveredReservation && amountDueNow <= 0.0001) {
         const marketplacePayment = isRecoveredUberOrder
            ? buildUberRecoveredPayment(activeRecoveredReservation, cartTotal)
            : null;
         handlePaymentConfirm(marketplacePayment ? [marketplacePayment] : []).catch(console.error);
         return;
      }
      setShowPaymentModal(true);
   };

   const handleDispatchCommand = async () => {
      if (cart.length === 0) return;

      const newItems = cart.filter(item => !item.dispatched);
      if (newItems.length === 0) {
         alert("Todos los ítems ya han sido enviados.");
         return;
      }

      const orderId = activeTable?.currentOrderId || `P-${Date.now()}`;
      const orderNumber = readCartOrderNumber(cart) || reserveNextOrderNumber();
      const displayOrderRef = orderNumber || activeTableContext.compactLabel || orderId;

      try {
         const configuredAreas = await db.get('productionAreas' as any).catch(() => []) as any;
         const productionAreas: ProductionAreaConfig[] = Array.isArray(configuredAreas) ? configuredAreas : [];
         const areaById = new Map(productionAreas.map(area => [String(area.id), area]));
         const configuredProducts = await db.get('products' as any).catch(() => []) as any;
         const productionProducts: Product[] = Array.isArray(configuredProducts) ? configuredProducts : [];
         const resolveAreaForDispatch = buildProductionAreaResolver(productionAreas, productionProducts);

         // 1. Group only routed items by production area for separate tickets/KDS screens.
         const areas: Record<string, { area: ProductionAreaConfig, title: string, items: CartItem[] }> = {};
         const dispatchMetaByCartId = new Map<string, KdsDispatchMeta>();
         newItems.forEach(item => {
            const areaId = resolveAreaForDispatch(item);
            if (!areaId) return;

            const configuredArea = areaById.get(areaId);
            if (!configuredArea) {
               console.warn('[KDS] Producto con centro de producción no configurado en POS:', {
                  itemId: item.id,
                  itemName: item.name,
                  areaId,
               });
               return;
            }

            if (!areas[areaId]) {
               areas[areaId] = {
                  area: configuredArea,
                  title: configuredArea.nombre || areaId,
                  items: []
               };
            }
            areas[areaId].items.push(item);
         });

         const areaEntries = Object.entries(areas);
         if (areaEntries.length === 0) {
            alert("No hay ítems con centro de producción configurado para enviar.");
            return;
         }

         let printedCount = 0;
         let sentKdsCount = 0;
         let queuedKdsCount = 0;
         const dispatchedCartIds = new Set<string>();
         const activeTableRoom = activeTable?.roomId ? rooms?.find(room => room.id === activeTable.roomId) : undefined;
         const kdsTablePayload = activeTable ? {
            id: activeTable.id,
            name: activeTable.name || activeTable.nombre,
            displayLabel: activeTableContext.compactLabel || null,
            roomId: activeTable.roomId || null,
            roomName: activeTableRoom?.name || activeTableRoom?.nombre || null,
            guests: activeTable.guests || activeTable.capacity || null,
         } : null;

         // 2. Print and/or send to KDS per configured area.
         for (const [areaId, areaData] of Object.entries(areas)) {
            const mode = normalizeProductionMode(areaData.area.modo_salida);
            const shouldPrint = mode === 'PRINTER' || mode === 'AMBOS';
            const shouldSendKds = mode === 'KDS' || mode === 'AMBOS';

            if (shouldPrint) {
               const printed = await printComanda(config, {
                  items: areaData.items,
                  table: activeTable
                     ? ({ ...activeTable, tableDisplayLabel: activeTableContext.compactLabel } as any)
                     : undefined,
                  orderNumber,
                  customerName: selectedCustomer?.name,
                  areaTitle: areaData.title,
                  productionAreaId: areaId
               });
               if (printed) printedCount += 1;
            }

            if (shouldSendKds) {
               const kdsBaseUrl = resolveKdsBaseUrl(areaData.area, config);
               const kdsItems = buildKdsDispatchItems(areaData.items, areaId);
               const areaTotal = areaData.items.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
               const warningMinutes = normalizeKdsMinutes(areaData.area.kds_warning_minutes, 10);
               const criticalMinutes = Math.max(
                  warningMinutes + 1,
                  normalizeKdsMinutes(areaData.area.kds_critical_minutes, 20)
               );
               const kdsPayload = {
                  orderId,
                  displayId: displayOrderRef,
                  orderNumber,
                  date: new Date().toISOString(),
                  terminalId: activeTerminalId,
                  userName: currentUser.name,
                  customerName: selectedCustomer?.name || 'Cliente General',
                  table: kdsTablePayload,
                  area: {
                     id: areaId,
                     name: areaData.title,
                     targetTerminalId: areaData.area.target_terminal_id || null,
                     warningMinutes,
                     criticalMinutes,
                  },
                  kdsTiming: {
                     warningMinutes,
                     criticalMinutes,
                  },
                  items: kdsItems,
                  total: areaTotal,
               };

               if (!kdsBaseUrl) {
                  queuedKdsCount += 1;
                  await queuePendingKdsDispatch({
                     reason: 'KDS_HOST_NOT_CONFIGURED',
                     areaId,
                     areaName: areaData.title,
                     payload: kdsPayload,
                  });
               } else {
                  try {
                     await postJsonWithTimeout(`${kdsBaseUrl}/api/ordenes/${encodeURIComponent(orderId)}`, {
                        items: kdsItems,
                        total: areaTotal,
                        status: 'OCCUPIED',
                        displayId: displayOrderRef,
                        orderNumber,
                        terminalId: activeTerminalId,
                        userName: currentUser.name,
                        customerName: selectedCustomer?.name || 'Cliente General',
                        table: kdsTablePayload,
                        area: kdsPayload.area,
                        kdsTiming: kdsPayload.kdsTiming,
                     });
                     const endpoint = `${kdsBaseUrl}/api/ordenes/enviar-comanda/${encodeURIComponent(orderId)}`;
                     await postJsonWithTimeout(endpoint, kdsPayload);
                     sentKdsCount += 1;
                  } catch (kdsError: any) {
                     queuedKdsCount += 1;
                     console.warn('[KDS] No se pudo enviar comanda al KDS LAN:', kdsError);
                     await queuePendingKdsDispatch({
                        reason: kdsError?.message || 'KDS_UNREACHABLE',
                        kdsBaseUrl,
                        areaId,
                        areaName: areaData.title,
                        payload: kdsPayload,
                     });
                  }
               }
            }

            areaData.items.forEach((item, index) => {
               const key = getCartDispatchKey(item);
               dispatchedCartIds.add(key);
               dispatchMetaByCartId.set(key, {
                  areaId,
                  orderId,
                  itemIds: buildKdsItemIds(orderId, areaId, item, index),
               });
            });
         }

         // 3. Mark items as dispatched in state
         const updatedCart = cart.map(item => {
            const key = getCartDispatchKey(item);
            const dispatchMeta = dispatchMetaByCartId.get(key);
            return dispatchedCartIds.has(key) ? {
               ...item,
               ...(dispatchMeta?.orderId ? { orderNumber: orderNumber || item.orderNumber } : {}),
               ...(activeTableContext.compactLabel ? { tableDisplayLabel: activeTableContext.compactLabel } : {}),
               ...(activeTableContext.roomLabel ? { tableRoomLabel: activeTableContext.roomLabel } : {}),
               dispatched: true,
               kdsStatus: 'ENVIADO',
               kdsOrderId: dispatchMeta?.orderId,
               kdsAreaId: dispatchMeta?.areaId,
               kdsItemIds: dispatchMeta?.itemIds,
               production_area_id: dispatchMeta?.areaId || resolveProductionAreaId(item) || undefined,
               restaurantConfig: {
                  ...(item.restaurantConfig || {}),
                  production_area_id: dispatchMeta?.areaId || item.restaurantConfig?.production_area_id || undefined,
               },
            } : item;
         });
         onUpdateCart(updatedCart);

         // 4. Save state to DB (Parking)
         if (activeTable) {
            await handleParkCurrentTicket(undefined, updatedCart);
         }

         const parts = [
            printedCount > 0 ? `${printedCount} ticket(s)` : '',
            sentKdsCount > 0 ? `${sentKdsCount} KDS` : '',
            queuedKdsCount > 0 ? `${queuedKdsCount} KDS pendiente(s)` : '',
         ].filter(Boolean);
         setSuccessToast(parts.length > 0 ? `Comanda procesada: ${parts.join(' · ')}` : 'Comanda procesada');

      } catch (e) {
         console.error("Dispatch error:", e);
         alert("Error al procesar el envío a cocina");
      }
   };

   const handleReturnDispatchedCartItem = async (item: CartItem) => {
      if (blockRecoveredUberOrderMutation('devolver el artículo enviado a cocina')) return;
      if (!item.dispatched) {
         await updateCartItem(null, item.cartId);
         return;
      }
      if (isKdsReturnedCartItem(item)) {
         alert('Este artículo ya fue marcado como devuelto en cocina.');
         return;
      }

      const authorized = await requestApproval({
         permission: 'POS_VOID_ITEM',
         actionDescription: 'Devolver artículo enviado al KDS',
         context: {
            itemId: item.cartId,
            ticketId: item.kdsOrderId || activeTable?.currentOrderId,
            reason: 'Devolución de artículo enviado al KDS'
         }
      });
      if (!authorized) return;

      const confirmed = window.confirm(`¿Marcar "${item.name}" como devuelto en cocina? El plato no debe prepararse y la línea quedará en el ticket como auditoría.`);
      if (!confirmed) return;

      try {
         const configuredAreas = await db.get('productionAreas' as any).catch(() => []) as any;
         const productionAreas: ProductionAreaConfig[] = Array.isArray(configuredAreas) ? configuredAreas : [];
         const configuredProducts = await db.get('products' as any).catch(() => []) as any;
         const productionProducts: Product[] = Array.isArray(configuredProducts) ? configuredProducts : [];
         const areaById = new Map(productionAreas.map(area => [String(area.id), area]));
         const resolveAreaForDispatch = buildProductionAreaResolver(productionAreas, productionProducts);
         const areaId = String(item.kdsAreaId || resolveAreaForDispatch(item) || '').trim();
         const area = areaById.get(areaId);
         const orderId = String(item.kdsOrderId || activeTable?.currentOrderId || '').trim();

         if (!orderId || !area) {
            alert('No se pudo ubicar la orden o el centro de producción para devolver este artículo en cocina.');
            return;
         }

         const kdsBaseUrl = resolveKdsBaseUrl(area, config);
         if (!kdsBaseUrl) {
            alert('El centro de producción no tiene ruta KDS disponible. Configura la IP/terminal antes de devolver en cocina.');
            return;
         }

         await postJsonWithTimeout(`${kdsBaseUrl}/api/cocina/cambiar-estado`, {
            orden_id: orderId,
            item_id: item.kdsItemIds?.[0],
            item_ids: item.kdsItemIds || [],
            cart_id: item.cartId,
            producto_id: item.id,
            nuevo_estado: 'DEVUELTO',
         });

         const returnedAt = new Date().toISOString();
         const newCart = cart.map((cartItem) => {
            if (cartItem.cartId !== item.cartId) return cartItem;
            return {
               ...cartItem,
               price: 0,
               kdsOriginalPrice: cartItem.kdsOriginalPrice ?? cartItem.price,
               kdsStatus: 'DEVUELTO',
               kdsReturnedAt: returnedAt,
               voidedByKdsReturn: true,
               returnReason: 'Devuelto en cocina',
            };
         });
         onUpdateCart(newCart);

         if (activeTable && onUpdateParkedTickets) {
            const ticketId = activeTable.currentOrderId;
            const total = newCart.reduce((sum, cartItem) => sum + (Number(cartItem.price || 0) * Number(cartItem.quantity || 0)), 0);
            onUpdateParkedTickets(parkedTickets.map(ticket => ticket.id === ticketId ? { ...ticket, items: newCart, total } : ticket));
         }

         setSuccessToast(`Artículo devuelto en cocina: ${item.name}`);
      } catch (error: any) {
         console.error('[KDS] No se pudo marcar artículo como devuelto:', error);
         alert(`No se pudo marcar el artículo como devuelto en cocina: ${error?.message || 'error desconocido'}`);
      }
   };

   const handlePrintPrecuenta = async () => {
      if (cart.length === 0) return;
      setSuccessToast('Generando Precuenta...');
      // In a more complete implementation, this would call printer.ts with a dummy transaction
      setTimeout(() => {
         setSuccessToast('Precuenta enviada a impresora');
      }, 1000);
   };

   const openReservationModal = () => {
      if (blockRecoveredUberOrderMutation('convertirlo en reserva')) return;

      const formatDateForInput = (value?: string) => {
         if (!value) return '';
         const d = new Date(value);
         if (Number.isNaN(d.getTime())) return '';
         const yyyy = d.getFullYear();
         const mm = String(d.getMonth() + 1).padStart(2, '0');
         const dd = String(d.getDate()).padStart(2, '0');
         return `${yyyy}-${mm}-${dd}`;
      };
      const today = new Date().toISOString().slice(0, 10);
      if (editableRecoveredReservation) {
         setReservationCustomerId(editableRecoveredReservation.customerId || selectedCustomer?.id || '');
         setReservationAdvanceInput(String(editableRecoveredReservation.balancePaid || 0));
         setReservationDeliveryDate(formatDateForInput(editableRecoveredReservation.deliveryDate) || today);
      } else {
         setReservationCustomerId(selectedCustomer?.id || '');
         setReservationAdvanceInput('0');
         setReservationDeliveryDate(today);
      }
      setShowReservationModal(true);
   };

   const releaseActiveEmptyTable = async (options: { silent?: boolean } = {}): Promise<boolean> => {
      if (!activeTable || cart.length > 0) return false;

      const tableToRelease = activeTable;

      if (tableToRelease.currentOrderId) {
         const remaining = parkedTickets.filter(p => p.id !== tableToRelease.currentOrderId);
         onUpdateParkedTickets(remaining);
      }

      onUpdateCart([]);
      onSelectCustomer(null);
      setActiveRecoveredReservation(null);
      if (onClearActiveTable) onClearActiveTable();
      if (!options.silent) {
         setSuccessToast('Mesa liberada (sin productos)');
      }

      void (async () => {
         const controller = new AbortController();
         const timeoutId = window.setTimeout(() => controller.abort(), 2500);
         try {
            const releaseRes = await fetch('/api/mesas/liberar', {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ tableId: tableToRelease.id }),
               signal: controller.signal
            });
            const releaseData = await releaseRes.json().catch(() => null);

            if (!releaseRes.ok || (releaseData && releaseData.success === false)) {
               throw new Error(releaseData?.message || `HTTP ${releaseRes.status}`);
            }
         } catch (error) {
            console.warn('No se pudo confirmar la liberacion de mesa en servidor:', error);
         } finally {
            window.clearTimeout(timeoutId);
         }
      })();

      return true;
   };

   const handleParkCurrentTicket = async (aliasInput?: string, cartOverride?: CartItem[]) => {
      if (blockRecoveredUberOrderMutation('guardarlo como ticket en espera')) return;
      const ticketItems = cartOverride || cart;
      if (ticketItems.length === 0) return;
      const parkedTicketId = activeTable?.currentOrderId || `P-${Date.now()}`;
      const existingParked = (Array.isArray(parkedTickets) ? parkedTickets : []).find((ticket) => ticket.id === parkedTicketId);
      const normalizedAlias = aliasInput === undefined
         ? existingParked?.alias
         : (aliasInput.trim() || undefined);
      const ticketTotal = ticketItems.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
      const newParked: ParkedTicket = {
         id: parkedTicketId,
         name: buildParkedTicketName(),
         alias: normalizedAlias,
         items: [...ticketItems],
         total: ticketTotal,
         customerId: selectedCustomer?.id,
         customerName: selectedCustomer?.name,
         timestamp: existingParked?.timestamp || new Date().toISOString(),
         orderNumber: readCartOrderNumber(ticketItems) || existingParked?.orderNumber,
         tableDisplayLabel: activeTableContext.compactLabel || existingParked?.tableDisplayLabel,
         tableRoomLabel: activeTableContext.roomLabel || existingParked?.tableRoomLabel,
      };

      // Remove existing if updating same ID
      const updatedTickets = [...(Array.isArray(parkedTickets) ? parkedTickets : []).filter(p => p.id !== newParked.id), newParked];
      onUpdateParkedTickets(updatedTickets);
      closeParkAliasModal();

      if (activeTable) {
         try {
            const total = ticketItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);

            // Sync with KDS backend
            await fetch(`http://localhost:8001/api/ordenes/${newParked.id}`, {
               method: 'PUT',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({
                  items: ticketItems,
                  total: total,
                  status: 'OCCUPIED'
               })
            });

            if (onClearActiveTable) onClearActiveTable();

            // Redirect Logic
            if (activeTerminalConfig?.tables?.autoRedirectToMap && onOpenTableMap) {
               onOpenTableMap();
            } else if (onOpenTableMap) {
               onOpenTableMap();
            }
         } catch (e) {
            console.error("Failed to sync table status with KDS:", e);
         }
      }

      onUpdateCart([]); onSelectCustomer(null);
      setActiveRecoveredReservation(null);
      setErrorToast(activeTable ? "Mesa Guardada" : "Ticket Guardado");
      setTimeout(() => setErrorToast(null), 2000);
   };

   const saveActiveTableOrderForMap = async () => {
      if (!activeTable || cart.length === 0) return;

      const parkedTicketId = activeTable.currentOrderId || `ORD-${Date.now()}`;
      const existingParked = (Array.isArray(parkedTickets) ? parkedTickets : []).find((ticket) => ticket.id === parkedTicketId);
      const tableName = activeTable.nombre || activeTable.name || 'Mesa';
      const tableOrder: ParkedTicket = {
         id: parkedTicketId,
         name: existingParked?.name || `Mesa: ${activeTableContext.compactLabel || tableName}`,
         alias: existingParked?.alias,
         items: [...cart],
         total: cartTotal,
         customerId: selectedCustomer?.id,
         customerName: selectedCustomer?.name,
         timestamp: existingParked?.timestamp || new Date().toISOString(),
         orderNumber: readCartOrderNumber(cart) || existingParked?.orderNumber,
         tableDisplayLabel: activeTableContext.compactLabel || existingParked?.tableDisplayLabel,
         tableRoomLabel: activeTableContext.roomLabel || existingParked?.tableRoomLabel,
      };

      const updatedTickets = [
         ...(Array.isArray(parkedTickets) ? parkedTickets : []).filter(ticket => ticket.id !== tableOrder.id),
         tableOrder
      ];
      onUpdateParkedTickets(updatedTickets);

      onUpdateCart([]);
      onSelectCustomer(null);
      setActiveRecoveredReservation(null);
      if (onClearActiveTable) onClearActiveTable();

      void (async () => {
         try {
            await fetch(`http://localhost:8001/api/ordenes/${tableOrder.id}`, {
               method: 'PUT',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({
                  items: tableOrder.items,
                  total: tableOrder.total,
                  status: 'OCCUPIED'
               })
            });
         } catch (error) {
            console.warn('No se pudo sincronizar la mesa con cocina al volver al mapa:', error);
         }
      })();
   };

   const handleSendAndExit = async () => {
      if (blockRecoveredUberOrderMutation('enviarlo a espera')) return;

      // 1. If table is empty, auto-release to avoid ghost occupied tables.
      const releasedEmptyTable = await releaseActiveEmptyTable();

      // 2. Otherwise park/save the ticket.
      if (!releasedEmptyTable) {
         await handleParkCurrentTicket();
      }

      // 3. Dispatch to kitchen if applicable
      if (!releasedEmptyTable && activeTerminalConfig?.operational?.usa_modulos_cocina && cart.length > 0) {
         try {
            await handleDispatchCommand();
         } catch (e) {
            console.error("Failed to dispatch on exit:", e);
         }
      }

      // 4. Navigate back to map
      if (onOpenTableMap) onOpenTableMap();
   };

   const handleBackToMap = () => {
      if (blockRecoveredUberOrderMutation('volver al mapa de mesas')) return;

      setShowParkedList(false);
      closeParkAliasModal();
      if (onOpenTableMap) onOpenTableMap();

      window.setTimeout(() => {
         if (!activeTable) return;
         if (cart.length === 0) {
            void releaseActiveEmptyTable({ silent: true });
            return;
         }
         void saveActiveTableOrderForMap();
      }, 0);
   };

   const handleRestoreTicket = (parked: ParkedTicket) => {
      onUpdateCart([...parked.items]);
      if (parked.customerId) {
         const found = (customers || []).find(c => c.id === parked.customerId);
         if (found) onSelectCustomer(found);
      }
      onUpdateParkedTickets(parkedTickets.filter(p => p.id !== parked.id));
      setActiveRecoveredReservation(null);
      setShowParkedList(false);
      setMobileView('TICKET');
   };

   const handleOpenDrawer = async () => {
      const authorized = await requestApproval({
         permission: 'POS_OPEN_DRAWER',
         actionDescription: 'Abrir Cajón de Dinero',
         context: {
            reason: 'Apertura Manual'
         }
      });
      if (authorized) {
         alert("Cajón Abierto Exitosamente");
         // In a real app, this would trigger the hardware command
      }
   };

   const handleProcessReturn = async (originalTransaction: Transaction, itemsToReturn: { itemId: string, quantity: number }[]) => {
      // 1. Calculate Refund Totals
      const returnItems: CartItem[] = [];

      itemsToReturn.forEach(returnItem => {
         const originalItem = (originalTransaction.items || []).find(i => i.cartId === returnItem.itemId);
         if (originalItem) {
            returnItems.push({
               ...originalItem,
               quantity: Math.abs(returnItem.quantity),
               cartId: `RET-${Date.now()}-${returnItem.itemId}`,
               price: originalItem.price
            });
         }
      });

      const refundSummary = calculateTransactionTaxSummary(
         returnItems,
         config.taxes || [],
         Boolean(originalTransaction.isTaxIncluded),
         config.taxRate || 0
      );
      const refundTotal = refundSummary.total;

      const fiscalCompliance = getEffectiveFiscalComplianceConfig(config, activeTerminalConfig);
      const creditNoteFiscalType = resolveCreditNoteFiscalCode(fiscalCompliance.mode);
      const creditNoteNcf = await db.getNextNCF(creditNoteFiscalType, terminalId, 50);

      // 2. Create Refund Transaction
      const refundTxn = await transactionService.createTransaction({
         documentType: 'REFUND',
         seriesId: activeTerminalConfig?.documentAssignments?.['REFUND'] || 'REFUND-GENERIC',
         date: new Date().toISOString(),
         items: returnItems,
         total: refundTotal,
         payments: [],
         userId: currentUser.id,
         userName: currentUser.name,
         terminalId: terminalId,
         status: 'REFUNDED',
         customerId: originalTransaction.customerId,
         customerName: originalTransaction.customerName,
         originalTransactionId: originalTransaction.id,
         electronicNcf: creditNoteFiscalType.startsWith('E') ? creditNoteNcf : undefined,
         fiscalMode: fiscalCompliance.mode,
         fiscalProvider: creditNoteFiscalType.startsWith('E') ? getDefaultFiscalProvider(config, activeTerminalConfig) : 'NONE',
         taxAmount: refundSummary.taxAmount,
         netAmount: refundSummary.netAmount,
         affectedNCF: originalTransaction.ncf,
         affectedInvoiceNumber: originalTransaction.displayId || originalTransaction.id,
         ncf: creditNoteNcf,
         ncfType: creditNoteFiscalType,
         refundReason: 'Smart QR Return',
         isTaxIncluded: originalTransaction.isTaxIncluded
      });

      const sellableConditions = new Map<string, 'SELLABLE' | 'DAMAGED'>();
      returnItems.forEach(item => sellableConditions.set(item.cartId, 'SELLABLE'));

      await persistStandaloneRefundTransaction(
         {
            ...refundTxn,
            items: returnItems,
            total: refundTotal,
            status: 'REFUNDED',
            refundReason: 'Smart QR Return',
            syncStatus: 'PENDING'
         },
         {
            warehouseId: defaultSalesWarehouseId || 'wh_central',
            terminalId,
            originalTransaction,
            conditions: sellableConditions
         }
      );

      if (!(Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android')) {
         try {
            await fetch(`/api/transactions/${originalTransaction.id}`, {
               method: 'PUT',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ status: 'REFUNDED' })
            });
         } catch (e) {
            console.error("Failed to update original transaction status:", e);
         }
      }

      alert(`Devolución registrada: ${config.currencySymbol}${refundTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\nTicket original (${originalTransaction.displayId}) marcado como REEMBOLSADO.`);
   };

   // --- ACTION GRID HANDLER ---
   const handleGridAction = (action: string) => {
      switch (action) {
         case 'DISCOUNT':
            if (blockRecoveredUberOrderMutation('aplicar descuentos')) return;
            setShowGlobalDiscount(true);
            break;
         case 'COUPON':
            if (blockRecoveredUberOrderMutation('aplicar cupones')) return;
            setShowCouponModal(true);
            break;
         case 'PARK_LIST': setShowParkedList((prev: any) => !prev); break;
         case 'RESERVATION': openReservationModal(); break;
         case 'RECOVER_RESERVATION': openRecoverReservationModal(); break;
         case 'RETURN':
            if (blockRecoveredUberOrderMutation('mezclar devoluciones con este pedido')) return;
            if (!isReturnMode) {
               const hasPermission = (currentUser as any).permissions?.includes('CAN_REFUND') ||
                  ['ADMIN', 'MANAGER'].includes(currentUser.role);
               if (!hasPermission) {
                  setShowSupervisorAuth(true);
                  return;
               }
            }
            if (isReturnMode) setRefundAuthorizedBy(null);
            setIsReturnMode(!isReturnMode);
            break;
         case 'Z_REPORT':
            triggerSafetyGate('Cierre Z', onOpenZReport || onOpenFinance);
            break;
         case 'LOGOUT':
            triggerSafetyGate('Cerrar Sesión', onLogout);
            break;
         case 'SETTINGS': if (onOpenSettings) onOpenSettings(); break;
         case 'TRACKING': if (onOpenInventoryTracking) onOpenInventoryTracking(); break;
         case 'DRAWER': handleOpenDrawer(); break;
         case 'SAVE': openParkAliasModal(); break;
         case 'TABLES':
            if ((config.vertical === 'RESTAURANT' || config.vertical === 'RETAIL') && cart.length > 0) {
               handleSendAndExit();
            } else {
               if (onOpenTableMap) onOpenTableMap();
            }
            break;
         case 'loyalty_card': setShowLoyaltyModal(true); break;
         case 'AGENDA': if (onOpenAgenda) onOpenAgenda(); break;
      }
   };

   return (
      <div
         ref={posRootRef}
         className="fixed inset-0 w-full overflow-hidden bg-gray-50 flex font-sans select-none text-gray-900"
         style={posShellStyle}
      >
         {errorToast && (
            <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-5 fade-in duration-300">
               <div className="bg-red-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-bold border-2 border-red-400">
                  <AlertTriangle size={24} className="animate-pulse" />
                  <span>{errorToast}</span>
               </div>
            </div>
         )}

         <MobileConfigModal
            isOpen={showMobileConfigModal}
            onClose={() => {
               setShowMobileConfigModal(false);
               setPendingProductToAdd(null);
            }}
            onSave={(mobileConfig) => {
               // Update global config with selected warehouse/tariff
               const newConfig = { ...config };
               const terminalIndex = newConfig.terminals.findIndex(t => t.id === activeTerminalId);

               if (terminalIndex >= 0) {
                  // Update Warehouse
                  if (!newConfig.terminals[terminalIndex].config.inventoryScope) {
                     newConfig.terminals[terminalIndex].config.inventoryScope = {
                        defaultSalesWarehouseId: mobileConfig.warehouseId,
                        visibleWarehouseIds: [mobileConfig.warehouseId]
                     };
                  } else {
                     newConfig.terminals[terminalIndex].config.inventoryScope!.defaultSalesWarehouseId = mobileConfig.warehouseId;
                  }

                  // Update Tariff
                  if (!newConfig.terminals[terminalIndex].config.pricing) {
                     newConfig.terminals[terminalIndex].config.pricing = {
                        allowedTariffIds: [mobileConfig.tariffId],
                        defaultTariffId: mobileConfig.tariffId
                     };
                  } else {
                     newConfig.terminals[terminalIndex].config.pricing.defaultTariffId = mobileConfig.tariffId;
                  }

                  // Update Document Series
                  if (!newConfig.terminals[terminalIndex].config.documentAssignments) {
                     newConfig.terminals[terminalIndex].config.documentAssignments = {};
                  }
                  newConfig.terminals[terminalIndex].config.documentAssignments!['TICKET'] = mobileConfig.seriesId;
                  newConfig.terminals[terminalIndex].config.documentAssignments!['REFUND'] =
                     newConfig.terminals[terminalIndex].config.documentAssignments!['REFUND'] || 'REFUND';
                  newConfig.terminals[terminalIndex].config.documentAssignments!['TRANSFER'] =
                     newConfig.terminals[terminalIndex].config.documentAssignments!['TRANSFER'] || 'TRANSFER';

                  onUpdateConfig(newConfig);
                  setActiveTariffId(mobileConfig.tariffId);
                  setCategoryFilter(mobileConfig.categoryId === 'ALL' ? 'ALL' : canonicalizeCategory(mobileConfig.categoryId));
               }

               // Proceed to add product
               if (pendingProductToAdd) {
                  // Small delay to allow config update to propagate
                  setTimeout(() => {
                     // Re-check add to cart logic with new config
                     const pendingName = pendingProductToAdd.name || '';
                     const isWeighted = pendingProductToAdd.type === 'SERVICE' || pendingName.toLowerCase().includes('(peso)');
                     const hasVariants = pendingProductToAdd.attributes && pendingProductToAdd.attributes.length > 0;

                     if (isWeighted) setProductForScale(pendingProductToAdd);
                     else if (hasVariants) setSelectedProductForVariants(pendingProductToAdd);
                     else addToCart(pendingProductToAdd);

                     setPendingProductToAdd(null);
                  }, 100);
               }
               setShowMobileConfigModal(false);
            }}
            config={config}
            warehouses={warehouses}
            terminalId={activeTerminalId}
            currentWarehouseId={defaultSalesWarehouseId}
            currentTariffId={activeTariffId}
            currentCategory={categoryFilter}
         />

         <ReturnModal
            isOpen={showReturnModal}
            onClose={() => setShowReturnModal(false)}
            invoiceId={returnInvoiceId}
            transactions={transactions}
            onProcessReturn={handleProcessReturn}
            config={config}
         />

         {mobileView === 'PRODUCTS' && (
            <MobileCartButton
               buttonRef={mobileCartButtonRef}
               itemCount={cart.length}
               onClick={() => setMobileView('TICKET')}
               style={mobileCartButtonStyle}
            />
         )}

         {/* LEFT AREA: PRODUCTS */}
         <div className={`flex-1 min-h-0 flex flex-col min-w-0 bg-gray-50 transition-all duration-300 ${mobileView === 'TICKET' ? 'hidden md:flex' : 'flex'} ${isRetailMode ? '!hidden' : ''}`}>
            <header className="bg-white px-3 md:px-8 py-3 md:py-4 border-b border-gray-200 flex flex-wrap items-center gap-2 md:gap-6 shadow-sm z-10 shrink-0">
               <div className="flex items-center gap-3 pr-0 md:pr-4 border-r-0 md:border-r border-gray-100 shrink-0">
                  <div className="w-10 h-10 rounded-full bg-gray-50 overflow-hidden border border-gray-200 shadow-inner shrink-0">
                     {currentUser.photo ? <img src={currentUser.photo} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-blue-50 text-blue-600 font-bold">{currentUser.name.charAt(0)}</div>}
                  </div>
                  <div className="flex flex-col leading-tight md:hidden min-w-0">
                     <p className="text-[11px] font-black text-slate-800 truncate max-w-[96px]">{currentUser.name.split(' ')[0]}</p>
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.24em] mt-1">Cajero</p>
                     <p className="text-[0.66rem] font-extrabold text-red-500 uppercase tracking-[0.16em] mt-1 truncate max-w-[96px]">{terminalDisplayLabel}</p>
                  </div>
                  <div className="hidden lg:block leading-tight">
                     <p className="text-sm font-black text-gray-800 truncate max-w-[120px]">{currentUser.name}</p>
                     <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Cajero</p>
                     <p className="text-[0.84rem] font-extrabold text-red-500 uppercase tracking-[0.16em] mt-1 truncate max-w-[140px]">{terminalDisplayLabel}</p>
                  </div>
               </div>

               <div className="flex items-center gap-2 px-3 md:px-4 py-2 rounded-2xl bg-gray-50 border border-gray-100 shadow-inner shrink-0">
                  {syncState.isSyncing ? (
                     <RefreshCw size={18} className="text-amber-500 animate-spin" />
                  ) : !navigator.onLine ? (
                     <CloudOff size={18} className="text-red-500" />
                  ) : (
                     <Cloud size={18} className={syncState.hasError || syncState.pendingCount > 0 ? 'text-amber-500' : 'text-emerald-500'} />
                  )}
                  <div className="flex flex-col leading-none">
                     <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest hidden md:block">Sincronización</span>
                     <span className={`text-[10px] font-bold ${
                        syncState.isSyncing
                           ? 'text-amber-600'
                           : !navigator.onLine
                              ? 'text-red-600'
                              : syncState.hasError || syncState.pendingCount > 0
                                 ? 'text-amber-600'
                                 : 'text-emerald-600'
                     }`}>
                        {syncState.isSyncing
                           ? 'Sincronizando'
                           : !navigator.onLine
                              ? 'Offline'
                              : syncState.pendingCount > 0
                                 ? `Online · ${syncState.pendingCount}`
                                 : 'Online'}
                     </span>
                  </div>
               </div>


               <div className="w-full md:flex-1 flex flex-wrap md:flex-nowrap items-center gap-2 md:gap-4 md:min-w-0">
                  <div className="relative shrink-0 ml-auto md:ml-0 order-1" ref={tariffSelectorRef}>
                     <button
                        type="button"
                        onClick={() => {
                           if (!canChangeTariff) return;
                           setShowTariffSelector(!showTariffSelector);
                        }}
                        className={`flex items-center justify-between gap-2 md:gap-3 min-w-[134px] sm:min-w-[156px] px-3 md:px-5 py-2.5 md:py-3 rounded-2xl border-2 transition-all ${showTariffSelector ? 'border-purple-500 bg-purple-50' : 'bg-purple-50/80 border-purple-100'} ${canChangeTariff ? 'hover:border-purple-300' : 'opacity-75 cursor-not-allowed'}`}
                        disabled={!canChangeTariff}
                        title={canChangeTariff ? 'Cambiar tarifa activa' : 'Tu rol no tiene permiso para cambiar la tarifa'}
                     >
                        <Tag size={18} className="text-purple-600 shrink-0" />
                        <div className="text-left min-w-0">
                           <p className="text-[8px] md:text-[9px] font-black text-purple-400 uppercase tracking-[0.22em] leading-none mb-1">Tarifa</p>
                           <p className="text-[11px] md:text-xs font-bold text-purple-900 leading-none truncate max-w-[86px] sm:max-w-[110px] md:max-w-[120px]">{activeTariff?.name || 'General'}</p>
                        </div>
                        {canChangeTariff ? (
                           <ChevronDown size={14} className={`text-purple-400 transition-transform shrink-0 ${showTariffSelector ? 'rotate-180' : ''}`} />
                        ) : (
                           <Lock size={14} className="text-purple-300 shrink-0" />
                        )}
                     </button>
                     {canChangeTariff && showTariffSelector && (
                        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 min-w-[220px] max-w-[min(88vw,280px)] rounded-2xl border border-purple-100 bg-white p-2 shadow-xl">
                           <div className="px-3 py-2">
                              <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest">Seleccionar tarifa</p>
                           </div>
                           <div className="space-y-1">
                              {allowedTariffs.map((tariff) => {
                                 const isSelected = tariff.id === activeTariffId;
                                 return (
                                    <button
                                       key={tariff.id}
                                       type="button"
                                       onClick={() => {
                                          setActiveTariffId(tariff.id);
                                          setShowTariffSelector(false);
                                       }}
                                       className={`w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-all ${isSelected ? 'bg-purple-50 text-purple-900 border border-purple-200' : 'bg-white text-gray-700 hover:bg-gray-50 border border-transparent'}`}
                                    >
                                       <div className="min-w-0">
                                          <p className="text-sm font-bold truncate">{tariff.name}</p>
                                          <p className="text-[10px] font-medium text-gray-400 uppercase tracking-widest">
                                             {tariff.taxIncluded ? 'Impuestos incluidos' : 'Impuestos separados'}
                                          </p>
                                       </div>
                                       {isSelected && <Check size={16} className="text-purple-600 shrink-0" />}
                                    </button>
                                 );
                              })}
                           </div>
                        </div>
                     )}
                  </div>

                  <div className="relative order-3 md:order-none w-full md:flex-1 group min-w-0 md:min-w-[220px]">
                     <Search className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                     <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Buscar..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        className="w-full pl-10 md:pl-12 pr-10 md:pr-4 py-2.5 md:py-3 bg-gray-100 rounded-2xl border-none outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                     />
                     <button onClick={() => setIsScannerOpen(true)} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 bg-white shadow-sm rounded-xl hover:text-blue-600 hover:bg-blue-50 border border-gray-100"><ScanBarcode size={18} /></button>
                  </div>


                  <SupervisorAuthModal
                     isOpen={showSupervisorAuth}
                     onClose={() => setShowSupervisorAuth(false)}
                     users={users}
                     requiredPermission="CAN_REFUND"
                     onSuccess={(supervisor) => {
                        console.log("Authorized by:", supervisor.name);
                        setRefundAuthorizedBy({ id: supervisor.id, name: supervisor.name });
                        setIsReturnMode(true);
                     }}
                  />

                  {/* MOBILE SETTINGS BUTTON */}
                  <button onClick={() => onOpenSettings()} className="md:hidden order-2 p-3 bg-gray-100 rounded-xl text-gray-600 hover:bg-gray-200 shrink-0">
                     <Settings size={20} />
                  </button>
               </div>
            </header>

            {/* --- CATEGORY SELECTOR BAR --- */}
            <div className={categoryContainerClass}>
               {categoryOptions.map((categoryOption, idx) => {
                  const selectedCategoryKey = categoryFilter === 'ALL' ? 'ALL' : canonicalizeCategory(categoryFilter);
                  const isActiveCategory = selectedCategoryKey === categoryOption.id;
                  return (
                  <button
                     key={categoryOption.id || `cat-${idx}`}
                     onClick={() => setCategoryFilter(categoryOption.id)}
                     className={`px-6 py-2.5 rounded-full text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap shadow-sm border ${isActiveCategory
                        ? 'bg-blue-600 border-blue-500 text-white shadow-blue-200 scale-105'
                        : 'bg-white border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-600'
                        }`}
                  >
                     {categoryOption.label}
                  </button>
                  );
               })}
            </div>

            <div
               className={`flex-1 min-h-0 overflow-y-auto bg-[#eef2f6] ${usesExpandedCatalog ? 'p-3 pl-4 pr-2' : isMobile ? 'p-4' : 'p-8'} custom-scrollbar scrollbar-thin dark:bg-slate-900`}
               style={bottomAwareScrollStyle}
            >
               <div className={gridClass}>
                  {filteredProducts.map((product, idx) => (
                     <ProductGridCard
                        key={product.id || `prod-${idx}`}
                        product={product}
                        usesSupermarketLayout={usesSupermarketLayout}
                        usesExpandedCatalog={usesExpandedCatalog}
                        isMobile={isMobile}
                        showProductImages={uxConfig.showProductImages}
                        baseCurrencySymbol={baseCurrency.symbol}
                        isProductWarehouseBlockedForSale={isProductWarehouseBlockedForSale}
                        getTerminalWarehouseName={getTerminalWarehouseName}
                        getProductPrice={getProductPrice}
                        hasPromotionForProduct={hasPromotionForProduct}
                        onProductClick={handleProductCardClick}
                        onOpenPromotion={openProductPromotionSheet}
                        onProductTouchStart={handleProductCardTouchStart}
                        onProductTouchMove={handleProductCardTouchMove}
                        onProductTouchEnd={clearQuickActionTouchTimer}
                        onProductContextMenu={handleProductCardContextMenu}
                     />
                  ))}
               </div>
            </div>
            {/* VIRTUAL KEYBOARD SLOT */}
            {showVirtualKeyboard && (
               <div className="flex-none z-50">
                  <VirtualKeyboard
                     onKeyPress={(key) => setSearchTerm(prev => prev + key)}
                     onDelete={() => setSearchTerm(prev => prev.slice(0, -1))}
                     onClear={() => setSearchTerm('')}
                     onClose={() => {
                        setShowVirtualKeyboard(false);
                        // Optional: trigger search enter logic if needed
                     }}
                  />
               </div>
            )}

            {/* --- Novedad: ActionGrid (Rediseño Adaptativo) REEMPLAZADO POR TABS EN PANEL DERECHO --- */}
            {/* (Removido para usar Option 2: Tabs) */}
         </div >

         {/* RIGHT SIDEBAR: CURRENT TICKET */}
         <div className={`w-full ${isRetailMode ? '' : 'md:w-96'} h-full min-h-0 bg-white border-l border-gray-200 shadow-2xl flex flex-col z-20 transition-all duration-300 ${mobileView === 'PRODUCTS' && !isRetailMode ? 'hidden md:flex' : 'flex'}`}>

            {/* MOBILE HEADER */}
            < div className="md:hidden p-4 border-b border-gray-100 bg-white flex flex-col gap-3 shrink-0" >
               <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                     {renderTicketBrand(true)}
                     <button onClick={() => setMobileView('PRODUCTS')} className="p-2 -ml-2 text-gray-400 hover:text-blue-600 transition-colors">
                        <ArrowLeft size={24} />
                     </button>
                     <h2 className="font-black text-gray-800 text-lg leading-tight">
                        {activeTable ? (
                           <div className="flex flex-col">
                              <span className="text-[10px] text-gray-400 -mb-1 font-bold uppercase">
                                 {activeTableContext.roomLabel || 'Mesa Activa'}
                              </span>
                              <span>{activeTableContext.compactLabel || activeTable.nombre || activeTable.name}</span>
                           </div>
                        ) : 'Ticket Actual'}
                     </h2>
                  </div>
                  <div className="flex gap-1">
                     <button onClick={openParkAliasModal} className="p-2 text-gray-400 hover:text-blue-600" title="Guardar Ticket">
                        <Save size={20} />
                     </button>
                     <button onClick={() => setShowParkedList(!showParkedList)} className="p-2 text-gray-400 hover:text-orange-600 relative" title="Recuperar Ticket">
                        <Inbox size={20} />
                        {(Array.isArray(parkedTickets) ? parkedTickets : []).length > 0 && (
                           <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-orange-500 rounded-full border-2 border-white"></span>
                        )}
                     </button>
                     <div className="relative group">
                        <button className="p-2 text-gray-400 hover:text-gray-600"><MoreVertical size={20} /></button>
                        <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 hidden group-hover:block z-50">
                           <button onClick={onOpenHistory} className="w-full px-4 py-3 text-left text-sm font-bold text-gray-600 hover:bg-gray-50 flex items-center gap-2"><History size={16} /> Historial</button>
                           <button onClick={onOpenZReport || onOpenFinance} className="w-full px-4 py-3 text-left text-sm font-bold text-gray-600 hover:bg-gray-50 flex items-center gap-2"><Lock size={16} /> Cierre Z</button>
                           <button onClick={() => onOpenSettings()} className="w-full px-4 py-3 text-left text-sm font-bold text-gray-600 hover:bg-gray-50 flex items-center gap-2"><Settings size={16} /> Ajustes</button>
                           <button onClick={onLogout} className="w-full px-4 py-3 text-left text-sm font-bold text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-gray-50"><LogOut size={16} /> Salir</button>
                        </div>
                     </div>
                  </div>
               </div>

               {/* CUSTOMER PILL (MOBILE) */}
               {
                  selectedCustomer ? (
                     <div className="flex items-center justify-between bg-blue-50 px-4 py-2 rounded-full border border-blue-100" onClick={onOpenCustomers}>
                        <div className="flex items-center gap-2">
                           {resolveCustomerImageSrc(selectedCustomer) ? (
                              <img
                                 src={resolveCustomerImageSrc(selectedCustomer)}
                                 alt={selectedCustomer.name}
                                 className="w-6 h-6 rounded-full object-cover border border-blue-200 bg-white"
                              />
                           ) : (
                              <div className="w-6 h-6 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center font-bold text-[10px]">{selectedCustomer.name.charAt(0)}</div>
                           )}
                           <span className="text-xs font-bold text-blue-900 truncate max-w-[150px]">{selectedCustomer.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                           <button
                              onClick={(e) => { e.stopPropagation(); openRecoverReservationForSelectedCustomer(); }}
                              className="px-2 py-1 rounded-full bg-teal-100 text-teal-700 text-[10px] font-black hover:bg-teal-200 transition-colors"
                              title="Reservas del cliente"
                           >
                              Res. {selectedCustomerActiveReservationsCount}
                           </button>
                           <button onClick={(e) => { e.stopPropagation(); onSelectCustomer(null); }} className="p-1 text-blue-400"><X size={14} /></button>
                        </div>
                     </div>
                  ) : (
                     <button onClick={onOpenCustomers} className="flex items-center gap-2 px-4 py-2 bg-gray-50 border border-dashed border-gray-300 rounded-full text-gray-400 text-xs font-bold uppercase tracking-wider">
                        <UserPlus size={14} /> Asignar Cliente
                     </button>
                  )
               }
            </div >

            {/* DESKTOP: marca + mesa/comensales bajo el logo; retail: busqueda al centro; botones carrito/acciones alineados a la derecha (como APK 1.0.300) */}
            <div className={`hidden md:flex px-5 py-3 border-b border-gray-100 bg-gray-50/50 flex-col gap-3 shrink-0 flex-none ${activeTable ? 'border-l-4 border-l-blue-500' : ''}`} >
               <div className="flex w-full items-center justify-between gap-4">
                  <div className="flex min-w-0 shrink-0 items-center justify-start">
                     {renderTicketBrand(false)}
                  </div>

                  {/* RETAIL MODE SEARCH BAR */}
                  {isRetailMode && (
                     <div className="relative min-w-0 max-w-xl flex-1 group">
                        <button
                           type="button"
                           onClick={() => handleRetailSearchSubmit()}
                           className="absolute left-2 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-purple-50 hover:text-purple-600"
                           title="Buscar"
                        >
                           <Search size={18} />
                        </button>
                        <input
                           ref={retailSearchInputRef}
                           type="text"
                           placeholder="Escanear o buscar..."
                           value={searchTerm}
                           onFocus={() => {
                              if (window.matchMedia('(pointer: coarse)').matches) {
                                 setShowVirtualKeyboard(true);
                              }
                           }}
                           onChange={(e) => setSearchTerm(e.target.value)}
                           onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                 handleRetailSearchSubmit(e.currentTarget.value);
                              }
                           }}
                           autoFocus
                           className="w-full pl-12 pr-12 py-2.5 bg-gray-100 rounded-xl border-none outline-none focus:bg-white focus:ring-2 focus:ring-purple-500 text-sm font-bold transition-all"
                        />
                        <button
                           type="button"
                           onClick={() => setSearchTerm('')}
                           className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-slate-200 hover:text-slate-600"
                           title={searchTerm ? 'Limpiar búsqueda' : 'Lector silencioso activo'}
                        >
                           {searchTerm ? <X size={16} /> : <ScanBarcode size={16} />}
                        </button>

                        {/* SEARCH RESULTS DROPDOWN */}
                        {searchTerm && filteredProducts.length > 0 && (
                           <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-100 max-h-[60vh] overflow-y-auto z-50">
                              {filteredProducts.map((product, idx) => {
                                 const whBlocked = isProductWarehouseBlockedForSale(product);
                                 return (
                                    <div
                                       key={product.id || `search-prod-${idx}`}
                                       title={
                                          whBlocked
                                             ? `No vendible en ${getTerminalWarehouseName()}: ajuste almacenes en el ERP.`
                                             : undefined
                                       }
                                       onClick={() => {
                                          handleProductClick(product);
                                          setSearchTerm('');
                                       }}
                                       className={`p-3 border-b border-gray-50 last:border-0 flex justify-between items-center gap-2 group ${
                                          whBlocked
                                             ? 'cursor-not-allowed bg-amber-50/80 opacity-90'
                                             : 'cursor-pointer hover:bg-purple-50'
                                       }`}
                                    >
                                       <div className="min-w-0 flex-1">
                                          <p
                                             className={`font-bold text-sm truncate ${
                                                whBlocked ? 'text-gray-700' : 'text-gray-800 group-hover:text-purple-700'
                                             }`}
                                          >
                                             {product.name}
                                          </p>
                                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                             <p className="text-[10px] text-gray-400 font-mono">{product.barcode || 'Sin Código'}</p>
                                             {whBlocked && (
                                                <span className="inline-flex items-center gap-0.5 rounded bg-amber-600 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-white">
                                                   <MapPin size={8} strokeWidth={3} />
                                                   Sin almacén
                                                </span>
                                             )}
                                          </div>
                                       </div>
                                       <span
                                          className={`shrink-0 font-black ${whBlocked ? 'text-gray-600' : 'text-gray-900'}`}
                                       >
                                          {baseCurrency.symbol}
                                          {getProductPrice(product).toLocaleString('en-US', {
                                             minimumFractionDigits: 2,
                                             maximumFractionDigits: 2
                                          })}
                                       </span>
                                    </div>
                                 );
                              })}
                           </div>
                        )}
                     </div>
                  )}

                  <div className="ml-auto flex max-w-[180px] shrink-0 items-center justify-end gap-2">
                     <button
                        onClick={() => setRightSidebarTab('CART')}
                        aria-label={`Abrir carrito${cartQuantity > 0 ? ` con ${cartQuantity} artículos` : ''}`}
                        title={`Carrito${cartQuantity > 0 ? ` (${cartQuantity})` : ''}`}
                        className={`group relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.05rem] border transition-all duration-200 ${
                           rightSidebarTab === 'CART'
                              ? 'border-red-200 bg-gradient-to-br from-red-50 via-rose-50 to-red-100 text-red-700 shadow-[0_14px_30px_rgba(248,113,113,0.18)]'
                              : 'border-slate-200 bg-white text-slate-500 hover:border-red-200 hover:bg-red-50/70 hover:text-red-600'
                        }`}
                     >
                        <span
                           className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-all ${
                              rightSidebarTab === 'CART'
                                 ? 'border-red-200/80 bg-white/90 text-red-600 shadow-sm'
                                 : 'border-red-100 bg-red-50 text-red-500 group-hover:border-red-200 group-hover:bg-white group-hover:text-red-600'
                           }`}
                        >
                           <ShoppingBag size={18} strokeWidth={2.3} />
                        </span>
                        {cartQuantity > 0 && (
                           <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-7 items-center justify-center rounded-full border border-white bg-white px-2 py-1 text-[10px] font-black leading-none text-red-700 shadow-md">
                              {cartQuantity}
                           </span>
                        )}
                     </button>
                     <button
                        onClick={() => setRightSidebarTab('ACTIONS')}
                        aria-label="Abrir acciones rápidas"
                        title="Acciones"
                        className={`group flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.05rem] border transition-all duration-200 ${
                           rightSidebarTab === 'ACTIONS'
                              ? 'border-blue-200 bg-gradient-to-br from-blue-50 via-sky-50 to-blue-100 text-blue-700 shadow-[0_14px_30px_rgba(59,130,246,0.18)]'
                              : 'border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:bg-blue-50/70 hover:text-blue-600'
                        }`}
                     >
                        <span
                           className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border transition-all ${
                              rightSidebarTab === 'ACTIONS'
                                 ? 'border-blue-200/80 bg-white/90 text-blue-600 shadow-sm'
                                 : 'border-blue-100 bg-blue-50 text-blue-500 group-hover:border-blue-200 group-hover:bg-white group-hover:text-blue-600'
                           }`}
                        >
                           <Layers size={18} strokeWidth={2.3} />
                        </span>
                     </button>
                  </div>
               </div>

               {activeTable && (
                  <div className="flex w-full items-center justify-between gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
                     <div className="flex min-w-0 items-center gap-2">
                        <Layout size={18} className="shrink-0 text-blue-600" />
                        <span className="truncate text-xl font-black tracking-tight text-slate-900">
                           {activeTableContext.compactLabel || activeTable.nombre || activeTable.name}
                        </span>
                     </div>

                     <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 shadow-sm transition-all hover:shadow-md">
                        <button
                           onClick={() => onUpdateActiveTableGuests?.(Math.max(1, (activeTable.guests || 1) - 1))}
                           className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-50 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                           title="Reducir comensales"
                        >
                           <Minus size={10} strokeWidth={3} />
                        </button>

                        <div className="flex items-center gap-1 px-1">
                           <Users size={12} className="text-blue-500" />
                           <span className="min-w-[1rem] text-center text-xs font-black text-slate-700">{activeTable.guests || 1}</span>
                        </div>

                        <button
                           onClick={() => onUpdateActiveTableGuests?.((activeTable.guests || 1) + 1)}
                           className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-50 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-500"
                           title="Aumentar comensales"
                        >
                           <Plus size={10} strokeWidth={3} />
                        </button>
                     </div>
                  </div>
               )}

               {activeTable && shouldApplyServiceCharge && (
                  <div className="flex items-center gap-1 rounded-lg border border-blue-100/50 bg-blue-50 px-2 py-1 text-[9px] font-black uppercase tracking-tighter text-blue-600 animate-in fade-in slide-in-from-top-1">
                     <Percent size={10} className="text-blue-500" />
                     <span>Propina Sugerida {serviceCharge?.percentage}% Activa</span>
                  </div>
               )}

               {
                  selectedCustomer ? (
                     <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50/50 rounded-xl border border-blue-100 animate-in slide-in-from-top-2">
                        {resolveCustomerImageSrc(selectedCustomer) ? (
                           <img
                              src={resolveCustomerImageSrc(selectedCustomer)}
                              alt={selectedCustomer.name}
                              className="w-10 h-10 rounded-full object-cover border border-blue-200 bg-white"
                           />
                        ) : (
                           <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-black">
                              {selectedCustomer.name.substring(0, 2).toUpperCase()}
                           </div>
                        )}
                        <div className="flex-1 min-w-0">
                           <div className="flex items-center gap-2">
                              <p className="font-bold text-gray-800 truncate">{selectedCustomer.name}</p>
                              {/* Save to contact feature temporarily disabled due to missing prop plumbing */}
                           </div>
                           <div className="flex items-center gap-2 flex-wrap">
                              {selectedCustomer.taxId && (
                                 <span className="text-xs font-mono text-gray-500">{selectedCustomer.taxId}</span>
                              )}
                              {selectedCustomer.fiscalStatus === 'ACTIVO' && (
                                 <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold">FISCAL</span>
                              )}
                              {selectedCustomer.isTemporary && (
                                 <span className="text-[9px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-bold">TEMP</span>
                              )}
                              {isDelinquent && (
                                 <span className="text-[9px] bg-red-600 text-white px-1.5 py-0.5 rounded font-black animate-pulse shadow-lg shadow-red-200">
                                    DEUDA VENCIDA / CRÉDITO BLOQUEADO
                                 </span>
                              )}
                           </div>
                        </div>
                        <div className="flex items-center gap-2">
                           <button
                              onClick={openRecoverReservationForSelectedCustomer}
                              title="Ver reservas activas del cliente"
                              className="px-2.5 py-1.5 rounded-lg border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 transition-all flex items-center gap-1"
                           >
                              <QrCode size={14} />
                              <span className="text-[10px] font-black uppercase">Res. {selectedCustomerActiveReservationsCount}</span>
                           </button>
                           <button onClick={() => onSelectCustomer(null)} className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-lg transition-colors">
                              <X size={16} />
                           </button>
                        </div>
                     </div>
                  ) : (
                     <button onClick={onOpenCustomers} className="w-full flex items-center justify-between p-3 bg-white border-2 border-dashed border-gray-300 rounded-xl text-gray-400 hover:text-blue-500 group"><div className="flex items-center gap-2"><UserPlus size={18} /><span className="text-xs font-bold uppercase">Asignar Cliente</span></div><ChevronRight size={16} /></button>
                  )
               }

               {shouldShowFiscalReserveAlert && fiscalReserveAlert && (
                  <div
                     className={`mt-3 mb-2 rounded-2xl border px-3 py-2.5 shadow-sm animate-pulse ${
                        fiscalReserveAlert.tone === 'critical'
                           ? 'border-red-200 bg-red-50 text-red-800'
                           : 'border-amber-200 bg-amber-50 text-amber-800'
                     }`}
                  >
                     <div className="flex items-start gap-2.5">
                        <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                        <div className="min-w-0">
                           <p className="text-[10px] font-black uppercase tracking-[0.18em]">Reserva fiscal baja</p>
                           <p className="mt-1 text-xs font-black leading-snug">{fiscalReserveAlert.message}</p>
                        </div>
                     </div>
                  </div>
               )}

               <div className={`mt-1 flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase ${fiscalStatus.hasNCF ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100 animate-pulse'}`}>
                  <Landmark size={12} />
                  <span>Status Fiscal: {fiscalStatus.type} {fiscalStatus.hasNCF ? (fiscalStatus.isTerminalBlock ? 'Bloque Terminal' : (fiscalStatus.isUsingPool ? 'Reservado en Pool' : 'Lote Global Activo')) : 'Agotado'}</span>
               </div>
            </div >

            {/* --- CART ITEMS LIST & TAB VIEWS --- */}
            {isRetailMode ? (
               // SUPERMARKET MODE (DENSE TABLE)
               <ProductTableSupermarket
                  cart={processedCart}
                  config={config}
                  currencySymbol={baseCurrency.symbol}
                  lastAddedCartId={lastAddedCartId}
                  onRemoveItem={(cartId) => updateCartItem(null, cartId)}
                  containerStyle={isMobile ? bottomAwareScrollStyle : undefined}
               />
            ) : (
               // STANDARD RESTAURANT/RETAIL LIST
               <>
                  <div
                     className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 custom-scrollbar bg-gray-100/70"
                     style={isMobile ? bottomAwareScrollStyle : undefined}
                  >
                     {rightSidebarTab === 'ACTIONS' && !isMobile ? (
                        <div className="animate-in fade-in zoom-in-95 duration-200 mt-2">
                           <button
                              onClick={onOpenHistory}
                              className="mb-3 flex w-full items-center justify-between rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-left text-sm font-black text-blue-700 shadow-sm transition-all hover:bg-blue-100"
                           >
                              <div className="flex items-center gap-3">
                                 <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/90 text-blue-600 shadow-sm">
                                    <History size={18} />
                                 </div>
                                 <div className="flex flex-col">
                                    <span className="text-[10px] uppercase tracking-[0.22em] text-blue-400">Acciones</span>
                                    <span>Historial de Facturas</span>
                                 </div>
                              </div>
                              <ChevronRight size={18} />
                           </button>
                           <ActionGrid
                              orientation="vertical"
                              onAction={(action) => {
                                 handleGridAction(action);
                                 if (['PARK', 'RECOVER', 'PRINT_RESERVE', 'KITCHEN'].includes(action)) {
                                    setRightSidebarTab('CART');
                                 }
                              }}
                              config={config}
                              parkedTicketsCount={parkedTickets.length}
                              isReturnMode={isReturnMode}
                              hasCartItems={cart.length > 0}
                              globalDiscountValue={globalDiscount.value}
                              showLogout={false}
                           />
                        </div>
                     ) : (
                        processedCart.map((item, idx) => {
                        const hasDiscount = item.originalPrice && item.price < item.originalPrice;
                        const discountPct = hasDiscount ? Math.round((1 - item.price / item.originalPrice!) * 100) : 0;
                        const lineNet = item.price * item.quantity;
                        const lineTaxSummary = getCartItemTaxSummary(item);
                        const isActiveCartItem = activeCartItemId === item.cartId;
                        const isReturnedToKds = isKdsReturnedCartItem(item);
                        const isDispatchedToKds = Boolean(item.dispatched);

                        // MOBILE CARD DESIGN
                        if (isMobile) {
                           return (
                              <div
                                 key={item.cartId || `cart-m-${idx}`}
                                 onClick={() => toggleCartItemFocus(item.cartId)}
                                 className={`bg-white rounded-2xl p-3 shadow-sm border flex gap-3 animate-in slide-in-from-right-2 transition-all cursor-pointer ${isActiveCartItem ? 'border-blue-200 ring-2 ring-blue-100 shadow-md' : 'border-gray-100 hover:border-slate-200'}`}
                              >
                                 <div className="w-16 h-16 rounded-xl bg-gray-50 overflow-hidden shrink-0 border border-gray-100">
                                    {resolveProductImageSrc(item) ? <img src={resolveProductImageSrc(item)} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-300"><Grid size={24} /></div>}
                                 </div>
                                 <div className="flex-1 min-w-0 flex flex-col justify-between">
                                    <div>
                                       <div className="flex justify-between items-start">
                                          <h4 className="font-bold text-gray-800 text-sm leading-tight line-clamp-1">{item.name}</h4>
                                       </div>
                                       <div className="flex flex-col mt-0.5">
                                          <div className="flex items-center gap-2">
                                             <span className="text-xs font-black text-blue-600">{baseCurrency.symbol}{(item.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                             {hasDiscount && <span className="text-[10px] text-red-500 font-bold line-through">{baseCurrency.symbol}{item.originalPrice?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                                          </div>
                                          <span className="text-[9px] font-bold text-gray-500 uppercase tracking-tighter">{lineTaxSummary}</span>
                                          {isDispatchedToKds && (
                                             <span className={`mt-1 inline-flex w-fit rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${isReturnedToKds ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                                                {isReturnedToKds ? 'KDS devuelto' : 'KDS enviado'}
                                             </span>
                                          )}
                                       </div>
                                       {item.salespersonId && (
                                          <div className="mt-1 flex items-center gap-1 text-[9px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-md w-fit">
                                             <User size={10} />
                                             <span>{resolveSalespersonLabel(item.salespersonId)}</span>
                                          </div>
                                       )}
                                    </div>
                                    {!isActiveCartItem ? (
                                       <div className="mt-2 flex items-center justify-between">
                                          <div className="rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-600 shadow-sm">
                                             {item.quantity} ud
                                          </div>
                                          <span className="font-black text-gray-900 text-sm">{baseCurrency.symbol}{lineNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                       </div>
                                    ) : (
                                       <>
                                          <div className="flex items-center justify-between mt-2">
                                             <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1">
                                                <button
                                                   onClick={(e) => {
                                                      e.stopPropagation();
                                                      if (isDispatchedToKds) {
                                                         alert('Este artículo ya fue enviado al KDS. Usa Devolver para cancelar la preparación.');
                                                         return;
                                                      }
                                                      updateCartItem({ ...item, quantity: item.quantity - 1 });
                                                   }}
                                                   disabled={isDispatchedToKds}
                                                   className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                                                >
                                                   <Minus size={13} strokeWidth={3} />
                                                </button>
                                                <span className="min-w-[20px] text-center text-xs font-black text-slate-800">{item.quantity}</span>
                                                <button
                                                   onClick={(e) => {
                                                      e.stopPropagation();
                                                      if (isDispatchedToKds) {
                                                         alert('Para agregar más cantidad a un artículo ya enviado al KDS, agrega una línea nueva desde el catálogo.');
                                                         return;
                                                      }
                                                      updateCartItem({ ...item, quantity: item.quantity + 1 });
                                                   }}
                                                   disabled={isDispatchedToKds}
                                                   className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                                                >
                                                   <Plus size={13} strokeWidth={3} />
                                                </button>
                                             </div>
                                             <span className="font-black text-gray-900 text-sm">{baseCurrency.symbol}{lineNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                          </div>
                                          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-gray-100 pt-3">
                                             <button
                                                onClick={(e) => {
                                                   e.stopPropagation();
                                                   setEditingItem(item);
                                                }}
                                                className="inline-flex items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-blue-700 shadow-sm transition-all hover:bg-blue-100"
                                                title="Editar artículo"
                                             >
                                                <Edit3 size={13} strokeWidth={2.4} />
                                             </button>
                                             {isDispatchedToKds ? (
                                                <button
                                                   onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleReturnDispatchedCartItem(item);
                                                   }}
                                                   disabled={isReturnedToKds}
                                                   className="inline-flex items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-700 shadow-sm transition-all hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                   title={isReturnedToKds ? 'Artículo ya devuelto en KDS' : 'Devolver en KDS'}
                                                >
                                                   <Undo2 size={13} strokeWidth={2.4} />
                                                </button>
                                             ) : (
                                                <button
                                                   onClick={(e) => {
                                                      e.stopPropagation();
                                                      updateCartItem(null, item.cartId);
                                                   }}
                                                   className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-red-700 shadow-sm transition-all hover:bg-red-100"
                                                   title="Eliminar artículo"
                                                >
                                                   <Trash2 size={13} strokeWidth={2.4} />
                                                </button>
                                             )}
                                          </div>
                                       </>
                                    )}
                                 </div>
                              </div>
                           );
                        }

                        // DESKTOP CARD DESIGN (Restaurant/Retail)
                        return (
                           <div
                              key={item.cartId || `cart-${idx}`}
                              onClick={() => toggleCartItemFocus(item.cartId)}
                              className={`bg-white rounded-xl p-3 shadow-sm border group relative overflow-hidden transition-all hover:shadow-md cursor-pointer ${editingItem?.cartId === item.cartId || isActiveCartItem ? 'ring-2 ring-blue-100 border-blue-200 bg-blue-50/40' : 'border-gray-100 hover:border-slate-200'}`}
                           >
                              {/* Discount Badge */}
                              {hasDiscount && (
                                 <div className="absolute top-0 right-0 bg-red-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-bl-lg">
                                    -{discountPct}%
                                 </div>
                              )}

                              <div className="flex gap-3">
                                 {/* Item Image */}
                                 {uxConfig.showProductImages && (
                                    <div className="w-12 h-12 rounded-lg bg-gray-50 shrink-0 overflow-hidden border border-gray-100">
                                       {resolveProductImageSrc(item) ? <img src={resolveProductImageSrc(item)} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-300"><Grid size={20} /></div>}
                                    </div>
                                 )}

                                 {/* Item Details */}
                                 <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start mb-1">
                                       <h4 className="font-bold text-gray-800 text-sm leading-tight line-clamp-2" title={item.name}>{item.name}</h4>
                                       <div className="text-right shrink-0 ml-2">
                                          <p className="font-black text-gray-900">{baseCurrency.symbol}{lineNet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                          {hasDiscount && <p className="text-[10px] text-gray-400 line-through">{baseCurrency.symbol}{(item.originalPrice! * item.quantity).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>}
                                       </div>
                                    </div>

                                    <div className="flex items-center justify-between">
                                       <div className="flex flex-col">
                                          <div className="flex flex-col">
                                             <div className="flex items-center gap-1 text-[10px] text-gray-500">
                                                <span>{item.quantity} x {baseCurrency.symbol}{item.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                {item.modifiers && item.modifiers.length > 0 && <span className="text-blue-600 font-bold ml-1">+{item.modifiers.length} mod</span>}
                                             </div>
                                             <div className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">
                                                {lineTaxSummary}
                                             </div>
                                             {isDispatchedToKds && (
                                                <span className={`mt-1 inline-flex w-fit rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${isReturnedToKds ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
                                                   {isReturnedToKds ? 'KDS devuelto' : 'KDS enviado'}
                                                </span>
                                             )}
                                          </div>
                                          {/* Salesperson Badge */}
                                          {item.salespersonId && (
                                             <div className="flex items-center gap-1 text-[9px] text-gray-400 mt-0.5">
                                                <User size={10} />
                                                <span className="truncate max-w-[80px]">{resolveSalespersonLabel(item.salespersonId) || '...'}</span>
                                             </div>
                                          )}
                                       </div>

                                       {!isActiveCartItem ? (
                                          <div className="flex items-center rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-600 shadow-sm">
                                             {item.quantity} ud
                                          </div>
                                       ) : (
                                          <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1">
                                             <button
                                                onClick={(e) => {
                                                   e.stopPropagation();
                                                   if (isDispatchedToKds) {
                                                      alert('Este artículo ya fue enviado al KDS. Usa Devolver para cancelar la preparación.');
                                                      return;
                                                   }
                                                   updateCartItem({ ...item, quantity: item.quantity - 1 }, item.cartId);
                                                }}
                                                disabled={isDispatchedToKds}
                                                className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                                                title="Restar cantidad"
                                             >
                                                <Minus size={13} strokeWidth={3} />
                                             </button>
                                             <button
                                                onClick={(e) => {
                                                   e.stopPropagation();
                                                   if (isDispatchedToKds) {
                                                      alert('Para agregar más cantidad a un artículo ya enviado al KDS, agrega una línea nueva desde el catálogo.');
                                                      return;
                                                   }
                                                   updateCartItem({ ...item, quantity: item.quantity + 1 }, item.cartId);
                                                }}
                                                disabled={isDispatchedToKds}
                                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                                                title="Sumar cantidad"
                                             >
                                                <Plus size={13} strokeWidth={3} />
                                             </button>
                                             <button
                                                onClick={(e) => {
                                                   e.stopPropagation();
                                                   setEditingItem(item);
                                                }}
                                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 shadow-sm transition-colors hover:bg-blue-100"
                                                title="Editar artículo"
                                             >
                                                <Edit3 size={12} />
                                             </button>
                                             {isDispatchedToKds ? (
                                                <button
                                                   onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleReturnDispatchedCartItem(item);
                                                   }}
                                                   disabled={isReturnedToKds}
                                                   className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700 shadow-sm transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                   title={isReturnedToKds ? 'Artículo ya devuelto en KDS' : 'Devolver en KDS'}
                                                >
                                                   <Undo2 size={12} />
                                                </button>
                                             ) : (
                                                <button
                                                   onClick={(e) => {
                                                      e.stopPropagation();
                                                      updateCartItem(null, item.cartId);
                                                   }}
                                                   className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 shadow-sm transition-colors hover:bg-red-100"
                                                   title="Eliminar artículo"
                                                >
                                                   <Trash2 size={12} />
                                                </button>
                                             )}
                                          </div>
                                       )}
                                    </div>
                                 </div>
                              </div>

                              {/* Modifiers List */}
                              {item.modifiers && item.modifiers.length > 0 && (
                                 <div className="mt-2 pl-2 border-l-2 border-blue-100">
                                    <p className="text-[10px] text-gray-500 leading-relaxed">{item.modifiers.join(', ')}</p>
                                 </div>
                              )}
                           </div>
                        );
                     })
                  )}
                  </div >
               </>
            )}
            <div ref={cartEndRef} />

            {activeRecoveredReservation && (
               <div className="mx-4 mb-3 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800">
                  <div className="flex items-center gap-2">
                     <p className="text-[10px] font-black uppercase tracking-widest">
                        {isRecoveredUberOrder ? 'Pedido Recuperado' : 'Reserva Recuperada'}
                     </p>
                     {isRecoveredUberOrder && (
                        <span className="inline-flex items-center rounded-full bg-black px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-white">
                           Uber Eats
                        </span>
                     )}
                  </div>
                  <p className="text-xs font-bold mt-1">{activeRecoveredReservation.code} • {activeRecoveredReservation.customerName}</p>
                  <p className="text-[11px] mt-1">
                     Total: {baseCurrency.symbol}{cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Anticipo: {baseCurrency.symbol}{reservationAdvanceApplied.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Saldo: {baseCurrency.symbol}{reservationBalanceDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  {isRecoveredUberOrder && (
                     <p className="text-[11px] mt-1 font-semibold text-amber-700">
                        Pedido bloqueado para cambios manuales. Debe convertirse en venta POS para confirmar Uber Eats.
                     </p>
                  )}
               </div>
            )}

            {/* Sidebar Footer */}
            <div className={`flex-none bg-white border-t border-gray-200 p-4 shadow-inner ${isRetailMode ? 'flex flex-row-reverse items-end justify-between gap-8' : 'space-y-3'} ${isMobile ? 'hidden' : ''}`}>
               {/* DESKTOP FOOTER CONTENT (UNCHANGED) */}
               {
                  isRetailMode ? (
                     // --- RETAIL MODE FOOTER (HORIZONTAL) ---
                     <>
                        {/* RIGHT: PAY & TOTAL */}
                        <div className="flex items-end gap-5">
                           <div className="hidden xl:flex flex-col gap-3 rounded-[1.75rem] border border-slate-100 bg-slate-50 px-5 py-4 shadow-sm">
                              <div className="flex items-end gap-6">
                                 <div className="text-right">
                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Subtotal</p>
                                    <p className="text-lg font-bold text-gray-700">{baseCurrency.symbol}{cartSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                 </div>
                                 {discountAmount > 0 && (
                                    <div className="text-right">
                                       <p className="text-[10px] text-red-400 font-bold uppercase tracking-wider">Descuento</p>
                                       <p className="text-lg font-bold text-red-500">-{baseCurrency.symbol}{discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                    </div>
                                 )}
                                 <div className="text-right">
                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Impuestos</p>
                                    <p className="text-lg font-bold text-gray-700">{baseCurrency.symbol}{cartTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                 </div>
                              </div>
                              <div className="flex items-end justify-between gap-6 border-t border-slate-200 pt-3">
                                 <div className="text-left">
                                    <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Total a Pagar</p>
                                    <p className="text-[10px] font-bold text-gray-400 mt-1">
                                       {cart.reduce((acc, i) => acc + i.quantity, 0)} Artículos
                                       {pointsEarned > 0 && <span className="text-purple-500 ml-2">• Ganarás +{pointsEarned} pts</span>}
                                    </p>
                                 </div>
                                 <div className="text-right text-[3rem] font-black text-slate-900 leading-none tracking-tighter">
                                    {baseCurrency.symbol}{cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                 </div>
                              </div>
                           </div>

                           <div className="text-right hidden sm:block xl:hidden mr-1">
                              <div className="flex items-end justify-end gap-5">
                                 <div>
                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Subtotal</p>
                                    <p className="text-lg font-bold text-gray-700">{baseCurrency.symbol}{cartSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                 </div>
                                 <div>
                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Impuestos</p>
                                    <p className="text-lg font-bold text-gray-700">{baseCurrency.symbol}{cartTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                 </div>
                              </div>
                              <div className="mt-3 border-t border-slate-200 pt-3">
                                 <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Total a Pagar</p>
                                 <div className="text-4xl font-black text-slate-900 leading-none tracking-tighter">
                                    {baseCurrency.symbol}{cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                 </div>
                                 <p className="text-[10px] font-bold text-gray-400 mt-1">
                                    {cart.reduce((acc, i) => acc + i.quantity, 0)} Artículos
                                    {pointsEarned > 0 && <span className="text-purple-500 ml-2">• Ganarás +{pointsEarned} pts</span>}
                                 </p>
                              </div>
                           </div>

                           <div className="flex items-center gap-4 pl-2">
                              <button
                                 onClick={() => triggerSafetyGate('Cerrar Sesión', onLogout)}
                                 className="h-14 min-w-[136px] px-5 rounded-2xl font-black text-base border-2 border-red-100 bg-red-50 text-red-700 hover:bg-red-100 hover:border-red-200 shadow-lg shadow-red-100/60 transition-all active:scale-95 flex items-center justify-center gap-2.5 shrink-0"
                              >
                                 <LogOut size={22} />
                                 <span>Salir</span>
                              </button>
                              <button
                                 onClick={() => {
                                    if (cart.length > 0 && fiscalStatus.hasNCF) {
                                       const validation = validateTerminalDocument(config, terminalId, 'TICKET');
                                       if (!validation.isValid) {
                                          alert(validation.error);
                                          return;
                                       }
                                       if (!canProceedWithOperationalSession()) return;
                                       proceedToCheckout();
                                    } else if (!fiscalStatus.hasNCF) {
                                       alert("No hay secuencias fiscales disponibles.");
                                    }
                                 }}
                                 disabled={cart.length === 0 || !fiscalStatus.hasNCF}
                                 className={`h-14 min-w-[228px] px-6 rounded-2xl font-black text-lg shadow-xl hover:scale-[1.05] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2.5 shrink-0 ${!fiscalStatus.hasNCF ? 'bg-red-100 text-red-500 cursor-not-allowed border-2 border-red-200' : 'bg-slate-900 text-white hover:bg-black'}`}
                              >
                                 <span>{checkoutActionLabel}</span>
                                 <ArrowRight size={24} />
                              </button>
                           </div>
                        </div>

                        <div className="flex-1 w-full min-w-0 pr-4">
                           <ActionGrid
                              orientation="horizontal"
                              onAction={handleGridAction}
                              config={config}
                              parkedTicketsCount={parkedTickets.length}
                              isReturnMode={isReturnMode}
                              hasCartItems={cart.length > 0}
                              globalDiscountValue={globalDiscount.value}
                              showLogout={false}
                           />
                        </div>

                     </>
                  ) : (
                     // --- VISUAL MODE FOOTER (VERTICAL) ---
                     <>




                        {/* --- CONDITIONAL FOOTER --- */}
                        {(rightSidebarTab === 'CART' || isMobile) && (isKioskMode ? (
                           <div className="mt-auto pt-6 space-y-6">
                              {/* Simple Kiosk Totals */}
                              <div className="flex justify-between items-end px-2">
                                 <span className="text-xl font-bold text-gray-400">Total a Pagar</span>
                                 <span className="text-6xl font-black text-slate-900 tracking-tighter">{baseCurrency.symbol}{cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              </div>

                              <button
                                 onClick={() => {
                                    if (cart.length > 0) {
                                       if (onKioskPay) onKioskPay();
                                       else alert("Kiosk Pay Not Implemented");
                                    }
                                 }}
                                 disabled={cart.length === 0}
                                 className={`w-full py-8 rounded-3xl font-black text-4xl shadow-2xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-6 ${cart.length === 0 ? 'bg-gray-200 text-gray-400' : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-emerald-200'}`}
                              >
                                 <span>PAGAR AHORA</span>
                                 <ArrowRight size={48} />
                              </button>

                              <div className="text-center text-gray-400 text-sm font-medium">
                                 Toca para seleccionar método de pago
                              </div>
                           </div>
                        ) : (
                           <>
                              {/* --- BLOQUE DE TOTALES --- */}
                              <div className="space-y-1.5 pt-1 border-t border-dashed border-gray-200 mt-2">
                                 <div className="flex justify-between items-center text-xs font-bold text-gray-500">
                                    <span>SUBTOTAL</span>
                                    <span>{formatCurrency(cartSubtotal, baseCurrency.symbol)}</span>
                                 </div>
                                 {discountAmount > 0 && (
                                    <div className="flex justify-between items-center text-xs font-black text-red-500">
                                       <span>DESCUENTO</span>
                                       <span>-{formatCurrency(discountAmount, baseCurrency.symbol)}</span>
                                    </div>
                                 )}
                                 <div className="flex justify-between items-start text-xs font-bold text-gray-500">
                                    <div className="flex flex-col gap-0.5">
                                       <div className="flex items-center gap-2">
                                          <span>IMPUESTOS</span>
                                          {primaryTaxLabel && (
                                             <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                                                {primaryTaxLabel}
                                             </span>
                                          )}
                                       </div>
                                       {combinedTaxBreakdown.length > 0 && (
                                          <div className="space-y-0.5 pt-0.5">
                                             {combinedTaxBreakdown.map((tax) => (
                                                <div key={tax.id} className="flex items-center justify-between gap-4 text-[10px] font-bold text-slate-400">
                                                   <span>{tax.label}</span>
                                                   <span>{formatCurrency(tax.amount, baseCurrency.symbol)}</span>
                                                </div>
                                             ))}
                                          </div>
                                       )}
                                    </div>
                                    <span className="shrink-0 pt-0.5">{formatCurrency(cartTax, baseCurrency.symbol)}</span>
                                 </div>

                                 <div className="flex items-end justify-between gap-4 pt-3">
                                    <div className="space-y-1">
                                       <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.28em]">Total</p>
                                       {pointsEarned > 0 && <p className="text-[10px] font-bold text-purple-500">+{pointsEarned} Puntos</p>}
                                    </div>
                                    <div className="text-right text-[2.65rem] font-black text-slate-900 leading-none tracking-tighter">
                                       {formatCurrency(cartTotal, baseCurrency.symbol)}
                                    </div>
                                 </div>
                              </div>

                               <div className={`grid ${isRestaurantMode ? (hideTableExtras ? 'grid-cols-4' : 'grid-cols-5') : 'grid-cols-[112px_minmax(0,1fr)]'} items-center gap-3 pt-5 px-1`}>
                                 {!isRestaurantMode ? (
                                    <>
                                       <button
                                          onClick={() => triggerSafetyGate('Cerrar Sesión', onLogout)}
                                          className="w-[112px] px-3 py-3.5 rounded-2xl font-black text-base border-2 border-red-100 bg-red-50 text-red-700 hover:bg-red-100 hover:border-red-200 shadow-lg shadow-red-100/60 transition-all active:scale-95 flex items-center justify-center gap-2"
                                       >
                                          <LogOut size={20} />
                                          <span>Salir</span>
                                       </button>
                                       <button
                                          onClick={() => {
                                             if (cart.length > 0 && fiscalStatus.hasNCF) {
                                                const validation = validateTerminalDocument(config, terminalId, 'TICKET');
                                                if (!validation.isValid) {
                                                   alert(validation.error);
                                                   return;
                                                }
                                                if (!canProceedWithOperationalSession()) return;
                                                proceedToCheckout();
                                             } else if (!fiscalStatus.hasNCF) {
                                                alert("No hay secuencias fiscales disponibles.");
                                             }
                                          }}
                                          disabled={cart.length === 0 || !fiscalStatus.hasNCF}
                                          className={`w-full max-w-[188px] justify-self-end py-3.5 rounded-2xl font-black text-lg shadow-xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2.5 ${!fiscalStatus.hasNCF ? 'bg-red-100 text-red-500 cursor-not-allowed border-2 border-red-200' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
                                       >
                                          <span>{checkoutActionLabel}</span>
                                          <ArrowRight size={24} />
                                       </button>
                                    </>
                                 ) : (
                                    <>
                                       <button
                                          onClick={() => { void handleBackToMap(); }}
                                          className="min-w-0 h-20 flex flex-col items-center justify-center gap-2 rounded-3xl font-black text-[11px] uppercase border-2 border-slate-200 bg-slate-50 text-slate-700 hover:bg-white hover:border-slate-300 shadow-sm hover:shadow-md transition-all active:scale-95"
                                       >
                                          <Layout size={24} />
                                          <span>Mesas</span>
                                       </button>
                                       <button
                                          onClick={handleDispatchCommand}
                                          className="min-w-0 h-20 flex flex-col items-center justify-center gap-2 rounded-3xl font-black text-[11px] uppercase border-2 border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-100 hover:border-orange-300 shadow-sm hover:shadow-md transition-all active:scale-95"
                                       >
                                          <ChefHat size={24} />
                                          <span>Cocina</span>
                                       </button>
                                       {!hideTableExtras && (
                                          <button
                                             onClick={() => setShowSplitModal(true)}
                                             className="min-w-0 h-20 flex flex-col items-center justify-center gap-2 rounded-3xl font-black text-[11px] uppercase border-2 border-purple-200 bg-purple-50 text-purple-600 hover:bg-purple-100 hover:border-purple-300 shadow-sm hover:shadow-md transition-all active:scale-95"
                                          >
                                             <Split size={24} />
                                             <span>Dividir</span>
                                          </button>
                                       )}
                                       <button
                                          onClick={handlePrintPrecuenta}
                                          className="min-w-0 h-20 flex flex-col items-center justify-center gap-2 rounded-3xl font-black text-[11px] uppercase border-2 border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:border-blue-300 shadow-sm hover:shadow-md transition-all active:scale-95"
                                       >
                                          <Printer size={24} />
                                          <span>Precuenta</span>
                                       </button>
                                       <button
                                          onClick={() => {
                                             if (cart.length > 0) {
                                                if (!canProceedWithOperationalSession()) return;
                                                proceedToCheckout();
                                             }
                                          }}
                                          disabled={cart.length === 0}
                                          className="min-w-0 h-20 flex flex-col items-center justify-center gap-2 rounded-3xl font-black text-[11px] uppercase bg-slate-900 text-white hover:bg-black shadow-sm hover:shadow-md transition-all active:scale-95 disabled:bg-slate-200 disabled:text-slate-500 disabled:opacity-100 disabled:cursor-not-allowed"
                                       >
                                          <ArrowRight size={24} />
                                          <span>Cobrar</span>
                                       </button>
                                    </>
                                 )}
                              </div>
                           </>
                        ))}
                     </>
                  )
               }
            </div >
         </div>

         {/* MOBILE STICKY FOOTER */}
         {
            isMobile && mobileView === 'TICKET' && (
               <div
                  ref={mobileFooterRef}
                  className="md:hidden fixed left-0 right-0 bg-white border-t border-gray-100 p-4 shadow-[0_-10px_30px_rgba(0,0,0,0.05)] z-50 animate-in slide-in-from-bottom-5"
                  style={mobileFooterStyle}
               >
                  <div className="flex justify-between items-center mb-4 px-2">
                     <div className="flex gap-4">
                        <button onClick={() => {
                           if (blockRecoveredUberOrderMutation('aplicar descuentos')) return;
                           setShowGlobalDiscount(true);
                        }} className="flex flex-col items-center gap-1 text-gray-400 hover:text-pink-500">
                           <Percent size={18} />
                           <span className="text-[9px] font-bold uppercase">Desc.</span>
                        </button>
                        <button onClick={() => {
                           if (blockRecoveredUberOrderMutation('aplicar cupones')) return;
                           setShowCouponModal(true);
                        }} className="flex flex-col items-center gap-1 text-gray-400 hover:text-cyan-500">
                           <QrCode size={18} />
                           <span className="text-[9px] font-bold uppercase">Cupón</span>
                        </button>
                        {!hideTableExtras && (
                           <>
                              <button onClick={openParkAliasModal} className="flex flex-col items-center gap-1 text-gray-400 hover:text-blue-500">
                                 <Save size={18} />
                                 <span className="text-[9px] font-bold uppercase">Grd.</span>
                              </button>
                              <button onClick={() => setShowParkedList(!showParkedList)} className="flex flex-col items-center gap-1 text-gray-400 hover:text-orange-500 relative">
                                 <Inbox size={18} />
                                 <span className="text-[9px] font-bold uppercase">Esp.</span>
                                 {(Array.isArray(parkedTickets) ? parkedTickets : []).length > 0 && <span className="absolute -top-1 -right-1 w-2 h-2 bg-orange-500 rounded-full"></span>}
                              </button>
                              <button onClick={openReservationModal} className="flex flex-col items-center gap-1 text-gray-400 hover:text-amber-600">
                                 <StickyNote size={18} />
                                 <span className="text-[9px] font-bold uppercase">Res.</span>
                              </button>
                              <button onClick={openRecoverReservationModal} className="flex flex-col items-center gap-1 text-gray-400 hover:text-teal-600">
                                 <QrCode size={18} />
                                 <span className="text-[9px] font-bold uppercase">Rec.</span>
                              </button>
                           </>
                        )}
                        {activeTerminalConfig?.operational?.usa_modulos_cocina && (
                           <button onClick={handleDispatchCommand} className="flex flex-col items-center gap-1 text-gray-400 hover:text-orange-600">
                              <ChefHat size={18} />
                              <span className="text-[9px] font-bold uppercase">March.</span>
                           </button>
                        )}
                        {!hideTableExtras && (
                           <button onClick={() => onOpenInventoryTracking()} className="flex flex-col items-center gap-1 text-gray-400 hover:text-indigo-500">
                              <Package size={18} />
                              <span className="text-[9px] font-bold uppercase">Rast.</span>
                           </button>
                        )}
                     </div>
                     <div className="text-right">
                        <span className="text-[10px] font-bold text-gray-400 uppercase block">Subtotal: {baseCurrency.symbol}{cartSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        {discountAmount > 0 && <span className="text-[10px] font-bold text-red-500 uppercase block">Desc: -{baseCurrency.symbol}{discountAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
                     </div>
                  </div>
                  <div className="flex items-center gap-4">
                     <div className="flex-1">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block leading-none mb-1">Total</span>
                        <span className="text-3xl font-black text-gray-900 tracking-tighter leading-none">{baseCurrency.symbol}{cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                     </div>
                     <button
                        onClick={() => {
                           if (cart.length > 0 && fiscalStatus.hasNCF) {
                              if (!canProceedWithOperationalSession()) return;
                              proceedToCheckout();
                           }
                        }}
                        disabled={cart.length === 0 || !fiscalStatus.hasNCF}
                        className="bg-blue-600 text-white px-8 py-4 rounded-2xl font-black text-lg shadow-lg shadow-blue-200 active:scale-95 transition-all flex items-center gap-2"
                     >
                        <span>{isRecoveredUberOrder ? 'FACTURAR UBER' : activeRecoveredReservation ? 'COBRAR SALDO' : 'COBRAR'}</span>
                        <ArrowRight size={20} />
                     </button>
                  </div>
               </div>
            )
         }

         {/* Modals & Overlays */}
         {
            showSafetyGate && safetyAction && (
               <SafetyGateModal
                  isOpen={showSafetyGate}
                  onClose={() => setShowSafetyGate(false)}
                  onConfirm={safetyAction.callback}
                  actionName={safetyAction.name}
                  isCritical={safetyAction.isCritical}
               />
            )
         }
         {showSplitModal && (
            <SplitTicketModal
               originalItems={cart}
               currencySymbol={baseCurrency.symbol}
               onClose={() => setShowSplitModal(false)}
               onConfirm={handleSplitConfirm}
            />
         )}
         {showPaymentModal && <UnifiedPaymentModal total={amountDueNow} items={cart} taxAmount={cartTax} currencySymbol={baseCurrency.symbol} config={config} onClose={() => setShowPaymentModal(false)} onConfirm={handlePaymentConfirm} themeColor={config.themeColor} customer={effectiveSelectedCustomer} isDelinquent={isDelinquent} users={users} roles={roles} isMaster={isMaster} currentUser={currentUser} isRestaurantMode={isRestaurantMode} />}
         {showLoyaltyModal && <LoyaltyScanModal onClose={() => setShowLoyaltyModal(false)} onScan={handleLoyaltyScan} />}
         {editingItem && <CartItemOptionsModal item={editingItem} config={config} users={users} salesUsers={salesUsers} roles={roles} onClose={() => setEditingItem(null)} onUpdate={updateCartItem} canApplyDiscount={!isKdsReturnedCartItem(editingItem)} canVoidItem={!editingItem.dispatched} />}
         {selectedProductForVariants && <ProductVariantSelector product={selectedProductForVariants} currencySymbol={baseCurrency.symbol} onClose={() => setSelectedProductForVariants(null)} onConfirm={(p, m, pr, selectedVariant, variantInfo) => { addToCart(p, 1, pr, m, undefined, selectedVariant, variantInfo); setSelectedProductForVariants(null); }} />}
         {productForScale && <ScaleModal product={productForScale} currencySymbol={baseCurrency.symbol} onClose={() => setProductForScale(null)} onConfirm={(w) => { addToCart(productForScale, w); setProductForScale(null); }} />}
         {
            showGlobalDiscount && <GlobalDiscountModal currentSubtotal={cartSubtotal} currencySymbol={baseCurrency.symbol} initialValue={globalDiscount.value.toString()} initialType={globalDiscount.type} themeColor={config.themeColor} onClose={() => setShowGlobalDiscount(false)} onConfirm={async (val, type) => {
               const numVal = parseFloat(val) || 0;
               const authorized = await requestApproval({
                  permission: 'POS_DISCOUNT',
                  actionDescription: 'Aplicar Descuento Global',
                  context: { newValue: type === 'PERCENT' ? numVal : undefined, originalValue: cartSubtotal }
               });
               if (!authorized) return;

               setGlobalDiscount({ value: numVal, type });
               setShowGlobalDiscount(false);
            }} />
         }

         <SupervisorModal {...supervisorModalProps} users={users} />

         {
            showCouponModal && (
               <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                  <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                     <div className="p-6">
                        <div className="flex justify-between items-center mb-6">
                           <h3 className="text-xl font-black text-gray-800 flex items-center gap-2">
                              <QrCode className="text-blue-600" />
                              Canjear Cupón
                           </h3>
                           <button onClick={() => setShowCouponModal(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
                              <X size={20} />
                           </button>
                        </div>

                        <div className="space-y-4">
                           <div>
                              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Código del Cupón</label>
                              <input
                                 autoFocus
                                 type="text"
                                 value={couponCode}
                                 onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                                 className="w-full text-center text-2xl font-black tracking-widest p-4 bg-gray-50 border-2 border-gray-200 rounded-xl outline-none focus:border-blue-500 focus:bg-white transition-all uppercase placeholder-gray-300"
                                 placeholder="XXXX-XXXX"
                                 onKeyDown={(e) => e.key === 'Enter' && handleRedeemCoupon()}
                              />
                           </div>

                           <button
                              onClick={handleRedeemCoupon}
                              className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold text-lg shadow-lg hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center gap-2"
                           >
                              <Check size={20} />
                              Validar y Aplicar
                           </button>
                        </div>
                     </div>
                  </div>
               </div>
            )
         }

         {
            showReservationModal && (
               <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="bg-white rounded-[2rem] w-full max-w-lg shadow-2xl overflow-hidden">
                     <div className="p-6 border-b bg-amber-50 flex justify-between items-center">
                        <h3 className="font-black text-xl text-amber-900 flex items-center gap-2">
                           <StickyNote size={20} />
                           {isEditingRecoveredReservation ? 'Actualizar Reserva' : 'Reserva / Hold'}
                        </h3>
                        <button onClick={() => setShowReservationModal(false)} className="p-2 hover:bg-amber-100 rounded-full text-amber-700">
                           <X size={18} />
                        </button>
                     </div>
                     <div className="p-6 space-y-4">
                        {isEditingRecoveredReservation && activeRecoveredReservation && (
                           <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs font-bold">
                              Editando {activeRecoveredReservation.code}. Se guardará con la misma referencia y QR.
                           </div>
                        )}

                        <div>
                           <label className="block text-[11px] font-black text-gray-500 uppercase tracking-widest mb-2">Cliente (Obligatorio)</label>
                           <select
                              value={reservationCustomerId}
                              onChange={(e) => setReservationCustomerId(e.target.value)}
                              className="w-full p-3 rounded-xl border border-gray-200 font-bold text-sm outline-none focus:ring-2 focus:ring-amber-100"
                           >
                              <option value="">Seleccionar Cliente</option>
                              {(customers || []).map(c => (
                                 <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                           </select>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                           <div>
                              <label className="block text-[11px] font-black text-gray-500 uppercase tracking-widest mb-2">Monto de Abono</label>
                              <input
                                 type="number"
                                 min={0}
                                 step="0.01"
                                 value={reservationAdvanceInput}
                                 onChange={(e) => setReservationAdvanceInput(e.target.value)}
                                 className="w-full p-3 rounded-xl border border-gray-200 font-bold text-sm outline-none focus:ring-2 focus:ring-amber-100"
                              />
                           </div>
                           <div>
                              <label className="block text-[11px] font-black text-gray-500 uppercase tracking-widest mb-2">Fecha de Entrega</label>
                              <input
                                 type="date"
                                 value={reservationDeliveryDate}
                                 onChange={(e) => setReservationDeliveryDate(e.target.value)}
                                 className="w-full p-3 rounded-xl border border-gray-200 font-bold text-sm outline-none focus:ring-2 focus:ring-amber-100"
                              />
                           </div>
                        </div>

                        <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs">
                           Vigencia: {reservationPolicy.validityDays} día(s)
                           {reservationPolicy.requireAdvance && (
                              <span> • Anticipo mínimo: {reservationPolicy.minimumAdvancePercent}%</span>
                           )}
                        </div>

                        <div className="p-4 rounded-xl border border-gray-100 bg-gray-50 text-sm">
                           <div className="flex justify-between font-bold text-gray-600">
                              <span>Total Reserva</span>
                              <span>{baseCurrency.symbol}{cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                           </div>
                           <div className="flex justify-between text-gray-500 mt-1">
                              <span>Saldo estimado</span>
                              <span>{baseCurrency.symbol}{Math.max(0, cartTotal - (parseFloat(reservationAdvanceInput || '0') || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                           </div>
                        </div>
                     </div>
                     <div className="px-6 pb-6 flex justify-end gap-3">
                        <button onClick={() => setShowReservationModal(false)} className="px-4 py-2 rounded-xl border border-gray-200 text-gray-600 font-bold hover:bg-gray-50">
                           Cancelar
                        </button>
                        <button onClick={handleCreateReservation} className="px-5 py-2.5 rounded-xl bg-amber-600 text-white font-black hover:bg-amber-700 transition-all">
                           {isEditingRecoveredReservation ? 'Actualizar Reserva' : 'Guardar Reserva'}
                        </button>
                     </div>
                  </div>
               </div>
            )
         }

         {
            showRecoverReservationModal && (
               <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="bg-white rounded-[2rem] w-full max-w-2xl shadow-2xl overflow-hidden">
                     <div className="p-6 border-b bg-teal-50 flex justify-between items-center">
                        <h3 className="font-black text-xl text-teal-900 flex items-center gap-2">
                           <QrCode size={20} />
                           Reservas y Pedidos
                        </h3>
                        <button onClick={closeRecoverReservationModal} className="p-2 hover:bg-teal-100 rounded-full text-teal-700">
                           <X size={18} />
                        </button>
                     </div>
                     <div className="p-6 space-y-4">
                        <div className="flex gap-2">
                           <div className="flex-1 relative">
                              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                              <input
                                 type="text"
                                 value={reservationSearchTerm}
                                 onChange={(e) => setReservationSearchTerm(e.target.value)}
                                 placeholder="Buscar por cliente, código, display o ID..."
                                 className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 font-bold text-sm outline-none focus:ring-2 focus:ring-teal-100"
                              />
                           </div>
                           <button
                              onClick={() => loadUberPendingOrders().catch(console.error)}
                              className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 font-bold hover:bg-slate-50"
                           >
                              Actualizar
                           </button>
                           <button
                              onClick={() => {
                                 if (isMobile) {
                                    closeRecoverReservationModal();
                                    setIsScannerOpen(true);
                                    return;
                                 }

                                 setSuccessToast('Escanee la reserva con el lector QR del equipo.');
                                 setTimeout(() => setSuccessToast(null), 2200);
                              }}
                              className="px-4 py-2.5 rounded-xl border border-teal-200 bg-teal-50 text-teal-700 font-bold hover:bg-teal-100"
                           >
                              {isMobile ? 'Escanear QR' : 'Leer con Lector'}
                           </button>
                        </div>

                        {!isMobile && (
                           <div className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-2.5">
                              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-sky-600">
                                 Desktop
                              </p>
                              <p className="mt-1 text-xs font-semibold text-sky-900">
                                 El lector QR funciona como teclado. No hace falta abrir la cámara para recuperar reservas o pedidos Uber Eats.
                              </p>
                           </div>
                        )}

                        {reservationCustomerFilterId && (
                           <div className="flex items-center justify-between rounded-xl border border-teal-100 bg-teal-50 px-3 py-2">
                              <p className="text-xs font-bold text-teal-800">
                                 Mostrando reservas activas de {reservationFilterCustomerName}
                              </p>
                              <button
                                 onClick={openRecoverReservationModal}
                                 className="text-[11px] font-black uppercase text-teal-700 hover:text-teal-900"
                              >
                                 Ver todas
                              </button>
                           </div>
                        )}

                        {!reservationCustomerFilterId && (
                           <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                              <span className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                                 Uber Eats
                              </span>
                              <span className="rounded-full bg-black px-2 py-0.5 text-[10px] font-black text-white">
                                 {uberPendingOrders.length}
                              </span>
                              {isLoadingUberPendingOrders && (
                                 <span className="text-[11px] font-bold text-slate-500">Cargando pedidos...</span>
                              )}
                              {!isLoadingUberPendingOrders && uberPendingOrdersError && (
                                 <span className="text-[11px] font-bold text-red-500">{uberPendingOrdersError}</span>
                              )}
                           </div>
                        )}

                        <div className="max-h-[45vh] overflow-y-auto space-y-2">
                           {recoverableOrders.map((entry) => {
                              if (entry.kind === 'UBER_EATS') {
                                 const order = entry.order;
                                 const existingTransaction = findUberTransactionByOrderId(order.uberOrderId);

                                 return (
                                    <button
                                       key={order.id || order.uberOrderId}
                                       onClick={() => { void handleRecoverUberOrder(order); }}
                                       className="w-full text-left p-4 rounded-xl border border-gray-100 hover:border-slate-900 hover:bg-slate-50 transition-all"
                                    >
                                       <div className="flex justify-between items-start gap-2">
                                          <div>
                                             <div className="flex items-center gap-2">
                                                <span className="inline-flex items-center rounded-full bg-black px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-white">
                                                   Uber Eats
                                                </span>
                                                <span className="text-[11px] font-black text-slate-500">{order.displayId || order.uberOrderId}</span>
                                             </div>
                                             <p className="mt-2 font-black text-gray-800">{order.customerName || 'Cliente Uber Eats'}</p>
                                             <p className="text-[11px] font-bold text-gray-500 mt-0.5">
                                                Estado: {order.status} • POS: {order.posSyncStatus}
                                             </p>
                                          </div>
                                          <div className="text-right">
                                             <p className="text-xs font-black text-gray-800">{baseCurrency.symbol}{order.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                             <p className="text-[11px] text-gray-500">{order.itemCount} artículo(s)</p>
                                          </div>
                                       </div>
                                       <p className="text-[11px] text-gray-500 mt-2">
                                          {existingTransaction
                                             ? `Factura local detectada: ${existingTransaction.displayId || existingTransaction.id}. Toque para reconfirmar ERP.`
                                             : 'Toque para cargar el pedido y convertirlo en factura local POS.'}
                                       </p>
                                    </button>
                                 );
                              }

                              const reservation = entry.reservation;
                              return (
                                 <button
                                    key={reservation.id}
                                    onClick={() => handleRecoverReservation(reservation)}
                                    className="w-full text-left p-4 rounded-xl border border-gray-100 hover:border-teal-300 hover:bg-teal-50 transition-all"
                                 >
                                    <div className="flex justify-between items-start gap-2">
                                       <div>
                                          <p className="font-black text-gray-800">{reservation.customerName}</p>
                                          <p className="text-[11px] font-bold text-gray-500 mt-0.5">{reservation.code}</p>
                                       </div>
                                       <div className="text-right">
                                          <p className="text-xs font-black text-gray-800">{baseCurrency.symbol}{reservation.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                          <p className="text-[11px] text-gray-500">Abono: {baseCurrency.symbol}{(reservation.balancePaid || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                       </div>
                                    </div>
                                    <p className="text-[11px] text-gray-500 mt-2">
                                       Vence: {new Date(reservation.expiryDate).toLocaleDateString()} {reservation.deliveryDate ? `• Entrega: ${new Date(reservation.deliveryDate).toLocaleDateString()}` : ''}
                                    </p>
                                 </button>
                              );
                           })}
                           {recoverableOrders.length === 0 && (
                              <div className="p-8 rounded-xl border border-dashed border-gray-200 text-center text-sm text-gray-400">
                                 No hay reservas ni pedidos Uber Eats pendientes para mostrar.
                              </div>
                           )}
                        </div>
                     </div>
                  </div>
               </div>
            )
         }

         {
            showReservationReceipt && (
               <div className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden">
                     <div className="p-6 border-b bg-slate-50">
                        <h3 className="font-black text-xl text-slate-800">Nota de Reserva</h3>
                        <p className="text-xs text-slate-500 mt-1">Documento no fiscal generado correctamente.</p>
                     </div>
                     <div className="p-6 space-y-4">
                        <div className="text-center">
                           <img
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(showReservationReceipt.qrPayload)}`}
                              alt="QR Reserva"
                              className="mx-auto w-40 h-40 rounded-xl border border-gray-200"
                           />
                           <p className="text-[11px] text-gray-500 font-mono mt-2">{showReservationReceipt.code}</p>
                        </div>
                        <div className="p-4 rounded-xl border border-gray-100 bg-gray-50 text-sm">
                           <div className="flex justify-between"><span className="text-gray-500">Cliente</span><span className="font-bold text-gray-800">{showReservationReceipt.customerName}</span></div>
                           <div className="flex justify-between mt-1"><span className="text-gray-500">Total</span><span className="font-bold text-gray-800">{baseCurrency.symbol}{showReservationReceipt.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                           <div className="flex justify-between mt-1"><span className="text-gray-500">Abono</span><span className="font-bold text-gray-800">{baseCurrency.symbol}{(showReservationReceipt.balancePaid || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                           <div className="flex justify-between mt-1"><span className="text-gray-500">Vence</span><span className="font-bold text-gray-800">{new Date(showReservationReceipt.expiryDate).toLocaleDateString()}</span></div>
                        </div>
                     </div>
                     <div className="px-6 pb-6 flex justify-between items-center gap-3">
                        <button
                           onClick={async () => {
                              if (isPrintingReservationReceipt) return;
                              setIsPrintingReservationReceipt(true);
                              try {
                                 const printed = await printReservation(
                                    showReservationReceipt,
                                    config,
                                    Math.max(1, Math.floor(Number(reservationPolicy.printCopies || 1)))
                                 );
                                 if (printed) {
                                    setSuccessToast(`Reserva ${showReservationReceipt.code} enviada a impresión`);
                                 } else {
                                    setErrorToast('No se pudo imprimir la nota de reserva. Verifica la impresora configurada.');
                                    setTimeout(() => setErrorToast(null), 3500);
                                 }
                              } catch (error) {
                                 console.error('Reservation print failed:', error);
                                 setErrorToast('Error al imprimir la nota de reserva.');
                                 setTimeout(() => setErrorToast(null), 3500);
                              } finally {
                                 setIsPrintingReservationReceipt(false);
                              }
                           }}
                           disabled={isPrintingReservationReceipt}
                           className="flex-1 px-5 py-2.5 rounded-xl bg-blue-600 text-white font-black hover:bg-blue-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-100"
                        >
                           <Printer size={18} /> {isPrintingReservationReceipt ? 'Imprimiendo...' : 'Imprimir'}
                        </button>
                        <button
                           onClick={() => setShowReservationReceipt(null)}
                           className="flex-1 px-5 py-2.5 rounded-xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 transition-all"
                        >
                           Cerrar
                        </button>
                     </div>
                  </div>
               </div>
            )
         }

         {/* Save Parked Ticket Alias */}
         {showParkAliasModal && (
            <div className="fixed inset-0 z-[101] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in zoom-in-95">
               <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95">
                  <div className="p-6 border-b bg-gray-50 flex justify-between items-center">
                     <div>
                        <h3 className="font-black text-xl text-gray-800">Guardar En Espera</h3>
                        <p className="text-sm text-gray-500 mt-1">Agrega un alias para ubicar esta factura más rápido.</p>
                     </div>
                     <button onClick={closeParkAliasModal} className="p-2 hover:bg-gray-200 rounded-full">
                        <X size={20} />
                     </button>
                  </div>
                  <div className="p-6 space-y-4">
                     <div>
                        <label htmlFor="park-ticket-alias" className="block text-sm font-bold text-gray-700 mb-2">
                           Alias de la factura
                        </label>
                        <input
                           id="park-ticket-alias"
                           ref={parkAliasInputRef}
                           value={parkTicketAlias}
                           onChange={(e) => setParkTicketAlias(e.target.value)}
                           onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                 void handleParkCurrentTicket(parkTicketAlias);
                              }
                           }}
                           placeholder="Ej. Cliente VIP, Pedido oficina, Recoger luego"
                           maxLength={80}
                           className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-base font-medium text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                     </div>
                     <div className="rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-500 mb-1">Nombre Base</p>
                        <p className="text-sm font-semibold text-blue-900">{buildParkedTicketName()}</p>
                     </div>
                  </div>
                  <div className="p-6 pt-0 flex gap-3">
                     <button
                        onClick={closeParkAliasModal}
                        className="flex-1 rounded-2xl border border-gray-200 px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-gray-500 hover:bg-gray-50 transition-colors"
                     >
                        Cancelar
                     </button>
                     <button
                        onClick={() => void handleParkCurrentTicket(parkTicketAlias)}
                        className="flex-1 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-white hover:bg-blue-700 transition-colors"
                     >
                        Guardar En Espera
                     </button>
                  </div>
               </div>
            </div>
         )}

         {/* List of Parked Tickets */}
         {
            showParkedList && (
               <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in zoom-in-95">
                  <div className="bg-white rounded-[2.5rem] w-full max-w-md shadow-2xl overflow-hidden animate-in zoom-in-95">
                     <div className="p-6 border-b bg-gray-50 flex justify-between items-center">
                        <h3 className="font-black text-xl text-gray-800">Tickets en Espera</h3>
                        <button onClick={() => setShowParkedList(false)} className="p-2 hover:bg-gray-200 rounded-full"><X size={20} /></button>
                     </div>
                     <div className="p-4 overflow-y-auto max-h-[60vh] space-y-3">
                        {(Array.isArray(parkedTickets) ? parkedTickets : []).map((pt, idx) => (
                           <div key={pt.id || `parked-${idx}`} onClick={() => handleRestoreTicket(pt)} className="p-4 bg-white border border-gray-100 rounded-2xl hover:border-orange-400 hover:bg-orange-50 cursor-pointer group transition-all">
                              <div className="flex justify-between items-start mb-2">
                                 <div className="min-w-0 pr-3">
                                    <span className="block font-bold text-gray-800 truncate">{pt.alias || pt.name}</span>
                                    {pt.alias && (
                                       <span className="block text-[11px] font-semibold text-gray-400 truncate mt-1">
                                          {pt.name}
                                       </span>
                                    )}
                                 </div>
                                 <span className="text-[10px] font-bold text-gray-400 uppercase">{new Date(pt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                              <div className="flex justify-between items-center">
                                 <div className="min-w-0 pr-3">
                                    <span className="text-xs text-gray-500 block">{pt.items.length} productos</span>
                                    <span className="text-sm font-black text-gray-900 block mt-1">
                                       {formatCurrency(Number(pt.total || 0), baseCurrency.symbol)}
                                    </span>
                                 </div>
                                 <ArrowRight size={16} className="text-orange-300 group-hover:text-orange-500 transition-colors shrink-0" />
                              </div>
                           </div>
                        ))}
                        {(Array.isArray(parkedTickets) ? parkedTickets : []).length === 0 && <div className="py-10 text-center text-gray-400 italic">No hay tickets guardados</div>}
                     </div>
                  </div>
               </div>
            )
         }
         {productForModifiers && (
            <ModifierModal
               product={productForModifiers}
               currencySymbol={baseCurrency.symbol}
               themeColor="blue"
               onClose={() => setProductForModifiers(null)}
               onConfirm={(selectedModifierNames, finalPrice, note, restaurantConfig) => {
                  addToCart(productForModifiers, isReturnMode ? -1 : 1, finalPrice, selectedModifierNames, undefined, undefined, undefined, note, restaurantConfig as CartItem['restaurantConfig']);
                  setProductForModifiers(null);
               }}
            />
         )}

         <PromoBottomSheet
            isOpen={showPromoSheet}
            onClose={() => setShowPromoSheet(false)}
            product={selectedPromoProduct}
            onAddToCart={(p) => handleProductClick(p)}
            config={config}
         />

         <BarcodeScannerModal
            isOpen={isScannerOpen}
            onClose={() => setIsScannerOpen(false)}
            onScan={async (code) => {
               // 0. Try Smart QR (JSON)
               const trimmed = code.trim();
               try {
                  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                     const data = JSON.parse(trimmed);
                     if (data.type === 'RESERVATION_NOTE' && (data.id || data.code)) {
                        const found = (reservations || []).find(r => r.id === data.id || r.code === data.code);
                        if (found) {
                           handleRecoverReservation(found);
                           setIsScannerOpen(false);
                           return { success: true, message: 'Reserva Recuperada' };
                        }
                     }
                     if (data.type === 'INVOICE_RETURN' && data.id) {
                        setReturnInvoiceId(data.id);
                        setShowReturnModal(true);
                        setIsScannerOpen(false);
                        return { success: true, message: 'Factura Identificada' };
                     }
                  }
               } catch (e) {
                  // Not a JSON or invalid
               }

               // 0.1 Try Transaction Search (Direct bypass for TCK... barcodes)
               const txnFound = (transactions || []).find(t => t.displayId === trimmed || t.id === trimmed);
               if (txnFound) {
                  setReturnInvoiceId(txnFound.id);
                  setShowReturnModal(true);
                  setIsScannerOpen(false);
                  return { success: true, message: 'Factura Identificada' };
               }

               // 1. Try Scale Parser
               if (config.scaleLabelConfig?.isEnabled) {
                  const scaleItem = parseScaleBarcode(code, config.scaleLabelConfig);
                  if (scaleItem) {
                     const product = (products || []).find(p => p.barcode === scaleItem.plu || p.id === scaleItem.plu);
                     if (product) {
                        if (!canAddItemToCart(product)) return { success: false, message: 'No disponible en almacén' };

                        if (scaleItem.type === 'WEIGHT') {
                           addToCart(product, scaleItem.value);
                           return { success: true, message: `${product.name} (${scaleItem.value.toFixed(3)}kg)` };
                        } else {
                           const unitPrice = getProductPrice(product);
                           const weight = unitPrice > 0 ? scaleItem.value / unitPrice : 1;
                           addToCart(product, weight);
                           return { success: true, message: `${product.name} ($${scaleItem.value})` };
                        }
                     }
                  }
               }

               // 2. Normal Search
               const product = (products || []).find(p => p.barcode === code);
               if (product) {
                  if (!canAddItemToCart(product)) return { success: false, message: 'No disponible en almacén' };

                  // Direct add for speed
                  addToCart(product);
                  return { success: true, message: `${product.name} Agregado` };
               }

               return { success: false, message: 'Producto no encontrado' };
            }}
         />
         {
            quickActionData && (
               <ProductQuickActions
                  product={quickActionData.product}
                  position={{ x: quickActionData.x, y: quickActionData.y }}
                  onClose={() => setQuickActionData(null)}
                  onUpdateProduct={(updatedProduct) => {
                     setSuccessToast(`Producto ${updatedProduct.name} actualizado`);
                  }}
                  onAdvancedEdit={(p) => {
                     setQuickActionData(null);
                     onOpenSettings('CATALOG', { productId: p.id });
                  }}
                  onViewHistory={(p) => {
                     setQuickActionData(null);
                     // Conditional Navigation logic:
                     // 1. If product is Serialized or Lotted -> Go to Specific Tracking View
                     // 2. If standard product -> Go to Kardex Tab in Catalog
                     if (p.operationalFlags?.usesSerial || p.operationalFlags?.usesLots) {
                        onOpenInventoryTracking(p.id);
                     } else {
                        onOpenSettings('CATALOG', { productId: p.id, tab: 'KARDEX' });
                     }
                  }}
                  warehouses={warehouses}
                  config={config}
                  currentUser={currentUser}
                  roles={roles}
               />
            )
         }

         {
            incomingUberToast && (
               <div className="fixed top-6 right-6 z-[210] animate-in slide-in-from-top-4">
                  <button
                     onClick={openRecoverReservationModal}
                     className="max-w-sm rounded-[1.6rem] border border-black bg-white px-5 py-4 text-left shadow-2xl transition-all hover:-translate-y-0.5 hover:shadow-black/20"
                  >
                     <div className="flex items-start gap-3">
                        <div className="rounded-2xl bg-black p-2 text-white">
                           <ShoppingBag size={18} />
                        </div>
                        <div className="min-w-0 flex-1">
                           <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Uber Eats</p>
                           <p className="mt-1 text-sm font-black text-slate-900">
                              {incomingUberToast.count === 1 ? 'Nuevo pedido listo para POS' : `${incomingUberToast.count} pedidos nuevos listos para POS`}
                           </p>
                           <p className="mt-1 text-xs font-semibold text-slate-500">
                              {incomingUberToast.displayIds.join(' • ')}
                           </p>
                           <p className="mt-2 text-[11px] font-black uppercase tracking-[0.18em] text-blue-600">
                              Tocar para abrir pedidos
                           </p>
                        </div>
                     </div>
                  </button>
               </div>
            )
         }

         {
            successToast && (
               <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] animate-in slide-in-from-bottom-5">
                  <div className="bg-emerald-600 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 font-bold border border-emerald-500">
                     <Check size={20} />
                     <span>{successToast}</span>
                  </div>
               </div>
            )
         }

         {
            pendingTrackingProduct && (
               <TrackingSelectionModal
                  product={pendingTrackingProduct.product}
                  warehouseId={defaultSalesWarehouseId || 'wh_central'}
                  quantity={pendingTrackingProduct.quantity}
                  onClose={() => setPendingTrackingProduct(null)}
                  onSelect={(tracking) => {
                     addToCart(
                        pendingTrackingProduct.product,
                        pendingTrackingProduct.quantity,
                        pendingTrackingProduct.price,
                        pendingTrackingProduct.modifiers,
                        tracking
                     );
                     setPendingTrackingProduct(null);
                  }}
               />
            )
         }
      </div>
   );
};

export default POSInterface;
