import React, { useState } from 'react';
import { 
  Printer, ScanBarcode, Bluetooth, RefreshCw, CheckCircle, 
  X, Zap, Settings as SettingsIcon, FileText, Usb, Network, Plus, Server
} from 'lucide-react';

interface Device {
  id: string;
  name: string;
  type: 'PRINTER' | 'SCANNER';
  connection: 'BLUETOOTH' | 'NETWORK' | 'USB';
  status: 'CONNECTED' | 'DISCONNECTED' | 'PAIRING';
  config?: {
    paperWidth?: '58mm' | '80mm';
    density?: 'LOW' | 'MEDIUM' | 'HIGH';
    ipAddress?: string; // For Network printers
    port?: string;      // Standard 9100
  };
}

const MOCK_FOUND_DEVICES: Device[] = [
  { id: 'dev1', name: 'Cocina Caliente', type: 'PRINTER', connection: 'NETWORK', status: 'CONNECTED', config: { paperWidth: '80mm', ipAddress: '192.168.1.200' } },
  { id: 'dev2', name: 'Star Micronics POP', type: 'PRINTER', connection: 'BLUETOOTH', status: 'DISCONNECTED', config: { paperWidth: '58mm' } },
  { id: 'dev3', name: 'Zebra DS2208', type: 'SCANNER', connection: 'BLUETOOTH', status: 'DISCONNECTED' },
];

