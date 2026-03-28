
import React, { useState, useMemo, useEffect } from 'react';
import {
   Printer, ScanBarcode, Bluetooth, RefreshCw, CheckCircle,
   X, Zap, Settings as SettingsIcon, Usb, Network, Plus,
   Monitor, MessageSquare, DollarSign, Scale,
   Save, Info, AlertTriangle, Check, Tv, MonitorPlay, QrCode, Trash2,
   Cable, Radio, MousePointer2, Image as ImageIcon, ArrowLeft,
   Smartphone, Wallet, ShieldCheck, Database, HardDrive, Loader2, Wifi,
   Cpu, Keyboard, Activity, Layers, Activity as Wave, Barcode
} from 'lucide-react';
import { BusinessConfig, Product, CustomerDisplayConfig, ScaleDevice, ScaleTech, PrinterDevice, ConnectionType, ScaleLabelConfig } from '../types';
import { parseScaleBarcode } from '../utils/barcodeParser';
import { nativePrintBridge } from '../services/printer/NativePrintBridge';

// Perfiles predefinidos de balanzas populares
const SCALE_PRESETS = [
   { id: 'CAS_PD2', brand: 'CAS', model: 'PD-II / ER', baud: 9600, data: 7, parity: 'Even', protocol: 'NCI', icon: '⚖️' },
   { id: 'TOLEDO_8217', brand: 'Toledo', model: 'Mettler 8217', baud: 9600, data: 7, parity: 'Even', protocol: 'Standard', icon: '⚖️' },
   { id: 'DIBAL_G310', brand: 'Dibal', model: 'G-310 / G-325', baud: 9600, data: 8, parity: 'None', protocol: 'Protocolo T', icon: '⚖️' },
   { id: 'BIZERBA', brand: 'Bizerba', model: 'SC-II / BC-II', baud: 9600, data: 8, parity: 'None', protocol: 'Dialog 06', icon: '⚖️' },
   { id: 'ISHIDA', brand: 'Ishida', model: 'Uni-7 / Uni-5', baud: 9600, data: 8, parity: 'None', protocol: 'Standard', icon: '⚖️' },
   { id: 'MANUAL', brand: 'Genérica', model: 'Configuración Manual', baud: 9600, data: 8, parity: 'None', protocol: 'NCI', icon: '⚙️' },
];

