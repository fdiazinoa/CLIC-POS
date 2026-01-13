
import React, { useState } from 'react';
import { Delete, KeyRound, Lock, User, UserCircle, Globe, ChevronDown } from 'lucide-react';
import { User as UserType } from '../types';

interface LoginScreenProps {
  onLogin: (user: UserType) => void;
  subVertical: string;
  availableUsers: UserType[];
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, subVertical, availableUsers }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [showUsersList, setShowUsersList] = useState(false);

  const handleKeyPress = (key: string) => {
    setError(false);
    if (key === 'C') {
      setPin('');
    } else if (key === 'BACK') {
      setPin(prev => prev.slice(0, -1));
    } else {
      if (pin.length < 4) {
        const newPin = pin + key;
        setPin(newPin);
        
        // Auto-check on 4 digits
        if (newPin.length === 4) {
          checkLogin(newPin);
        }
      }
    }
  };

  const checkLogin = (inputPin: string) => {
    const user = availableUsers.find(u => u.pin === inputPin);
    if (user) {
      setTimeout(() => onLogin(user), 200);
    } else {
      setTimeout(() => {
        setError(true);
        setPin('');
      }, 300);
    }
  };

  const handleUserClick = (userPin: string) => {
    setPin(userPin);
    checkLogin(userPin);
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500 rounded-full blur-[100px]"></div>
      </div>

      <div className="max-w-md w-full bg-gray-800/80 backdrop-blur-md rounded-3xl border border-gray-700 shadow-2xl p-8 z-10 flex flex-col relative">
        
        <div className="text-center mb-8">
           <div className="bg-gray-700 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner">
             <Lock className="text-blue-400" size={32} />
           </div>
           <h1 className="text-2xl font-bold text-white mb-1">Acceso de Usuario</h1>
           <p className="text-gray-400 text-sm mb-2">{subVertical}</p>
           
           {/* Demo Users Hint */}
           <button 
             onClick={() => setShowUsersList(!showUsersList)}
             className="text-xs text-blue-400 font-bold hover:text-blue-300 flex items-center justify-center gap-1 mx-auto bg-gray-700/50 px-3 py-1 rounded-full transition-colors"
           >
             Ver Credenciales Demo <ChevronDown size={14} className={`transition-transform ${showUsersList ? 'rotate-180' : ''}`} />
           </button>
           
           {showUsersList && (
             <div className="mt-4 bg-gray-700 rounded-xl p-3 animate-in slide-in-from-top-2 text-left space-y-2 border border-gray-600">
               {availableUsers.map(u => (
                 <div 
                   key={u.id} 
                   onClick={() => handleUserClick(u.pin)}
                   className="flex justify-between items-center p-2 hover:bg-gray-600 rounded-lg cursor-pointer transition-colors group"
                 >
                   <div className="flex items-center gap-3">
                     <div className="w-8 h-8 rounded-full bg-gray-500 flex items-center justify-center text-xs font-bold text-white">
                        {u.name.charAt(0)}
                     </div>
                     <div>
                        <p className="text-sm font-bold text-white">{u.name}</p>
                        <p className="text-[10px] text-gray-300">{u.role}</p>
                     </div>
                   </div>
                   <div className="text-right">
                      <span className="text-xs font-mono bg-black/30 px-2 py-1 rounded text-green-400 group-hover:bg-black/50">
                        {u.pin}
                      </span>
                   </div>
                 </div>
               ))}
             </div>
           )}
        </div>

        {/* PIN Display */}
        <div className="mb-8">
           <div className={`flex justify-center gap-4 transition-all duration-300 ${error ? 'animate-shake' : ''}`}>
             {[0, 1, 2, 3].map((i) => (
               <div 
                 key={i}
                 className={`w-4 h-4 rounded-full transition-all duration-200 ${
                   pin.length > i 
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
        </div>

      </div>
    </div>
  );
};

export default LoginScreen;
