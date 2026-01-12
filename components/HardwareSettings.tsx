
import React, { useState } from 'react';
import { 
  Printer, ScanBarcode, Bluetooth, RefreshCw, CheckCircle, 
  X, Zap, Settings as SettingsIcon, FileText, Usb, Network, Plus, Server,
  Monitor, Image as ImageIcon, MessageSquare, DollarSign, Lock, ShieldCheck, Scale,
  Cable, Save
} from 'lucide-react';

interface Device {
  id: string;
  name: string;
  type: 'PRINTER' | 'SCANNER' | 'SCALE';
  connection: 'BLUETOOTH' | 'NETWORK' | 'USB' | 'SERIAL';
  status: 'CONNECTED' | 'DISCONNECTED' | 'PAIRING';
  config?: {
    paperWidth?: '58mm' | '80mm';
    density?: 'LOW' | 'MEDIUM' | 'HIGH';
    ipAddress?: string; // For Network printers
    port?: string;      // Standard 9100
    protocol?: string;  // For Scales (e.g., CAS, Dibal)
    baudRate?: number;  // For Serial Scales
  };
}

const MOCK_DEVICES: Device[] = [
  { id: 'dev1', name: 'Cocina Caliente', type: 'PRINTER', connection: 'NETWORK', status: 'CONNECTED', config: { paperWidth: '80mm', ipAddress: '192.168.1.200' } },
  { id: 'dev2', name: 'Star Micronics POP', type: 'PRINTER', connection: 'BLUETOOTH', status: 'DISCONNECTED', config: { paperWidth: '58mm' } },
  { id: 'dev3', name: 'Zebra DS2208', type: 'SCANNER', connection: 'BLUETOOTH', status: 'DISCONNECTED' },
  { id: 'dev4', name: 'Balanza CAS PD-II', type: 'SCALE', connection: 'SERIAL', status: 'CONNECTED', config: { protocol: 'CAS', baudRate: 9600 } },
];

type HardwareTab = 'PERIPHERALS' | 'SCALES' | 'DISPLAY' | 'CASHDRO';

