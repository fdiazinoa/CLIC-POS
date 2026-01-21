import React, { useState } from 'react';
import { ShieldCheck, X, Delete, Lock } from 'lucide-react';
import { User, BusinessConfig, Permission, RoleDefinition } from '../types';

interface SupervisorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAuthorize: (user: User) => void;
    requiredPermission: Permission;
    actionDescription: string;
    config: BusinessConfig;
    roles: RoleDefinition[];
    users: User[];
}

const SupervisorModal: React.FC<SupervisorModalProps> = ({
    isOpen,
    onClose,
    onAuthorize,
    requiredPermission,
    actionDescription,
    config,
    roles,
    users
}) => {
    const [pin, setPin] = useState('');
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleNumberClick = (num: string) => {
        if (pin.length < 4) {
            setPin(prev => prev + num);
            setError(null);
        }
    };

    const handleDelete = () => {
        setPin(prev => prev.slice(0, -1));
        setError(null);
    };

    const handleAuthorize = () => {
        // 1. Find user by PIN
        const user = users.find(u => u.pin === pin);

        if (!user) {
            setError('PIN incorrecto');
            setPin('');
            return;
        }

        // 2. Check Permissions
        // Find the role definition for this user
        const role = roles?.find(r => r.id === user.roleId);

        // Fallback for legacy users without roleId (check role name)
        const effectiveRole = role || roles?.find(r => r.id === user.role);

        if (!effectiveRole) {
            setError('Usuario sin rol asignado');
            setPin('');
            return;
        }

        // Check if role has the required permission or is Admin (ALL)
        const hasPermission = (effectiveRole.permissions as string[]).includes('ALL') || effectiveRole.permissions.includes(requiredPermission);

        if (hasPermission) {
            onAuthorize(user);
            setPin('');
            setError(null);
        } else {
            setError('Permisos insuficientes');
            setPin('');
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="bg-slate-900 p-6 text-center relative">
                    <div className="mx-auto w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-4 border-4 border-slate-700 shadow-lg">
                        <Lock size={32} className="text-red-500" />
                    </div>
                    <h3 className="text-xl font-black text-white mb-1">Autorización Requerida</h3>
                    <p className="text-slate-400 text-sm font-medium">{actionDescription}</p>

                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 bg-slate-50">
                    {/* PIN Display */}
                    <div className="mb-6 flex justify-center gap-4">
                        {[0, 1, 2, 3].map(i => (
                            <div key={i} className={`w-4 h-4 rounded-full transition-all duration-300 ${i < pin.length ? 'bg-slate-800 scale-110' : 'bg-slate-300'}`} />
                        ))}
                    </div>

                    {error && (
                        <div className="mb-4 text-center text-xs font-bold text-red-500 bg-red-50 py-2 rounded-lg animate-in shake">
                            {error}
                        </div>
                    )}

                    {/* Keypad */}
                    <div className="grid grid-cols-3 gap-3">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                            <button
                                key={num}
                                onClick={() => handleNumberClick(num.toString())}
                                className="h-16 rounded-xl bg-white shadow-sm border-b-4 border-slate-200 active:border-b-0 active:translate-y-1 transition-all text-2xl font-black text-slate-700 hover:bg-slate-50"
                            >
                                {num}
                            </button>
                        ))}
                        <div className="h-16" /> {/* Spacer */}
                        <button
                            onClick={() => handleNumberClick('0')}
                            className="h-16 rounded-xl bg-white shadow-sm border-b-4 border-slate-200 active:border-b-0 active:translate-y-1 transition-all text-2xl font-black text-slate-700 hover:bg-slate-50"
                        >
                            0
                        </button>
                        <button
                            onClick={handleDelete}
                            className="h-16 rounded-xl bg-red-50 text-red-500 shadow-sm border-b-4 border-red-100 active:border-b-0 active:translate-y-1 transition-all flex items-center justify-center hover:bg-red-100"
                        >
                            <Delete size={24} />
                        </button>
                    </div>

                    <button
                        onClick={handleAuthorize}
                        disabled={pin.length < 4}
                        className="w-full mt-6 py-4 bg-slate-900 text-white rounded-xl font-bold text-lg shadow-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                    >
                        Autorizar
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SupervisorModal;
