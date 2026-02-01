import React, { useState, useEffect } from 'react';
import { Mail, Save, RefreshCw, CheckCircle2, AlertTriangle, Lock, Key, ArrowLeft } from 'lucide-react';
import { EmailConfig } from '../types';

interface EmailSettingsProps {
   onSave: (config: EmailConfig) => void;
   onBack: () => void;
}

const EmailSettings: React.FC<EmailSettingsProps> = ({ onSave, onBack }) => {
   const [config, setConfig] = useState<EmailConfig>({
      provider: 'resend',
      apiKey: '',
      from: 'onboarding@resend.dev'
   });

   const [isTesting, setIsTesting] = useState(false);
   const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

   useEffect(() => {
      // Load config from backend
      fetch('/smtp/config')
         .then(res => res.json())
         .then(data => {
            if (data.apiKey) setConfig(data);
         })
         .catch(err => console.error('Error loading email config:', err));
   }, []);

   const handleChange = (field: keyof EmailConfig, value: string) => {
      setConfig(prev => ({ ...prev, [field]: value }));
   };

   const handleSave = () => {
      onSave(config);

      // Save to backend
      fetch('/smtp/config', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(config)
      })
         .then(res => res.json())
         .then(() => alert('Configuración guardada'))
         .catch(err => alert('Error al guardar: ' + err.message));
   };

   const handleTest = async () => {
      setIsTesting(true);
      setTestResult(null);

      try {
         const res = await fetch('/smtp/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
         });
         const data = await res.json();
         console.log('Email test response:', data);

         if (data.success) {
            setTestResult({ success: true, message: 'Conexión exitosa. Email de prueba enviado.' });
         } else {
            setTestResult({ success: false, message: 'Error: ' + (data.message || JSON.stringify(data)) });
         }
      } catch (error: any) {
         setTestResult({ success: false, message: 'Error de red: ' + (error.message || String(error)) });
      } finally {
         setIsTesting(false);
      }
   };

   return (
      <div className="h-full flex flex-col bg-gray-50 animate-in fade-in duration-300">
         {/* Header */}
         <div className="bg-white border-b border-gray-200 p-6 flex justify-between items-center">
            <div className="flex items-center gap-4">
               <button
                  onClick={onBack}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
               >
                  <ArrowLeft size={24} className="text-gray-600" />
               </button>
               <div>
                  <h2 className="text-2xl font-black text-gray-800 flex items-center gap-2">
                     <Mail className="text-blue-600" /> Configuración de Email (Resend)
                  </h2>
                  <p className="text-sm text-gray-500">Usa Resend.com para enviar correos de forma fiable y sencilla.</p>
               </div>
            </div>
         </div>

         {/* Content */}
         <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full space-y-6">

            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-6">
               <h3 className="font-bold text-gray-800 text-lg border-b border-gray-100 pb-2">Credenciales de Resend</h3>

               <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2 flex items-center gap-2">
                     <Key size={14} /> API Key
                  </label>
                  <div className="relative">
                     <input
                        type="password"
                        value={config.apiKey}
                        onChange={(e) => handleChange('apiKey', e.target.value)}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="re_123456789..."
                     />
                     <Lock size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">Obtén tu API Key en <a href="https://resend.com/api-keys" target="_blank" className="text-blue-500 underline">resend.com</a></p>
               </div>

               <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Remitente (From)</label>
                  <input
                     type="text"
                     value={config.from}
                     onChange={(e) => handleChange('from', e.target.value)}
                     className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500"
                     placeholder="onboarding@resend.dev"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">Si no tienes dominio propio, usa <code>onboarding@resend.dev</code> (solo envía a tu propio email de registro).</p>
               </div>

               <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Email Destinatario por Defecto</label>
                  <input
                     type="email"
                     value={config.defaultRecipient || ''}
                     onChange={(e) => handleChange('defaultRecipient', e.target.value)}
                     className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500"
                     placeholder="admin@tuempresa.com"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">Este correo recibirá los Reportes Z si no se especifica uno por terminal.</p>
               </div>
            </div>

            {/* Actions */}
            <div className="mt-8 flex items-center justify-end gap-4">
               {testResult && (
                  <div className={`flex items-center gap-2 text-sm font-bold px-4 py-2 rounded-lg animate-in fade-in ${testResult.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                     {testResult.success ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
                     {testResult.message}
                  </div>
               )}

               <button
                  onClick={handleTest}
                  disabled={isTesting || !config.apiKey}
                  className="px-6 py-3 bg-white border border-gray-300 text-gray-700 rounded-xl font-bold hover:bg-gray-50 transition-all flex items-center gap-2 disabled:opacity-50"
               >
                  {isTesting ? <RefreshCw size={20} className="animate-spin" /> : <RefreshCw size={20} />}
                  Probar Conexión
               </button>

               <button
                  onClick={handleSave}
                  className="px-8 py-3 bg-gray-900 text-white rounded-xl font-bold shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
               >
                  <Save size={20} />
                  Guardar Configuración
               </button>
            </div>

         </div>
      </div>
   );
};

export default EmailSettings;
