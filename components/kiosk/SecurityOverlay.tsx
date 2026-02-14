import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ShieldAlert, ShieldCheck, Lock, RefreshCw, Trash2, CheckCircle2, Delete } from 'lucide-react';
import { SecurityLockReason } from '../../hooks/useKioskSecurity';

interface SecurityOverlayProps {
  isOpen: boolean;
  lockReason: SecurityLockReason | null;
  lockMessage: string;
  conflictProductName?: string | null;
  expectedWeightKg?: number;
  sensorWeightKg?: number;
  canRemoveItem?: boolean;
  supervisorAuthorized?: boolean;
  onValidateSupervisorPin: (pin: string) => boolean;
  onApproveTransaction: () => void;
  onRemoveConflictItem: () => void;
  onResetCart: () => void;
}

const SecurityOverlay: React.FC<SecurityOverlayProps> = ({
  isOpen,
  lockReason,
  lockMessage,
  conflictProductName,
  expectedWeightKg,
  sensorWeightKg,
  canRemoveItem = false,
  supervisorAuthorized = false,
  onValidateSupervisorPin,
  onApproveTransaction,
  onRemoveConflictItem,
  onResetCart
}) => {
  const [showPinPad, setShowPinPad] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [localAuthorized, setLocalAuthorized] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setShowPinPad(false);
      setPin('');
      setPinError('');
      setLocalAuthorized(false);
      return;
    }

    if (!supervisorAuthorized) {
      setPin('');
      setPinError('');
      setLocalAuthorized(false);
    }
  }, [isOpen, supervisorAuthorized]);

  const isSupervisorGranted = supervisorAuthorized || localAuthorized;

  const theme = useMemo(() => {
    if (lockReason === 'SCALE_DISCREPANCY') {
      return {
        panel: 'bg-red-50 border-red-200',
        title: 'text-red-800',
        text: 'text-red-700',
        accent: 'bg-red-600 hover:bg-red-500',
        icon: 'text-red-600',
        overlay: 'bg-red-950/65'
      };
    }

    return {
      panel: 'bg-amber-50 border-amber-200',
      title: 'text-amber-900',
      text: 'text-amber-800',
      accent: 'bg-amber-600 hover:bg-amber-500',
      icon: 'text-amber-600',
      overlay: 'bg-black/65'
    };
  }, [lockReason]);

  if (!isOpen) return null;

  const appendPin = (digit: string) => {
    if (pin.length >= 6) return;
    setPin(prev => `${prev}${digit}`);
    setPinError('');
  };

  const handleValidatePin = () => {
    const ok = onValidateSupervisorPin(pin);
    if (ok) {
      setLocalAuthorized(true);
      setShowPinPad(false);
      setPin('');
      setPinError('');
      return;
    }

    setPinError('PIN inválido');
  };

  return (
    <div className={`fixed inset-0 z-[140] ${theme.overlay} backdrop-blur-sm flex items-center justify-center p-6`}>
      <div className={`w-full max-w-2xl rounded-3xl border-2 shadow-2xl ${theme.panel} relative overflow-hidden`}>
        <div
          className="absolute top-0 left-0 w-24 h-24 opacity-0"
          onClick={() => setShowPinPad(true)}
          aria-hidden="true"
        />

        <div className="p-8 text-center">
          <div className="mx-auto w-24 h-24 rounded-full bg-white/70 flex items-center justify-center mb-6 shadow-sm">
            {lockReason === 'SCALE_DISCREPANCY' ? (
              <ShieldAlert size={50} className={theme.icon} />
            ) : (
              <AlertTriangle size={50} className={theme.icon} />
            )}
          </div>

          <h2 className={`text-4xl font-black mb-3 ${theme.title}`}>Validación de Seguridad</h2>
          <p className={`text-xl font-semibold ${theme.text}`}>
            Un asistente de tienda está en camino para verificar su compra.
          </p>

          {lockMessage && (
            <p className="mt-4 text-base text-slate-700 bg-white/70 rounded-xl px-4 py-3 border border-white">
              {lockMessage}
            </p>
          )}

          {lockReason === 'SCALE_DISCREPANCY' && (
            <div className="mt-4 grid grid-cols-2 gap-3 text-left">
              <div className="bg-white/80 rounded-xl border border-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500 font-bold">Peso Esperado</p>
                <p className="text-2xl font-black text-slate-800">{(expectedWeightKg || 0).toFixed(3)} kg</p>
              </div>
              <div className="bg-white/80 rounded-xl border border-white p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500 font-bold">Peso Sensor</p>
                <p className="text-2xl font-black text-slate-800">{(sensorWeightKg || 0).toFixed(3)} kg</p>
              </div>
            </div>
          )}

          {conflictProductName && (
            <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/80 border border-white text-sm font-bold text-slate-700">
              <Lock size={16} />
              Artículo observado: {conflictProductName}
            </div>
          )}

          {!isSupervisorGranted ? (
            <div className="mt-8 text-sm text-slate-500">
              Esperando autorización de supervisor...
            </div>
          ) : (
            <div className="mt-8 space-y-3">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-100 text-emerald-700 font-black text-sm">
                <ShieldCheck size={16} />
                Supervisor autenticado
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <button
                  onClick={onApproveTransaction}
                  className="min-h-[58px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black flex items-center justify-center gap-2"
                >
                  <CheckCircle2 size={18} />
                  Aprobar transacción
                </button>

                <button
                  onClick={onRemoveConflictItem}
                  disabled={!canRemoveItem}
                  className="min-h-[58px] rounded-xl bg-amber-600 hover:bg-amber-500 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-black flex items-center justify-center gap-2"
                >
                  <Trash2 size={18} />
                  Eliminar artículo
                </button>

                <button
                  onClick={onResetCart}
                  className="min-h-[58px] rounded-xl bg-red-600 hover:bg-red-500 text-white font-black flex items-center justify-center gap-2"
                >
                  <RefreshCw size={18} />
                  Reiniciar carrito
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showPinPad && !isSupervisorGranted && (
        <div className="fixed inset-0 z-[150] bg-black/50 flex items-end md:items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl p-5 animate-in fade-in slide-in-from-bottom-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-black text-slate-800">Acceso Supervisor</h3>
              <button
                onClick={() => setShowPinPad(false)}
                className="w-9 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
              >
                <Delete size={16} />
              </button>
            </div>

            <div className="h-14 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center tracking-[0.5rem] font-black text-2xl text-slate-800 mb-2">
              {pin.replace(/./g, '•')}
            </div>
            {pinError && <p className="text-sm text-red-600 font-bold mb-2">{pinError}</p>}

            <div className="grid grid-cols-3 gap-2 mt-3">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                <button
                  key={num}
                  onClick={() => appendPin(String(num))}
                  className="min-h-[56px] rounded-xl bg-slate-100 hover:bg-slate-200 font-black text-slate-800"
                >
                  {num}
                </button>
              ))}
              <button
                onClick={() => setPin('')}
                className="min-h-[56px] rounded-xl bg-slate-100 hover:bg-slate-200 font-black text-slate-600"
              >
                Limpiar
              </button>
              <button
                onClick={() => appendPin('0')}
                className="min-h-[56px] rounded-xl bg-slate-100 hover:bg-slate-200 font-black text-slate-800"
              >
                0
              </button>
              <button
                onClick={() => setPin(prev => prev.slice(0, -1))}
                className="min-h-[56px] rounded-xl bg-slate-100 hover:bg-slate-200 font-black text-slate-600"
              >
                Borrar
              </button>
            </div>

            <button
              onClick={handleValidatePin}
              disabled={pin.length < 4}
              className={`w-full min-h-[56px] mt-3 rounded-xl text-white font-black disabled:bg-slate-300 disabled:cursor-not-allowed ${theme.accent}`}
            >
              Validar PIN
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SecurityOverlay;
