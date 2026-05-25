import React, { useState } from 'react';
import { ChevronRight, Lock, Server, Smartphone, Wifi } from 'lucide-react';
import { BusinessConfig, Product, User as UserType } from '../types';
import TerminalSelector from './TerminalSelector';
import { buildMasterUrlCandidates, buildMasterUrlFromHost, normalizeMasterHost } from '../utils/cloudMasterRegistry';

interface PairingResult {
  tenantId?: string;
  erpTerminalId?: string;
  erpBaseUrl?: string;
  terminalName?: string;
  companyId?: string | null;
  storeId?: string | null;
  boundConfig?: BusinessConfig;
  boundUsers?: UserType[];
  masterIp?: string;
  snapshotItems?: Product[];
  snapshotMeta?: {
    fullPullOnPairing?: boolean;
    resolutionError?: unknown;
  };
  progress?: (update: { stepId?: 'claim' | 'config' | 'apply' | 'sync' | 'cache' | 'finish'; message?: string }) => void;
}

interface PairingOptions {
  forceTakeover?: boolean;
}

interface TerminalBindingScreenProps {
  config: BusinessConfig;
  deviceId: string;
  adminUsers: UserType[];
  tenantId?: string;
  erpBaseUrl?: string;
  initialBindingMode?: 'MASTER' | 'SLAVE';
  integrationMode?: 'LOCAL_ONLY' | 'ERP_DIRECT';
  onPair: (terminalId: string, result?: PairingResult, options?: PairingOptions) => Promise<void>;
  onConfigUpdate?: (newConfig: BusinessConfig) => void | Promise<void>;
  onUsersUpdate?: (users: UserType[]) => void | Promise<void>;
  initialError?: string | null;
  initialMasterIp?: string;
}

