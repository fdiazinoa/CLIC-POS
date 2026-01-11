import React, { useState, useEffect } from 'react';
import { 
  Receipt, Upload, Type, LayoutTemplate, QrCode, 
  ToggleLeft, ToggleRight, Trash2, Save 
} from 'lucide-react';
import { BusinessConfig, ReceiptConfig } from '../types';

interface ReceiptDesignerProps {
  config: BusinessConfig;
  onUpdateConfig: (newConfig: BusinessConfig) => void;
}

// Dummy data for preview
const PREVIEW_ITEMS = [
  { name: 'Coca Cola 500ml', qty: 2, price: 2.50, total: 5.00 },
  { name: 'Sandwich Mixto', qty: 1, price: 5.00, total: 5.00 },
  { name: 'Papas Fritas', qty: 1, price: 3.00, total: 3.00 },
];

const ReceiptDesigner: React.FC<ReceiptDesignerProps> = ({ config, onUpdateConfig }) => {
  const [localConfig, setLocalConfig] = useState<ReceiptConfig>({
    logo: config.receiptConfig?.logo || '',
    footerMessage: config.receiptConfig?.footerMessage || '¡Gracias por su compra!\nVuelva pronto.',
    showCustomerInfo: config.receiptConfig?.showCustomerInfo ?? true,
    showSavings: config.receiptConfig?.showSavings ?? false,
    showQr: config.receiptConfig?.showQr ?? true,
  });

  // Sync with parent when saving
  const handleSave = () => {
    onUpdateConfig({
      ...config,
      receiptConfig: localConfig
    });
    alert("Diseño de ticket guardado correctamente.");
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setLocalConfig(prev => ({ ...prev, logo: reader.result as string }));
      reader.readAsDataURL(file);
    }
  };

  // --- UI COMPONENTS ---
  
  const ToggleSwitch: React.FC<{ label: string; checked: boolean; onChange: (val: boolean) => void }> = ({ label, checked, onChange }) => (
    <div 
      onClick={() => onChange(!checked)} 
      className="flex items-center justify-between p-3 bg-white rounded-xl border border-gray-200 cursor-pointer hover:border-blue-300 transition-colors"
    >
      <span className="font-medium text-gray-600 text-sm">{label}</span>
      {checked ? <ToggleRight className="text-blue-600" size={28} /> : <ToggleLeft className="text-gray-300" size={28} />}
    </div>
  );

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-140px)] gap-6 animate-in fade-in">
      
      {/* LEFT: CONTROLS */}
      <div className="w-full lg:w-1/2 flex flex-col gap-6 overflow-y-auto pr-2">
        
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
           <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <LayoutTemplate size={20} className="text-blue-500" />
              Cabecera & Logo
           </h2>
           
           <div className="flex gap-4 mb-4">
              <div className="w-24 h-24 rounded-xl bg-gray-50 border-2 border-dashed border-gray-300 flex items-center justify-center relative overflow-hidden group cursor-pointer">
                 {localConfig.logo ? (
                    <img src={localConfig.logo} alt="Logo" className="w-full h-full object-contain" />
                 ) : (
                    <Upload className="text-gray-400" size={24} />
                 )}
                 <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" onChange={handleLogoUpload} />
                 {localConfig.logo && (
                    <div 
                      onClick={(e) => { e.stopPropagation(); setLocalConfig(prev => ({...prev, logo: ''})); }}
                      className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                       <Trash2 className="text-white" size={20} />
                    </div>
                 )}
              </div>
              <div className="flex-1 space-y-2">
                 <p className="text-xs text-gray-500">Sube el logo de tu negocio. Se mostrará en blanco y negro en la mayoría de impresoras.</p>
                 <div className="p-3 bg-blue-50 text-blue-800 text-xs rounded-lg font-medium">
                    Recomendado: PNG Transparente
                 </div>
              </div>
           </div>

           <div className="space-y-3">
              <div>
                 <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre del Negocio</label>
                 <input 
                    type="text" 
                    value={config.companyInfo.name} 
                    onChange={e => onUpdateConfig({...config, companyInfo: {...config.companyInfo, name: e.target.value}})}
                    className="w-full p-2 border rounded-lg text-sm bg-gray-50" 
                 />
              </div>
              <div className="grid grid-cols-2 gap-3">
                 <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Dirección</label>
                    <input 
                       type="text" 
                       value={config.companyInfo.address} 
                       onChange={e => onUpdateConfig({...config, companyInfo: {...config.companyInfo, address: e.target.value}})}
                       className="w-full p-2 border rounded-lg text-sm bg-gray-50" 
                    />
                 </div>
                 <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">RNC / Tax ID</label>
                    <input 
                       type="text" 
                       value={config.companyInfo.rnc} 
                       onChange={e => onUpdateConfig({...config, companyInfo: {...config.companyInfo, rnc: e.target.value}})}
                       className="w-full p-2 border rounded-lg text-sm bg-gray-50" 
                    />
                 </div>
              </div>
           </div>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
           <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Type size={20} className="text-purple-500" />
              Contenido & Pie de Página
           </h2>
           
           <div className="space-y-3 mb-6">
              <ToggleSwitch label="Mostrar Datos del Cliente" checked={localConfig.showCustomerInfo} onChange={v => setLocalConfig(prev => ({...prev, showCustomerInfo: v}))} />
              <ToggleSwitch label="Mostrar Ahorro Total" checked={localConfig.showSavings} onChange={v => setLocalConfig(prev => ({...prev, showSavings: v}))} />
              <ToggleSwitch label="Mostrar Código QR Factura" checked={localConfig.showQr} onChange={v => setLocalConfig(prev => ({...prev, showQr: v}))} />
           </div>

           <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Mensaje de Despedida</label>
              <textarea 
                 rows={3}
                 value={localConfig.footerMessage}
                 onChange={e => setLocalConfig(prev => ({...prev, footerMessage: e.target.value}))}
                 className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-purple-500 outline-none resize-none"
                 placeholder="Ej. Gracias por su visita..."
              />
           </div>
        </div>

        <button 
           onClick={handleSave}
           className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold shadow-xl hover:bg-gray-800 transition-all flex items-center justify-center gap-2"
        >
           <Save size={20} /> Guardar Diseño
        </button>

      </div>

      {/* RIGHT: PREVIEW */}
      <div className="w-full lg:w-1/2 bg-gray-200/80 rounded-3xl border-2 border-gray-300/50 flex items-start justify-center p-8 overflow-y-auto shadow-inner relative">
         <div className="absolute top-4 right-4 bg-white/50 backdrop-blur px-3 py-1 rounded-full text-xs font-bold text-gray-500 border border-gray-200">
            Vista Previa (80mm)
         </div>
         
         {/* THE TICKET */}
         <div className="w-[380px] bg-white shadow-2xl relative transition-all duration-300 shrink-0">
            
            {/* Ticket Content */}
            <div className="p-6 pb-12 font-mono text-gray-800 text-sm leading-snug">
               
               {/* Header */}
               <div className="text-center mb-6">
                  {localConfig.logo && (
                     <img src={localConfig.logo} alt="Logo" className="h-16 mx-auto mb-2 grayscale object-contain" />
                  )}
                  <h1 className="font-bold text-xl uppercase mb-1">{config.companyInfo.name || 'NOMBRE TIENDA'}</h1>
                  <p className="text-xs text-gray-500">{config.companyInfo.address || 'Dirección línea 1'}</p>
                  <p className="text-xs text-gray-500">Tel: {config.companyInfo.phone || '000-000-0000'}</p>
                  <p className="text-xs text-gray-500">RNC: {config.companyInfo.rnc || '123456789'}</p>
               </div>

               {/* Transaction Info */}
               <div className="border-b-2 border-dashed border-gray-300 pb-3 mb-3">
                  <div className="flex justify-between text-xs">
                     <span>FECHA: {new Date().toLocaleDateString()}</span>
                     <span>HORA: {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                     <span>TICKET: #000458</span>
                     <span>CAJERO: Admin</span>
                  </div>
                  {localConfig.showCustomerInfo && (
                     <div className="mt-2 pt-2 border-t border-dotted border-gray-200 text-xs">
                        <p className="font-bold">CLIENTE: Juan Pérez</p>
                        <p>RNC/Cédula: 402-0000000-1</p>
                     </div>
                  )}
               </div>

               {/* Items */}
               <table className="w-full text-xs mb-4">
                  <thead>
                     <tr className="text-left border-b border-gray-800">
                        <th className="pb-1 w-8">CANT</th>
                        <th className="pb-1">DESC</th>
                        <th className="pb-1 text-right">TOTAL</th>
                     </tr>
                  </thead>
                  <tbody>
                     {PREVIEW_ITEMS.map((item, idx) => (
                        <tr key={idx}>
                           <td className="py-1 align-top">{item.qty}</td>
                           <td className="py-1 align-top">{item.name}</td>
                           <td className="py-1 align-top text-right">{config.currencySymbol}{item.total.toFixed(2)}</td>
                        </tr>
                     ))}
                  </tbody>
               </table>

               {/* Totals */}
               <div className="border-t-2 border-gray-800 pt-2 mb-6">
                  <div className="flex justify-between text-xs mb-1">
                     <span>SUBTOTAL</span>
                     <span>{config.currencySymbol}11.60</span>
                  </div>
                  <div className="flex justify-between text-xs mb-1">
                     <span>IMPUESTOS (18%)</span>
                     <span>{config.currencySymbol}2.09</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold mt-2">
                     <span>TOTAL</span>
                     <span>{config.currencySymbol}13.69</span>
                  </div>
                  {localConfig.showSavings && (
                     <div className="mt-2 text-center text-xs font-bold border border-gray-800 rounded p-1">
                        *** AHORRO TOTAL: {config.currencySymbol}1.50 ***
                     </div>
                  )}
               </div>

               {/* Footer */}
               <div className="text-center space-y-4">
                  <p className="text-xs whitespace-pre-wrap">{localConfig.footerMessage}</p>
                  
                  {localConfig.showQr && (
                     <div className="flex flex-col items-center gap-1">
                        <QrCode size={64} className="text-gray-800" />
                        <span className="text-[10px] text-gray-400">Escanea para factura digital</span>
                     </div>
                  )}
                  
                  <p className="text-[10px] text-gray-400 mt-4 uppercase">*** COPIA CLIENTE ***</p>
               </div>
            </div>

            {/* Paper Cut Effect (CSS Generated ZigZag) */}
            <div 
               className="absolute bottom-0 left-0 w-full h-4 bg-gray-200/0"
               style={{
                  height: '12px',
                  background: 'radial-gradient(circle, transparent 50%, #ffffff 50%)',
                  backgroundSize: '20px 20px',
                  backgroundPosition: '0 10px',
                  transform: 'rotate(180deg) translateY(-100%)'
               }}
            ></div>
         </div>
      </div>

    </div>
  );
};

export default ReceiptDesigner;