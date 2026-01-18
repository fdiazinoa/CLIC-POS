
import React, { useState, useEffect } from 'react';
import { 
  Receipt, Upload, Type, LayoutTemplate, QrCode, 
  ToggleLeft, ToggleRight, Trash2, Save, MapPin, Phone, Hash
} from 'lucide-react';
import { BusinessConfig, ReceiptConfig, CompanyInfo } from '../types';

interface ReceiptDesignerProps {
  config: BusinessConfig;
  onUpdateConfig: (newConfig: BusinessConfig) => void;
}

const PREVIEW_ITEMS = [
  { 
    name: 'Pollo Fresco (Peso)', 
    qty: 2.450, 
    unit: 'kg', 
    price: 3.50, 
    total: 8.58, 
    isWeight: true, 
    discount: 0.50,
    tax: 1.54,
    variant: 'Marinado Especial',
    seller: 'Ana P.',
    note: 'Entregar troceado',
    img: 'https://images.unsplash.com/photo-1587593810167-a84920ea0781?q=80&w=50&auto=format&fit=crop' 
  },
  { 
    name: 'Coca Cola 500ml', 
    qty: 2, 
    unit: 'un', 
    price: 2.50, 
    total: 5.00, 
    isWeight: false, 
    discount: 0,
    tax: 0.90,
    seller: 'Ana P.',
    img: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?q=80&w=50&auto=format&fit=crop' 
  },
];

