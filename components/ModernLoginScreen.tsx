import React, { useState, useEffect, useCallback } from 'react';
import { Delete, Lock, Fingerprint } from 'lucide-react';
import { User as UserType, TerminalConfig } from '../types';
import { biometricService } from '../services/BiometricAuthService';
import './ModernLoginScreen.css';

interface ModernLoginScreenProps {
  onLogin: (user: UserType) => void;
  subVertical: string;
  availableUsers: UserType[];
  config: TerminalConfig;
}

const ModernLoginScreen: React.FC<ModernLoginScreenProps> = ({
  onLogin,
  subVertical,
  availableUsers,
  config
}) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserType | null>(null);
  const [biometricError, setBiometricError] = useState(false);
  const [biometricFailCount, setBiometricFailCount] = useState(0);
  const [isHardwareAvailable, setIsHardwareAvailable] = useState(false);
  const [buildVersion, setBuildVersion] = useState<string>('');

  useEffect(() => {
    const initBiometrics = async () => {
      const available = await biometricService.isAvailable();
      setIsHardwareAvailable(available);
    };
    void initBiometrics();
  }, []);

  useEffect(() => {
    const loadBuildVersion = async () => {
      const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          const runtimeWindow = window as any;
          let deviceInfo: { versionName?: string; versionCode?: number } | null = null;

          if (typeof runtimeWindow.ClicPOSNativePrinter?.getDeviceInfo === 'function') {
            deviceInfo = await runtimeWindow.ClicPOSNativePrinter.getDeviceInfo();
          } else if (typeof runtimeWindow.AndroidPrinter?.getDeviceInfo === 'function') {
            const raw = runtimeWindow.AndroidPrinter.getDeviceInfo();
            deviceInfo = raw ? JSON.parse(raw) : null;
          }

          if (deviceInfo?.versionName) {
            setBuildVersion(
              deviceInfo.versionCode
                ? `APK v${deviceInfo.versionName} (${deviceInfo.versionCode})`
                : `APK v${deviceInfo.versionName}`
            );
            return;
          }
        } catch (loadError) {
          console.warn('No se pudo leer la versión del compilado:', loadError);
        }

        await wait(250);
      }

      setBuildVersion('Web');
    };

    void loadBuildVersion();
  }, []);

  const checkLogin = useCallback((inputPin: string) => {
    const user = availableUsers.find((candidate) => candidate.pin === inputPin);
    if (user) {
      window.setTimeout(() => onLogin(user), 200);
    } else {
      window.setTimeout(() => {
        setError(true);
        setPin('');
      }, 300);
    }
  }, [availableUsers, onLogin]);

  const handleKeyPress = useCallback((key: string) => {
    setError(false);
    if (key === 'C') {
      setPin('');
    } else if (key === 'BACK') {
      setPin((prev) => prev.slice(0, -1));
    } else {
      setPin((prev) => {
        if (prev.length < 4) return prev + key;
        return prev;
      });
    }
  }, []);

  useEffect(() => {
    if (pin.length === 4) {
      checkLogin(pin);
    }
  }, [pin, checkLogin]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(event.key)) {
      handleKeyPress(event.key);
    } else if (event.key === 'Backspace') {
      handleKeyPress('BACK');
    } else if (event.key === 'Escape' || event.key.toLowerCase() === 'c') {
      handleKeyPress('C');
    }
  }, [handleKeyPress]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleBiometricLogin = async () => {
    if (biometricFailCount >= 3) {
      setBiometricError(true);
      return;
    }

    try {
      setBiometricError(false);
      const enrolledUsers = availableUsers.filter((user) => user.biometrics?.credentialID);
      if (enrolledUsers.length === 0) return;

      const credentialIDs = enrolledUsers.map((user) => user.biometrics!.credentialID);
      const matchedId = await biometricService.verify(credentialIDs);

      if (matchedId) {
        const targetUser = enrolledUsers.find((user) => user.biometrics?.credentialID === matchedId);
        if (targetUser) {
          onLogin(targetUser);
          return;
        }
      }

      setBiometricFailCount((prev) => prev + 1);
      setBiometricError(true);
      window.setTimeout(() => setBiometricError(false), 2000);
    } catch {
      setBiometricFailCount((prev) => prev + 1);
      setBiometricError(true);
      window.setTimeout(() => setBiometricError(false), 2000);
    }
  };

  const loginFooterText =
    config.security?.allowBiometrics && isHardwareAvailable
      ? biometricError
        ? 'Reintente huella o tarjeta'
        : 'Escanear Tarjeta o Login con Huella'
      : 'Escanear Tarjeta o Login con Huella';

  return (
    <div className="modern-login-container">
      <div className="modern-login-brand">
        <span className="modern-login-brand-mark">CLIC</span>
        <span className="modern-login-brand-pos">POS</span>
      </div>

      <div className={`modern-login-card animate-fade-in ${error ? 'animate-shake' : ''}`}>
        {/* Left Side: Company & User Selection */}
        <div className="modern-login-left">
          <div className="modern-login-header">
            <div className="modern-lock-icon-container">
              <Lock className="text-blue-400" size={30} />
            </div>
            <p className="modern-login-subtitle">{subVertical}</p>
            <h1 className="modern-login-title">Acceso de Sistema</h1>
          </div>

          <div className="modern-user-grid">
            {availableUsers.slice(0, 12).map((user) => (
              <button
                key={user.id}
                onClick={() => {
                  setSelectedUser(user);
                  setPin('');
                  setError(false);
                }}
                className={`modern-user-card ${selectedUser?.id === user.id ? 'active' : ''}`}
              >
                <div className="modern-user-avatar-wrapper">
                  <div className="modern-user-avatar">
                    {user.photo ? (
                      <img src={user.photo} alt={user.name} className="w-full h-full object-cover" />
                    ) : (
                      user.name.charAt(0)
                    )}
                  </div>
                </div>
                <span className="modern-user-name">{user.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right Side: PIN Entry & Keypad */}
        <div className="modern-login-right">
          <div className="modern-pin-section">
            <div className="modern-pin-display">
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className={`modern-pin-dot ${pin.length > index ? (error ? 'error' : 'filled') : ''}`}
                />
              ))}
            </div>
            {error && (
              <div className="text-center text-red-500 text-xs mt-2 font-semibold">
                PIN Incorrecto. Intente nuevamente.
              </div>
            )}
          </div>

          <div className="modern-keypad">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button key={num} onClick={() => handleKeyPress(num.toString())} className="modern-key">
                {num}
              </button>
            ))}
            <button onClick={() => handleKeyPress('C')} className="modern-key special clear">
              C
            </button>
            <button onClick={() => handleKeyPress('0')} className="modern-key">
              0
            </button>
            <button onClick={() => handleKeyPress('BACK')} className="modern-key special">
              <Delete size={24} />
            </button>
          </div>

          <div className="modern-biometrics-footer">
            {config.security?.allowBiometrics && isHardwareAvailable ? (
              <button
                onClick={handleBiometricLogin}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 transition-all ${
                  biometricError
                    ? 'bg-red-400/10 text-red-400'
                    : 'text-slate-500 hover:bg-blue-400/10 hover:text-blue-400'
                }`}
              >
                <Fingerprint size={16} />
                <span className="modern-biometrics-text">{loginFooterText}</span>
              </button>
            ) : (
              <p className="modern-biometrics-text italic">{loginFooterText}</p>
            )}

            <div className="mt-6 text-center text-xs text-gray-500 opacity-60">
              <p>Terminal ID: POS-001</p>
              {buildVersion && <p className="mt-1">Versión: {buildVersion}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModernLoginScreen;