const DEFAULT_DISPLAY_CONFIG: CustomerDisplayConfig = {
   isEnabled: true,
   welcomeMessage: '¡Bienvenido a CLIC POS!',
   showItemImages: true,
   showQrPayment: true,
   layout: 'SPLIT',
   connectionType: 'VIRTUAL',
   ads: [
      { id: 'ad1', url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?q=80&w=600&auto=format&fit=crop', active: true },
      { id: 'ad2', url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?q=80&w=600&auto=format&fit=crop', active: true }
   ]
};

const MOCK_DISCOVERY: Record<string, Partial<PrinterDevice>[]> = {
   'BLUETOOTH': [{ name: 'Star mPOP (BT)', address: '00:11:22:33:44:55' }],
   'USB': [{ name: 'Epson TM-T88VI (USB)', address: 'USB_PORT_001' }],
   'NETWORK': [{ name: 'Impresora Cocina 1', address: '192.168.1.50' }]
};


interface HardwareSettingsProps {
   config: BusinessConfig;
   products: Product[];
   onUpdateConfig: (cfg: BusinessConfig) => void;
   onClose: () => void;
   terminalId?: string;
}

type HardwareTab = 'PERIPHERALS' | 'SCALES' | 'DISPLAY' | 'CASHDRO' | 'LABELS';

const HardwareSettings: React.FC<HardwareSettingsProps> = ({ config: globalConfig, products, onUpdateConfig, onClose, terminalId }) => {
   const [activeTab, setActiveTab] = useState<HardwareTab>('PERIPHERALS');

   // -- Local State synced with Config --
   const [scales, setScales] = useState<ScaleDevice[]>(globalConfig.scales || []);
   const [printers, setPrinters] = useState<PrinterDevice[]>(globalConfig.availablePrinters || []);
   const [editingScale, setEditingScale] = useState<ScaleDevice | null>(null);

   // -- Discovery State --
   const [isScanning, setIsScanning] = useState<ConnectionType | null>(null);
   const [isDiscoveryLoading, setIsDiscoveryLoading] = useState(false);
   const [discoveryNotice, setDiscoveryNotice] = useState<string | null>(null);
   const [discoveredDevices, setDiscoveredDevices] = useState<Partial<PrinterDevice>[]>([]);
   const [isManualMode, setIsManualMode] = useState(false);
   const [manualData, setManualData] = useState({ name: '', address: '' });
   const [manualTestResult, setManualTestResult] = useState<{ success: boolean; message: string } | null>(null);
   const [testingPrinterId, setTestingPrinterId] = useState<string | null>(null);
   const [printerTestFeedback, setPrinterTestFeedback] = useState<Record<string, { success: boolean; message: string }>>({});

   // -- Customer Display State --
   const currentTerminalConfig = useMemo(() => {
      // If terminalId is provided, look it up. Otherwise fallback to first terminal or default.
      if (terminalId) {
         return globalConfig.terminals?.find(t => t.id === terminalId) || globalConfig.terminals?.[0];
      }
      return globalConfig.terminals?.[0];
   }, [globalConfig.terminals, terminalId]);

   const [displayConfig, setDisplayConfig] = useState<CustomerDisplayConfig>(
      currentTerminalConfig?.config?.hardware?.customerDisplay || DEFAULT_DISPLAY_CONFIG
   );
   const [previewMode, setPreviewMode] = useState<'IDLE' | 'CHECKOUT'>('CHECKOUT');
   const [currentPreviewAdIndex, setCurrentPreviewAdIndex] = useState(0);

   // Auto-rotate preview ads in IDLE mode
   useEffect(() => {
      if (previewMode === 'IDLE' && displayConfig.ads && displayConfig.ads.length > 1) {
         const interval = setInterval(() => {
            setCurrentPreviewAdIndex(prev => (prev + 1) % displayConfig.ads.length);
         }, 3000); // Faster rotation for preview (3s)
         return () => clearInterval(interval);
      } else {
         setCurrentPreviewAdIndex(0);
      }
   }, [previewMode, displayConfig.ads?.length]);

   useEffect(() => {
      let cancelled = false;

      const prefillUsbPort = async () => {
         if (!isManualMode || isScanning !== 'USB') return;
         if (manualData.address.trim()) return;

         const detected = await nativePrintBridge.discoverPrinters('USB');
         if (cancelled || detected.length === 0) {
            setDiscoveryNotice(prev => prev || 'No se detectó automáticamente un puerto USB. Revise cable, OTG y energía de la impresora.');
            return;
         }

         const first = detected[0];
         setManualData(prev => ({
            name: prev.name || first.name || 'Impresora USB',
            address: prev.address || first.address || ''
         }));
         setDiscoveryNotice(`Puerto USB detectado automáticamente: ${first.address || first.name}`);
      };

      prefillUsbPort();
      return () => { cancelled = true; };
   }, [isManualMode, isScanning, manualData.address]);

   // -- Scale Label State --
   const [scaleLabelConfig, setScaleLabelConfig] = useState<ScaleLabelConfig>(globalConfig.scaleLabelConfig || {
      isEnabled: false,
      prefixes: ['20'],
      structure: {
         totalLength: 13,
         prefixLength: 2,
         pluStart: 2,
         pluLength: 5,
         valueStart: 7,
         valueLength: 5,
         checksumLength: 1
      },
      valueType: 'WEIGHT',
      decimals: 3
   });
   const [testBarcode, setTestBarcode] = useState('');
   const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

   const selectedTerminalId = terminalId || globalConfig.terminals?.[0]?.id || 'T1';

   // --- ACTIONS ---

   const createNewScale = () => {
      setEditingScale({
         id: `scale_${Date.now()}`,
         name: 'Nueva Balanza',
         isEnabled: true,
         technology: 'DIRECT',
         directConfig: {
            port: 'COM1',
            baudRate: 9600,
            dataBits: 8,
            protocol: 'NCI'
         }
      });
   };

   const handleApplyPreset = (preset: typeof SCALE_PRESETS[0]) => {
      if (!editingScale) return;
      setEditingScale({
         ...editingScale,
         name: preset.id === 'MANUAL' ? editingScale.name : `${preset.brand} ${preset.model}`,
         directConfig: {
            port: editingScale.directConfig?.port || 'COM1',
            baudRate: preset.baud,
            dataBits: preset.data,
            protocol: preset.protocol
         }
      });
   };

   const handleDeleteScale = (id: string) => {
      if (confirm('¿Eliminar esta balanza?')) {
         setScales(scales.filter(s => s.id !== id));
      }
   };

   const handleSaveAllHardware = () => {
      const newConfig = { ...globalConfig, scales, availablePrinters: printers, scaleLabelConfig };
      if (newConfig.terminals) {
         // Update the specific terminal config
         newConfig.terminals = newConfig.terminals.map(t => {
            if (t.id === selectedTerminalId) {
               return {
                  ...t,
                  config: {
                     ...t.config,
                     hardware: {
                        ...t.config.hardware,
                        customerDisplay: displayConfig
                     }
                  }
               };
            }
            return t;
         });
      }
      onUpdateConfig(newConfig);
      alert("Configuración de hardware sincronizada con éxito.");
   };

   const handleSaveScale = () => {
      if (!editingScale) return;
      const newScales = scales.some(s => s.id === editingScale.id)
         ? scales.map(s => s.id === editingScale.id ? editingScale : s)
         : [...scales, editingScale];

      setScales(newScales);
      setEditingScale(null);
   };

   const handleStartDiscovery = async (type: ConnectionType) => {
      setIsScanning(type);
      setIsDiscoveryLoading(true);
      setDiscoveryNotice(null);
      setIsManualMode(false);
      setManualData({ name: '', address: '' });
      setManualTestResult(null);
      setDiscoveredDevices([]);

      const runtime = nativePrintBridge.getRuntime();
      const isNativeRuntime = runtime === 'ANDROID' || runtime === 'ELECTRON' || runtime === 'WINDOWS';

      if (nativePrintBridge.supportsPeripheralBinding()) {
         try {
            const nativeDevices = await nativePrintBridge.discoverPrinters(type);
            setDiscoveredDevices(nativeDevices);
            if (nativeDevices.length === 0) {
               if (runtime === 'ANDROID' && type === 'USB') {
                  setDiscoveryNotice('No se detectó una impresora USB conectada. Revise cable, OTG, permisos y energía del equipo.');
               } else if (runtime === 'ANDROID' && type === 'NETWORK') {
                  setDiscoveryNotice('La búsqueda automática por red no está disponible en APK. Use configuración manual para IP y puerto.');
               } else if (runtime === 'ANDROID') {
                  setDiscoveryNotice('No se encontraron impresoras Bluetooth vinculadas en Android.');
               } else {
                  setDiscoveryNotice(`No se encontraron impresoras ${type.toLowerCase()}.`);
               }
            }
            setIsDiscoveryLoading(false);
            return;
         } catch (error) {
            console.warn('Native printer discovery failed, using local fallback:', error);
            if (isNativeRuntime) {
               setDiscoveryNotice(error instanceof Error ? error.message : 'No se pudo completar el reconocimiento nativo.');
               setIsDiscoveryLoading(false);
               return;
            }
         }
      }

      setTimeout(() => {
         setDiscoveredDevices(MOCK_DISCOVERY[type] || []);
         setDiscoveryNotice('Modo demostración: mostrando dispositivos simulados.');
         setIsDiscoveryLoading(false);
      }, 1500);
   };

   const resolveUsbAddress = async () => {
      const detected = await nativePrintBridge.discoverPrinters('USB');
      if (detected.length === 0) {
         return null;
      }

      const first = detected[0];
      setManualData(prev => ({
         name: prev.name || first.name || 'Impresora USB',
         address: prev.address || first.address || ''
      }));
      return first.address || null;
   };

   const buildPrinterTestHtml = (printer: Partial<PrinterDevice>) => `
      <!DOCTYPE html>
      <html>
      <head>
         <meta charset="utf-8" />
         <style>
            body { font-family: monospace; width: 72mm; margin: 0 auto; padding: 6mm; color: #111; }
            h1 { font-size: 18px; margin: 0 0 8px; text-align: center; }
            .row { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; }
            .divider { border-top: 1px dashed #222; margin: 10px 0; }
            .center { text-align: center; }
         </style>
      </head>
      <body>
         <h1>CLIC POS</h1>
         <div class="center">Ticket de prueba de impresora</div>
         <div class="divider"></div>
         <div class="row"><span>Impresora</span><strong>${printer.name || 'Sin nombre'}</strong></div>
         <div class="row"><span>Conexión</span><strong>${printer.connection || 'N/D'}</strong></div>
         <div class="row"><span>Puerto / Dirección</span><strong>${printer.address || 'N/D'}</strong></div>
         <div class="row"><span>Fecha</span><strong>${new Date().toLocaleString()}</strong></div>
         <div class="divider"></div>
         <div class="center">Si este ticket salió impreso, la conexión está operativa.</div>
      </body>
      </html>
   `;

   const handlePairPrinter = async (dev: Partial<PrinterDevice>) => {
      const detectedConnection = isScanning || dev.connection || 'BLUETOOTH';
      let generatedId = dev.id || `prn_${Date.now()}`;

      if (nativePrintBridge.supportsPeripheralBinding()) {
         const paired = await nativePrintBridge.pairPrinter({
            id: dev.id,
            name: dev.name || 'Impresora',
            connection: detectedConnection,
            address: dev.address,
            type: (dev.type as any) || 'TICKET'
         });
         if (paired?.id) generatedId = paired.id;
      }

      const newPrinter: PrinterDevice = {
         id: generatedId,
         name: dev.name || 'Impresora',
         connection: detectedConnection,
         address: dev.address,
         status: 'CONNECTED',
         type: (dev.type as any) || 'TICKET'
      };
      setPrinters([...printers, newPrinter]);
      setIsScanning(null);
      setIsDiscoveryLoading(false);
      setManualTestResult(null);
   };

   const handleSaveManualPrinter = async () => {
      let resolvedAddress = manualData.address.trim();
      if (isScanning === 'USB' && !resolvedAddress) {
         resolvedAddress = (await resolveUsbAddress()) || '';
      }

      if (!manualData.name || !resolvedAddress) {
         alert("Por favor completa el nombre y la dirección.");
         return;
      }
      let generatedId = `prn_man_${Date.now()}`;

      if (nativePrintBridge.supportsPeripheralBinding()) {
         const paired = await nativePrintBridge.pairPrinter({
            name: manualData.name,
            connection: isScanning || 'BLUETOOTH',
            address: resolvedAddress,
            type: 'TICKET'
         });
         if (paired?.id) generatedId = paired.id;
      }

      const newPrinter: PrinterDevice = {
         id: generatedId,
         name: manualData.name,
         connection: isScanning || 'BLUETOOTH',
         address: resolvedAddress,
         status: 'CONNECTED',
         type: 'TICKET'
      };
      setPrinters([...printers, newPrinter]);
      setIsScanning(null);
      setIsDiscoveryLoading(false);
      setIsManualMode(false);
      setManualTestResult(null);
   };

   const handleTestPrinter = async (printer: Partial<PrinterDevice>, feedbackKey?: string) => {
      const printerKey = feedbackKey || printer.id || printer.address || printer.name || `printer-${Date.now()}`;
      setTestingPrinterId(printerKey);

      try {
         const printed = await nativePrintBridge.printHtml({
            html: buildPrinterTestHtml(printer),
            printerId: printer.id,
            printerName: printer.name,
            printerAddress: printer.address,
            connection: printer.connection,
            role: 'TICKET',
            jobType: 'HARDWARE_TEST',
            referenceId: `test-${printerKey}`
         });

         let success = printed;
         let message = printed
            ? `Se imprimió correctamente el ticket de prueba en ${printer.name || 'la impresora seleccionada'}.`
            : `No se pudo imprimir el ticket de prueba en ${printer.name || 'la impresora seleccionada'}.`;

         if (!printed) {
            const status = await nativePrintBridge.testPrinterConnection({
               id: printer.id,
               name: printer.name,
               address: printer.address,
               connection: printer.connection,
               type: printer.type
            });

            if (status === 'ONLINE') {
               message = `La impresora ${printer.name || 'seleccionada'} responde, pero no aceptó el trabajo de impresión.`;
            }
            success = false;
         }

         setPrinterTestFeedback(prev => ({
            ...prev,
            [printerKey]: { success, message }
         }));

         return { success, message };
      } finally {
         setTestingPrinterId(null);
      }
   };

   const handleTestManualPrinter = async () => {
      let resolvedAddress = manualData.address.trim();
      if (isScanning === 'USB' && !resolvedAddress) {
         resolvedAddress = (await resolveUsbAddress()) || '';
      }

      if (!resolvedAddress) {
         setManualTestResult({ success: false, message: 'No se pudo detectar automáticamente el puerto o dirección para esta impresora.' });
         return;
      }

      const result = await handleTestPrinter({
         id: `manual-${resolvedAddress}`,
         name: manualData.name || 'Impresora manual',
         address: resolvedAddress,
         connection: isScanning || 'BLUETOOTH',
         type: 'TICKET'
      }, 'manual-draft');

      setManualTestResult(result);
   };

   const addAd = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const url = prompt("Introduce la URL de la imagen publicitaria (JPG/PNG):");
      if (url && url.trim().startsWith('http')) {
         setDisplayConfig(prev => ({
            ...prev,
            ads: [...(prev.ads || []), { id: `ad_${Date.now()}`, url, active: true }]
         }));
      } else if (url) {
         alert("Por favor introduce una URL válida");
      }
   };

   const toggleAdActive = (adId: string) => {
      setDisplayConfig(prev => ({
         ...prev,
         ads: (prev.ads || []).map(ad =>
            ad.id === adId ? { ...ad, active: !ad.active } : ad
         )
      }));
   };

   const removeAd = (adId: string) => {
      setDisplayConfig(prev => ({
         ...prev,
         ads: prev.ads.filter(a => a.id !== adId)
      }));
   };

   const renderCustomerDisplay = () => (
      <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 pb-32">
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-6">
               <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-200">
                  <div className="flex items-center justify-between">
                     <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-2xl ${displayConfig.isEnabled ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                           <Tv size={24} />
                        </div>
                        <div>
                           <h3 className="font-bold text-gray-800">Estado del Visor</h3>
                           <p className="text-xs text-gray-500">Muestra precios y publicidad al cliente.</p>
                        </div>
                     </div>
                     <button
                        onClick={() => setDisplayConfig({ ...displayConfig, isEnabled: !displayConfig.isEnabled })}
                        className={`w-14 h-7 rounded-full transition-all relative ${displayConfig.isEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}
                     >
                        <div className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all shadow-sm ${displayConfig.isEnabled ? 'left-8' : 'left-1'}`} />
                     </button>
                  </div>
                  {displayConfig.isEnabled && (
                     <div className="mt-6 pt-6 border-t border-slate-50">
                        <button
                           onClick={async () => {
                              try {
                                 let left = window.screen.width; // Default heuristic: Move to the right
                                 let top = 0;
                                 let width = 1024;
                                 let height = 768;

                                 // Advanced API: Multi-Screen Window Placement
                                 if ('getScreenDetails' in window) {
                                    try {
                                       const screenDetails = await (window as any).getScreenDetails();
                                       const screens = screenDetails.screens;

                                       // Find a screen that is NOT the current one (Primary usually)
                                       // ideally we look for an external one or just the second one
                                       const externalScreen = screens.find((s: any) => s !== screenDetails.currentScreen);

                                       if (externalScreen) {
                                          left = externalScreen.left;
                                          top = externalScreen.top;
                                          width = externalScreen.width;
                                          height = externalScreen.height;
                                          console.log("Found external screen:", externalScreen);
                                       }
                                    } catch (err) {
                                       console.warn("Permission denied or API error for screen details:", err);
                                    }
                                 }

                                 // Launch the window
                                 const features = `left=${left},top=${top},width=${width},height=${height},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no`;
                                 window.open('/?view=VISOR', 'clic_pos_visor', features);

                              } catch (e) {
                                 console.error("Error launching visor:", e);
                                 // Fallback simple launch
                                 window.open('/?view=VISOR', 'clic_pos_visor', 'width=1024,height=768');
                              }
                           }}
                           className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-slate-800 transition-all shadow-xl active:scale-95 shadow-slate-200"
                        >
                           <MonitorPlay size={20} /> Lanzar Visor HDMI
                        </button>
                     </div>
                  )}
               </div>

               <div className={`bg-white p-8 rounded-3xl shadow-sm border border-gray-200 space-y-6 transition-all ${displayConfig.isEnabled ? 'opacity-100' : 'opacity-60 grayscale cursor-not-allowed'}`}>
                  <div>
                     <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Método de Conexión</label>
                     <div className="grid grid-cols-2 gap-3">
                        {[
                           { id: 'VIRTUAL', label: 'Monitor HDMI', icon: MonitorPlay },
                           { id: 'NETWORK', label: 'Tablet por IP', icon: Network },
                        ].map(conn => (
                           <button
                              key={conn.id}
                              onClick={() => setDisplayConfig({ ...displayConfig, connectionType: conn.id as any })}
                              className={`p-4 rounded-2xl border-2 flex items-center gap-3 transition-all ${displayConfig.connectionType === conn.id ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm' : 'border-gray-100 text-gray-500 hover:border-gray-200'}`}
                           >
                              <conn.icon size={20} />
                              <span className="text-xs font-bold">{conn.label}</span>
                           </button>
                        ))}
                     </div>
                  </div>

                  <div>
                     <label className="block text-xs font-bold text-gray-400 uppercase mb-2">Mensaje de Bienvenida</label>
                     <input
                        type="text"
                        value={displayConfig.welcomeMessage}
                        onChange={(e) => setDisplayConfig({ ...displayConfig, welcomeMessage: e.target.value })}
                        className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-700 outline-none focus:bg-white focus:ring-2 focus:ring-blue-100"
                        placeholder="Ej. ¡Gracias por preferirnos!"
                     />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                     <button
                        onClick={() => setDisplayConfig({ ...displayConfig, showItemImages: !displayConfig.showItemImages })}
                        className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${displayConfig.showItemImages ? 'border-blue-500 bg-blue-50' : 'border-gray-100'}`}
                     >
                        <Check size={16} className={displayConfig.showItemImages ? 'text-blue-600' : 'text-transparent'} />
                        <span className="text-xs font-bold text-gray-600">Fotos de Artículos</span>
                     </button>
                     <button
                        onClick={() => setDisplayConfig({ ...displayConfig, showQrPayment: !displayConfig.showQrPayment })}
                        className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all ${displayConfig.showQrPayment ? 'border-blue-500 bg-blue-50' : 'border-gray-100'}`}
                     >
                        <Check size={16} className={displayConfig.showQrPayment ? 'text-blue-600' : 'text-transparent'} />
                        <span className="text-xs font-bold text-gray-600">QR de Pago</span>
                     </button>
                  </div>
               </div>

               <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-200">
                  <div className="flex justify-between items-center mb-6">
                     <div>
                        <h3 className="font-bold text-gray-800 text-sm uppercase">Anuncios Publicitarios</h3>
                        <p className="text-[10px] text-gray-400 uppercase font-bold mt-0.5">Rotación automática en modo inactivo</p>
                     </div>
                     <button
                        onClick={addAd}
                        className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 shadow-lg shadow-blue-200 active:scale-90 transition-all"
                     >
                        <Plus size={20} />
                     </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                     {(displayConfig.ads || []).map(ad => (
                        <div key={ad.id} className="relative group rounded-2xl overflow-hidden aspect-video border border-gray-200 bg-gray-100">
                           <img src={ad.url} className="w-full h-full object-cover" alt="Ad" />
                           <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                              <button
                                 onClick={() => toggleAdActive(ad.id)}
                                 className={`p-2.5 rounded-xl text-white transition-all shadow-lg ${ad.active ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'}`}
                                 title={ad.active ? 'Desactivar' : 'Activar'}
                              >
                                 <Monitor size={18} />
                              </button>
                              <button
                                 onClick={() => removeAd(ad.id)}
                                 className="p-2.5 bg-red-600 rounded-xl text-white hover:bg-red-700 transition-all shadow-lg"
                                 title="Eliminar"
                              >
                                 <Trash2 size={18} />
                              </button>
                           </div>
                           {!ad.active && (
                              <div className="absolute top-2 right-2 bg-red-500 text-white text-[8px] font-black px-2 py-1 rounded-full uppercase tracking-tighter shadow-sm">
                                 Inactivo
                              </div>
                           )}
                        </div>
                     ))}
                     {(displayConfig.ads || []).length === 0 && (
                        <div className="col-span-2 py-10 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col items-center justify-center text-gray-300">
                           <ImageIcon size={32} className="mb-2 opacity-20" />
                           <p className="text-xs font-bold uppercase tracking-widest">Sin anuncios</p>
                        </div>
                     )}
                  </div>
               </div>
            </div>

            <div className="flex flex-col items-center">
               <div className="flex bg-gray-200 p-1 rounded-2xl mb-8">
                  <button onClick={() => setPreviewMode('CHECKOUT')} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${previewMode === 'CHECKOUT' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>Modo Cobro</button>
                  <button onClick={() => setPreviewMode('IDLE')} className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${previewMode === 'IDLE' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>Modo Inactivo</button>
               </div>

               <div className="relative w-full max-w-lg bg-gray-900 rounded-[3rem] p-5 shadow-2xl border-8 border-gray-800">
                  <div className="bg-white rounded-[2rem] overflow-hidden aspect-[16/10] flex flex-col relative shadow-inner">
                     {previewMode === 'IDLE' ? (
                        <div className="flex-1 flex flex-col">
                           <div className="flex-1 relative overflow-hidden">
                              {displayConfig.ads?.[currentPreviewAdIndex] ? (
                                 <img src={displayConfig.ads[currentPreviewAdIndex].url} className="w-full h-full object-cover opacity-90 transition-all duration-500" alt="Ad" />
                              ) : (
                                 <div className="w-full h-full bg-slate-100 flex items-center justify-center"><ImageIcon size={48} className="text-slate-200" /></div>
                              )}
                              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/90 via-slate-900/20 to-transparent flex flex-col justify-end p-8 text-white text-center">
                                 <h4 className="text-3xl font-black mb-1">{displayConfig.welcomeMessage}</h4>
                                 <p className="text-xs text-blue-400 font-bold uppercase tracking-[0.2em]">Terminal {selectedTerminalId}</p>
                              </div>
                           </div>
                        </div>
                     ) : (
                        <div className="flex-1 flex overflow-hidden">
                           <div className="flex-1 flex flex-col border-r border-gray-100 bg-white p-6">
                              <span className="font-black text-[10px] uppercase text-slate-300 tracking-widest mb-4">Items en Ticket</span>
                              <div className="space-y-4">
                                 <div className="flex gap-4 items-center">
                                    {displayConfig.showItemImages && <div className="w-12 h-12 rounded-xl bg-gray-100 border border-gray-50 shadow-sm" />}
                                    <div className="flex-1"><p className="font-black text-slate-700 text-sm">Zapatillas Runner X</p><p className="text-[10px] text-slate-400 font-bold">CALZADO</p></div>
                                    <div className="text-sm font-black text-slate-900">$2,500.00</div>
                                 </div>
                              </div>
                           </div>
                           <div className="w-40 bg-slate-50 flex flex-col p-6 items-center justify-between text-center border-l border-white shadow-[inset_10px_0_15px_rgba(0,0,0,0.02)]">
                              <div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total</p><p className="text-2xl font-black text-slate-900">$2,950.00</p></div>
                              {displayConfig.showQrPayment && (
                                 <div className="p-3 bg-white rounded-2xl shadow-md border border-slate-100">
                                    <QrCode size={48} className="text-slate-800" />
                                 </div>
                              )}
                           </div>
                        </div>
                     )}
                  </div>
                  <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 w-48 h-12 bg-gray-800 rounded-t-[2rem] shadow-lg"></div>
               </div>
            </div>
         </div>
      </div>
   );

   return (
      <div className="flex flex-col h-full bg-gray-50 animate-in fade-in slide-in-from-right-10 duration-300">
         <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-4">
               <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"><ArrowLeft size={24} /></button>
               <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2"><SettingsIcon className="text-slate-900" /> Hardware & Periféricos</h1>
            </div>
         </div>

         <div className="flex-1 overflow-hidden p-8 flex flex-col">
            <div className="flex space-x-1 bg-gray-200 p-1 rounded-xl mb-6 self-start">
               {[
                  { id: 'PERIPHERALS', label: 'Impresoras y Escáneres', icon: Printer },
                  { id: 'SCALES', label: 'Balanzas', icon: Scale },
                  { id: 'LABELS', label: 'Etiquetas', icon: Barcode },
                  { id: 'DISPLAY', label: 'Visor Cliente', icon: Tv },
               ].map(tab => (
                  <button
                     key={tab.id}
                     onClick={() => setActiveTab(tab.id as HardwareTab)}
                     className={`px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${activeTab === tab.id ? 'bg-white text-blue-600 shadow-md' : 'text-gray-500 hover:text-gray-700'
                        }`}
                  >
                     <tab.icon size={16} /> {tab.label}
                  </button>
               ))}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
               {activeTab === 'PERIPHERALS' && (
                  <div className="space-y-6 animate-in slide-in-from-right-4">
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <button onClick={() => handleStartDiscovery('BLUETOOTH')} className="p-6 bg-white border border-gray-200 rounded-3xl flex flex-col items-center gap-3 hover:border-blue-400 hover:shadow-lg transition-all group"><Bluetooth size={32} className="text-blue-500 group-hover:scale-110 transition-transform" /><span className="text-sm font-black uppercase tracking-widest text-slate-700">Bluetooth</span></button>
                        <button onClick={() => handleStartDiscovery('NETWORK')} className="p-6 bg-white border border-gray-200 rounded-3xl flex flex-col items-center gap-3 hover:border-blue-400 hover:shadow-lg transition-all group"><Wifi size={32} className="text-indigo-500 group-hover:scale-110 transition-transform" /><span className="text-sm font-black uppercase tracking-widest text-slate-700">Red IP</span></button>
                        <button onClick={() => handleStartDiscovery('USB')} className="p-6 bg-white border border-gray-200 rounded-3xl flex flex-col items-center gap-3 hover:border-blue-400 hover:shadow-lg transition-all group"><Usb size={32} className="text-slate-600 group-hover:scale-110 transition-transform" /><span className="text-sm font-black uppercase tracking-widest text-slate-700">USB</span></button>
                     </div>
                     {isScanning && (
                        <div className="fixed inset-0 z-[120] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
                           <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl p-10 overflow-hidden">
                              <div className="flex justify-between items-center mb-8 border-b border-slate-50 pb-4">
                                 <h3 className="font-black text-2xl text-slate-800">{isManualMode ? 'Configuración Manual' : 'Buscando...'}</h3>
                                 <button onClick={() => setIsScanning(null)} className="p-2 hover:bg-slate-100 rounded-full"><X size={20} /></button>
                              </div>

                              {isManualMode ? (
                                 <div className="space-y-6 animate-in zoom-in-95">
                                    <div>
                                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Nombre del Dispositivo</label>
                                       <input
                                          type="text"
                                          value={manualData.name}
                                          onChange={e => setManualData({ ...manualData, name: e.target.value })}
                                          placeholder="Ej. Impresora Cocina Central"
                                          className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl font-bold text-slate-800 focus:bg-white focus:border-blue-400 outline-none transition-all"
                                       />
                                    </div>
                                    <div>
                                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">
                                          {isScanning === 'NETWORK' ? 'Dirección IP Address' : 'Puerto / ID USB'}
                                       </label>
                                       <div className="relative">
                                          <input
                                             type="text"
                                             value={manualData.address}
                                             onChange={e => setManualData({ ...manualData, address: e.target.value })}
                                             placeholder={isScanning === 'NETWORK' ? '192.168.1.100' : 'COM3 o USB001'}
                                             className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl font-mono font-bold text-slate-800 focus:bg-white focus:border-blue-400 outline-none transition-all"
                                          />
                                          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300">
                                             {isScanning === 'NETWORK' ? <Wifi size={18} /> : <Usb size={18} />}
                                          </div>
                                       </div>
                                    </div>
                                    {manualTestResult && (
                                       <div className={`p-4 rounded-2xl border flex items-center gap-3 ${manualTestResult.success ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                                          {manualTestResult.success ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
                                          <span className="text-sm font-semibold">{manualTestResult.message}</span>
                                       </div>
                                    )}
                                    <div className="flex gap-4 mt-8 pt-4 border-t border-slate-50">
                                       <button onClick={() => setIsManualMode(false)} className="flex-1 py-4 font-black text-slate-400 hover:bg-slate-50 rounded-2xl">Volver al Escaneo</button>
                                       <button onClick={handleTestManualPrinter} className="flex-1 py-4 bg-slate-100 text-slate-700 rounded-[1.5rem] font-black text-sm shadow-sm active:scale-95 transition-all flex items-center justify-center gap-2">
                                          {testingPrinterId === 'manual-draft' ? <Loader2 size={16} className="animate-spin" /> : <Activity size={16} />}
                                          Imprimir prueba
                                       </button>
                                       <button onClick={handleSaveManualPrinter} className="flex-[2] py-4 bg-blue-600 text-white rounded-[1.5rem] font-black text-lg shadow-xl shadow-blue-200 active:scale-95 transition-all">Vincular Manualmente</button>
                                    </div>
                                 </div>
                              ) : (
                                 <>
                                    {isDiscoveryLoading ? (
                                       <div className="py-12 flex flex-col items-center">
                                          <Loader2 className="animate-spin text-blue-500 mb-4" size={56} />
                                          <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">Escaneando puerto {isScanning}...</p>
                                          <button onClick={() => setIsManualMode(true)} className="mt-8 px-6 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-black hover:bg-slate-200 transition-colors flex items-center gap-2">
                                             <Keyboard size={14} /> NO DETECTADO? CONFIGURAR MANUAL
                                          </button>
                                       </div>
                                    ) : discoveredDevices.length === 0 ? (
                                       <div className="py-12 flex flex-col items-center text-center">
                                          <AlertTriangle className="text-amber-500 mb-4" size={56} />
                                          <p className="text-xs font-bold text-slate-500 uppercase tracking-[0.2em]">No se detectaron impresoras {isScanning?.toLowerCase()}</p>
                                          {discoveryNotice && (
                                             <p className="mt-4 max-w-md text-sm font-medium text-slate-500 leading-relaxed">{discoveryNotice}</p>
                                          )}
                                          <div className="mt-8 flex gap-3">
                                             <button onClick={() => isScanning && handleStartDiscovery(isScanning)} className="px-6 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-black hover:bg-slate-200 transition-colors flex items-center gap-2">
                                                <RefreshCw size={14} /> REINTENTAR
                                             </button>
                                             <button onClick={() => setIsManualMode(true)} className="px-6 py-2 bg-blue-600 text-white rounded-xl text-xs font-black hover:bg-blue-700 transition-colors flex items-center gap-2">
                                                <Keyboard size={14} /> CONFIGURAR MANUAL
                                             </button>
                                          </div>
                                       </div>
                                    ) : (
                                       <div className="space-y-3">
                                          {discoveryNotice && (
                                             <div className="px-4 py-3 bg-blue-50 border border-blue-100 rounded-2xl text-sm font-medium text-blue-700">
                                                {discoveryNotice}
                                             </div>
                                          )}
                                          {discoveredDevices.map((dev, i) => (
                                             <div key={i} className="flex justify-between items-center p-5 bg-slate-50 border border-slate-100 rounded-2xl hover:border-blue-300 transition-all group">
                                                <div><p className="font-black text-slate-700">{dev.name}</p><p className="text-[10px] text-slate-400 font-mono">{dev.address}</p></div>
                                                <button onClick={() => handlePairPrinter(dev)} className="px-5 py-2 bg-blue-600 text-white rounded-xl text-xs font-black shadow-lg shadow-blue-200 active:scale-95 transition-all">VINCULAR</button>
                                             </div>
                                          ))}
                                          <div className="mt-6 pt-4 border-t border-slate-50 flex justify-center">
                                             <button onClick={() => setIsManualMode(true)} className="text-blue-500 text-xs font-black hover:underline flex items-center gap-2">
                                                <Keyboard size={14} /> ¿BUSCAS OTRO? AGREGAR MANUALMENTE
                                             </button>
                                          </div>
                                       </div>
                                    )}
                                 </>
                              )}
                           </div>
                        </div>
                     )}
                     <div className="bg-white rounded-3xl border border-gray-200 shadow-sm divide-y divide-slate-50 overflow-hidden">
                        <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                           <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Hardware Activo</h3>
                        </div>
                        {printers.map(p => (
                           <div key={p.id} className="p-5 flex justify-between items-center hover:bg-slate-50/50 group transition-colors">
                              <div className="flex gap-4 items-center">
                                 <div className="p-3 bg-slate-100 rounded-xl text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-500 transition-colors"><Printer size={24} /></div>
                                 <div>
                                    <p className="font-black text-slate-800">{p.name}</p>
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">{p.connection} • {p.address}</p>
                                    {printerTestFeedback[p.id] && (
                                       <p className={`mt-2 text-[11px] font-semibold ${printerTestFeedback[p.id].success ? 'text-green-600' : 'text-red-500'}`}>
                                          {printerTestFeedback[p.id].message}
                                       </p>
                                    )}
                                 </div>
                              </div>
                              <div className="flex items-center gap-2">
                                 <button
                                    onClick={() => handleTestPrinter(p)}
                                    className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-black hover:bg-slate-200 transition-colors flex items-center gap-2"
                                 >
                                    {testingPrinterId === p.id ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
                                    Imprimir prueba
                                 </button>
                                 <button onClick={() => setPrinters(printers.filter(x => x.id !== p.id))} className="p-2 text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={20} /></button>
                              </div>
                           </div>
                        ))}
                        {printers.length === 0 && (
                           <div className="p-16 text-center text-slate-300">
                              <Cable size={48} className="mx-auto mb-3 opacity-20" />
                              <p className="text-sm font-bold uppercase tracking-widest">Sin dispositivos vinculados</p>
                           </div>
                        )}
                     </div>
                  </div>
               )}
               {activeTab === 'SCALES' && (
                  <div className="bg-white p-8 rounded-[2.5rem] border border-gray-200 shadow-sm animate-in slide-in-from-right-4">
                     <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-50">
                        <div><h3 className="text-xl font-black text-slate-800 flex items-center gap-3"><Scale className="text-blue-600" /> Gestión de Balanzas</h3><p className="text-xs text-slate-400 font-medium">Configura dispositivos de pesaje por serie o USB.</p></div>
                        <button onClick={createNewScale} className="px-6 py-3 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-500/20 active:scale-95 transition-all flex items-center gap-2"><Plus size={24} /> Nueva Balanza</button>
                     </div>
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {scales.map(scale => (
                           <div key={scale.id} className="p-8 bg-white border-2 border-slate-100 rounded-[2.5rem] relative group hover:border-blue-400 hover:shadow-xl transition-all">
                              <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 flex gap-2 transition-opacity">
                                 <button onClick={() => setEditingScale(scale)} className="p-2.5 bg-slate-50 rounded-xl text-blue-600 hover:bg-blue-50"><SettingsIcon size={18} /></button>
                                 <button onClick={() => handleDeleteScale(scale.id)} className="p-2.5 bg-slate-50 rounded-xl text-red-500 hover:bg-red-50"><Trash2 size={18} /></button>
                              </div>
                              <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center text-blue-500 mb-6 group-hover:bg-blue-600 group-hover:text-white transition-all shadow-inner"><Scale size={32} /></div>
                              <h4 className="font-black text-slate-800 text-lg leading-tight mb-1">{scale.name}</h4>
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{scale.technology === 'DIRECT' ? 'SERIAL/COM' : 'ETIQUETADO'}</span>
                           </div>
                        ))}
                        {scales.length === 0 && (
                           <div className="col-span-full py-20 border-2 border-dashed border-slate-200 rounded-[3rem] text-center text-slate-400">
                              <Scale size={64} className="mx-auto mb-4 opacity-10" />
                              <p className="text-sm font-bold uppercase tracking-widest">No hay balanzas registradas</p>
                           </div>
                        )}
                     </div>
                  </div>
               )}
               {activeTab === 'LABELS' && (
                  <div className="bg-white p-8 rounded-[2.5rem] border border-gray-200 shadow-sm animate-in slide-in-from-right-4">
                     <div className="flex justify-between items-center mb-8 pb-4 border-b border-slate-50">
                        <div>
                           <h3 className="text-xl font-black text-slate-800 flex items-center gap-3"><Barcode className="text-purple-600" /> Lector de Etiquetas</h3>
                           <p className="text-xs text-slate-400 font-medium">Configura la lectura de códigos de barras impresos por balanzas.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                           <input type="checkbox" checked={scaleLabelConfig.isEnabled} onChange={(e) => setScaleLabelConfig({ ...scaleLabelConfig, isEnabled: e.target.checked })} className="sr-only peer" />
                           <div className="w-14 h-7 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-purple-600"></div>
                        </label>
                     </div>

                     {scaleLabelConfig.isEnabled && (
                        <div className="space-y-8 animate-in fade-in">
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                              <div className="space-y-4">
                                 <label className="block text-sm font-bold text-gray-700">Prefijos (Separados por coma)</label>
                                 <input
                                    type="text"
                                    value={scaleLabelConfig.prefixes.join(',')}
                                    onChange={(e) => setScaleLabelConfig({ ...scaleLabelConfig, prefixes: e.target.value.split(',').map(s => s.trim()) })}
                                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-mono text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                    placeholder="Ej: 20, 02"
                                 />
                              </div>
                              <div className="space-y-4">
                                 <label className="block text-sm font-bold text-gray-700">Tipo de Valor</label>
                                 <div className="flex gap-4">
                                    <button onClick={() => setScaleLabelConfig({ ...scaleLabelConfig, valueType: 'WEIGHT' })} className={`flex-1 py-3 px-4 rounded-xl border-2 font-bold text-sm transition-all ${scaleLabelConfig.valueType === 'WEIGHT' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>Peso (kg/lb)</button>
                                    <button onClick={() => setScaleLabelConfig({ ...scaleLabelConfig, valueType: 'PRICE' })} className={`flex-1 py-3 px-4 rounded-xl border-2 font-bold text-sm transition-all ${scaleLabelConfig.valueType === 'PRICE' ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>Precio ($)</button>
                                 </div>
                              </div>
                           </div>

                           <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200">
                              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-6">Estructura del Código (EAN-13)</h3>
                              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                 {[
                                    { label: 'Longitud Total', key: 'totalLength' },
                                    { label: 'Inicio PLU', key: 'pluStart' },
                                    { label: 'Largo PLU', key: 'pluLength' },
                                    { label: 'Inicio Valor', key: 'valueStart' },
                                    { label: 'Decimales', key: 'decimals', root: true }
                                 ].map((field: any) => (
                                    <div key={field.label}>
                                       <label className="text-[10px] font-bold text-slate-500 uppercase">{field.label}</label>
                                       <input
                                          type="number"
                                          value={field.root ? (scaleLabelConfig as any)[field.key] : (scaleLabelConfig.structure as any)[field.key]}
                                          onChange={(e) => {
                                             const val = parseInt(e.target.value);
                                             if (field.root) setScaleLabelConfig({ ...scaleLabelConfig, [field.key]: val });
                                             else setScaleLabelConfig({ ...scaleLabelConfig, structure: { ...scaleLabelConfig.structure, [field.key]: val } });
                                          }}
                                          className="w-full mt-2 p-3 rounded-xl border border-slate-300 text-center font-mono font-bold outline-none focus:border-purple-500"
                                       />
                                    </div>
                                 ))}
                              </div>
                           </div>

                           <div className="border-t border-slate-100 pt-6">
                              <h3 className="text-sm font-bold text-gray-800 mb-4 flex items-center gap-2"><Barcode size={18} /> Probador de Configuración</h3>
                              <div className="flex gap-4">
                                 <input
                                    type="text"
                                    placeholder="Escanea o escribe un código de prueba..."
                                    value={testBarcode}
                                    onChange={(e) => setTestBarcode(e.target.value)}
                                    className="flex-1 p-4 bg-white border border-gray-300 rounded-2xl font-mono text-lg outline-none focus:border-purple-500 shadow-sm"
                                 />
                                 <button
                                    onClick={() => {
                                       const result = parseScaleBarcode(testBarcode, scaleLabelConfig as any);
                                       setTestResult(result ? { success: true, message: `PLU: ${result.plu} | ${result.type === 'WEIGHT' ? 'Peso' : 'Precio'}: ${result.value}` } : { success: false, message: 'Error de lectura' });
                                    }}
                                    className="px-8 py-3 bg-slate-800 text-white font-bold rounded-2xl hover:bg-slate-900 transition-colors"
                                 >
                                    Probar
                                 </button>
                              </div>
                              {testResult && (
                                 <div className={`mt-4 p-4 rounded-2xl flex items-center gap-3 ${testResult.success ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                                    {testResult.success ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
                                    <span className="font-bold">{testResult.message}</span>
                                 </div>
                              )}
                           </div>
                        </div>
                     )}
                  </div>
               )}
               {activeTab === 'DISPLAY' && renderCustomerDisplay()}
            </div>
         </div>

         <div className="fixed bottom-6 right-6 z-50">
            <button
               onClick={handleSaveAllHardware}
               className="px-8 py-4 bg-blue-600 text-white rounded-2xl font-bold text-lg shadow-xl shadow-blue-600/30 flex items-center gap-3 transition-all hover:scale-105 active:scale-95 animate-in slide-in-from-bottom-8 duration-500"
            >
               <Save size={20} /> Sincronizar Hardware
            </button>
         </div>

         {editingScale && (
            <div className="fixed inset-0 z-[130] bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
               <div className="bg-white rounded-[3rem] w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 flex flex-col max-h-[90vh]">
                  <div className="p-8 border-b border-slate-50 flex justify-between items-center shrink-0">
                     <div className="flex items-center gap-4">
                        <div className="p-3 bg-blue-100 text-blue-600 rounded-2xl"><Scale size={28} /></div>
                        <div>
                           <h3 className="text-2xl font-black text-slate-800">Parámetros de Balanza</h3>
                           <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Configuración del Puerto RS-232 / USB</p>
                        </div>
                     </div>
                     <button onClick={() => setEditingScale(null)} className="p-2 hover:bg-slate-100 rounded-full"><X size={24} /></button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                     {/* SELECTOR DE PRESETS */}
                     <section>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 ml-1">Seleccionar Marca / Modelo</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                           {SCALE_PRESETS.map(preset => (
                              <button
                                 key={preset.id}
                                 onClick={() => handleApplyPreset(preset)}
                                 className="p-4 rounded-2xl border-2 border-slate-100 hover:border-blue-400 bg-white hover:shadow-lg transition-all text-left flex flex-col gap-2 group"
                              >
                                 <span className="text-2xl">{preset.icon}</span>
                                 <div>
                                    <p className="font-black text-slate-800 text-sm">{preset.brand}</p>
                                    <p className="text-[10px] text-slate-400 font-bold uppercase leading-tight">{preset.model}</p>
                                 </div>
                              </button>
                           ))}
                        </div>
                     </section>

                     <div className="h-px bg-slate-100"></div>

                     <section className="space-y-6">
                        <div>
                           <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Alias del Dispositivo</label>
                           <input
                              type="text"
                              value={editingScale.name}
                              onChange={e => setEditingScale({ ...editingScale, name: e.target.value })}
                              className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl font-bold text-slate-800 focus:bg-white focus:border-blue-400 outline-none transition-all"
                              placeholder="Ej. Balanza Carnicería 1"
                           />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                           <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Tecnología</label>
                              <select value={editingScale.technology} onChange={e => setEditingScale({ ...editingScale, technology: e.target.value as any })} className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl font-bold text-slate-800 outline-none focus:bg-white focus:border-blue-400">
                                 <option value="DIRECT">Comunicación Directa (Serie)</option>
                                 <option value="LABEL">Lectura Etiquetas (EAN-13)</option>
                              </select>
                           </div>
                           <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Puerto de Comunicación</label>
                              <div className="relative">
                                 <input
                                    type="text"
                                    value={editingScale.directConfig?.port || 'COM1'}
                                    onChange={e => setEditingScale({ ...editingScale, directConfig: { ...editingScale.directConfig!, port: e.target.value } })}
                                    className="w-full p-4 bg-slate-50 border-2 border-transparent rounded-2xl font-black text-slate-800 focus:bg-white focus:border-blue-400 outline-none transition-all"
                                    placeholder="COM1 o /dev/ttyUSB0"
                                 />
                                 <Cpu className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300" size={20} />
                              </div>
                           </div>
                        </div>

                        <div className="bg-slate-900 rounded-3xl p-6 border border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-6">
                           <div>
                              <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">Baud Rate</label>
                              <select
                                 value={editingScale.directConfig?.baudRate}
                                 onChange={e => setEditingScale({ ...editingScale, directConfig: { ...editingScale.directConfig!, baudRate: parseInt(e.target.value) } })}
                                 className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl p-3 font-mono text-sm font-bold outline-none"
                              >
                                 {[2400, 4800, 9600, 19200, 38400, 57600, 115200].map(b => <option key={b} value={b}>{b}</option>)}
                              </select>
                           </div>
                           <div>
                              <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-2">Protocolo Data</label>
                              <select
                                 value={editingScale.directConfig?.protocol}
                                 onChange={e => setEditingScale({ ...editingScale, directConfig: { ...editingScale.directConfig!, protocol: e.target.value } })}
                                 className="w-full bg-slate-800 border border-slate-700 text-white rounded-xl p-3 font-mono text-sm font-bold outline-none"
                              >
                                 <option value="NCI">NCI Standard</option>
                                 <option value="Standard">Standard (PosScale)</option>
                                 <option value="Dialog 06">Dialog 06</option>
                                 <option value="Protocolo T">Dibal T</option>
                              </select>
                           </div>
                           <div className="flex items-center justify-center pt-5">
                              <button className="flex items-center gap-2 text-blue-400 font-black text-[10px] uppercase hover:text-blue-300 transition-colors">
                                 <Wave size={16} className="animate-pulse" /> Probar Conexión
                              </button>
                           </div>
                        </div>
                     </section>
                  </div>

                  <div className="p-8 bg-gray-50 border-t flex gap-4 shrink-0">
                     <button onClick={() => setEditingScale(null)} className="flex-1 py-4 font-black text-slate-400 hover:bg-white rounded-2xl border border-transparent hover:border-slate-200 transition-all">Cancelar</button>
                     <button onClick={handleSaveScale} className="flex-[2] py-4 bg-blue-600 text-white rounded-[1.5rem] font-black text-lg shadow-xl shadow-blue-200 active:scale-95 transition-all">Aplicar Configuración</button>
                  </div>
               </div>
            </div>
         )}
      </div>
   );
};

export default HardwareSettings;
