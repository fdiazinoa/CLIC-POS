import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
   Search, ShoppingCart, Trash2, MoreVertical,
   CreditCard, User, Tag, Grid, Save,
   Settings, Users, History, Wallet,
   UserPlus, X, Percent, ArrowLeft, ChevronRight,
   Scale as ScaleIcon, PauseCircle, LogOut,
   ArrowRightLeft, Globe, DollarSign,
   ChevronDown, Check, AlertCircle, Layers,
   ShoppingBag, ScanBarcode, ArrowRight, Clock, Camera, AlertTriangle,
   MessageSquare, PlayCircle, Download, Lock, ArrowUpRight, Landmark,
   UserCheck, StickyNote, Inbox, Printer, QrCode, Box
} from 'lucide-react';
import { Html5Qrcode } from "html5-qrcode";
import {
   BusinessConfig, User as UserType, RoleDefinition,
   Customer, Product, CartItem, Transaction, ParkedTicket, Warehouse, NCFType
} from '../types';
import UnifiedPaymentModal from './PaymentModal';
import TicketOptionsModal from './TicketOptionsModal';
import CartItemOptionsModal from './CartItemOptionsModal';
import ProductVariantSelector from './ProductVariantSelector';
import ScaleModal from './ScaleModal';
import GlobalDiscountModal from './GlobalDiscountModal';
import LoyaltyScanModal from './LoyaltyScanModal';
import { db } from '../utils/db';
import { validateTerminalDocument } from '../utils/validation';
import { isSessionExpired } from '../utils/session';
import { FiscalRangeDGII } from '../types';
import { parseScaleBarcode } from '../utils/barcodeParser';
import { applyPromotions } from '../utils/promotionEngine';
import { calculatePointsEarned, getPrimaryLoyaltyCard } from '../utils/loyaltyEngine';
import { couponService } from '../utils/couponService';
import { useSupervisorAuth } from '../hooks/useSupervisorAuth';
import SupervisorModal from './SupervisorModal';