const HardwareSettings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<HardwareTab>('PERIPHERALS');
  
  // -- Peripherals State --
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<Device[]>(MOCK_DEVICES);
  const [testPrintStatus, setTestPrintStatus] = useState<string | null>(null);
  const [showIpModal, setShowIpModal] = useState(false);
  const [ipForm, setIpForm] = useState({ name: '', ip: '192.168.1.', port: '9100' });

  // -- Scale specific --
  const [scaleReading, setScaleReading] = useState<number | null>(null);

  // -- Customer Display State --
  const [displayConfig, setDisplayConfig] = useState({
    isEnabled: true,
    welcomeMessage: '¡Bienvenido a nuestra tienda!',
    idleImage: '', // Base64 or URL
    showItemDetails: true
  });

  // -- CashDro State --
  const [cashDroConfig, setCashDroConfig] = useState({
    isEnabled: false,
    ipAddress: '192.168.1.50',
    port: '8888',
    user: 'admin',
    password: ''
  });
  const [cashDroStatus, setCashDroStatus] = useState<'DISCONNECTED' | 'CONNECTING' | 'READY'>('DISCONNECTED');

  // --- PERIPHERAL ACTIONS ---
  const startScan = () => {
    setIsScanning(true);
    setTimeout(() => {
       const newBtDevice: Device = { 
          id: `bt_${Math.random()}`, 
          name: 'Epson TM-P80 (BT)', 
          type: 'PRINTER', 
          connection: 'BLUETOOTH', 
          status: 'DISCONNECTED',
          config: { paperWidth: '80mm' }
       };
       setDevices(prev => [...prev, newBtDevice]);
       setIsScanning(false);
    }, 2000);
  };

  const handleConnectUsb = () => {
     const newUsbDevice: Device = {
        id: `usb_${Math.random()}`,
        name: 'USB Thermal Printer',
        type: 'PRINTER',
        connection: 'USB',
        status: 'CONNECTED',
        config: { paperWidth: '80mm' }
     };
     setDevices(prev => [...prev, newUsbDevice]);
  };

  const handleAddIpPrinter = () => {
     if (!ipForm.name || !ipForm.ip) return;
     const newNetDevice: Device = {
        id: `net_${Math.random()}`,
        name: ipForm.name,
        type: 'PRINTER',
        connection: 'NETWORK',
        status: 'CONNECTED',
        config: { 
           paperWidth: '80mm',
           ipAddress: ipForm.ip,
           port: ipForm.port
        }
     };
     setDevices(prev => [...prev, newNetDevice]);
     setShowIpModal(false);
     setIpForm({ name: '', ip: '192.168.1.', port: '9100' });
  };

  const handleAddScale = () => {
     const newScale: Device = {
        id: `scale_${Math.random()}`,
        name: 'Nueva Balanza',
        type: 'SCALE',
        connection: 'SERIAL',
        status: 'DISCONNECTED',
        config: { protocol: 'CAS', baudRate: 9600 }
     };
     setDevices(prev => [...prev, newScale]);
  }

  const toggleConnection = (id: string) => {
    setDevices(prev => prev.map(d => {
      if (d.id === id) {
        return { 
          ...d, 
          status: d.status === 'CONNECTED' ? 'DISCONNECTED' : 'CONNECTED' 
        };
      }
      return d;
    }));
  };

  const removeDevice = (id: string) => {
     if(confirm("¿Olvidar este dispositivo?")) {
        setDevices(prev => prev.filter(d => d.id !== id));
     }
  };

  const handleTestPrint = (deviceName: string) => {
    setTestPrintStatus(`Enviando prueba a ${deviceName}...`);
    setTimeout(() => {
      setTestPrintStatus(null);
      alert("Prueba de impresión enviada con éxito.");
    }, 2000);
  };

  // --- TAB RENDERERS ---

  const renderPeripherals = () => (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
       <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <button onClick={startScan} disabled={isScanning} className="p-4 bg-white border border-gray-200 rounded-xl flex flex-col items-center gap-2 hover:border-blue-300 hover:bg-blue-50 transition-all shadow-sm">
             <Bluetooth size={24} className={isScanning ? 'animate-spin text-blue-500' : 'text-gray-600'} />
             <span className="text-sm font-bold text-gray-700">{isScanning ? 'Buscando...' : 'Escanear Bluetooth'}</span>
          </button>
          <button onClick={() => setShowIpModal(true)} className="p-4 bg-white border border-gray-200 rounded-xl flex flex-col items-center gap-2 hover:border-blue-300 hover:bg-blue-50 transition-all shadow-sm">
             <Network size={24} className="text-gray-600" />
             <span className="text-sm font-bold text-gray-700">Agregar por IP</span>
          </button>
          <button onClick={handleConnectUsb} className="p-4 bg-white border border-gray-200 rounded-xl flex flex-col items-center gap-2 hover:border-blue-300 hover:bg-blue-50 transition-all shadow-sm">
             <Usb size={24} className="text-gray-600" />
             <span className="text-sm font-bold text-gray-700">Detectar USB</span>
          </button>
       </div>

       <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
             <h3 className="font-bold text-gray-700 flex items-center gap-2">
                <Printer size={18} /> Dispositivos Vinculados
             </h3>
             <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-bold">{devices.length}</span>
          </div>
          <div className="divide-y divide-gray-100">
             {devices.map(device => (
                <div key={device.id} className="p-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                   <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${device.status === 'CONNECTED' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                         {device.type === 'PRINTER' && <Printer size={24} />}
                         {device.type === 'SCANNER' && <ScanBarcode size={24} />}
                         {device.type === 'SCALE' && <Scale size={24} />}
                      </div>
                      <div>
                         <h4 className="font-bold text-gray-800">{device.name}</h4>
                         <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span className="uppercase font-bold">{device.connection}</span>
                            <span>•</span>
                            <span className={device.status === 'CONNECTED' ? 'text-green-600 font-bold' : 'text-gray-400'}>{device.status}</span>
                            {device.config?.ipAddress && <span>• {device.config.ipAddress}</span>}
                         </div>
                      </div>
                   </div>
                   <div className="flex items-center gap-2">
                      {device.type === 'PRINTER' && device.status === 'CONNECTED' && (
                         <button onClick={() => handleTestPrint(device.name)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Test Print">
                            <FileText size={18} />
                         </button>
                      )}
                      <button onClick={() => toggleConnection(device.id)} className={`p-2 rounded-lg font-bold text-xs transition-colors ${device.status === 'CONNECTED' ? 'text-orange-500 hover:bg-orange-50' : 'text-green-600 hover:bg-green-50'}`}>
                         {device.status === 'CONNECTED' ? 'Desconectar' : 'Conectar'}
                      </button>
                      <button onClick={() => removeDevice(device.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                         <X size={18} />
                      </button>
                   </div>
                </div>
             ))}
             {devices.length === 0 && (
                <div className="p-8 text-center text-gray-400">No hay dispositivos configurados.</div>
             )}
          </div>
       </div>
    </div>
  );

  const renderScales = () => (
     <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col md:flex-row gap-8 items-center">
           <div className="w-full md:w-1/2 flex flex-col items-center justify-center p-8 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
              <Scale size={64} className="text-gray-300 mb-4" />
              <div className="text-4xl font-black text-gray-800 font-mono mb-2">
                 {scaleReading !== null ? scaleReading.toFixed(3) : '0.000'} <span className="text-lg text-gray-400">kg</span>
              </div>
              <div className="flex gap-2">
                 <span className={`w-3 h-3 rounded-full ${scaleReading !== null ? 'bg-green-500' : 'bg-red-500'}`}></span>
                 <span className="text-xs font-bold text-gray-500 uppercase">{scaleReading !== null ? 'Estable' : 'Sin señal'}</span>
              </div>
           </div>
           
           <div className="w-full md:w-1/2 space-y-4">
              <h3 className="font-bold text-lg text-gray-800">Configuración de Balanza</h3>
              <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Puerto (COM)</label>
                    <select className="w-full p-2 border rounded-lg bg-white text-sm">
                       <option>COM1</option>
                       <option>COM2</option>
                       <option>USB Virtual</option>
                    </select>
                 </div>
                 <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Protocolo</label>
                    <select className="w-full p-2 border rounded-lg bg-white text-sm">
                       <option>CAS NCI</option>
                       <option>Dibal</option>
                       <option>Epelsa</option>
                       <option>Toledo</option>
                    </select>
                 </div>
              </div>
              <div className="flex gap-2">
                 <button onClick={() => setScaleReading(Number((Math.random() * 2).toFixed(3)))} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700">
                    Probar Lectura
                 </button>
                 <button onClick={() => setScaleReading(0)} className="px-4 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-200">
                    Tara (Zero)
                 </button>
              </div>
           </div>
        </div>
     </div>
  );

  const renderDisplay = () => (
     <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
        <div className="flex justify-between items-start gap-8">
           <div className="flex-1 space-y-6">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                 <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                       <Monitor size={18} /> Pantalla Cliente
                    </h3>
                    <div onClick={() => setDisplayConfig({...displayConfig, isEnabled: !displayConfig.isEnabled})} className={`w-12 h-6 rounded-full cursor-pointer transition-colors relative ${displayConfig.isEnabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                       <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${displayConfig.isEnabled ? 'left-7' : 'left-1'}`}></div>
                    </div>
                 </div>
                 
                 <div className={`space-y-4 transition-opacity ${displayConfig.isEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                    <div>
                       <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Mensaje de Bienvenida</label>
                       <input 
                          type="text" 
                          value={displayConfig.welcomeMessage}
                          onChange={(e) => setDisplayConfig({...displayConfig, welcomeMessage: e.target.value})}
                          className="w-full p-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                       />
                    </div>
                    <div>
                       <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Imagen en Reposo (Publicidad)</label>
                       <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 flex flex-col items-center justify-center text-gray-400 hover:bg-gray-50 cursor-pointer transition-colors">
                          <ImageIcon size={32} className="mb-2" />
                          <span className="text-xs font-bold">Click para subir imagen</span>
                       </div>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                       <input type="checkbox" checked={displayConfig.showItemDetails} onChange={(e) => setDisplayConfig({...displayConfig, showItemDetails: e.target.checked})} className="w-4 h-4 text-blue-600 rounded" />
                       <span className="text-sm font-medium text-gray-700">Mostrar detalle de items al escanear</span>
                    </label>
                 </div>
              </div>
           </div>

           {/* Preview Mockup */}
           <div className="w-80 hidden md:block">
              <p className="text-center text-xs font-bold text-gray-400 uppercase mb-2">Vista Previa</p>
              <div className="bg-gray-900 border-8 border-gray-800 rounded-xl overflow-hidden aspect-video relative shadow-xl">
                 {/* Simulate Screen Content */}
                 <div className="absolute inset-0 bg-gradient-to-br from-blue-900 to-slate-900 flex flex-col items-center justify-center text-white p-4 text-center">
                    <h2 className="text-xl font-bold mb-2">{displayConfig.welcomeMessage}</h2>
                    <div className="w-full bg-white/10 rounded-lg p-2 mt-4">
                       <div className="flex justify-between text-xs mb-1 opacity-60"><span>Producto</span><span>Precio</span></div>
                       <div className="flex justify-between text-sm font-bold"><span>Coca Cola</span><span>$2.00</span></div>
                    </div>
                    <div className="mt-auto w-full flex justify-between items-end border-t border-white/20 pt-2">
                       <span className="text-xs opacity-70">Total a Pagar</span>
                       <span className="text-2xl font-black">$2.00</span>
                    </div>
                 </div>
              </div>
           </div>
        </div>
     </div>
  );

  const renderCashDro = () => (
     <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
        <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg relative overflow-hidden">
           <div className="absolute top-0 right-0 w-64 h-64 bg-green-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
           
           <div className="flex justify-between items-start relative z-10">
              <div>
                 <h3 className="text-2xl font-black flex items-center gap-2">
                    <Server /> CashDro Integration
                 </h3>
                 <p className="text-slate-400 text-sm mt-1">Gestión automática de efectivo.</p>
              </div>
              <div className={`px-3 py-1 rounded-full text-xs font-bold border ${cashDroStatus === 'READY' ? 'bg-green-500/20 border-green-500 text-green-400' : 'bg-red-500/20 border-red-500 text-red-400'}`}>
                 {cashDroStatus}
              </div>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8 relative z-10">
              <div className="space-y-4">
                 <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">IP Address</label>
                    <input 
                       type="text" 
                       value={cashDroConfig.ipAddress}
                       onChange={(e) => setCashDroConfig({...cashDroConfig, ipAddress: e.target.value})}
                       className="w-full p-3 bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-green-500"
                    />
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                       <label className="block text-xs font-bold text-slate-500 uppercase mb-1">User</label>
                       <input 
                          type="text" 
                          value={cashDroConfig.user}
                          onChange={(e) => setCashDroConfig({...cashDroConfig, user: e.target.value})}
                          className="w-full p-3 bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-green-500"
                       />
                    </div>
                    <div>
                       <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password</label>
                       <input 
                          type="password" 
                          value={cashDroConfig.password}
                          onChange={(e) => setCashDroConfig({...cashDroConfig, password: e.target.value})}
                          className="w-full p-3 bg-slate-800 border border-slate-700 rounded-xl text-white outline-none focus:border-green-500"
                       />
                    </div>
                 </div>
                 <button 
                    onClick={() => { setCashDroStatus('CONNECTING'); setTimeout(() => setCashDroStatus('READY'), 2000); }}
                    className="w-full py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-xl transition-colors shadow-lg shadow-green-900/20"
                 >
                    {cashDroStatus === 'CONNECTING' ? 'Conectando...' : 'Conectar CashDro'}
                 </button>
              </div>

              {/* Status Monitor */}
              <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 flex flex-col justify-between opacity-80">
                 <div className="space-y-4">
                    <div className="flex justify-between items-center border-b border-slate-700 pb-2">
                       <span className="text-sm text-slate-400">Estado Billetero</span>
                       <span className="text-green-400 font-bold flex items-center gap-1"><CheckCircle size={14}/> OK</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-slate-700 pb-2">
                       <span className="text-sm text-slate-400">Estado Monedero</span>
                       <span className="text-green-400 font-bold flex items-center gap-1"><CheckCircle size={14}/> OK</span>
                    </div>
                    <div className="flex justify-between items-center">
                       <span className="text-sm text-slate-400">Nivel de Cambio</span>
                       <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-slate-700 rounded-full overflow-hidden">
                             <div className="w-[70%] h-full bg-blue-500"></div>
                          </div>
                          <span className="text-xs font-bold">70%</span>
                       </div>
                    </div>
                 </div>
                 <div className="mt-4 pt-4 border-t border-slate-700 flex gap-2">
                    <button className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-bold">Vaciaje</button>
                    <button className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-bold">Carga</button>
                 </div>
              </div>
           </div>
        </div>
     </div>
  );

  return (
    <div className="flex flex-col h-full bg-gray-50 animate-in fade-in slide-in-from-right-10 duration-300">
      
      {/* Header */}
      <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
             <SettingsIcon className="text-slate-900" /> Configuración Hardware
          </h1>
          <p className="text-sm text-gray-500">Administra impresoras, cajones y periféricos.</p>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-8 flex flex-col">
         
         {/* Tabs */}
         <div className="flex space-x-1 bg-gray-200 p-1 rounded-xl mb-6 self-start">
            {[
               { id: 'PERIPHERALS', label: 'Impresoras y Escáneres', icon: Printer },
               { id: 'SCALES', label: 'Balanzas', icon: Scale },
               { id: 'DISPLAY', label: 'Visor Cliente', icon: Monitor },
               { id: 'CASHDRO', label: 'CashDro / Cajón', icon: DollarSign },
            ].map(tab => (
               <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as HardwareTab)}
                  className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${
                     activeTab === tab.id 
                        ? 'bg-white text-blue-600 shadow-sm' 
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-300/50'
                  }`}
               >
                  <tab.icon size={16} />
                  {tab.label}
               </button>
            ))}
         </div>

         {/* Content */}
         <div className="flex-1 overflow-y-auto">
            {activeTab === 'PERIPHERALS' && renderPeripherals()}
            {activeTab === 'SCALES' && renderScales()}
            {activeTab === 'DISPLAY' && renderDisplay()}
            {activeTab === 'CASHDRO' && renderCashDro()}
         </div>

      </div>

      {/* IP Modal */}
      {showIpModal && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">
               <h3 className="text-lg font-bold text-gray-800 mb-4">Agregar Impresora de Red</h3>
               <div className="space-y-4">
                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre</label>
                     <input 
                        type="text" 
                        value={ipForm.name} 
                        onChange={(e) => setIpForm({...ipForm, name: e.target.value})} 
                        className="w-full p-3 border rounded-xl"
                        placeholder="Ej. Cocina"
                     />
                  </div>
                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Dirección IP</label>
                     <input 
                        type="text" 
                        value={ipForm.ip} 
                        onChange={(e) => setIpForm({...ipForm, ip: e.target.value})} 
                        className="w-full p-3 border rounded-xl font-mono"
                     />
                  </div>
                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Puerto</label>
                     <input 
                        type="text" 
                        value={ipForm.port} 
                        onChange={(e) => setIpForm({...ipForm, port: e.target.value})} 
                        className="w-full p-3 border rounded-xl font-mono"
                     />
                  </div>
                  <div className="flex gap-2 pt-2">
                     <button onClick={() => setShowIpModal(false)} className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl">Cancelar</button>
                     <button onClick={handleAddIpPrinter} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700">Guardar</button>
                  </div>
               </div>
            </div>
         </div>
      )}

    </div>
  );
};

export default HardwareSettings;
