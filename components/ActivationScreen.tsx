
import React, { useState } from 'react';
import { supabase } from '../utils/supabase';
import { Rocket, Lock, Mail, CheckCircle, AlertCircle, ShieldCheck, ArrowRight, Loader2 } from 'lucide-react';

interface ActivationScreenProps {
    onActivationComplete: (tenantData: any) => void;
}

const ActivationScreen: React.FC<ActivationScreenProps> = ({ onActivationComplete }) => {
    const [step, setStep] = useState<'LOGIN' | 'CHANGE_PASSWORD' | 'SUCCESS'>('LOGIN');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleInitialLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { data, error: authError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (authError) throw authError;

            // Check if password change is needed (common for newly created admin users)
            // For Supabase, we can check metadata or just assume first login if we haven't confirmed email yet
            // or if we explicitly set a flag in metadata.
            const isNewUser = data.user?.user_metadata?.is_new_user !== false;

            if (isNewUser) {
                setStep('CHANGE_PASSWORD');
            } else {
                completeActivation(data.user);
            }
        } catch (err: any) {
            setError(err.message || 'Error al iniciar sesión. Verifique sus credenciales.');
        } finally {
            setLoading(false);
        }
    };

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            setError('Las contraseñas no coinciden.');
            return;
        }
        if (newPassword.length < 6) {
            setError('La contraseña debe tener al menos 6 caracteres.');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const { data, error: updateError } = await supabase.auth.updateUser({
                password: newPassword,
                data: { is_new_user: false }
            });

            if (updateError) throw updateError;

            setStep('SUCCESS');
            setTimeout(() => completeActivation(data.user), 2000);
        } catch (err: any) {
            setError(err.message || 'Error al actualizar la contraseña.');
        } finally {
            setLoading(false);
        }
    };

    const completeActivation = (user: any) => {
        // Save tenant session info
        const tenantData = {
            id: user.id,
            email: user.email,
            name: user.user_metadata?.full_name || user.email.split('@')[0],
            tenantId: user.user_metadata?.tenant_id || user.id // Fallback to user ID if tenant_id is missing
        };

        // Save locally for persistence
        localStorage.setItem('clic_tenant_id', tenantData.tenantId);
        localStorage.setItem('clic_tenant_email', tenantData.email);

        onActivationComplete(tenantData);
    };

    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 overflow-hidden relative">
            {/* Background Glows */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 blur-[120px] rounded-full" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 blur-[120px] rounded-full" />

            <div className="max-w-md w-full z-10 transition-all duration-500 transform">
                <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-800 p-8 rounded-[2.5rem] shadow-2xl">

                    <div className="flex justify-center mb-8">
                        <div className="bg-gradient-to-tr from-blue-600 to-purple-600 p-4 rounded-3xl shadow-lg shadow-blue-500/20">
                            <Rocket className="text-white" size={32} />
                        </div>
                    </div>

                    {step === 'LOGIN' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="text-center mb-8">
                                <h1 className="text-3xl font-black text-white mb-2">Activación</h1>
                                <p className="text-slate-400 text-sm">Ingrese las credenciales enviadas por Clic-Cloud para vincular su sistema.</p>
                            </div>

                            <form onSubmit={handleInitialLogin} className="space-y-5">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Email Registrado</label>
                                    <div className="relative group">
                                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-500 transition-colors" size={20} />
                                        <input
                                            type="email"
                                            required
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            className="w-full bg-slate-800/50 border border-slate-700 focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 rounded-2xl py-4 pl-12 pr-4 text-white outline-none transition-all placeholder:text-slate-600"
                                            placeholder="ejemplo@email.com"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Contraseña Temporal</label>
                                    <div className="relative group">
                                        <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-500 transition-colors" size={20} />
                                        <input
                                            type="password"
                                            required
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="w-full bg-slate-800/50 border border-slate-700 focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 rounded-2xl py-4 pl-12 pr-4 text-white outline-none transition-all placeholder:text-slate-600"
                                            placeholder="••••••••"
                                        />
                                    </div>
                                </div>

                                {error && (
                                    <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex items-start gap-3 animate-in fade-in zoom-in">
                                        <AlertCircle className="text-red-500 shrink-0" size={18} />
                                        <p className="text-red-400 text-xs leading-relaxed">{error}</p>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold py-4 rounded-2xl shadow-lg shadow-blue-500/20 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 group"
                                >
                                    {loading ? (
                                        <Loader2 className="animate-spin" size={20} />
                                    ) : (
                                        <>
                                            Continuar <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                                        </>
                                    )}
                                </button>
                            </form>
                        </div>
                    )}

                    {step === 'CHANGE_PASSWORD' && (
                        <div className="animate-in fade-in slide-in-from-right-8 duration-500">
                            <div className="text-center mb-8">
                                <div className="inline-flex items-center gap-2 bg-blue-500/10 text-blue-400 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest mb-3">
                                    <ShieldCheck size={12} /> Seguridad Obligatoria
                                </div>
                                <h1 className="text-2xl font-black text-white mb-2">Nueva Contraseña</h1>
                                <p className="text-slate-400 text-sm">Por seguridad, debe cambiar su clave temporal antes de continuar.</p>
                            </div>

                            <form onSubmit={handlePasswordChange} className="space-y-5">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Nueva Clave</label>
                                    <input
                                        type="password"
                                        required
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        className="w-full bg-slate-800/50 border border-slate-700 focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 rounded-2xl py-4 px-4 text-white outline-none transition-all"
                                        placeholder="Contraseña segura"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 ml-1">Confirmar Clave</label>
                                    <input
                                        type="password"
                                        required
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="w-full bg-slate-800/50 border border-slate-700 focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 rounded-2xl py-4 px-4 text-white outline-none transition-all"
                                        placeholder="Repita la contraseña"
                                    />
                                </div>

                                {error && (
                                    <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex items-start gap-3">
                                        <AlertCircle className="text-red-500 shrink-0" size={18} />
                                        <p className="text-red-400 text-xs leading-relaxed">{error}</p>
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold py-4 rounded-2xl shadow-lg shadow-green-500/20 transition-all active:scale-[0.98] disabled:opacity-50"
                                >
                                    {loading ? <Loader2 className="animate-spin mx-auto" size={20} /> : 'Activar Sistema'}
                                </button>
                            </form>
                        </div>
                    )}

                    {step === 'SUCCESS' && (
                        <div className="text-center py-10 animate-in zoom-in duration-500">
                            <div className="flex justify-center mb-6">
                                <div className="bg-green-500/20 p-6 rounded-full">
                                    <CheckCircle className="text-green-500" size={64} />
                                </div>
                            </div>
                            <h1 className="text-3xl font-black text-white mb-2">¡Activado!</h1>
                            <p className="text-slate-400">Vinculación exitosa. Iniciando configuración...</p>
                        </div>
                    )}

                </div>

                <div className="mt-8 text-center space-y-4">
                    <a
                        href={(import.meta as any).env.VITE_CLOUD_ADMIN_URL || 'https://cloud-admin-gamma.vercel.app/'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400/60 hover:text-blue-400 text-[11px] font-medium transition-colors border-b border-transparent hover:border-blue-400/30 pb-0.5 inline-block"
                    >
                        ¿No tiene sus credenciales? Gestionar en Cloud Admin
                    </a>
                    <p className="text-slate-600 text-[10px] uppercase font-bold tracking-[0.2em] pt-2">CLIC POS • CLOUD EDITION</p>
                </div>
            </div>
        </div>
    );
};

export default ActivationScreen;
