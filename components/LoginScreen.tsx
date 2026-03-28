
import React, { useState } from 'react';
import { Delete, KeyRound, Lock, User, UserCircle, Globe, ChevronDown, Fingerprint } from 'lucide-react';
import { User as UserType, TerminalConfig } from '../types';
import { biometricService } from '../services/BiometricAuthService';
import AccessibilityToggle from './AccessibilityToggle';

interface LoginScreenProps {
  onLogin: (user: UserType) => void;
  subVertical: string;
  availableUsers: UserType[];
  config: TerminalConfig;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, subVertical, availableUsers, config }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserType | null>(null);
  const [biometricError, setBiometricError] = useState(false);
  const [biometricFailCount, setBiometricFailCount] = useState(0);
  const [isHardwareAvailable, setIsHardwareAvailable] = useState(false);
  const [buildVersion, setBuildVersion] = useState<string>('');

  // Check availability on mount
  React.useEffect(() => {
    const initBiometrics = async () => {
      const available = await biometricService.isAvailable();
      setIsHardwareAvailable(available);

      if (config.security?.allowBiometrics && available && biometricFailCount < 3) {
        // Ready for scan
      }
    };
    initBiometrics();
  }, [config.security?.allowBiometrics, biometricFailCount]);

  React.useEffect(() => {
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
            const versionLabel = deviceInfo.versionCode
              ? `APK v${deviceInfo.versionName} (${deviceInfo.versionCode})`
              : `APK v${deviceInfo.versionName}`;
            setBuildVersion(versionLabel);
            return;
          }
        } catch (error) {
          console.warn('No se pudo leer la versión del compilado:', error);
        }

        await wait(250);
      }

      setBuildVersion('Web');
    };

    void loadBuildVersion();
  }, []);

  const checkLogin = React.useCallback((inputPin: string) => {
    console.log(`🔐 Login Attempt: PIN=${inputPin}, AvailableUsers=${availableUsers.length}`);
    const user = availableUsers.find(u => u.pin === inputPin);
    if (user) {
      console.log(`✅ Login Success: User=${user.name}`);
      setTimeout(() => onLogin(user), 200);
    } else {
      console.warn(`❌ Login Failed: PIN ${inputPin} not found in available users.`);
      setTimeout(() => {
        setError(true);
        setPin('');
      }, 300);
    }
  }, [availableUsers, onLogin]);

  const handleKeyPress = React.useCallback((key: string) => {
    setError(false);
    if (key === 'C') {
      setPin('');
    } else if (key === 'BACK') {
      setPin(prev => prev.slice(0, -1));
    } else {
      setPin(prev => {
        if (prev.length < 4) {
          return prev + key;
        }
        return prev;
      });
    }
  }, []);

  // Use Effect for auto-check when PIN reaches 4 digits
  React.useEffect(() => {
    if (pin.length === 4) {
      checkLogin(pin);
    }
  }, [pin, checkLogin]);

  // Handle physical keyboard input
  const handleKeyDown = React.useCallback((e: KeyboardEvent) => {
    if (['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(e.key)) {
      handleKeyPress(e.key);
    } else if (e.key === 'Backspace') {
      handleKeyPress('BACK');
    } else if (e.key === 'Escape' || e.key === 'c' || e.key === 'C') {
      handleKeyPress('C');
    } else if (e.key === 'Enter') {
      // Enter is redundant but good for UX if they type 4 digits and hit enter
      if (pin.length === 4) checkLogin(pin);
    }
  }, [pin, handleKeyPress, checkLogin]);

  React.useEffect(() => {
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
      // We iterate through available users to find those with registered credentials
      const enrolledUsers = availableUsers.filter(u => u.biometrics?.credentialID);

      if (enrolledUsers.length === 0) {
        alert("No hay usuarios registrados con huella en este dispositivo.");
        return;
      }

      // Collect all credential IDs for multi-user verification
      const credentialIDs = enrolledUsers.map(u => u.biometrics!.credentialID);

      // Verify and get the matched credentialID back
      const matchedID = await biometricService.verify(credentialIDs);

      if (matchedID) {
        // Find the user that corresponds to the matched ID
        const targetUser = enrolledUsers.find(u => u.biometrics?.credentialID === matchedID);
        if (targetUser) {
          onLogin(targetUser);
        } else {
          handleBioFail();
        }
      } else {
        handleBioFail();
      }
    } catch (e) {
      handleBioFail();
    }
  };

  const handleBioFail = () => {
    setBiometricFailCount(prev => prev + 1);
    setBiometricError(true);
    setTimeout(() => setBiometricError(false), 2000);
  };

  const handleUserClick = (user: UserType) => {
    setSelectedUser(user);
    setPin('');
    setError(false);
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500 rounded-full blur-[100px]"></div>
      </div>

      <div className="absolute top-4 right-4 z-50">
        <AccessibilityToggle />
      </div>

      <div className="max-w-md w-full bg-gray-800/80 backdrop-blur-md rounded-3xl border border-gray-700 shadow-2xl p-8 z-10 flex flex-col relative">

        <div className="text-center mb-6">
          <div className="bg-gray-700/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 shadow-inner">
            <Lock className="text-blue-400" size={28} />
          </div>
          <h1 className="text-xl font-bold text-white mb-1">Acceso de Sistema</h1>
          <p className="text-gray-400 text-xs mb-4">{subVertical}</p>

          {/* User Selection Grid */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {availableUsers.map(u => (
              <button
                key={u.id}
                onClick={() => handleUserClick(u)}
                className={`flex flex-col items-center p-3 rounded-2xl transition-all border-2 ${selectedUser?.id === u.id
                  ? 'bg-blue-600/20 border-blue-500 scale-105'
                  : 'bg-gray-700/30 border-transparent hover:bg-gray-700/50'
                  }`}
              >
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold mb-2 shadow-lg ${selectedUser?.id === u.id ? 'bg-blue-500 text-white' : 'bg-gray-600 text-gray-300'}`}>
                  {u.photo ? <img src={u.photo} className="w-full h-full rounded-full object-cover" /> : u.name.charAt(0)}
                </div>
                <span className="text-[10px] font-bold text-gray-300 truncate w-full text-center">{u.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>

          {selectedUser && (
            <div className="animate-in fade-in slide-in-from-top-2">
              <p className="text-blue-400 text-sm font-bold mb-4">Ingresa PIN para {selectedUser.name}</p>
            </div>
          )}
        </div>

        {/* Biometric Icon */}
        {config.security?.allowBiometrics && isHardwareAvailable && biometricFailCount < 3 && (
          <div className="flex justify-center mb-8">
            <button
              onClick={handleBiometricLogin}
              className={`w-20 h-20 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${biometricError
                ? 'bg-red-500/20 border-red-500 animate-shake'
                : 'bg-blue-600/20 border-blue-500 hover:bg-blue-600/40 hover:scale-105 active:scale-95'
                }`}
            >
              <Fingerprint size={40} className={`text-white ${biometricError ? 'text-red-400' : 'text-blue-400'}`} />
            </button>
            {biometricError && (
              <div className="absolute mt-24 text-red-400 text-xs font-bold animate-in fade-in">
                No reconocido ({biometricFailCount}/3)
              </div>
            )}
          </div>
        )}

        {/* PIN Display */}
        <div className="mb-8">
          <div className={`flex justify-center gap-4 transition-all duration-300 ${error ? 'animate-shake' : ''}`}>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full transition-all duration-200 ${pin.length > i
                  ? error ? 'bg-red-500 scale-125' : 'bg-blue-500 scale-110'
                  : 'bg-gray-600'
                  }`}
              />
            ))}
          </div>
          {error && (
            <p className="text-center text-red-500 text-xs mt-4 font-semibold animate-in fade-in">
              PIN Incorrecto. Intente nuevamente.
            </p>
          )}
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <button
              key={num}
              onClick={() => handleKeyPress(num.toString())}
              className="h-16 rounded-2xl bg-gray-700 hover:bg-gray-600 active:bg-blue-600 text-white text-2xl font-semibold shadow-md transition-all active:scale-95 border-b-4 border-gray-900 active:border-b-0 active:translate-y-1"
            >
              {num}
            </button>
          ))}
          <button
            onClick={() => handleKeyPress('C')}
            className="h-16 rounded-2xl bg-gray-700/50 hover:bg-gray-600/50 text-red-400 font-bold transition-all border-b-4 border-transparent active:border-b-0 active:translate-y-1"
          >
            C
          </button>
          <button
            onClick={() => handleKeyPress('0')}
            className="h-16 rounded-2xl bg-gray-700 hover:bg-gray-600 active:bg-blue-600 text-white text-2xl font-semibold shadow-md transition-all active:scale-95 border-b-4 border-gray-900 active:border-b-0 active:translate-y-1"
          >
            0
          </button>
          <button
            onClick={() => handleKeyPress('BACK')}
            className="h-16 rounded-2xl bg-gray-700/50 hover:bg-gray-600/50 text-gray-300 flex items-center justify-center transition-all border-b-4 border-transparent active:border-b-0 active:translate-y-1"
          >
            <Delete size={24} />
          </button>
        </div>

        <div className="text-center text-gray-500 text-xs">
          <p>Terminal ID: POS-001</p>
          {buildVersion && <p className="mt-1">Versión: {buildVersion}</p>}
        </div>

      </div>
    </div>
  );
};

export default LoginScreen;
