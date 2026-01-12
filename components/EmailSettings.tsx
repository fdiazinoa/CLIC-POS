
import React, { useState, useEffect } from 'react';
import { 
  Mail, Save, Upload, LayoutTemplate, Palette, 
  Image as ImageIcon, Eye, X 
} from 'lucide-react';
import { BusinessConfig, EmailConfig } from '../types';

interface EmailSettingsProps {
  config: BusinessConfig;
  onUpdateConfig: (newConfig: BusinessConfig) => void;
  onClose: () => void;
}

const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  subjectTemplate: '¡Gracias por tu compra en {{StoreName}}!',
  accentColor: '#3B82F6', // Blue-500
  bannerImage: '',
  customFooter: 'Síguenos en redes sociales para más ofertas.',
  showSocialLinks: true
};

const EmailSettings: React.FC<EmailSettingsProps> = ({ config, onUpdateConfig, onClose }) => {
  const [localConfig, setLocalConfig] = useState<EmailConfig>(config.emailConfig || DEFAULT_EMAIL_CONFIG);

  const handleSave = () => {
    onUpdateConfig({
      ...config,
      emailConfig: localConfig
    });
    alert("Plantilla de correo guardada.");
  };

  const handleBannerUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setLocalConfig(prev => ({ ...prev, bannerImage: reader.result as string }));
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50 animate-in fade-in">
      
      {/* Header */}
      <div className="bg-white px-8 py-6 border-b border-gray-200 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2">
             <Mail className="text-blue-500" /> Plantillas de Email
          </h1>
          <p className="text-sm text-gray-500">Personaliza los recibos digitales enviados a tus clientes.</p>
        </div>
        <div className="flex gap-3">
           <button onClick={handleSave} className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold shadow-md hover:bg-blue-700 transition-all flex items-center gap-2">
              <Save size={18} /> Guardar
           </button>
           <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
              <X size={24} />
           </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-8 flex flex-col lg:flex-row gap-8">
         
         {/* LEFT: EDITOR */}
         <div className="w-full lg:w-1/2 flex flex-col gap-6 overflow-y-auto">
            
            {/* General Settings */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
               <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <LayoutTemplate size={18} className="text-gray-400" /> Configuración General
               </h3>
               
               <div className="space-y-4">
                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Asunto del Correo</label>
                     <input 
                        type="text" 
                        value={localConfig.subjectTemplate}
                        onChange={(e) => setLocalConfig({...localConfig, subjectTemplate: e.target.value})}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Ej. Recibo de compra #{{TicketID}}"
                     />
                     <p className="text-[10px] text-gray-400 mt-1">Variables disponibles: {'{{StoreName}}'}, {'{{TicketID}}'}</p>
                  </div>

                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Mensaje Pie de Página</label>
                     <textarea 
                        value={localConfig.customFooter}
                        onChange={(e) => setLocalConfig({...localConfig, customFooter: e.target.value})}
                        rows={3}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                     />
                  </div>
               </div>
            </div>

            {/* Branding */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
               <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <Palette size={18} className="text-purple-500" /> Branding Visual
               </h3>

               <div className="space-y-6">
                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Color de Acento (Botones y Enlaces)</label>
                     <div className="flex gap-3 items-center">
                        <input 
                           type="color" 
                           value={localConfig.accentColor}
                           onChange={(e) => setLocalConfig({...localConfig, accentColor: e.target.value})}
                           className="w-12 h-12 rounded-xl border-none cursor-pointer bg-transparent"
                        />
                        <input 
                           type="text" 
                           value={localConfig.accentColor}
                           onChange={(e) => setLocalConfig({...localConfig, accentColor: e.target.value})}
                           className="w-32 p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono uppercase"
                        />
                     </div>
                  </div>

                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Banner Promocional (Inferior)</label>
                     <div className="border-2 border-dashed border-gray-300 rounded-2xl p-6 flex flex-col items-center justify-center hover:bg-gray-50 transition-colors relative cursor-pointer group">
                        {localConfig.bannerImage ? (
                           <div className="relative w-full h-32 rounded-xl overflow-hidden">
                              <img src={localConfig.bannerImage} className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                 <p className="text-white font-bold text-sm">Cambiar Imagen</p>
                              </div>
                           </div>
                        ) : (
                           <div className="text-center text-gray-400">
                              <ImageIcon size={32} className="mx-auto mb-2" />
                              <p className="text-sm font-medium">Click para subir imagen</p>
                              <p className="text-xs">Recomendado: 600x150px</p>
                           </div>
                        )}
                        <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" onChange={handleBannerUpload} />
                     </div>
                  </div>
               </div>
            </div>

         </div>

         {/* RIGHT: PREVIEW */}
         <div className="w-full lg:w-1/2 bg-gray-200 rounded-3xl flex flex-col items-center justify-center p-8 relative overflow-hidden shadow-inner">
            <div className="absolute top-4 right-4 bg-white/80 backdrop-blur px-3 py-1 rounded-full text-xs font-bold text-gray-600 border border-gray-300 flex items-center gap-1">
               <Eye size={12} /> Vista Previa
            </div>

            {/* Email Container */}
            <div className="w-full max-w-sm bg-white shadow-2xl rounded-xl overflow-hidden scale-95 lg:scale-100 transition-transform">
               {/* Email Header */}
               <div className="bg-gray-900 text-white p-6 text-center">
                  <div className="w-12 h-12 bg-white/10 rounded-full mx-auto mb-3 flex items-center justify-center text-2xl font-bold">
                     {config.companyInfo.name.charAt(0)}
                  </div>
                  <h2 className="font-bold text-lg">{config.companyInfo.name}</h2>
                  <p className="text-xs text-gray-400">Recibo de Compra</p>
               </div>

               {/* Email Body */}
               <div className="p-6">
                  <h1 className="text-xl font-bold text-gray-800 mb-2">Hola, Juan Cliente</h1>
                  <p className="text-sm text-gray-600 mb-6">Gracias por comprar con nosotros. Aquí tienes el detalle de tu transacción reciente.</p>

                  <div className="border border-gray-100 rounded-lg p-4 mb-6">
                     <div className="flex justify-between text-sm mb-2">
                        <span className="text-gray-500">Producto A x2</span>
                        <span className="font-bold">$20.00</span>
                     </div>
                     <div className="flex justify-between text-sm mb-2">
                        <span className="text-gray-500">Servicio B</span>
                        <span className="font-bold">$50.00</span>
                     </div>
                     <div className="border-t border-gray-100 my-2"></div>
                     <div className="flex justify-between font-bold text-gray-900">
                        <span>Total</span>
                        <span>$70.00</span>
                     </div>
                  </div>

                  <button 
                     className="w-full py-3 rounded-lg text-white font-bold text-sm mb-6 shadow-md"
                     style={{ backgroundColor: localConfig.accentColor }}
                  >
                     Ver Factura Completa
                  </button>

                  {localConfig.bannerImage && (
                     <div className="w-full h-24 rounded-lg overflow-hidden mb-6">
                        <img src={localConfig.bannerImage} className="w-full h-full object-cover" />
                     </div>
                  )}

                  <div className="text-center">
                     <p className="text-xs text-gray-500 mb-2">{localConfig.customFooter}</p>
                     <p className="text-[10px] text-gray-400">
                        {config.companyInfo.address} • {config.companyInfo.phone}
                     </p>
                  </div>
               </div>
            </div>

         </div>

      </div>
    </div>
  );
};

export default EmailSettings;
