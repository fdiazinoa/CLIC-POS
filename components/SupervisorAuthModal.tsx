import React, { useState, useEffect, useRef } from 'react';
import { X, Lock, ShieldCheck, AlertTriangle } from 'lucide-react';
import { User, Permission, RoleDefinition } from '../types';

/** Datos mostrados al autorizar venta a crédito / Pendiente. */
export interface CreditSupervisorSummary {
   currencySymbol: string;
   customerName: string;
   limit: number;
   currentDebt: number;
   /** Total a crédito en este ticket (líneas Pendiente/Crédito). */
   creditOnTicket: number;
   /** Deuda actual + crédito del ticket. */
   projected: number;
   reason: 'NO_LIMIT' | 'OVER_LIMIT';
}

interface SupervisorAuthModalProps {
   isOpen: boolean;
   onClose: () => void;
   onSuccess: (supervisor: User) => void;
   users: User[];
   requiredPermission?: Permission;
   roles?: RoleDefinition[];
   /** Título del encabezado (opcional). */
   title?: string;
   /** Texto bajo el título. */
   description?: string;
   /** Si viene, muestra resumen compacto y exige marcar confirmación antes de autorizar. */
   creditSummary?: CreditSupervisorSummary | null;
}

const supervisorHasPermission = (
   supervisor: User,
   perm: Permission,
   roles?: RoleDefinition[]
): boolean => {
   if (roles?.length) {
      const role = roles.find(r => r.id === supervisor.roleId || r.id === supervisor.role);
      const perms = role?.permissions || [];
      if (perms.includes('ALL') || perms.includes(perm)) return true;
   }
   const direct = (supervisor as { permissions?: Permission[] }).permissions;
   if (direct?.includes('ALL') || direct?.includes(perm)) return true;
   const rid = (supervisor.roleId || supervisor.role || '').toString().toUpperCase();
   if (['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(supervisor.role || '') ||
       rid.includes('ADMIN') || rid.includes('GERENTE')) {
      return true;
   }
   return false;
};

const SupervisorAuthModal: React.FC<SupervisorAuthModalProps> = ({
   isOpen,
   onClose,
   onSuccess,
   users,
   requiredPermission = 'CAN_REFUND',
   roles,
   title,
   description,
   creditSummary
}) => {
   const [pin, setPin] = useState('');
   const [error, setError] = useState<string | null>(null);
   const [acknowledge, setAcknowledge] = useState(false);
   const inputRef = useRef<HTMLInputElement>(null);

   const isCreditFlow = Boolean(creditSummary);
   const headerTitle = title ?? (isCreditFlow ? 'Autorizar venta a crédito' : 'Autorización de Seguridad');
   const headerSubtitle = description ?? (
      isCreditFlow
         ? 'Supervisor o administrador (PIN)'
         : 'Nivel supervisor requerido'
   );
   const bodyHint = isCreditFlow
      ? 'Revise el cupo y el pendiente antes de autorizar.'
      : `Se requiere autorización para ingresar al módulo de ${requiredPermission === 'CAN_REFUND' ? 'Devoluciones' : 'esta acción'}.`;

   useEffect(() => {
      if (isOpen) {
         setPin('');
         setError(null);
         setAcknowledge(false);
         setTimeout(() => {
            inputRef.current?.focus();
         }, 100);
      }
   }, [isOpen]);

   const handleAuthorize = (e?: React.FormEvent) => {
      e?.preventDefault();

      if (isCreditFlow && !acknowledge) {
         setError('Marque la casilla de confirmación para continuar');
         return;
      }

      if (!pin) {
         setError('Ingrese el PIN de seguridad');
         return;
      }

      const supervisor = users.find(u => u.pin === pin);

      if (!supervisor) {
         setError('Credenciales inválidas');
         setPin('');
         return;
      }

      if (!supervisorHasPermission(supervisor, requiredPermission, roles)) {
         setError('Usuario sin permiso para esta autorización');
         setPin('');
         return;
      }

      onSuccess(supervisor);
      onClose();
   };

   const handleOverlayClick = (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
         onClose();
      }
   };

   if (!isOpen) return null;

   const fmt = (n: number) =>
      `${creditSummary?.currencySymbol ?? ''}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

   return (
      <div
         className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 transition-all duration-200"
         onClick={handleOverlayClick}
      >
         <div
            className={`bg-white rounded-xl shadow-2xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${
               isCreditFlow ? 'max-w-sm' : 'max-w-md'
            }`}
         >
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-4 text-white flex items-center justify-between relative overflow-hidden">
               <div className="flex items-center gap-2 relative z-10 min-w-0">
                  <div className="p-1.5 bg-white/10 rounded-lg shrink-0">
                     <ShieldCheck size={20} className="text-emerald-400" />
                  </div>
                  <div className="min-w-0">
                     <h3 className="text-sm font-bold leading-tight truncate">{headerTitle}</h3>
                     <p className="text-slate-400 text-[10px] mt-0.5">{headerSubtitle}</p>
                  </div>
               </div>
               <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-white shrink-0"
               >
                  <X size={18} />
               </button>
               <div className="absolute -right-6 -bottom-10 opacity-10 rotate-12 pointer-events-none">
                  <Lock size={100} />
               </div>
            </div>

            <div className={isCreditFlow ? 'p-4' : 'p-8'}>
               {creditSummary && (
                  <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-[11px] space-y-1.5">
                     <p className="font-black text-amber-900 uppercase tracking-wide text-[9px]">
                        {creditSummary.reason === 'NO_LIMIT' ? 'Sin cupo configurado' : 'Límite de crédito excedido'}
                     </p>
                     <p className="text-amber-800/90 truncate font-bold" title={creditSummary.customerName}>
                        Cliente: {creditSummary.customerName}
                     </p>
                     <div className="grid grid-cols-1 gap-1 text-amber-950 font-mono text-[10px]">
                        <div className="flex justify-between gap-2">
                           <span className="text-amber-700 font-sans font-bold">Cupo autorizado</span>
                           <span>
                              {creditSummary.limit > 0 ? fmt(creditSummary.limit) : '— (sin definir)'}
                           </span>
                        </div>
                        <div className="flex justify-between gap-2">
                           <span className="text-amber-700 font-sans font-bold">Deuda actual</span>
                           <span>{fmt(creditSummary.currentDebt)}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                           <span className="text-amber-700 font-sans font-bold">Pendiente en ticket</span>
                           <span className="font-black">{fmt(creditSummary.creditOnTicket)}</span>
                        </div>
                        <div className="flex justify-between gap-2 border-t border-amber-200/80 pt-1 mt-0.5">
                           <span className="text-amber-800 font-sans font-black">Proyectado CxC</span>
                           <span className="font-black">{fmt(creditSummary.projected)}</span>
                        </div>
                     </div>
                     <label className="flex items-start gap-2 mt-3 cursor-pointer select-none">
                        <input
                           type="checkbox"
                           checked={acknowledge}
                           onChange={(e) => {
                              setAcknowledge(e.target.checked);
                              if (error === 'Marque la casilla de confirmación para continuar') setError(null);
                           }}
                           className="mt-0.5 rounded border-amber-300 text-amber-700 focus:ring-amber-500"
                        />
                        <span className="text-[10px] font-bold text-amber-950 leading-snug">
                           Confirmo revisar cupo y pendiente; autorizo cobro como supervisor o administrador.
                        </span>
                     </label>
                  </div>
               )}

               {!creditSummary && (
                  <div className="flex flex-col items-center mb-6 text-center">
                     <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4 border border-red-100">
                        <Lock size={32} className="text-red-500" />
                     </div>
                     <h4 className="font-bold text-gray-800 text-lg">Acceso Protegido</h4>
                     <p className="text-gray-500 text-sm mt-1">{bodyHint}</p>
                  </div>
               )}

               {creditSummary && (
                  <p className="text-[10px] text-gray-500 text-center mb-3 font-medium">{bodyHint}</p>
               )}

               <form onSubmit={handleAuthorize}>
                  <div className="relative mb-4">
                     <input
                        ref={inputRef}
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        className={`w-full text-center text-2xl tracking-[0.35em] font-bold py-3 border-b-2 bg-transparent focus:outline-none transition-colors ${
                           error ? 'border-red-500 text-red-600' : 'border-gray-300 focus:border-slate-800 text-slate-800'
                        }`}
                        placeholder="••••"
                        maxLength={6}
                        value={pin}
                        onChange={(e) => {
                           const val = e.target.value.replace(/[^0-9]/g, '');
                           setPin(val);
                           if (error) setError(null);
                        }}
                        autoComplete="off"
                     />
                  </div>

                  {error && (
                     <div className="flex items-center justify-center gap-2 text-red-500 text-xs mb-4 animate-in slide-in-from-top-2">
                        <AlertTriangle size={14} />
                        <span>{error}</span>
                     </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                     <button
                        type="button"
                        onClick={onClose}
                        className="py-2.5 px-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-bold hover:bg-gray-50 active:bg-gray-100 transition-colors"
                     >
                        Cancelar
                     </button>
                     <button
                        type="submit"
                        disabled={isCreditFlow && !acknowledge}
                        className="py-2.5 px-3 rounded-xl bg-slate-900 text-white text-sm font-bold shadow-lg shadow-slate-200 hover:bg-slate-800 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
                     >
                        <ShieldCheck size={16} />
                        Autorizar
                     </button>
                  </div>
               </form>
            </div>
         </div>
      </div>
   );
};

export default SupervisorAuthModal;