const TerminalBindingScreen: React.FC<TerminalBindingScreenProps> = ({
  config,
  deviceId,
  adminUsers,
  tenantId,
  erpBaseUrl,
  initialBindingMode,
  integrationMode = 'LOCAL_ONLY',
  onPair,
  onConfigUpdate,
  onUsersUpdate,
  initialError,
  initialMasterIp,
}) => {
  const [step, setStep] = useState<'MODE_SELECT' | 'SLAVE_CONNECT' | 'AUTH' | 'SELECT'>(
    initialError
      ? initialBindingMode === 'SLAVE'
        ? 'SLAVE_CONNECT'
        : 'AUTH'
      : initialBindingMode === 'SLAVE'
        ? 'SLAVE_CONNECT'
        : initialBindingMode === 'MASTER'
          ? 'AUTH'
          : 'MODE_SELECT'
  );
  const [adminPin, setAdminPin] = useState('');
  const [error, setError] = useState<string | null>(initialError || null);
  const [masterIp, setMasterIp] = useState(initialMasterIp || '');
  const [isConnecting, setIsConnecting] = useState(false);
  const [masterAdmins, setMasterAdmins] = useState<UserType[]>([]);
  const [localIps, setLocalIps] = useState<string[]>([]);
  const [bindingMode, setBindingMode] = useState<'MASTER' | 'SLAVE'>(initialBindingMode || 'MASTER');

  React.useEffect(() => {
    if (initialBindingMode) {
      setBindingMode(initialBindingMode);
    }
  }, [initialBindingMode]);

  const resolveReachableMaster = async (host: string) => {
    const normalizedHost = normalizeMasterHost(host);
    const candidates = buildMasterUrlCandidates(normalizedHost);
    let lastError: Error | null = null;

    for (const baseUrl of candidates) {
      try {
        const [configResponse, usersResponse] = await Promise.all([
          fetch(`${baseUrl}/api/config`),
          fetch(`${baseUrl}/api/users`),
        ]);

        if (!configResponse.ok) {
          throw new Error(`El servidor respondió con error ${configResponse.status}`);
        }

        const fetchedConfig = await configResponse.json();
        const fetchedUsers = usersResponse.ok ? await usersResponse.json() : [];
        return {
          baseUrl,
          host: new URL(baseUrl).hostname,
          config: fetchedConfig,
          users: Array.isArray(fetchedUsers) ? fetchedUsers : [],
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError || new Error('No se pudo conectar a la Maestra');
  };

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
      const connection = await resolveReachableMaster(masterIp);
      const fetchedConfig = connection.config;
      await onConfigUpdate?.(fetchedConfig);

      const fetchedAdmins = connection.users.filter((u: any) =>
        u.role?.toUpperCase() === 'ADMIN' || u.role?.toUpperCase() === 'ADMINISTRADOR'
      );
      setMasterAdmins(fetchedAdmins);
      await onUsersUpdate?.(connection.users);

      localStorage.setItem('pos_master_ip', connection.host);
      localStorage.setItem('CLIC_POS_MASTER_URL', connection.baseUrl || buildMasterUrlFromHost(connection.host));
      setMasterIp(connection.host);
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
    <div className="relative min-h-screen overflow-x-hidden overflow-y-auto bg-slate-900 p-3 pb-6 sm:p-6">
      <div className="pointer-events-none absolute inset-0 opacity-10">
        <div className="absolute left-1/2 top-1/2 h-[860px] w-[860px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500 blur-[170px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl pb-4 sm:pb-0">
        <div className="rounded-[2rem] border border-white/10 bg-white/95 p-5 shadow-[0_36px_110px_rgba(15,23,42,0.32)] backdrop-blur-xl sm:rounded-[2.75rem] sm:p-10">
          <div className="mb-7 text-center sm:mb-10">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-blue-50 shadow-inner sm:mb-6 sm:h-20 sm:w-20 sm:rounded-[1.85rem]">
              <Smartphone className="text-blue-600" size={32} />
            </div>
            <h1 className="text-[2rem] font-black leading-none tracking-tight text-slate-900 sm:text-3xl">Activar Terminal</h1>
            <p className="mx-auto mt-3 max-w-xl text-sm font-medium leading-relaxed text-slate-500 sm:text-sm">
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
                className="w-full rounded-[1.6rem] border-2 border-slate-100 bg-slate-50 p-5 text-left transition hover:border-blue-500 hover:bg-white sm:rounded-[2rem] sm:p-6"
              >
                <div className="flex items-start gap-4 sm:items-center">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm sm:h-12 sm:w-12">
                    <Server size={24} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-black text-slate-900">Caja Maestra / Independiente</h3>
                    <p className="mt-1 text-xs font-medium leading-relaxed text-slate-400">
                      {integrationMode === 'ERP_DIRECT'
                        ? 'Caja maestra conectada al ERP para operar y sincronizar directamente.'
                        : 'Servidor local o única caja operando en este equipo.'}
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleModeSelect('SLAVE')}
                className="w-full rounded-[1.6rem] border-2 border-slate-100 bg-slate-50 p-5 text-left transition hover:border-purple-500 hover:bg-white sm:rounded-[2rem] sm:p-6"
              >
                <div className="flex items-start gap-4 sm:items-center">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm sm:h-12 sm:w-12">
                    <Wifi size={24} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-black text-slate-900">Caja Esclava / Adicional</h3>
                    <p className="mt-1 text-xs font-medium leading-relaxed text-slate-400">Se conecta a una caja maestra existente dentro de la red local.</p>
                  </div>
                </div>
              </button>
            </div>
          )}

          {step === 'SLAVE_CONNECT' && (
            <div className="mx-auto max-w-xl space-y-6">
              <div className="rounded-[1.75rem] border border-purple-100 bg-purple-50 p-5 sm:rounded-[2rem] sm:p-6">
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
                  className="w-full rounded-xl border-2 border-purple-200 bg-white p-4 font-mono text-base text-purple-900 outline-none transition-all focus:border-purple-500 sm:text-lg"
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
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-purple-600 py-4 text-base font-black text-white shadow-xl shadow-purple-200 transition-all hover:bg-purple-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:text-lg"
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
              <div className="rounded-[1.75rem] border border-slate-100 bg-slate-50 p-5 sm:rounded-[2rem] sm:p-6">
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
                  className="w-full rounded-xl border-2 border-slate-200 bg-white p-4 text-center font-mono text-xl tracking-[0.75rem] outline-none transition-all focus:border-blue-500 sm:text-2xl sm:tracking-[1rem]"
                />
                {error && <p className="mt-3 text-center text-xs font-black text-red-500">{error}</p>}
              </div>

              <button
                onClick={handleAuth}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 text-base font-black text-white shadow-xl shadow-blue-200 transition-all hover:bg-blue-700 active:scale-95 sm:text-lg"
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
              currentConfig={config}
              deviceId={deviceId}
              bindingMode={bindingMode}
              integrationMode={integrationMode}
              tenantId={tenantId}
              erpBaseUrl={erpBaseUrl}
              masterIp={masterIp}
              isAlreadyBound={(config.terminals || []).some((terminal) => terminal.config?.currentDeviceId === deviceId)}
              onMasterIpChange={setMasterIp}
              onBack={() => setStep('AUTH')}
              onBound={async ({
                terminalId,
                tenantId,
                erpTerminalId,
                terminalName,
                companyId,
                storeId,
                forceTakeover,
                config: boundConfig,
                users,
                masterIp: resolvedMasterIp,
                snapshotItems,
                snapshotMeta,
                progress
              }) => {
                await onConfigUpdate?.(boundConfig);
                if (Array.isArray(users)) {
                  await onUsersUpdate?.(users);
                }
                await onPair(terminalId, {
                  tenantId,
                  erpTerminalId,
                  erpBaseUrl,
                  terminalName,
                  companyId,
                  storeId,
                  boundConfig,
                  boundUsers: users,
                  masterIp: resolvedMasterIp,
                  snapshotItems,
                  snapshotMeta,
                  progress,
                }, { forceTakeover: Boolean(forceTakeover) });
              }}
            />
          )}

          <div className="mt-8 border-t border-slate-100 pt-5 text-center sm:mt-10 sm:pt-6">
            <p className="font-mono text-[10px] text-slate-300 break-all sm:break-normal">Fingerprint: {deviceId.substring(0, 18)}...</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TerminalBindingScreen;