const ReceiptDesigner: React.FC<ReceiptDesignerProps> = ({ config, onUpdateConfig }) => {
  // Estado local para Empresa (para no guardar cambios parciales accidentalmente)
  const [localCompany, setLocalCompany] = useState<CompanyInfo>({
    ...config.companyInfo
  });

  // Estado local para Configuración de Ticket
  const [localReceipt, setLocalReceipt] = useState<ReceiptConfig>({
    logo: config.receiptConfig?.logo || '',
    footerMessage: config.receiptConfig?.footerMessage || '¡Gracias por su compra!\nVuelva pronto.',
    showCustomerInfo: config.receiptConfig?.showCustomerInfo ?? true,
    showSavings: config.receiptConfig?.showSavings ?? false,
    showQr: config.receiptConfig?.showQr ?? true,
    showForeignCurrencyTotals: config.receiptConfig?.showForeignCurrencyTotals ?? false,
  });

  const [isSaving, setIsSaving] = useState(false);

  const mockSubtotal = 13.58;
  const mockDiscount = 0.50;
  const mockTax = 2.44;
  const mockTotal = 15.52;

  // FUNCIÓN PRINCIPAL DE GUARDADO
  const handleSave = () => {
    setIsSaving(true);
    
    // Unificamos toda la configuración nueva
    const finalConfig: BusinessConfig = {
      ...config,
      companyInfo: localCompany,
      receiptConfig: localReceipt
    };

    // Simulamos un delay para feedback visual
    setTimeout(() => {
      onUpdateConfig(finalConfig);
      setIsSaving(false);
      alert("Configuración de ticket y empresa guardada exitosamente.");
    }, 600);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setLocalReceipt(prev => ({ ...prev, logo: reader.result as string }));
      reader.readAsDataURL(file);
    }
  };

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
              Datos de Empresa & Logo
           </h2>
           
           <div className="flex gap-4 mb-6">
              <div className="w-24 h-24 rounded-xl bg-gray-50 border-2 border-dashed border-gray-300 flex items-center justify-center relative overflow-hidden group cursor-pointer">
                 {localReceipt.logo ? (
                    <img src={localReceipt.logo} alt="Logo" className="w-full h-full object-contain" />
                 ) : (
                    <Upload className="text-gray-400" size={24} />
                 )}
                 <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" onChange={handleLogoUpload} />
                 {localReceipt.logo && (
                    <div 
                      onClick={(e) => { e.stopPropagation(); setLocalReceipt(prev => ({...prev, logo: ''})); }}
                      className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                       <Trash2 className="text-white" size={20} />
                    </div>
                 )}
              </div>
              <div className="flex-1 space-y-2">
                 <p className="text-xs text-gray-500 font-medium">Sube el logo de tu negocio para el encabezado del ticket.</p>
                 <div className="p-3 bg-blue-50 text-blue-800 text-[10px] rounded-lg font-bold uppercase tracking-wider">
                    Sugerencia: Blanco y negro (Grayscale)
                 </div>
              </div>
           </div>

           <div className="space-y-4">
              <div>
                 <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 ml-1">Nombre Comercial</label>
                 <input 
                    type="text" 
                    value={localCompany.name} 
                    onChange={e => setLocalCompany({...localCompany, name: e.target.value})}
                    className="w-full p-3 border border-gray-200 rounded-xl text-sm font-bold bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all" 
                 />
              </div>
              <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 ml-1">RNC / Cédula</label>
                    <input 
                       type="text" 
                       value={localCompany.rnc} 
                       onChange={e => setLocalCompany({...localCompany, rnc: e.target.value})}
                       className="w-full p-3 border border-gray-200 rounded-xl text-sm font-mono bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all" 
                    />
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 ml-1">Teléfono</label>
                    <input 
                       type="text" 
                       value={localCompany.phone} 
                       onChange={e => setLocalCompany({...localCompany, phone: e.target.value})}
                       className="w-full p-3 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all" 
                    />
                 </div>
              </div>
              <div>
                 <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 ml-1">Dirección Física</label>
                 <input 
                    type="text" 
                    value={localCompany.address} 
                    onChange={e => setLocalCompany({...localCompany, address: e.target.value})}
                    className="w-full p-3 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all" 
                 />
              </div>
           </div>
        </div>

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
           <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <Type size={20} className="text-purple-500" />
              Contenido Opcional
           </h2>
           
           <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              <ToggleSwitch label="Datos del Cliente" checked={localReceipt.showCustomerInfo || false} onChange={v => setLocalReceipt(prev => ({...prev, showCustomerInfo: v}))} />
              <ToggleSwitch label="Ahorro Total" checked={localReceipt.showSavings || false} onChange={v => setLocalReceipt(prev => ({...prev, showSavings: v}))} />
              <ToggleSwitch label="Otras Monedas" checked={localReceipt.showForeignCurrencyTotals || false} onChange={v => setLocalReceipt(prev => ({...prev, showForeignCurrencyTotals: v}))} />
              <ToggleSwitch label="Código QR Factura" checked={localReceipt.showQr || false} onChange={v => setLocalReceipt(prev => ({...prev, showQr: v}))} />
           </div>

           <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Mensaje en Pie de Ticket</label>
              <textarea 
                 rows={3}
                 value={localReceipt.footerMessage}
                 onChange={(e) => setLocalReceipt(prev => ({...prev, footerMessage: e.target.value}))}
                 className="w-full p-4 border border-gray-200 rounded-2xl text-sm focus:ring-4 focus:ring-purple-50 outline-none resize-none bg-gray-50 transition-all"
                 placeholder="Ej. Gracias por su visita."
              />
           </div>
        </div>

        <button 
           onClick={handleSave}
           disabled={isSaving}
           className={`w-full py-5 rounded-2xl font-black text-lg shadow-xl transition-all flex items-center justify-center gap-3 ${isSaving ? 'bg-gray-400 cursor-not-allowed' : 'bg-slate-900 text-white hover:bg-black active:scale-[0.98]'}`}
        >
           {isSaving ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <Save size={24} />}
           {isSaving ? 'Guardando...' : 'Guardar Cambios'}
        </button>

      </div>

      {/* RIGHT: PREVIEW */}
      <div className="w-full lg:w-1/2 bg-slate-200 rounded-[2.5rem] border-2 border-slate-300/50 flex items-start justify-center p-8 overflow-y-auto shadow-inner">
         <div className="w-[380px] bg-white shadow-2xl relative shrink-0">
            <div className="p-6 pb-12 font-mono text-gray-800 text-sm leading-tight">
               
               {/* Header Preview */}
               <div className="text-center mb-4">
                  {localReceipt.logo && (
                     <img src={localReceipt.logo} alt="Logo" className="h-12 mx-auto mb-2 grayscale object-contain" />
                  )}
                  <h1 className="font-bold text-lg uppercase leading-none mb-1">{localCompany.name}</h1>
                  <p className="text-[10px] text-gray-700">RNC: {localCompany.rnc}</p>
                  <p className="text-[10px] text-gray-700">{localCompany.address}</p>
                  <p className="text-[10px] text-gray-700">TEL: {localCompany.phone}</p>

                  <div className="mt-4 pt-4 border-t border-dashed border-gray-300 space-y-1">
                     <p className="text-[12px] font-black uppercase">Factura de Crédito Fiscal</p>
                     <p className="text-[11px] font-mono font-bold">NCF: B0100000001</p>
                     <p className="text-[11px] font-mono font-bold">Ticket No.: 000452</p>
                  </div>
               </div>

               {/* Line Items */}
               <div className="border-y-2 border-dashed border-gray-200 py-3 mb-4 space-y-4">
                  {PREVIEW_ITEMS.map((item, idx) => (
                    <div key={idx} className="space-y-0.5">
                       <div className="flex justify-between font-bold">
                          <span>{item.name}</span>
                          <span>{config.currencySymbol}{item.total.toFixed(2)}</span>
                       </div>
                       
                       <div className="text-[10px] flex gap-2">
                          <span>{item.qty} x {item.price.toFixed(2)}</span>
                          {item.discount > 0 && <span>(DESC: -{config.currencySymbol}{item.discount.toFixed(2)})</span>}
                       </div>

                       <div className="text-[10px] text-gray-500">
                          ITBIS Aplicado: {config.currencySymbol}{item.tax.toFixed(2)}
                       </div>

                       {item.variant && (
                          <div className="text-[10px] italic">
                             Opciones: {item.variant}
                          </div>
                       )}

                       <div className="text-[10px]">
                          Vendedor: {item.seller}
                       </div>
                    </div>
                  ))}
               </div>

               {/* Totals Block */}
               <div className="space-y-1 mb-4">
                  <div className="flex justify-between text-xs">
                     <span>SUBTOTAL</span>
                     <span>{config.currencySymbol}{mockSubtotal.toFixed(2)}</span>
                  </div>
                  {mockDiscount > 0 && (
                     <div className="flex justify-between text-xs">
                        <span>DESCUENTO TOTAL</span>
                        <span>-{config.currencySymbol}{mockDiscount.toFixed(2)}</span>
                     </div>
                  )}
                  <div className="flex justify-between text-xs">
                     <span>TOTAL IMPUESTOS</span>
                     <span>{config.currencySymbol}{mockTax.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-black border-t-2 border-slate-900 mt-2 pt-2">
                     <span>TOTAL</span>
                     <span>{config.currencySymbol}{mockTotal.toFixed(2)}</span>
                  </div>

                  {/* FEATURE: Otras Monedas */}
                  {localReceipt.showForeignCurrencyTotals && (
                    <div className="mt-4 pt-2 border-t border-dotted border-gray-300 space-y-1">
                      <p className="text-[9px] text-gray-500 font-bold uppercase tracking-tighter">Equivalente en Divisas</p>
                      {config.currencies.filter(c => !c.isBase).map(c => (
                        <div key={c.code} className="flex justify-between text-[11px] font-bold">
                           <span>TOTAL {c.code} (Tasa: {c.rate.toFixed(2)})</span>
                           <span>{c.symbol}{(mockTotal / (c.rate || 1)).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* FEATURE: Ahorro Total */}
                  {localReceipt.showSavings && mockDiscount > 0 && (
                    <div className="mt-4 p-2 border-2 border-dashed border-slate-800 text-center bg-slate-50">
                       <p className="text-[10px] font-black uppercase leading-none mb-1">¡Usted ha ahorrado!</p>
                       <p className="text-sm font-black">{config.currencySymbol}{mockDiscount.toFixed(2)}</p>
                    </div>
                  )}
               </div>

               {/* Footer */}
               <div className="text-center space-y-4 pt-4 border-t border-dashed border-gray-200">
                  <p className="text-[10px] whitespace-pre-wrap">{localReceipt.footerMessage}</p>
                  {localReceipt.showQr && (
                    <div className="flex flex-col items-center gap-1">
                      <QrCode size={48} className="text-slate-800" />
                      <span className="text-[8px] font-bold uppercase">e-Factura Validada</span>
                    </div>
                  )}
               </div>
            </div>
         </div>
      </div>

    </div>
  );
};

export default ReceiptDesigner;