interface POSInterfaceProps {
   config: BusinessConfig;
   currentUser: UserType;
   roles: RoleDefinition[];
   users: UserType[];
   customers: Customer[];
   products: Product[];
   warehouses: Warehouse[];
   cart: CartItem[];
   transactions: Transaction[];
   onUpdateCart: React.Dispatch<React.SetStateAction<CartItem[]>>;
   selectedCustomer: Customer | null;
   onSelectCustomer: (customer: Customer | null) => void;
   parkedTickets: ParkedTicket[];
   onUpdateParkedTickets: (tickets: ParkedTicket[]) => void;
   onLogout: () => void;
   onOpenSettings: () => void;
   onOpenCustomers: () => void;
   onOpenHistory: () => void;
   onOpenFinance: () => void;
   onTransactionComplete: (txn: Transaction) => void;
   onAddCustomer: (customer: Customer) => void;
   onUpdateConfig: (newConfig: BusinessConfig) => void;
}

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
   onTransactionComplete,
   onUpdateConfig
}) => {
   const cartEndRef = useRef<HTMLDivElement>(null);

   const activeTerminalConfig = config.terminals?.[0]?.config;
   const terminalId = config.terminals?.[0]?.id || 'T1';
   const defaultSalesWarehouseId = activeTerminalConfig?.inventoryScope?.defaultSalesWarehouseId;
   const uxConfig = activeTerminalConfig?.ux || { showProductImages: true, gridDensity: 'COMFORTABLE', theme: 'LIGHT', quickKeysLayout: 'A' };

   const isRetailMode = activeTerminalConfig?.ux?.viewMode === 'RETAIL';

   // --- UX EFFECTS ---
   useEffect(() => {
      if (uxConfig.theme === 'DARK') {
         document.documentElement.classList.add('dark');
      } else {
         document.documentElement.classList.remove('dark');
      }
   }, [uxConfig.theme]);

   const gridClass = useMemo(() => {
      if (uxConfig.gridDensity === 'COMPACT') {
         return "grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-4 pb-32";
      }
      return "grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6 pb-32";
   }, [uxConfig.gridDensity]);

   const categoryContainerClass = useMemo(() => {
      if (uxConfig.quickKeysLayout === 'B') {
         return "bg-white border-b border-gray-200 px-8 py-3 flex flex-wrap gap-2 shrink-0 max-h-32 overflow-y-auto custom-scrollbar";
      }
      return "bg-white border-b border-gray-200 px-8 py-3 flex gap-2 overflow-x-auto no-scrollbar shrink-0";
   }, [uxConfig.quickKeysLayout]);

   const allowedTariffs = useMemo(() => {
      const allowedIds = activeTerminalConfig?.pricing?.allowedTariffIds || [];
      return config.tariffs.filter(t => allowedIds.includes(t.id));
   }, [config.tariffs, activeTerminalConfig]);

   const [activeTariffId, setActiveTariffId] = useState<string>(() => {
      return activeTerminalConfig?.pricing?.defaultTariffId || allowedTariffs[0]?.id || config.tariffs[0]?.id || '';
   });

   const [showTariffSelector, setShowTariffSelector] = useState(false);
   const [errorToast, setErrorToast] = useState<string | null>(null);

   const activeTariff = useMemo(() => config.tariffs.find(t => t.id === activeTariffId), [config.tariffs, activeTariffId]);

   const [searchTerm, setSearchTerm] = useState('');
   const [categoryFilter, setCategoryFilter] = useState('ALL');
   const [mobileView, setMobileView] = useState<'PRODUCTS' | 'TICKET'>('PRODUCTS');

   const [showPaymentModal, setShowPaymentModal] = useState(false);
   const [showTicketOptions, setShowTicketOptions] = useState(false);
   const [showParkedList, setShowParkedList] = useState(false);
   const [showGlobalDiscount, setShowGlobalDiscount] = useState(false);
   const [showCouponModal, setShowCouponModal] = useState(false);
   const [couponCode, setCouponCode] = useState('');
   const [globalDiscount, setGlobalDiscount] = useState<{ type: 'PERCENT' | 'FIXED', value: number }>({ type: 'PERCENT', value: 0 });
   const [editingItem, setEditingItem] = useState<CartItem | null>(null);
   const [selectedProductForVariants, setSelectedProductForVariants] = useState<Product | null>(null);
   const [productForScale, setProductForScale] = useState<Product | null>(null);
   const [showLoyaltyModal, setShowLoyaltyModal] = useState(false);

   const [isScannerOpen, setIsScannerOpen] = useState(false);
   const scannerRef = useRef<Html5Qrcode | null>(null);

   const [fiscalStatus, setFiscalStatus] = useState<{ type: NCFType, hasNCF: boolean, localBuffer: any, isUsingPool: boolean }>({
      type: 'B02', hasNCF: false, localBuffer: null, isUsingPool: false
   });
   const [status, setStatus] = useState<{ isConnected: boolean, currentNCF: string, remaining: number, expiryDate: string, batteryLevel: number } | null>(null);

   // --- SUPERVISOR AUTH ---
   const { requestApproval, supervisorModalProps } = useSupervisorAuth({
      config,
      currentUser,
      roles,
      onUpdateConfig
   });

   const handleRedeemCoupon = () => {
      if (!couponCode) return;

      const cartSubtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const result = couponService.redeemCoupon(couponCode, `TICKET-${Date.now()}`, terminalId, config, cartSubtotal);

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
            alert(`¡Cupón Canjeado!\n${result.benefit.description}`);
            setShowCouponModal(false);
            setCouponCode('');
         }
      } else {
         alert(`Error: ${result.error}`);
      }
   };

   const handleLoyaltyScan = (code: string) => {
      // Find customer by loyalty card or gift card
      const customer = customers.find(c =>
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
   };

   // --- BARCODE SCANNER LOGIC ---
   const [barcodeBuffer, setBarcodeBuffer] = useState('');
   const lastKeyTime = useRef<number>(0);

   const processBarcode = (code: string) => {
      // 1. Try Scale Parser
      if (config.scaleLabelConfig?.isEnabled) {
         const scaleItem = parseScaleBarcode(code, config.scaleLabelConfig);
         if (scaleItem) {
            // Find product by PLU (assuming PLU matches barcode or part of it)
            // We search for a product whose barcode ENDS with the PLU or equals it.
            // Or strictly equals. Usually PLU 2001 matches product with barcode 2001.
            const product = products.find(p => p.barcode === scaleItem.plu || p.id === scaleItem.plu);

            if (product) {
               if (scaleItem.type === 'WEIGHT') {
                  addToCart(product, scaleItem.value);
                  setErrorToast(`⚖️ Peso: ${scaleItem.value.toFixed(3)}kg`);
               } else {
                  // Price Type
                  const unitPrice = getProductPrice(product);
                  if (unitPrice > 0) {
                     const weight = scaleItem.value / unitPrice;
                     addToCart(product, weight);
                     setErrorToast(`💲 Precio: $${scaleItem.value} (${weight.toFixed(3)}kg)`);
                  } else {
                     // Fallback if no unit price (shouldn't happen for weighted items)
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

      // 2. Normal Barcode Search
      const product = products.find(p => p.barcode === code);
      if (product) {
         handleProductClick(product);
         setErrorToast(`Producto agregado: ${product.name}`);
         setTimeout(() => setErrorToast(null), 1500);
      } else {
         setErrorToast(`Código no encontrado: ${code}`);
         setTimeout(() => setErrorToast(null), 2000);
      }
   };

   useEffect(() => {
      const handleGlobalKeyDown = (e: KeyboardEvent) => {
         const target = e.target as HTMLElement;
         const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

         // If we are in a specific input (like search), we might want to let it handle it,
         // UNLESS it's a fast scan which implies a barcode.

         const currentTime = Date.now();
         const gap = currentTime - lastKeyTime.current;
         lastKeyTime.current = currentTime;

         if (e.key === 'Enter') {
            // If buffer has content and was typed relatively fast (or just has content), process it.
            // We use a threshold for "scanner speed" or just check buffer length.
            if (barcodeBuffer.length >= 3) {
               processBarcode(barcodeBuffer);
               setBarcodeBuffer('');
               if (isInput) e.preventDefault(); // Prevent form submission
            } else {
               setBarcodeBuffer('');
            }
            return;
         }

         if (e.key.length === 1) { // Printable char
            if (gap > 100) {
               // Slow typing - reset buffer (assume manual input start)
               setBarcodeBuffer(e.key);
            } else {
               // Fast typing - append to buffer
               setBarcodeBuffer(prev => prev + e.key);
            }
         }
      };

      window.addEventListener('keydown', handleGlobalKeyDown);
      return () => window.removeEventListener('keydown', handleGlobalKeyDown);
   }, [barcodeBuffer, config, products, cart]); // Dependencies


   useEffect(() => {
      const checkFiscalStatus = async () => {
         const type: NCFType = selectedCustomer?.defaultNcfType || (selectedCustomer?.requiresFiscalInvoice ? 'B01' : 'B02');
         const buffers = await db.get('localFiscalBuffer') || [];
         const localBuffer = buffers.find((b: any) => b.type === type && b.isActive) as FiscalRangeDGII | undefined;

         if (localBuffer) {
            const current = localBuffer.currentGlobal || localBuffer.startNumber;
            const total = localBuffer.endNumber - localBuffer.startNumber + 1;
            const used = current - localBuffer.startNumber;
            const remaining = localBuffer.endNumber - current;

            setStatus({
               isConnected: true,
               currentNCF: `${localBuffer.prefix}${current.toString().padStart(8, '0')}`,
               remaining,
               expiryDate: localBuffer.expiryDate,
               batteryLevel: 100
            });
         }
         const hasLocal = localBuffer && localBuffer.currentGlobal <= localBuffer.endNumber;
         const canRequest = await db.canRequestMoreNCF(type);
         const hasNCF = hasLocal || canRequest;
         setFiscalStatus({ type, hasNCF, localBuffer, isUsingPool: !hasLocal && canRequest });
      };
      checkFiscalStatus();
   }, [selectedCustomer, cart]);

   const canAddItemToCart = (product: Product): boolean => {
      if (!defaultSalesWarehouseId) return true;
      const isEnabled = product.activeInWarehouses?.includes(defaultSalesWarehouseId);
      if (!isEnabled) {
         const whName = warehouses.find(w => w.id === defaultSalesWarehouseId)?.name || 'Almacén Actual';
         setErrorToast(`Artículo no habilitado para la venta en: ${whName}`);
         setTimeout(() => setErrorToast(null), 3500);
         return false;
      }
      return true;
   };

   const filteredProducts = useMemo(() => {
      return products.filter(p => {
         const isAvailableInWarehouse = defaultSalesWarehouseId ? p.activeInWarehouses?.includes(defaultSalesWarehouseId) ?? true : true;
         const matchSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.barcode?.includes(searchTerm);
         const matchCat = categoryFilter === 'ALL' || p.category === categoryFilter;

         // Category Scope Check
         const allowedCats = activeTerminalConfig?.catalog?.allowedCategories || [];
         const matchAllowedCat = allowedCats.length === 0 || allowedCats.includes(p.category);

         return matchSearch && matchCat && isAvailableInWarehouse && matchAllowedCat;
      });
   }, [products, searchTerm, categoryFilter, defaultSalesWarehouseId, activeTerminalConfig]);

   const categories = useMemo(() => {
      const allowedCats = activeTerminalConfig?.catalog?.allowedCategories || [];
      const availableProducts = allowedCats.length > 0
         ? products.filter(p => allowedCats.includes(p.category))
         : products;

      return ['ALL', ...Array.from(new Set(availableProducts.map(p => p.category))).sort()];
   }, [products, activeTerminalConfig]);

   const getProductPrice = (p: Product) => p.tariffs.find(t => t.tariffId === activeTariffId)?.price || p.price;



   // --- PROMOTION ENGINE INTEGRATION ---
   const processedCart = useMemo(() => {
      return applyPromotions(cart, config, selectedCustomer || undefined);
   }, [cart, config, selectedCustomer]);

   const isTaxIncluded = activeTariff?.taxIncluded || false;
   const grossLineTotal = processedCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

   const discountAmount = globalDiscount.type === 'PERCENT' ? grossLineTotal * (globalDiscount.value / 100) : Math.min(globalDiscount.value, grossLineTotal);

   const taxBreakdown = useMemo(() => {
      const breakdown: Record<string, { name: string, amount: number }> = {};

      processedCart.forEach(item => {
         const lineGross = item.price * item.quantity;
         const itemRatio = lineGross / (grossLineTotal || 1);
         const lineDiscount = discountAmount * itemRatio;
         const lineBaseAfterDiscount = lineGross - lineDiscount;

         let itemTaxRate = 0;
         const itemTaxes = (item.appliedTaxIds || []).map(id => config.taxes.find(t => t.id === id)).filter(Boolean);
         itemTaxes.forEach(t => itemTaxRate += t!.rate);

         let lineNet = 0;
         if (isTaxIncluded) {
            lineNet = lineBaseAfterDiscount / (1 + itemTaxRate);
         } else {
            lineNet = lineBaseAfterDiscount;
         }

         itemTaxes.forEach(t => {
            if (!breakdown[t!.id]) breakdown[t!.id] = { name: t!.name, amount: 0 };
            breakdown[t!.id].amount += lineNet * t!.rate;
         });
      });
      return Object.values(breakdown);
   }, [processedCart, grossLineTotal, config.taxes, discountAmount, isTaxIncluded]);

   const cartTax = taxBreakdown.reduce((sum, t) => sum + t.amount, 0);

   let cartTotal = 0;
   let netSubtotal = 0;

   if (isTaxIncluded) {
      cartTotal = grossLineTotal - discountAmount;
      netSubtotal = cartTotal - cartTax;
   } else {
      netSubtotal = grossLineTotal - discountAmount;
      cartTotal = netSubtotal + cartTax;
   }

   // Alias for compatibility if needed, though netSubtotal is what we usually display as "Subtotal"
   const cartSubtotal = grossLineTotal; // This represents the sum of list prices
   const baseCurrency = config.currencies.find(c => c.isBase) || config.currencies[0];

   const pointsEarned = useMemo(() => calculatePointsEarned(processedCart, config), [processedCart, config]);
   const primaryLoyaltyCard = selectedCustomer ? getPrimaryLoyaltyCard(selectedCustomer) : undefined;
   const currentPoints = primaryLoyaltyCard?.pointsBalance || 0;

   useEffect(() => {
      if (cart.length === 0) setMobileView('PRODUCTS');
      else cartEndRef.current?.scrollIntoView({ behavior: 'smooth' });
   }, [cart.length]);

   const handleProductClick = (product: Product) => {
      if (!canAddItemToCart(product)) return;
      const isWeighted = product.type === 'SERVICE' || product.name.toLowerCase().includes('(peso)');
      const hasVariants = product.attributes && product.attributes.length > 0;
      if (isWeighted) setProductForScale(product);
      else if (hasVariants) setSelectedProductForVariants(product);
      else addToCart(product);
   };

   const addToCart = (product: Product, quantity: number = 1, priceOverride?: number, modifiers?: string[]) => {
      if (!canAddItemToCart(product)) return;
      const finalPrice = priceOverride || getProductPrice(product);
      onUpdateCart(prev => {
         const modifiersString = modifiers ? modifiers.sort().join('|') : '';
         const existing = prev.find(i => {
            const iMods = i.modifiers ? i.modifiers.sort().join('|') : '';
            return i.id === product.id && iMods === modifiersString && i.price === finalPrice;
         });
         if (existing) return prev.map(i => i.cartId === existing.cartId ? { ...i, quantity: i.quantity + quantity } : i);
         return [...prev, { ...product, cartId: Math.random().toString(36).substr(2, 9), quantity, price: finalPrice, modifiers, originalPrice: getProductPrice(product) }];
      });
   };

   const updateCartItem = async (updatedItem: CartItem | null, cartIdToDelete?: string) => {
      if (cartIdToDelete || updatedItem === null) {
         // Void Line Check
         const authorized = await requestApproval({
            permission: 'POS_VOID_ITEM',
            actionDescription: 'Eliminar artículo del carrito',
            context: { itemId: cartIdToDelete || editingItem?.cartId }
         });
         if (!authorized) return;

         onUpdateCart(prev => prev.filter(i => i.cartId !== (cartIdToDelete || editingItem?.cartId)));
      } else {
         // Update Check (Price Override / Discount)
         const originalItem = cart.find(i => i.cartId === updatedItem.cartId);
         if (originalItem && updatedItem.price < originalItem.price) {
            const authorized = await requestApproval({
               permission: 'POS_PRICE_OVERRIDE',
               actionDescription: 'Modificar Precio de Ítem',
               context: {
                  itemId: updatedItem.cartId,
                  originalValue: originalItem.price,
                  newValue: updatedItem.price
               }
            });
            if (!authorized) return;
         }

         onUpdateCart(prev => prev.map(i => i.cartId === updatedItem.cartId ? updatedItem : i));
      }
      setEditingItem(null);
   };

   const handlePaymentConfirm = async (payments: any[]): Promise<Transaction | null> => {
      const finalNcf = await db.getNextNCF(fiscalStatus.type, terminalId, activeTerminalConfig?.fiscal?.typeConfigs?.[fiscalStatus.type]?.batchSize || 100);

      if (!finalNcf) {
         alert(`CRÍTICO: No hay NCF de ${fiscalStatus.type === 'B01' ? 'Crédito Fiscal' : 'Consumo'} disponible. Pool DGII agotado.`);
         return null;
      }

      // Get Ticket Sequence
      let ticketId = `T-${Date.now()}`;
      const assignedSequenceId = activeTerminalConfig?.documentAssignments?.['TICKET'];
      if (assignedSequenceId) {
         const seqId = await db.getNextSequenceNumber(assignedSequenceId);
         if (seqId) ticketId = seqId;
      }

      const txn: Transaction = {
         id: ticketId,
         date: new Date().toISOString(),
         items: processedCart,
         total: cartTotal,
         payments: payments,
         userId: currentUser.id,
         userName: currentUser.name,
         terminalId: terminalId,
         status: 'COMPLETED',
         customerId: selectedCustomer?.id,
         customerName: selectedCustomer?.name,
         ncf: finalNcf,
         ncfType: fiscalStatus.type,
         discountAmount: discountAmount,
         customerSnapshot: selectedCustomer ? {
            name: selectedCustomer.name,
            taxId: selectedCustomer.taxId,
            address: selectedCustomer.address,
            phone: selectedCustomer.phone,
            email: selectedCustomer.email
         } : undefined,
         isTaxIncluded: activeTariff?.taxIncluded || false
      };
      onTransactionComplete(txn);
      // setShowPaymentModal(false); // Removed: Modal handles closing
      onUpdateCart([]); onSelectCustomer(null);
      setMobileView('PRODUCTS'); setGlobalDiscount({ value: 0, type: 'PERCENT' });
      return txn;
   };

   const handleParkCurrentTicket = () => {
      if (cart.length === 0) return;
      const newParked: ParkedTicket = {
         id: `P-${Date.now()}`,
         name: selectedCustomer ? selectedCustomer.name : `Ticket #${parkedTickets.length + 1}`,
         items: [...cart],
         customerId: selectedCustomer?.id,
         customerName: selectedCustomer?.name,
         timestamp: new Date().toISOString()
      };
      onUpdateParkedTickets([...parkedTickets, newParked]);
      onUpdateCart([]); onSelectCustomer(null);
      setErrorToast("Ticket Guardado");
      setTimeout(() => setErrorToast(null), 2000);
   };

   const handleRestoreTicket = (parked: ParkedTicket) => {
      onUpdateCart([...parked.items]);
      if (parked.customerId) {
         const found = customers.find(c => c.id === parked.customerId);
         if (found) onSelectCustomer(found);
      }
      onUpdateParkedTickets(parkedTickets.filter(p => p.id !== parked.id));
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

   return (
      <div className="flex h-screen bg-gray-100 overflow-hidden font-sans text-gray-900 relative">
         {errorToast && (
            <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-5 fade-in duration-300">
               <div className="bg-red-600 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 font-bold border-2 border-red-400">
                  <AlertTriangle size={24} className="animate-pulse" />
                  <span>{errorToast}</span>
               </div>
            </div>
         )}

         {/* --- BOTÓN FLOTANTE MÓVIL (IR AL TICKET) --- */}
         {mobileView === 'PRODUCTS' && cart.length > 0 && (
            <button
               onClick={() => setMobileView('TICKET')}
               className="md:hidden fixed bottom-6 right-6 z-50 bg-blue-600 text-white p-5 rounded-full shadow-[0_15px_40px_rgba(37,99,235,0.4)] flex items-center justify-center animate-in zoom-in-50"
            >
               <div className="relative">
                  <ShoppingCart size={28} />
                  <span className="absolute -top-3 -right-3 bg-red-500 text-white text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                     {cart.reduce((acc, i) => acc + i.quantity, 0)}
                  </span>
               </div>
            </button>
         )}

         {/* LEFT AREA: PRODUCTS */}
         <div className={`flex-1 flex flex-col min-w-0 bg-gray-50 transition-all duration-300 ${mobileView === 'TICKET' ? 'hidden md:flex' : 'flex'} ${isRetailMode ? '!hidden' : ''}`}>
            <header className="bg-white px-8 py-4 border-b border-gray-200 flex items-center gap-6 shadow-sm z-10 shrink-0">
               <div className="flex items-center gap-3 pr-4 border-r border-gray-100">
                  <div className="w-10 h-10 rounded-full bg-gray-50 overflow-hidden border border-gray-200 shadow-inner shrink-0">
                     {currentUser.photo ? <img src={currentUser.photo} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-blue-50 text-blue-600 font-bold">{currentUser.name.charAt(0)}</div>}
                  </div>
                  <div className="hidden lg:block leading-tight">
                     <p className="text-sm font-black text-gray-800 truncate max-w-[120px]">{currentUser.name}</p>
                     <p className="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Cajero</p>
                  </div>
               </div>

               <div className="flex-1 flex items-center gap-4">
                  <div className="relative flex-1 group">
                     <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                     <input type="text" placeholder="Buscar producto..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-12 pr-12 md:pr-4 py-3 bg-gray-100 rounded-2xl border-none outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 text-sm font-medium" />
                     <button onClick={() => setIsScannerOpen(true)} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-500 bg-white shadow-sm rounded-xl hover:text-blue-600 hover:bg-blue-50 border border-gray-100"><ScanBarcode size={18} /></button>
                  </div>
                  <div className="relative shrink-0">
                     <button onClick={() => setShowTariffSelector(!showTariffSelector)} className={`flex items-center gap-3 px-5 py-3 rounded-2xl border-2 transition-all ${showTariffSelector ? 'border-purple-500 bg-purple-50' : 'bg-gray-100 border-transparent'}`}>
                        <Tag size={18} className="text-purple-600" />
                        <div className="text-left hidden sm:block">
                           <p className="text-[9px] font-black text-purple-400 uppercase tracking-widest leading-none mb-1">Tarifa Activa</p>
                           <p className="text-xs font-bold text-purple-900 leading-none truncate max-w-[120px]">{activeTariff?.name || 'General'}</p>
                        </div>
                        <ChevronDown size={16} className={`text-purple-400 ${showTariffSelector ? 'rotate-180' : ''}`} />
                     </button>
                  </div>
               </div>
            </header>

            {/* --- CATEGORY SELECTOR BAR --- */}
            <div className={categoryContainerClass}>
               {categories.map((cat) => (
                  <button
                     key={cat}
                     onClick={() => setCategoryFilter(cat)}
                     className={`px-6 py-2.5 rounded-full text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap shadow-sm border ${categoryFilter === cat
                        ? 'bg-blue-600 border-blue-500 text-white shadow-blue-200 scale-105'
                        : 'bg-white border-gray-200 text-gray-400 hover:border-blue-300 hover:text-blue-600'
                        }`}
                  >
                     {cat === 'ALL' ? 'Todas' : cat}
                  </button>
               ))}
            </div>

            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar dark:bg-slate-900">
               <div className={gridClass}>
                  {filteredProducts.map(product => {
                     const isWeighted = product.type === 'SERVICE' || product.name.toLowerCase().includes('(peso)');
                     const hasVariants = product.attributes && product.attributes.length > 0;

                     return (

                        <div key={product.id} onClick={() => handleProductClick(product)} className="bg-white dark:bg-slate-800 dark:border-slate-700 rounded-[2rem] p-4 shadow-sm border border-gray-100 cursor-pointer hover:shadow-xl hover:border-purple-300 hover:-translate-y-1 transition-all active:scale-95 group flex flex-col h-full relative overflow-hidden">
                           {uxConfig.showProductImages && (
                              <div className="aspect-square bg-gray-50 dark:bg-slate-800 rounded-[1.5rem] mb-4 overflow-hidden relative">
                                 {product.image ? <img src={product.image} className="w-full h-full object-cover group-hover:scale-110 transition-transform" /> : <div className="w-full h-full flex items-center justify-center text-gray-200 dark:text-slate-700"><Grid size={48} strokeWidth={1} /></div>}

                                 {/* BADGES DE TIPO DE ARTÍCULO */}
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
                              </div>
                           )}
                           <div className="flex flex-col flex-1">
                              <span className="text-[9px] font-bold text-purple-500 uppercase mb-1 opacity-60">{product.category}</span>
                              <h3 className="font-bold text-gray-800 dark:text-white text-sm leading-tight mb-2 line-clamp-2 flex-1">{product.name}</h3>
                              <div className="mt-auto pt-2 border-t border-gray-50 dark:border-slate-700"><span className="font-black text-lg text-gray-900 dark:text-white">{baseCurrency.symbol}{getProductPrice(product).toFixed(2)}</span></div>
                           </div>
                        </div>
                     );
                  })}
               </div>
            </div>
         </div>

         {/* RIGHT SIDEBAR: CURRENT TICKET */}
         <div className={`w-full ${isRetailMode ? '' : 'md:w-96'} bg-white border-l border-gray-200 shadow-2xl flex flex-col z-20 transition-all duration-300 ${mobileView === 'PRODUCTS' && !isRetailMode ? 'hidden md:flex' : 'flex'}`}>

            <div className="p-5 border-b border-gray-100 bg-gray-50/50 flex flex-col gap-3 shrink-0">
               {/* Header con Navegación para volver a productos */}
               <div className="flex justify-between items-center gap-4">
                  <div className="flex items-center gap-2 shrink-0">
                     <button onClick={() => setMobileView('PRODUCTS')} className={`md:hidden p-2 -ml-2 text-gray-400 hover:text-blue-600 transition-colors ${isRetailMode ? 'hidden' : ''}`}>
                        <ArrowLeft size={20} />
                     </button>
                     <h2 className="font-black text-gray-800 uppercase text-xs tracking-widest whitespace-nowrap">Ticket Actual</h2>
                  </div>

                  {/* RETAIL MODE SEARCH BAR */}
                  {isRetailMode && (
                     <div className="flex-1 max-w-xl relative group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                        <input
                           type="text"
                           placeholder="Escanear o buscar..."
                           value={searchTerm}
                           onChange={(e) => setSearchTerm(e.target.value)}
                           onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                 // 1. Try exact match (Scanner behavior)
                                 const exactMatch = products.find(p => p.barcode === searchTerm || p.id === searchTerm);
                                 if (exactMatch) {
                                    handleProductClick(exactMatch);
                                    setSearchTerm('');
                                    return;
                                 }
                                 // 2. If single result in filtered list, select it
                                 if (filteredProducts.length === 1) {
                                    handleProductClick(filteredProducts[0]);
                                    setSearchTerm('');
                                    return;
                                 }
                              }
                           }}
                           autoFocus
                           className="w-full pl-10 pr-10 py-2.5 bg-gray-100 rounded-xl border-none outline-none focus:bg-white focus:ring-2 focus:ring-purple-500 text-sm font-bold transition-all"
                        />
                        <button onClick={() => setIsScannerOpen(true)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-all"><ScanBarcode size={16} /></button>

                        {/* SEARCH RESULTS DROPDOWN (RETAIL MODE ONLY) */}
                        {searchTerm && filteredProducts.length > 0 && (
                           <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-100 max-h-[60vh] overflow-y-auto z-50">
                              {filteredProducts.map(product => (
                                 <div
                                    key={product.id}
                                    onClick={() => {
                                       handleProductClick(product);
                                       setSearchTerm('');
                                    }}
                                    className="p-3 hover:bg-purple-50 cursor-pointer border-b border-gray-50 last:border-0 flex justify-between items-center group"
                                 >
                                    <div>
                                       <p className="font-bold text-gray-800 text-sm group-hover:text-purple-700">{product.name}</p>
                                       <p className="text-[10px] text-gray-400 font-mono">{product.barcode || 'Sin Código'}</p>
                                    </div>
                                    <span className="font-black text-gray-900">{baseCurrency.symbol}{getProductPrice(product).toFixed(2)}</span>
                                 </div>
                              ))}
                           </div>
                        )}
                     </div>
                  )}

                  {!isRetailMode && (
                     <div className="flex gap-1 shrink-0">
                        <button onClick={handleOpenDrawer} title="Abrir Cajón" className="p-2 hover:bg-emerald-50 rounded-lg text-gray-400 hover:text-emerald-600 transition-colors"><Box size={18} /></button>
                        <button onClick={handleParkCurrentTicket} title="Guardar Ticket" className="p-2 hover:bg-blue-50 rounded-lg text-gray-400 hover:text-blue-600 transition-colors"><Save size={18} /></button>
                        <button onClick={() => setShowParkedList(!showParkedList)} title="Recuperar Ticket" className="p-2 hover:bg-orange-50 rounded-lg text-gray-400 hover:text-orange-600 transition-colors relative">
                           <Inbox size={18} />
                           {parkedTickets.length > 0 && <span className="absolute top-0 right-0 w-3 h-3 bg-orange-500 rounded-full border-2 border-white"></span>}
                        </button>
                        <button onClick={onOpenHistory} title="Historial" className="p-2 hover:bg-gray-200 rounded-lg text-gray-400 hover:text-blue-600 transition-colors"><History size={18} /></button>
                        <button onClick={onOpenSettings} title="Configuración" className="p-2 hover:bg-gray-200 rounded-lg text-gray-400 hover:text-blue-600 transition-colors"><Settings size={18} /></button>
                     </div>
                  )}
               </div>

               {selectedCustomer ? (
                  <div className="flex items-center justify-between bg-blue-50 p-3 rounded-xl border border-blue-100 cursor-pointer" onClick={onOpenCustomers}>
                     <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center font-bold text-xs">{selectedCustomer.name.charAt(0)}</div>
                        <div>
                           <p className="text-xs font-bold text-blue-900 leading-none">{selectedCustomer.name}</p>
                           <div className="flex gap-2 mt-0.5">
                              <span className="text-[9px] font-black text-blue-500 uppercase tracking-tighter">
                                 {selectedCustomer.defaultNcfType || (selectedCustomer.requiresFiscalInvoice ? 'B01' : 'B02')}
                              </span>
                              {selectedCustomer.wallet && (
                                 <span className="text-[9px] font-black text-emerald-600 flex items-center gap-0.5">
                                    <Wallet size={10} /> {config.currencySymbol}{selectedCustomer.wallet.balance.toLocaleString()}
                                 </span>
                              )}
                              {selectedCustomer.loyaltyPoints !== undefined && (
                                 <span className="text-[9px] font-black text-purple-600 flex items-center gap-0.5">
                                    <Tag size={10} /> {selectedCustomer.loyaltyPoints} pts
                                 </span>
                              )}
                           </div>
                        </div>
                     </div>
                     <button onClick={(e) => { e.stopPropagation(); onSelectCustomer(null); }} className="p-1 text-blue-400"><X size={14} /></button>
                  </div>
               ) : (
                  <button onClick={onOpenCustomers} className="w-full flex items-center justify-between p-3 bg-white border-2 border-dashed border-gray-300 rounded-xl text-gray-400 hover:text-blue-500 group"><div className="flex items-center gap-2"><UserPlus size={18} /><span className="text-xs font-bold uppercase">Asignar Cliente</span></div><ChevronRight size={16} /></button>
               )}

               <div className={`mt-1 flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase ${fiscalStatus.hasNCF ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100 animate-pulse'}`}>
                  <Landmark size={12} />
                  <span>Status Fiscal: {fiscalStatus.type} {fiscalStatus.hasNCF ? (fiscalStatus.isUsingPool ? 'Reservado en Pool' : 'Lote Activo') : 'Agotado'}</span>
                  {fiscalStatus.localBuffer && !fiscalStatus.isUsingPool && (
                     <span className="ml-auto opacity-60">Quedan: {fiscalStatus.localBuffer.endNumber - fiscalStatus.localBuffer.currentNumber + 1}</span>
                  )}
               </div>
            </div>

            {/* --- CART ITEMS LIST (DETALLE DE LÍNEA) --- */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar bg-slate-50/30">
               {processedCart.map((item) => {
                  const hasDiscount = item.originalPrice && item.price < item.originalPrice;
                  const discountPct = hasDiscount ? Math.round((1 - item.price / item.originalPrice!) * 100) : 0;
                  const promoName = config.promotions?.find(p => p.id === (item as any).appliedPromotionId)?.name;

                  const lineNet = item.price * item.quantity;
                  let lineTax = 0;

                  if (isTaxIncluded) {
                     const totalRate = (item.appliedTaxIds || []).reduce((acc, taxId) => {
                        const taxDef = config.taxes.find(t => t.id === taxId);
                        return acc + (taxDef?.rate || 0);
                     }, 0);
                     const net = lineNet / (1 + totalRate);
                     lineTax = lineNet - net;
                  } else {
                     lineTax = (item.appliedTaxIds || []).reduce((acc, taxId) => {
                        const taxDef = config.taxes.find(t => t.id === taxId);
                        return acc + (lineNet * (taxDef?.rate || 0));
                     }, 0);
                  }

                  return (
                     <div key={item.cartId} onClick={() => setEditingItem(item)} className="flex flex-col gap-1 px-3 py-3 transition-all hover:bg-white rounded-xl cursor-pointer group border border-transparent hover:border-gray-200 hover:shadow-sm animate-in slide-in-from-right-2">
                        <div className="flex justify-between items-start">
                           <div className="flex-1 min-w-0 pr-2">
                              <span className={`font-bold text-gray-700 leading-tight line-clamp-2 ${isRetailMode ? 'text-lg' : 'text-sm'}`}>{item.name}</span>
                           </div>
                           <span className={`font-black text-gray-900 shrink-0 ${isRetailMode ? 'text-lg' : 'text-sm'}`}>{baseCurrency.symbol}{(lineNet).toFixed(2)}</span>
                        </div>

                        {/* 1. Cantidad x Precio + Descuento (En la misma línea) */}
                        <div className="flex items-center gap-2 mt-1">
                           <span className={`bg-gray-100 px-1.5 py-0.5 rounded text-gray-600 font-black uppercase tracking-tighter ${isRetailMode ? 'text-xs' : 'text-[9px]'}`}>
                              {item.quantity.toFixed(item.type === 'SERVICE' ? 3 : 0)}x {baseCurrency.symbol}{item.price.toFixed(2)}
                           </span>
                           {hasDiscount && (
                              <div className="flex flex-col items-end">
                                 <span className={`bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-black border border-red-100 ${isRetailMode ? 'text-xs' : 'text-[9px]'}`}>-{discountPct}% {promoName ? `(${promoName})` : ''}</span>
                                 <span className={`text-gray-400 line-through decoration-red-400 ${isRetailMode ? 'text-xs' : 'text-[9px]'}`}>{baseCurrency.symbol}{item.originalPrice?.toFixed(2)}</span>
                              </div>
                           )}
                        </div>

                        {/* 2. Impuesto de la línea */}
                        <div className={`text-slate-400 font-bold flex items-center gap-1 ${isRetailMode ? 'text-xs' : 'text-[10px]'}`}>
                           <span>Impuestos: {baseCurrency.symbol}{lineTax.toFixed(2)}</span>
                        </div>

                        {/* 3. Variantes / Modificadores */}
                        {item.modifiers && item.modifiers.length > 0 && (
                           <div className="flex flex-wrap gap-1 mt-1">
                              {item.modifiers.map((m, mi) => (
                                 <span key={mi} className={`bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-bold border border-blue-100 uppercase ${isRetailMode ? 'text-xs' : 'text-[9px]'}`}>{m}</span>
                              ))}
                           </div>
                        )}

                        {/* 4. Vendedor */}
                        {item.salespersonId && (
                           <div className="mt-1">
                              <span className="bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded text-[9px] font-bold flex items-center gap-1 border border-indigo-100 w-fit">
                                 <UserCheck size={10} /> Vendedor: {users.find(u => u.id === item.salespersonId)?.name.split(' ')[0]}
                              </span>
                           </div>
                        )}

                        {/* 5. Nota */}
                        {item.note && (
                           <div className="mt-1.5 flex items-start gap-1 text-[10px] text-orange-600 font-medium bg-orange-50/50 p-1.5 rounded-lg border border-orange-100/50">
                              <StickyNote size={10} className="mt-0.5 shrink-0" />
                              <span className="italic">{item.note}</span>
                           </div>
                        )}
                     </div>
                  )
               })}
               <div ref={cartEndRef} />
            </div>

            {/* Sidebar Footer */}
            <div className={`bg-white border-t border-gray-200 p-4 shadow-inner shrink-0 ${isRetailMode ? 'flex flex-row-reverse items-center justify-between gap-6' : 'space-y-3'}`}>

               {isRetailMode ? (
                  // --- RETAIL MODE FOOTER (HORIZONTAL) ---
                  <>
                     {/* RIGHT: PAY & TOTAL */}
                     <div className="flex items-center gap-6">
                        {/* TOTALS BREAKDOWN */}
                        <div className="hidden xl:flex items-center gap-6 mr-2">
                           <div className="text-right">
                              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Subtotal</p>
                              <p className="text-lg font-bold text-gray-700">{baseCurrency.symbol}{cartSubtotal.toFixed(2)}</p>
                           </div>
                           {discountAmount > 0 && (
                              <div className="text-right">
                                 <p className="text-[10px] text-red-400 font-bold uppercase tracking-wider">Descuento</p>
                                 <p className="text-lg font-bold text-red-500">-{baseCurrency.symbol}{discountAmount.toFixed(2)}</p>
                              </div>
                           )}
                           <div className="text-right">
                              <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Impuestos</p>
                              <p className="text-lg font-bold text-gray-700">{baseCurrency.symbol}{cartTax.toFixed(2)}</p>
                           </div>
                           <div className="w-px h-10 bg-gray-200"></div>
                        </div>

                        <div className="text-right hidden sm:block">
                           <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest">Total a Pagar</p>
                           <div className="text-4xl font-black text-slate-900 leading-none tracking-tighter">
                              {baseCurrency.symbol}{cartTotal.toFixed(2)}
                           </div>
                           <p className="text-[10px] font-bold text-gray-400 mt-1">
                              {cart.reduce((acc, i) => acc + i.quantity, 0)} Artículos
                              {pointsEarned > 0 && <span className="text-purple-500 ml-2">• Ganarás +{pointsEarned} pts</span>}
                           </p>
                        </div>
                        <button
                           onClick={() => {
                              if (cart.length > 0 && fiscalStatus.hasNCF) {
                                 // 1. Validate Document Series
                                 const validation = validateTerminalDocument(config, terminalId, 'TICKET');
                                 if (!validation.isValid) {
                                    alert(validation.error);
                                    return;
                                 }

                                 // 2. Validate Session Expiration (Force Z)
                                 if (transactions.length > 0 && activeTerminalConfig) {
                                    const sessionStartDate = transactions[0].date; // Assuming first txn is start
                                    if (isSessionExpired(sessionStartDate, activeTerminalConfig)) {
                                       alert("⚠️ CIERRE Z REQUERIDO\n\nLa jornada operativa ha cambiado. Debe realizar el Cierre Z antes de continuar facturando.");
                                       return;
                                    }
                                 }

                                 setShowPaymentModal(true);
                              } else if (!fiscalStatus.hasNCF) {
                                 alert("No hay secuencias fiscales disponibles.");
                              }
                           }}
                           disabled={cart.length === 0 || !fiscalStatus.hasNCF}
                           className={`h-16 px-8 rounded-2xl font-black text-xl shadow-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3 ${!fiscalStatus.hasNCF ? 'bg-red-100 text-red-500 cursor-not-allowed border-2 border-red-200' : 'bg-slate-900 text-white hover:bg-black'}`}
                        >
                           <span>{!fiscalStatus.hasNCF ? 'Sin Secuencia' : 'COBRAR'}</span>
                           <ArrowRight size={24} />
                        </button>
                     </div>

                     {/* LEFT: ACTIONS */}
                     <div className="flex gap-2 overflow-x-auto no-scrollbar">
                        {/* MOVED BUTTONS FROM HEADER */}
                        <button onClick={handleOpenDrawer} title="Abrir Cajón" className="h-14 px-4 flex flex-col items-center justify-center rounded-xl border-2 bg-emerald-50 border-emerald-100 text-emerald-600 hover:bg-emerald-100 transition-all min-w-[60px]">
                           <Box size={18} />
                           <span className="text-[9px] font-black uppercase mt-1">Cajón</span>
                        </button>
                        <button onClick={handleParkCurrentTicket} title="Guardar Ticket" className="h-14 px-4 flex flex-col items-center justify-center rounded-xl border-2 bg-blue-50 border-blue-100 text-blue-600 hover:bg-blue-100 transition-all min-w-[60px]">
                           <Save size={18} />
                           <span className="text-[9px] font-black uppercase mt-1">Guardar</span>
                        </button>
                        <button onClick={() => setShowParkedList(!showParkedList)} title="Recuperar Ticket" className="h-14 px-4 flex flex-col items-center justify-center rounded-xl border-2 bg-orange-50 border-orange-100 text-orange-600 hover:bg-orange-100 transition-all min-w-[60px] relative">
                           <Inbox size={18} />
                           <span className="text-[9px] font-black uppercase mt-1">Espera</span>
                           {parkedTickets.length > 0 && <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-orange-500 rounded-full border-2 border-white"></span>}
                        </button>
                        <button onClick={onOpenHistory} title="Historial" className="h-14 px-4 flex flex-col items-center justify-center rounded-xl border-2 bg-purple-50 border-purple-100 text-purple-600 hover:bg-purple-100 transition-all min-w-[60px]">
                           <History size={18} />
                           <span className="text-[9px] font-black uppercase mt-1">Hist.</span>
                        </button>
                        <button onClick={onOpenSettings} title="Configuración" className="h-14 px-4 flex flex-col items-center justify-center rounded-xl border-2 bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 transition-all min-w-[60px]">
                           <Settings size={18} />
                           <span className="text-[9px] font-black uppercase mt-1">Config</span>
                        </button>

                        <div className="w-px h-10 bg-gray-200 mx-1 self-center"></div>

                        <button
                           onClick={() => setShowGlobalDiscount(true)}
                           className="h-14 px-4 flex flex-col items-center justify-center rounded-xl border-2 bg-pink-50 border-pink-100 text-pink-600 hover:bg-pink-100 transition-all min-w-[60px]"
                        >
                           <Percent size={18} />
                           <span className="text-[9px] font-black uppercase mt-1">Desc.</span>
                        </button>
                        <button
                           onClick={() => setShowCouponModal(true)}
                           className="h-14 px-4 flex flex-col items-center justify-center rounded-xl border-2 bg-cyan-50 border-cyan-100 text-cyan-600 hover:bg-cyan-100 transition-all min-w-[60px]"
                        >
                           <QrCode size={18} />
                           <span className="text-[9px] font-black uppercase mt-1">Cupón</span>
                        </button>
                        <button
                           onClick={onOpenFinance}
                           className="h-14 px-4 flex flex-col items-center justify-center rounded-xl border-2 bg-indigo-50 border-indigo-100 text-indigo-600 hover:bg-indigo-100 transition-all min-w-[60px]"
                        >
                           <Lock size={18} />
                           <span className="text-[9px] font-black uppercase mt-1">Cierre</span>
                        </button>
                        <button
                           onClick={() => setShowLoyaltyModal(true)}
                           title="Tarjeta Lealtad"
                           className="h-14 px-4 flex flex-col items-center justify-center rounded-xl border-2 bg-blue-50 border-blue-100 text-blue-600 hover:bg-blue-100 transition-all min-w-[60px]"
                        >
                           <CreditCard size={18} />
                           <span className="text-[9px] font-black uppercase mt-1">Tarjeta</span>
                        </button>
                        <button
                           onClick={onLogout}
                           className="h-14 px-4 flex flex-col items-center justify-center rounded-xl border-2 bg-red-50 border-red-100 text-red-600 hover:bg-red-100 transition-all min-w-[60px]"
                        >
                           <LogOut size={18} />
                           <span className="text-[9px] font-black uppercase mt-1">Salir</span>
                        </button>
                     </div>
                  </>
               ) : (
                  // --- VISUAL MODE FOOTER (VERTICAL) ---
                  <>
                     {/* --- BOTONES DE ACCIÓN --- */}
                     <div className="grid grid-cols-3 gap-2">
                        <button
                           onClick={() => setShowGlobalDiscount(true)}
                           className={`flex flex-col items-center justify-center py-2 rounded-xl border-2 transition-all ${globalDiscount.value > 0 ? 'bg-red-50 border-red-200 text-red-600' : 'bg-pink-50 border-pink-100 text-pink-600 hover:bg-pink-100 hover:border-pink-200'}`}
                        >
                           <Percent size={16} />
                           <span className="text-[9px] font-black uppercase mt-1">Descuento</span>
                        </button>
                        <button
                           onClick={() => setShowCouponModal(true)}
                           className="flex flex-col items-center justify-center py-2 rounded-xl border-2 bg-cyan-50 border-cyan-100 text-cyan-600 hover:bg-cyan-100 hover:border-cyan-200 transition-all"
                        >
                           <QrCode size={16} />
                           <span className="text-[9px] font-black uppercase mt-1">Cupón</span>
                        </button>
                        <button
                           onClick={onOpenFinance}
                           className="flex flex-col items-center justify-center py-2 rounded-xl border-2 bg-indigo-50 border-indigo-100 text-indigo-600 hover:bg-indigo-100 hover:border-indigo-200 transition-all"
                        >
                           <Lock size={16} />
                           <span className="text-[9px] font-black uppercase mt-1">Cierre Z</span>
                        </button>
                        <button
                           onClick={() => setShowLoyaltyModal(true)}
                           className="flex flex-col items-center justify-center py-2 rounded-xl border-2 bg-white border-gray-100 text-blue-500 hover:border-blue-200 hover:bg-blue-50 transition-all"
                        >
                           <CreditCard size={16} />
                           <span className="text-[9px] font-black uppercase mt-1">Tarjeta</span>
                        </button>
                        <button
                           onClick={onLogout}
                           className="flex flex-col items-center justify-center py-2 rounded-xl border-2 bg-white border-gray-100 text-gray-400 hover:border-red-100 hover:text-red-500 transition-all"
                        >
                           <LogOut size={16} />
                           <span className="text-[9px] font-black uppercase mt-1">Salir</span>
                        </button>
                     </div>

                     {/* --- BLOQUE DE TOTALES --- */}
                     <div className="space-y-1.5 pt-1 border-t border-dashed border-gray-200">
                        <div className="flex justify-between items-center text-xs font-bold text-gray-500">
                           <span>SUBTOTAL</span>
                           <span>{baseCurrency.symbol}{cartSubtotal.toFixed(2)}</span>
                        </div>
                        {discountAmount > 0 && (
                           <div className="flex justify-between items-center text-xs font-black text-red-500">
                              <span>DESCUENTO</span>
                              <span>-{baseCurrency.symbol}{discountAmount.toFixed(2)}</span>
                           </div>
                        )}
                        <div className="flex justify-between items-center text-xs font-bold text-gray-500">
                           <span>IMPUESTOS</span>
                           <span>{baseCurrency.symbol}{cartTax.toFixed(2)}</span>
                        </div>

                        <div className="flex justify-between items-end pt-2">
                           <div className="text-4xl font-black text-slate-900 leading-none tracking-tighter">
                              {baseCurrency.symbol}{cartTotal.toFixed(2)}
                           </div>
                           <div className="text-right">
                              <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Total General</p>
                              {pointsEarned > 0 && <p className="text-[10px] font-bold text-purple-500">+{pointsEarned} Puntos</p>}
                           </div>
                        </div>
                     </div>

                     <button
                        onClick={() => {
                           if (cart.length > 0 && fiscalStatus.hasNCF) {
                              // 1. Validate Document Series
                              const validation = validateTerminalDocument(config, terminalId, 'TICKET');
                              if (!validation.isValid) {
                                 alert(validation.error);
                                 return;
                              }

                              // 2. Validate Session Expiration (Force Z)
                              if (transactions.length > 0 && activeTerminalConfig) {
                                 const sessionStartDate = transactions[0].date;
                                 if (isSessionExpired(sessionStartDate, activeTerminalConfig)) {
                                    alert("⚠️ CIERRE Z REQUERIDO\n\nLa jornada operativa ha cambiado. Debe realizar el Cierre Z antes de continuar facturando.");
                                    return;
                                 }
                              }

                              setShowPaymentModal(true);
                           } else if (!fiscalStatus.hasNCF) {
                              alert("No hay secuencias fiscales disponibles.");
                           }
                        }}
                        disabled={cart.length === 0 || !fiscalStatus.hasNCF}
                        className={`w-full py-4 rounded-2xl font-black text-xl shadow-xl hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 ${!fiscalStatus.hasNCF ? 'bg-red-100 text-red-500 cursor-not-allowed border-2 border-red-200' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
                     >
                        <span>{!fiscalStatus.hasNCF ? 'Sin Secuencia' : 'COBRAR'}</span>
                        <ArrowRight size={24} />
                     </button>
                  </>
               )}
            </div>
         </div>

         {/* Modals & Overlays */}
         {showPaymentModal && <UnifiedPaymentModal total={cartTotal} items={cart} currencySymbol={baseCurrency.symbol} config={config} onClose={() => setShowPaymentModal(false)} onConfirm={handlePaymentConfirm} themeColor={config.themeColor} customer={selectedCustomer} />}
         {showLoyaltyModal && <LoyaltyScanModal onClose={() => setShowLoyaltyModal(false)} onScan={handleLoyaltyScan} />}
         {editingItem && <CartItemOptionsModal item={editingItem} config={config} users={users} roles={roles} onClose={() => setEditingItem(null)} onUpdate={updateCartItem} canApplyDiscount={true} canVoidItem={true} />}
         {selectedProductForVariants && <ProductVariantSelector product={selectedProductForVariants} currencySymbol={baseCurrency.symbol} onClose={() => setSelectedProductForVariants(null)} onConfirm={(p, m, pr) => { addToCart(p, 1, pr, m); setSelectedProductForVariants(null); }} />}
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
                        {parkedTickets.map(pt => (
                           <div key={pt.id} onClick={() => handleRestoreTicket(pt)} className="p-4 bg-white border border-gray-100 rounded-2xl hover:border-orange-400 hover:bg-orange-50 cursor-pointer group transition-all">
                              <div className="flex justify-between items-start mb-2">
                                 <span className="font-bold text-gray-800">{pt.name}</span>
                                 <span className="text-[10px] font-bold text-gray-400 uppercase">{new Date(pt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                              <div className="flex justify-between items-center">
                                 <span className="text-xs text-gray-500">{pt.items.length} productos</span>
                                 <ArrowRight size={16} className="text-orange-300 group-hover:text-orange-500 transition-colors" />
                              </div>
                           </div>
                        ))}
                        {parkedTickets.length === 0 && <div className="py-10 text-center text-gray-400 italic">No hay tickets guardados</div>}
                     </div>
                  </div>
               </div>
            )
         }
      </div >
   );
};

export default POSInterface;
