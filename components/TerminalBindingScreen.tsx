import React, { useState } from 'react';
import { ChevronRight, Lock, Server, Smartphone, Wifi } from 'lucide-react';
import { BusinessConfig, User as UserType } from '../types';
import TerminalSelector from './TerminalSelector';

interface PairingResult {
  tenantId?: string;
  boundConfig?: BusinessConfig;
  boundUsers?: UserType[];
  masterIp?: string;
}

interface TerminalBindingScreenProps {
  config: BusinessConfig;
  deviceId: string;
  adminUsers: UserType[];
  onPair: (terminalId: string, result?: PairingResult) => Promise<void>;
  onConfigUpdate?: (newConfig: BusinessConfig) => void | Promise<void>;
  onUsersUpdate?: (users: UserType[]) => void | Promise<void>;
  initialError?: string | null;
  initialMasterIp?: string;
}

const TerminalBindingScreen: React.FC<TerminalBindingScreenProps> = ({
  config,
  deviceId,
  adminUsers,
  onPair,
  onConfigUpdate,
  onUsersUpdate,
  initialError,
  initialMasterIp,
}) => {
  const [step, setStep] = useState<'MODE_SELECT' | 'SLAVE_CONNECT' | 'AUTH' | 'SELECT'>(
    initialError ? 'SLAVE_CONNECT' : 'MODE_SELECT'
  );
  const [adminPin, setAdminPin] = useState('');
  const [error, setError] = useState<string | null>(initialError || null);
  const [masterIp, setMasterIp] = useState(initialMasterIp || '');
  const [isConnecting, setIsConnecting] = useState(false);
  const [masterAdmins, setMasterAdmins] = useState<UserType[]>([]);
  const [localIps, setLocalIps] = useState<string[]>([]);
  const [bindingMode, setBindingMode] = useState<'MASTER' | 'SLAVE'>('MASTER');

  const handleModeSelect = (mode: 'MASTER' | 'SLAVE') => {
    setBindingMode(mode);
    setError(null);
    if (mode === 'MASTER') {
      setMasterIp('');
      setStep('AUTH');
      return;
    }

    setStep('SLAVE_CONNECT');
    fetch('/api/network')
      .then((res) => res.json())
      .then((data) => data.addresses && setLocalIps(data.addresses))
      .catch(() => undefined);
  };

  const handleConnectToMaster = async () => {
    if (!masterIp.trim()) {
      setError('Ingrese la IP de la Maestra');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const normalizedHost = masterIp.trim().replace(/^https?:\/\//, '');
      const hostWithPort = normalizedHost.includes(':') ? normalizedHost : `${normalizedHost}:3001`;
      const targetUrl = `${window.location.protocol}//${hostWithPort}`;

      const [configResponse, usersResponse] = await Promise.all([
        fetch(`${targetUrl}/api/config`),
        fetch(`${targetUrl}/api/users`),
      ]);

      if (!configResponse.ok) {
        throw new Error(`El servidor respondió con error ${configResponse.status}`);
      }

      const fetchedConfig = await configResponse.json();
      await onConfigUpdate?.(fetchedConfig);

      if (usersResponse.ok) {
        const fetchedUsers = await usersResponse.json();
        const fetchedAdmins = fetchedUsers.filter((u: any) =>
          u.role?.toUpperCase() === 'ADMIN' || u.role?.toUpperCase() === 'ADMINISTRADOR'
        );
        setMasterAdmins(fetchedAdmins);
        await onUsersUpdate?.(fetchedUsers);
      }

      localStorage.setItem('pos_master_ip', normalizedHost);
      setStep('AUTH');
    } catch (err) {
      console.error('Failed to connect to master during terminal activation:', err);
      const isHttps = window.location.protocol === 'https:';
      const isNetworkError =
        (err as Error).message.includes('fetch') || (err as Error).name === 'TypeError';

      let cleanError = `No se pudo conectar a la Maestra (${masterIp}).`;
      if (isNetworkError && isHttps) {
        cleanError +=
          '\n\n⚠️ Posible error de Certificado SSL detectado:\nDebes aceptar el certificado en el navegador antes de continuar.';
      } else {
        cleanError += `\nError: ${(err as Error).message}`;
      }

      setError(cleanError);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleAuth = () => {
    const allAvailableAdmins = [...adminUsers];
    masterAdmins.forEach((admin) => {
      if (!allAvailableAdmins.some((existing) => existing.id === admin.id)) {
        allAvailableAdmins.push(admin);
      }
    });

    if (adminPin === '1234' && allAvailableAdmins.length === 0) {
      setError(null);
      setStep('SELECT');
      return;
    }

    const admin = allAvailableAdmins.find(
      (user) =>
        user.pin === adminPin &&
        (user.role?.toUpperCase() === 'ADMIN' || user.role?.toUpperCase() === 'ADMINISTRADOR')
    );

    if (admin) {
      setError(null);
      setStep('SELECT');
      return;
    }

    setError(`PIN de Administrador inválido (Loaded: ${allAvailableAdmins.length} admins)`);
    setAdminPin('');
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-900 p-6">
      <div className="pointer-events-none absolute inset-0 opacity-10">
        <div className="absolute left-1/2 top-1/2 h-[860px] w-[860px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500 blur-[170px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl">
        <div className="rounded-[2.75rem] border border-white/10 bg-white/95 p-10 shadow-[0_36px_110px_rgba(15,23,42,0.32)] backdrop-blur-xl">
          <div className="mb-10 text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[1.85rem] bg-blue-50 shadow-inner">
              <Smartphone className="text-blue-600" size={40} />
            </div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">Activar Terminal</h1>
            <p className="mt-3 text-sm font-medium text-slate-500">
              Este equipo aún no tiene identidad operativa. Vamos a vincularlo a una caja del tenant.
            </p>
          </div>

          {step === 'MODE_SELECT' && (
            <div className="mx-auto max-w-2xl space-y-4">
              <p className="mb-3 text-center text-xs font-black uppercase tracking-[0.32em] text-slate-400">
                Selecciona el modo de operación
              </p>

              <button
                onClick={() => handleModeSelect('MASTER')}
                className="w-full rounded-[2rem] border-2 border-slate-100 bg-slate-50 p-6 text-left transition hover:border-blue-500 hover:bg-white"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm">
                    <Server size={24} />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-900">Caja Maestra / Independiente</h3>
                    <p className="mt-1 text-xs font-medium text-slate-400">Servidor local o única caja operando en este equipo.</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleModeSelect('SLAVE')}
                className="w-full rounded-[2rem] border-2 border-slate-100 bg-slate-50 p-6 text-left transition hover:border-purple-500 hover:bg-white"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm">
                    <Wifi size={24} />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-900">Caja Esclava / Adicional</h3>
                    <p className="mt-1 text-xs font-medium text-slate-400">Se conecta a una caja maestra existente dentro de la red local.</p>
                  </div>
                </div>
              </button>
            </div>
          )}

          {step === 'SLAVE_CONNECT' && (
            <div className="mx-auto max-w-xl space-y-6">
              <div className="rounded-[2rem] border border-purple-100 bg-purple-50 p-6">
                <div className="mb-4 flex items-center gap-2 text-purple-600">
                  <Wifi size={16} />
                  <span className="text-[10px] font-black uppercase tracking-[0.3em]">Conexión a Maestra</span>
                </div>
                <label className="mb-2 block text-xs font-black uppercase tracking-[0.25em] text-purple-400">
                  IP de la Caja Maestra
                </label>
                <input
                  type="text"
                  placeholder="Ej: 192.168.1.50"
                  value={masterIp}
                  onChange={(e) => setMasterIp(e.target.value)}
                  className="w-full rounded-xl border-2 border-purple-200 bg-white p-4 font-mono text-lg text-purple-900 outline-none transition-all focus:border-purple-500"
                />

                {localIps.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="text-[9px] font-black uppercase tracking-[0.25em] text-purple-400">IP de este equipo:</span>
                    {localIps.map((ip) => (
                      <button
                        key={ip}
                        onClick={() => setMasterIp(ip)}
                        className="rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-black text-purple-600 transition-colors hover:bg-purple-200"
                      >
                        {ip}
                      </button>
                    ))}
                  </div>
                )}

                {error && (
                  <div className="mt-4 rounded-xl border border-red-100 bg-red-50 p-4">
                    <p className="whitespace-pre-line text-center text-xs font-black text-red-500">{error}</p>
                  </div>
                )}
              </div>

              <button
                onClick={handleConnectToMaster}
                disabled={isConnecting}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-purple-600 py-4 text-lg font-black text-white shadow-xl shadow-purple-200 transition-all hover:bg-purple-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isConnecting ? 'Conectando...' : 'Conectar y Sincronizar'} <ChevronRight size={20} />
              </button>

              <button
                onClick={() => setStep('MODE_SELECT')}
                className="w-full py-3 text-sm font-black text-slate-400 transition-colors hover:text-slate-600"
              >
                Volver
              </button>
            </div>
          )}

          {step === 'AUTH' && (
            <div className="mx-auto max-w-xl space-y-6">
              <div className="rounded-[2rem] border border-slate-100 bg-slate-50 p-6">
                <div className="mb-4 flex items-center gap-2 text-slate-500">
                  <Lock size={16} />
                  <span className="text-[10px] font-black uppercase tracking-[0.3em]">Autorización Requerida</span>
                </div>
                <input
                  type="password"
                  placeholder="PIN de Administrador"
                  value={adminPin}
                  maxLength={4}
                  onChange={(e) => setAdminPin(e.target.value)}
                  className="w-full rounded-xl border-2 border-slate-200 bg-white p-4 text-center font-mono text-2xl tracking-[1rem] outline-none transition-all focus:border-blue-500"
                />
                {error && <p className="mt-3 text-center text-xs font-black text-red-500">{error}</p>}
              </div>

              <button
                onClick={handleAuth}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 text-lg font-black text-white shadow-xl shadow-blue-200 transition-all hover:bg-blue-700 active:scale-95"
              >
                Continuar <ChevronRight size={20} />
              </button>

              <button
                onClick={() => setStep(masterIp ? 'SLAVE_CONNECT' : 'MODE_SELECT')}
                className="w-full py-3 text-sm font-black text-slate-400 transition-colors hover:text-slate-600"
              >
                Volver
              </button>
            </div>
          )}

          {step === 'SELECT' && (
            <TerminalSelector
              deviceId={deviceId}
              bindingMode={bindingMode}
              masterIp={masterIp}
              isAlreadyBound={(config.terminals || []).some((terminal) => terminal.config?.currentDeviceId === deviceId)}
              onMasterIpChange={setMasterIp}
              onBack={() => setStep('AUTH')}
              onBound={async ({ terminalId, tenantId, config: boundConfig, users, masterIp: resolvedMasterIp }) => {
                await onConfigUpdate?.(boundConfig);
                if (Array.isArray(users)) {
                  await onUsersUpdate?.(users);
                }
                await onPair(terminalId, {
                  tenantId,
                  boundConfig,
                  boundUsers: users,
                  masterIp: resolvedMasterIp,
                });
              }}
            />
          )}

          <div className="mt-10 border-t border-slate-100 pt-6 text-center">
            <p className="font-mono text-[10px] text-slate-300">Fingerprint: {deviceId.substring(0, 18)}...</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TerminalBindingScreen;