const HardwareSettings: React.FC = () => {
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<Device[]>(MOCK_FOUND_DEVICES);
  const [testPrintStatus, setTestPrintStatus] = useState<string | null>(null);
  
  // IP Modal State
  const [showIpModal, setShowIpModal] = useState(false);
  const [ipForm, setIpForm] = useState({ name: '', ip: '192.168.1.', port: '9100' });

  // Simulate scanning process (Bluetooth Discovery)
  const startScan = () => {
    setIsScanning(true);
    // Simulate finding devices
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

  // Simulate USB Connection (WebUSB require user gesture)
  const handleConnectUsb = () => {
     // In a real app, this would call navigator.usb.requestDevice()
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

  // Add Network Printer
  const handleAddIpPrinter = () => {
     if (!ipForm.name || !ipForm.ip) return;
     const newNetDevice: Device = {
        id: `net_${Math.random()}`,
        name: ipForm.name,
        type: 'PRINTER',
        connection: 'NETWORK',
        status: 'CONNECTED', // Assume connected if IP is valid for demo
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

  const updatePrinterConfig = (id: string, width: '58mm' | '80mm') => {
    setDevices(prev => prev.map(d => 
      d.id === id ? { ...d, config: { ...d.config, paperWidth: width } } : d
    ));
  };

  const handleTestPrint = (deviceName: string) => {
    setTestPrintStatus(`Enviando test a ${deviceName}...`);
    setTimeout(() => setTestPrintStatus(null), 3000);
  };

  const getConnectionIcon = (type: string) => {
     switch(type) {
        case 'USB': return <Usb size={20} />;
        case 'NETWORK': return <Network size={20} />;
        case 'BLUETOOTH': return <Bluetooth size={20} />;
        default: return <Zap size={20} />;
     }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in slide-in-from-right-10 duration-500 pb-20">
      
      {/* HEADER & ACTIONS */}
      <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-6">
        <div>
          <h2 className="text-2xl font-black text-gray-800 flex items-center gap-2">
             <Server className="text-blue-600" /> Hardware & Conectividad
          </h2>
          <p className="text-gray-500 font-medium mt-1">Configura impresoras (USB/IP/BT) y escáneres.</p>
        </div>
        
        <div className="flex flex-wrap gap-3 w-full xl:w-auto">
           {/* Bluetooth Scan */}
           <button 
             onClick={startScan}
             disabled={isScanning}
             className={`flex-1 xl:flex-none px-5 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all border ${
               isScanning 
                 ? 'bg-blue-50 text-blue-400 border-blue-100' 
                 : 'bg-white text-gray-700 border-gray-200 hover:border-blue-400 hover:text-blue-600'
             }`}
           >
             <RefreshCw size={18} className={isScanning ? 'animate-spin' : ''} />
             {isScanning ? 'Escaneando...' : 'Scan BT'}
           </button>

           {/* USB Connect */}
           <button 
             onClick={handleConnectUsb}
             className="flex-1 xl:flex-none px-5 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all bg-white text-gray-700 border border-gray-200 hover:border-orange-400 hover:text-orange-600"
           >
             <Usb size={18} />
             <span>USB</span>
           </button>

           {/* Add IP */}
           <button 
             onClick={() => setShowIpModal(true)}
             className="flex-1 xl:flex-none px-6 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all bg-gray-900 text-white hover:bg-gray-800 shadow-lg hover:-translate-y-0.5"
           >
             <Plus size={18} />
             <span>Agregar IP</span>
           </button>
        </div>
      </div>

      {/* SCANNING RADAR UI */}
      {isScanning && (
        <div className="flex flex-col items-center justify-center py-8 bg-blue-50/50 rounded-3xl border border-blue-100 border-dashed">
           <div className="relative flex items-center justify-center w-24 h-24">
              <span className="absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-20 animate-ping"></span>
              <Bluetooth className="text-blue-500 relative z-10" size={32} />
           </div>
           <p className="mt-4 text-blue-600 font-medium text-sm animate-pulse">Buscando dispositivos Bluetooth...</p>
        </div>
      )}

      {/* DEVICE LIST */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
         {devices.map((device) => (
           <div 
             key={device.id} 
             className={`relative bg-white rounded-3xl p-5 border-2 transition-all duration-300 flex flex-col justify-between ${
               device.status === 'CONNECTED' 
                 ? 'border-blue-500 shadow-lg shadow-blue-50' 
                 : 'border-transparent hover:border-gray-200 shadow-sm'
             }`}
           >
             <div className="flex items-start gap-4">
                {/* ICON BOX */}
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 transition-colors ${
                  device.status === 'CONNECTED' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
                }`}>
                   {device.type === 'PRINTER' ? <Printer size={28} /> : <ScanBarcode size={28} />}
                </div>

                {/* INFO */}
                <div className="flex-1 min-w-0">
                   <div className="flex items-center justify-between mb-1">
                      <h3 className="font-bold text-lg text-gray-800 truncate pr-2">{device.name}</h3>
                      <button onClick={() => removeDevice(device.id)} className="text-gray-300 hover:text-red-400"><X size={16} /></button>
                   </div>
                   
                   <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 ${
                         device.connection === 'BLUETOOTH' ? 'bg-indigo-50 text-indigo-600' : 
                         device.connection === 'USB' ? 'bg-orange-50 text-orange-600' : 'bg-emerald-50 text-emerald-600'
                      }`}>
                         {getConnectionIcon(device.connection)}
                         {device.connection}
                      </span>
                      {device.connection === 'NETWORK' && device.config?.ipAddress && (
                         <span className="text-[10px] font-mono text-gray-500 bg-gray-100 px-2 py-1 rounded-lg">
                            {device.config.ipAddress}
                         </span>
                      )}
                   </div>
                </div>
             </div>

             {/* ACTIONS ROW */}
             <div className="flex items-center gap-3 mt-6 pt-4 border-t border-gray-100">
                 {device.status === 'CONNECTED' ? (
                   <>
                     <button 
                       onClick={() => toggleConnection(device.id)}
                       className="px-4 py-2 text-red-500 hover:bg-red-50 rounded-xl font-bold text-xs transition-colors"
                     >
                        Desconectar
                     </button>
                     {device.type === 'PRINTER' && (
                        <button 
                           onClick={() => handleTestPrint(device.name)}
                           className="ml-auto px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs flex items-center gap-2 transition-colors"
                        >
                           <FileText size={14} /> Test
                        </button>
                     )}
                   </>
                 ) : (
                   <button 
                     onClick={() => toggleConnection(device.id)}
                     className="w-full py-2 bg-blue-600 text-white rounded-xl font-bold text-sm shadow-md hover:bg-blue-500 transition-colors"
                   >
                      Conectar
                   </button>
                 )}
             </div>

             {/* CONFIGURATION PANEL (Only for Connected Printers) */}
             {device.status === 'CONNECTED' && device.type === 'PRINTER' && (
                <div className="mt-4 bg-gray-50 rounded-xl p-3 animate-in fade-in">
                   <div className="flex items-center gap-2 mb-2">
                      <SettingsIcon size={12} className="text-gray-400" />
                      <span className="text-[10px] font-bold text-gray-500 uppercase">Ancho de Papel</span>
                   </div>
                   <div className="flex gap-2">
                      {['58mm', '80mm'].map((size) => (
                         <button
                           key={size}
                           onClick={() => updatePrinterConfig(device.id, size as '58mm' | '80mm')}
                           className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                              device.config?.paperWidth === size 
                                 ? 'bg-white border-blue-500 text-blue-600 shadow-sm' 
                                 : 'bg-transparent border-transparent text-gray-400 hover:bg-gray-200'
                           }`}
                         >
                            {size}
                         </button>
                      ))}
                   </div>
                </div>
             )}
           </div>
         ))}
      </div>
      
      {devices.length === 0 && !isScanning && (
         <div className="text-center py-16 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
            <Zap className="mx-auto text-gray-300 mb-4" size={48} />
            <p className="text-gray-500 font-medium">No hay dispositivos configurados.</p>
         </div>
      )}

      {/* MODAL: ADD NETWORK PRINTER */}
      {showIpModal && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in zoom-in-95">
               <div className="flex justify-between items-center mb-6">
                  <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                     <Network className="text-blue-500" size={20} />
                     Impresora de Red
                  </h3>
                  <button onClick={() => setShowIpModal(false)} className="text-gray-400 hover:text-gray-600">
                     <X size={20} />
                  </button>
               </div>
               
               <div className="space-y-4">
                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre (Alias)</label>
                     <input 
                        type="text" 
                        value={ipForm.name}
                        onChange={e => setIpForm({...ipForm, name: e.target.value})}
                        placeholder="Ej. Cocina Fría"
                        className="w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                        autoFocus
                     />
                  </div>
                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Dirección IP</label>
                     <input 
                        type="text" 
                        value={ipForm.ip}
                        onChange={e => setIpForm({...ipForm, ip: e.target.value})}
                        placeholder="192.168.1.XXX"
                        className="w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                     />
                  </div>
                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Puerto</label>
                     <input 
                        type="number" 
                        value={ipForm.port}
                        onChange={e => setIpForm({...ipForm, port: e.target.value})}
                        placeholder="9100"
                        className="w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                     />
                  </div>
               </div>

               <button 
                  onClick={handleAddIpPrinter}
                  disabled={!ipForm.name || !ipForm.ip}
                  className="w-full mt-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-500 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
               >
                  Guardar Configuración
               </button>
            </div>
         </div>
      )}

      {/* FEEDBACK TOAST */}
      {testPrintStatus && (
         <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-5 z-[60]">
            <Printer size={18} className="text-green-400" />
            <span className="font-medium text-sm">{testPrintStatus}</span>
         </div>
      )}

    </div>
  );
};

export default HardwareSettings;