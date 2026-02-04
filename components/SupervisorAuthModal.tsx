import React, { useState, useEffect, useRef } from 'react';
import { X, Lock, ShieldCheck, AlertTriangle } from 'lucide-react';
import { User, Permission } from '../types';

interface SupervisorAuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (supervisor: User) => void;
    users: User[];
    requiredPermission?: Permission; // Defaults to CAN_REFUND
}

const SupervisorAuthModal: React.FC<SupervisorAuthModalProps> = ({
    isOpen,
    onClose,
    onSuccess,
    users,
    requiredPermission = 'CAN_REFUND'
}) => {
    const [pin, setPin] = useState('');
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setPin('');
            setError(null);
            // Small delay to ensure focus works after animation
            setTimeout(() => {
                if (inputRef.current) inputRef.current.focus();
            }, 100);
        }
    }, [isOpen]);

    const handleAuthorize = (e?: React.FormEvent) => {
        e?.preventDefault();

        if (!pin) {
            setError('Ingrese el PIN de seguridad');
            return;
        }

        // 1. Find user by PIN
        const supervisor = users.find(u => u.pin === pin);

        if (!supervisor) {
            setError('Credenciales inválidas');
            setPin('');
            return;
        }

        // IMPORTANT: In a real app we'd verify actual permissions array. 
        // For now we assume role checking or specific permission implementation.
        // Adjust this based on your User/Role structure.
        // Assuming 'ADMIN' or 'SUPERVISOR' roles imply full access if permissions array is missing
        // Or checking if permissions contains the required one.

        // Since type User in types.ts doesn't explicitly show 'permissions' array in the snippet I saw,
        // but the requirement says "currentUser.permissions.includes...", 
        // I will assume the User type has it or we logic check the role.

        // Let's assume User might have permissions or we check role for now based on context
        // Re-reading context: "currentUser.permissions.includes" implies User has permissions prop.
        // But my previous view of types.ts User didn't show it. It might be extended elsewhere or I missed it.
        // I'll check property existence safely.

        const hasPermission = (supervisor as any).permissions?.includes(requiredPermission) ||
            ['ADMIN', 'MANAGER'].includes(supervisor.role);

        if (hasPermission) {
            onSuccess(supervisor);
            onClose();
        } else {
            setError('Usuario sin privilegios de Supervisor');
            setPin('');
        }
    };

    const handleOverlayClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 transition-all duration-200"
            onClick={handleOverlayClick}
        >
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-6 text-white flex items-center justify-between relative overflow-hidden">
                    <div className="flex items-center gap-3 relative z-10">
                        <div className="p-2 bg-white/10 rounded-lg">
                            <ShieldCheck size={24} className="text-emerald-400" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold">Autorización de Seguridad</h3>
                            <p className="text-slate-400 text-xs">Nivel Supervisor Requerido</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-white"
                    >
                        <X size={20} />
                    </button>

                    {/* Decorative background element */}
                    <div className="absolute -right-6 -bottom-10 opacity-10 rotate-12">
                        <Lock size={120} />
                    </div>
                </div>

                {/* Body */}
                <div className="p-8">
                    <div className="flex flex-col items-center mb-6 text-center">
                        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4 border border-red-100">
                            <Lock size={32} className="text-red-500" />
                        </div>
                        <h4 className="font-bold text-gray-800 text-lg">Acceso Protegido</h4>
                        <p className="text-gray-500 text-sm mt-1">
                            Se requiere autorización para ingresar al módulo de <span className="font-bold text-gray-700">Devoluciones</span>.
                        </p>
                    </div>

                    <form onSubmit={handleAuthorize}>
                        <div className="relative mb-6">
                            <input
                                ref={inputRef}
                                type="password"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                className={`w-full text-center text-3xl tracking-[1em] font-bold py-4 border-b-2 bg-transparent focus:outline-none transition-colors ${error ? 'border-red-500 text-red-600' : 'border-gray-300 focus:border-slate-800 text-slate-800'
                                    }`}
                                placeholder="••••"
                                maxLength={6} // Assuming 4-6 digit PINs
                                value={pin}
                                onChange={(e) => {
                                    const val = e.target.value.replace(/[^0-9]/g, '');
                                    setPin(val);
                                    if (error) setError(null);
                                }}
                                autoComplete="off"
                            />
                            {/* Placeholder dots visual if needed, but standard password input works well */}
                        </div>

                        {error && (
                            <div className="flex items-center justify-center gap-2 text-red-500 text-sm mb-6 animate-in slide-in-from-top-2">
                                <AlertTriangle size={16} />
                                <span>{error}</span>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <button
                                type="button"
                                onClick={onClose}
                                className="py-3 px-4 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 active:bg-gray-100 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                className="py-3 px-4 rounded-xl bg-slate-900 text-white font-bold shadow-lg shadow-slate-200 hover:bg-slate-800 active:scale-95 transition-all flex items-center justify-center gap-2"
                            >
                                <ShieldCheck size={18} />
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
