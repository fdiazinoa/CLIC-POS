import React, { useState, useRef } from 'react';
import { 
  Users, Calendar, ShieldCheck, Clock, Check, X, 
  UserPlus, ScanFace, ChevronRight, Lock, 
  Trash2, GripVertical, AlertCircle, LogIn, LogOut, Plus
} from 'lucide-react';
import { User, RoleDefinition, Shift, TimeRecord, PermissionDetail } from '../types';
import { AVAILABLE_PERMISSIONS } from '../constants';

interface TeamHubProps {
  users: User[];
  roles: RoleDefinition[];
  onUpdateUsers: (users: User[]) => void;
  onUpdateRoles: (roles: RoleDefinition[]) => void;
  onClose: () => void;
}

// --- MOCK DATA FOR SHIFTS ---
const INITIAL_SHIFTS: Shift[] = [
  { id: 's1', userId: 'u2', dayOfWeek: 1, startTime: '09:00', endTime: '15:00', label: 'Mañana', color: 'bg-blue-100 border-blue-300 text-blue-800' },
  { id: 's2', userId: 'u3', dayOfWeek: 1, startTime: '15:00', endTime: '22:00', label: 'Tarde', color: 'bg-purple-100 border-purple-300 text-purple-800' },
  { id: 's3', userId: 'u2', dayOfWeek: 2, startTime: '09:00', endTime: '15:00', label: 'Mañana', color: 'bg-blue-100 border-blue-300 text-blue-800' },
];

const UNASSIGNED_SHIFTS: Shift[] = [
  { id: 'new_m', userId: null, dayOfWeek: 0, startTime: '09:00', endTime: '15:00', label: 'Mañana', color: 'bg-blue-100 border-blue-300 text-blue-800' },
  { id: 'new_t', userId: null, dayOfWeek: 0, startTime: '15:00', endTime: '22:00', label: 'Tarde', color: 'bg-purple-100 border-purple-300 text-purple-800' },
  { id: 'new_n', userId: null, dayOfWeek: 0, startTime: '22:00', endTime: '02:00', label: 'Noche', color: 'bg-indigo-100 border-indigo-300 text-indigo-800' },
];

// --- HELPER COMPONENTS ---

const SlideUnlock: React.FC<{ onUnlock: () => void; label: string; mode: 'IN' | 'OUT' }> = ({ onUnlock, label, mode }) => {
  const [sliderValue, setSliderValue] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value);
    setSliderValue(val);
    if (val === 100) {
      setTimeout(() => {
        onUnlock();
        setSliderValue(0);
      }, 200);
    }
  };

  const handleEnd = () => {
    if (sliderValue < 100) setSliderValue(0);
  };

  const colorClass = mode === 'IN' ? 'bg-green-500' : 'bg-red-500';
  const bgClass = mode === 'IN' ? 'bg-green-50' : 'bg-red-50';

  return (
    <div className={`relative h-16 rounded-full overflow-hidden ${bgClass} shadow-inner border border-gray-200 select-none`}>
      <div 
        className={`absolute top-0 left-0 bottom-0 ${colorClass} opacity-20 transition-all duration-75`} 
        style={{ width: `${sliderValue}%` }} 
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className={`text-sm font-bold uppercase tracking-widest ${mode === 'IN' ? 'text-green-600' : 'text-red-600'} animate-pulse`}>
          {label}
        </span>
      </div>
      <input 
        type="range" 
        min="0" 
        max="100" 
        value={sliderValue} 
        onChange={handleInput}
        onTouchEnd={handleEnd}
        onMouseUp={handleEnd}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
      />
      <div 
        className={`absolute top-1 bottom-1 w-14 rounded-full bg-white shadow-lg flex items-center justify-center transition-all duration-75 pointer-events-none z-10`}
        style={{ left: `calc(${sliderValue}% - ${sliderValue * 0.56}px)` }} // Adjust handle position
      >
        <ChevronRight size={24} className={mode === 'IN' ? 'text-green-500' : 'text-red-500'} />
      </div>
    </div>
  );
};

const TeamHub: React.FC<TeamHubProps> = ({ users, roles, onUpdateUsers, onUpdateRoles, onClose }) => {
  const [activeTab, setActiveTab] = useState<'CLOCK' | 'SCHEDULE' | 'ROLES'>('CLOCK');
  
  // Clock-in State
  const [pin, setPin] = useState('');
  const [authenticatedUser, setAuthenticatedUser] = useState<User | null>(null);
  const [isFaceScanning, setIsFaceScanning] = useState(false);
  const [timeRecords, setTimeRecords] = useState<TimeRecord[]>([]);

  // Schedule State
  const [shifts, setShifts] = useState<Shift[]>(INITIAL_SHIFTS);
  const [draggedShiftTemplate, setDraggedShiftTemplate] = useState<Shift | null>(null);

  // Roles State
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);

  // --- LOGIC: CLOCK IN/OUT ---
  
  const handlePinPress = (key: string) => {
    if (key === 'C') {
      setPin('');
      setAuthenticatedUser(null);
    } else if (key === 'BACK') {
      setPin(prev => prev.slice(0, -1));
    } else {
      const newPin = pin + key;
      setPin(newPin);
      if (newPin.length === 4) {
        const user = users.find(u => u.pin === newPin);
        if (user) {
          setAuthenticatedUser(user);
        } else {
          setPin('');
          alert('PIN Incorrecto');
        }
      }
    }
  };

  const handleFaceId = () => {
    setIsFaceScanning(true);
    setTimeout(() => {
      setIsFaceScanning(false);
      // Simulate finding a random user
      setPin(users[0].pin); 
      setAuthenticatedUser(users[0]);
    }, 2000);
  };

  const handleClockAction = (type: 'IN' | 'OUT') => {
    if (!authenticatedUser) return;
    const record: TimeRecord = {
      id: Math.random().toString(36).substr(2,9),
      userId: authenticatedUser.id,
      type,
      timestamp: new Date().toISOString(),
      method: isFaceScanning ? 'FACE_ID' : 'PIN'
    };
    setTimeRecords(prev => [record, ...prev]);
    alert(`${type === 'IN' ? 'Entrada' : 'Salida'} registrada: ${new Date().toLocaleTimeString()}`);
    setPin('');
    setAuthenticatedUser(null);
  };

  // --- LOGIC: SCHEDULE DRAG & DROP ---

  const handleDrop = (e: React.DragEvent, userId: string, dayIdx: number) => {
    e.preventDefault();
    if (!draggedShiftTemplate) return;

    const newShift: Shift = {
      ...draggedShiftTemplate,
      id: Math.random().toString(36).substr(2, 9),
      userId,
      dayOfWeek: dayIdx
    };
    setShifts(prev => [...prev, newShift]);
    setDraggedShiftTemplate(null);
  };

  const deleteShift = (shiftId: string) => {
    setShifts(prev => prev.filter(s => s.id !== shiftId));
  };

  // --- LOGIC: ROLES ---
  const togglePermission = (roleId: string, permKey: string) => {
    const updatedRoles = roles.map(role => {
      if (role.id === roleId) {
        const hasPerm = role.permissions.includes(permKey);
        return {
          ...role,
          permissions: hasPerm 
            ? role.permissions.filter(p => p !== permKey)
            : [...role.permissions, permKey]
        };
      }
      return role;
    });
    onUpdateRoles(updatedRoles);
  };

  // --- RENDER CONTENT ---

  return (
    <div className="h-screen w-full bg-gray-100 flex flex-col overflow-hidden animate-in fade-in">
      
      {/* Header Tabs */}
      <div className="bg-white border-b border-gray-200 px-6 pt-6 pb-0 flex justify-between items-center shrink-0">
        <div className="flex gap-8">
          <button 
            onClick={() => setActiveTab('CLOCK')}
            className={`pb-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === 'CLOCK' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            <Clock size={18} /> Fichaje
          </button>
          <button 
            onClick={() => setActiveTab('SCHEDULE')}
            className={`pb-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === 'SCHEDULE' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            <Calendar size={18} /> Turnos & Horarios
          </button>
          <button 
            onClick={() => setActiveTab('ROLES')}
            className={`pb-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === 'ROLES' ? 'border-purple-500 text-purple-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
          >
            <ShieldCheck size={18} /> Roles & Permisos
          </button>
        </div>
        <button onClick={onClose} className="mb-4 p-2 bg-gray-100 rounded-full text-gray-500 hover:bg-gray-200">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-hidden relative">
        
        {/* === TAB: CLOCK IN/OUT === */}
        {activeTab === 'CLOCK' && (
          <div className="h-full flex flex-col items-center justify-center p-6 bg-gray-50">
            
            <div className="w-full max-w-md bg-white rounded-[2.5rem] shadow-xl p-8 border border-gray-100 flex flex-col items-center relative overflow-hidden">
               
               {/* Status Header */}
               <div className="mb-8 text-center">
                  <div className="w-20 h-20 rounded-full bg-blue-50 mx-auto mb-4 flex items-center justify-center shadow-inner">
                     {authenticatedUser ? (
                        <img src={authenticatedUser.photo || ''} alt="User" className="w-full h-full rounded-full object-cover" />
                     ) : (
                        <Lock size={32} className="text-blue-400" />
                     )}
                  </div>
                  <h2 className="text-2xl font-black text-gray-800">
                     {authenticatedUser ? `Hola, ${authenticatedUser.name}` : 'Ingresa tu PIN'}
                  </h2>
                  <p className="text-gray-400 text-sm mt-1">
                     {authenticatedUser ? 'Desliza para registrar actividad' : 'Control de Asistencia'}
                  </p>
               </div>

               {/* PIN Dots (Hidden if Auth) */}
               {!authenticatedUser && (
                  <div className="flex gap-4 mb-8">
                     {[0,1,2,3].map(i => (
                        <div key={i} className={`w-4 h-4 rounded-full transition-all ${pin.length > i ? 'bg-blue-500 scale-110' : 'bg-gray-200'}`} />
                     ))}
                  </div>
               )}

               {/* Actions or Keypad */}
               {authenticatedUser ? (
                  <div className="w-full space-y-4 animate-in slide-in-from-bottom-10">
                     <SlideUnlock label="Desliza para Entrar" mode="IN" onUnlock={() => handleClockAction('IN')} />
                     <SlideUnlock label="Desliza para Salir" mode="OUT" onUnlock={() => handleClockAction('OUT')} />
                     
                     <button onClick={() => { setAuthenticatedUser(null); setPin(''); }} className="w-full py-3 text-gray-400 text-sm font-medium hover:text-gray-600">
                        Cancelar / Cambiar Usuario
                     </button>
                  </div>
               ) : (
                  <div className="w-full">
                     <div className="grid grid-cols-3 gap-4 mb-6">
                        {[1,2,3,4,5,6,7,8,9].map(n => (
                           <button key={n} onClick={() => handlePinPress(n.toString())} className="h-16 rounded-2xl bg-gray-50 hover:bg-gray-100 text-2xl font-bold text-gray-700 transition-all active:scale-95 shadow-sm border border-gray-100">
                              {n}
                           </button>
                        ))}
                        <button onClick={handleFaceId} className="h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center active:scale-95 relative overflow-hidden">
                           {isFaceScanning ? (
                              <div className="absolute inset-0 bg-blue-100 flex items-center justify-center">
                                 <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                              </div>
                           ) : (
                              <ScanFace size={28} />
                           )}
                        </button>
                        <button onClick={() => handlePinPress('0')} className="h-16 rounded-2xl bg-gray-50 hover:bg-gray-100 text-2xl font-bold text-gray-700 transition-all active:scale-95 shadow-sm border border-gray-100">
                           0
                        </button>
                        <button onClick={() => handlePinPress('BACK')} className="h-16 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center active:scale-95">
                           <Trash2 size={24} />
                        </button>
                     </div>
                  </div>
               )}

            </div>

            {/* Recent Activity Log */}
            <div className="mt-8 w-full max-w-md">
               <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 ml-2">Actividad Reciente</h3>
               <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-200 max-h-40 overflow-y-auto">
                  {timeRecords.length === 0 ? (
                     <p className="text-center text-gray-400 text-xs py-2">Sin registros hoy</p>
                  ) : (
                     timeRecords.map(rec => {
                        const user = users.find(u => u.id === rec.userId);
                        return (
                           <div key={rec.id} className="flex justify-between items-center py-2 border-b border-gray-50 last:border-0">
                              <div className="flex items-center gap-2">
                                 <div className={`p-1.5 rounded-lg ${rec.type === 'IN' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                    {rec.type === 'IN' ? <LogIn size={14} /> : <LogOut size={14} />}
                                 </div>
                                 <span className="text-sm font-bold text-gray-700">{user?.name}</span>
                              </div>
                              <span className="text-xs text-gray-500 font-mono">
                                 {new Date(rec.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                              </span>
                           </div>
                        );
                     })
                  )}
               </div>
            </div>

          </div>
        )}

        {/* === TAB: SCHEDULE === */}
        {activeTab === 'SCHEDULE' && (
          <div className="h-full flex flex-col lg:flex-row">
             
             {/* Templates Sidebar */}
             <div className="w-full lg:w-64 bg-white border-r border-gray-200 p-4 flex flex-col gap-4 overflow-y-auto z-10">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Plantillas de Turno</h3>
                <p className="text-xs text-gray-500 mb-2">Arrastra al calendario</p>
                
                {UNASSIGNED_SHIFTS.map(shift => (
                   <div 
                      key={shift.id}
                      draggable
                      onDragStart={(e) => {
                         setDraggedShiftTemplate(shift);
                         // Minimal styling for drag image if needed, browser handles default
                      }}
                      className={`p-4 rounded-xl cursor-grab active:cursor-grabbing shadow-sm border ${shift.color} hover:brightness-95 transition-all`}
                   >
                      <div className="font-bold text-sm">{shift.label}</div>
                      <div className="text-xs opacity-80 mt-1 flex items-center gap-1">
                         <Clock size={12} /> {shift.startTime} - {shift.endTime}
                      </div>
                   </div>
                ))}
             </div>

             {/* Calendar Grid */}
             <div className="flex-1 overflow-x-auto p-4 md:p-6 bg-gray-50">
                <div className="min-w-[800px]">
                   
                   {/* Days Header */}
                   <div className="grid grid-cols-[200px_repeat(7,1fr)] gap-2 mb-2">
                      <div className="p-2 font-bold text-gray-400 text-xs uppercase text-right pr-4 self-end">Empleado</div>
                      {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((day, idx) => (
                         <div key={day} className={`p-2 text-center rounded-lg font-bold text-sm ${idx === new Date().getDay() ? 'bg-blue-600 text-white shadow-md' : 'text-gray-600 bg-white'}`}>
                            {day}
                         </div>
                      ))}
                   </div>

                   {/* Rows per User */}
                   {users.map(user => (
                      <div key={user.id} className="grid grid-cols-[200px_repeat(7,1fr)] gap-2 mb-2">
                         
                         {/* User Cell */}
                         <div className="bg-white p-3 rounded-xl border border-gray-100 flex items-center gap-3 shadow-sm sticky left-0 z-10">
                            <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden">
                               {user.photo ? <img src={user.photo} className="w-full h-full object-cover" /> : <Users size={16} className="m-2 text-gray-500" />}
                            </div>
                            <div>
                               <p className="text-sm font-bold text-gray-800 leading-tight">{user.name}</p>
                               <p className="text-[10px] text-gray-400 font-medium">{roles.find(r => r.id === user.role)?.name}</p>
                            </div>
                         </div>

                         {/* Days Cells */}
                         {[0,1,2,3,4,5,6].map(dayIdx => {
                            const userShift = shifts.find(s => s.userId === user.id && s.dayOfWeek === dayIdx);
                            
                            return (
                               <div 
                                  key={dayIdx}
                                  onDragOver={(e) => e.preventDefault()}
                                  onDrop={(e) => handleDrop(e, user.id, dayIdx)}
                                  className={`relative h-20 rounded-xl border-2 border-dashed transition-all flex flex-col justify-center p-2 ${
                                     userShift 
                                        ? `border-transparent shadow-sm ${userShift.color}` 
                                        : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                                  }`}
                               >
                                  {userShift ? (
                                     <div className="relative group">
                                        <p className="font-bold text-xs">{userShift.label}</p>
                                        <p className="text-[10px] opacity-80">{userShift.startTime} - {userShift.endTime}</p>
                                        <button 
                                           onClick={() => deleteShift(userShift.id)}
                                           className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 p-1 bg-white rounded-full text-red-500 shadow-sm hover:scale-110 transition-all"
                                        >
                                           <X size={12} />
                                        </button>
                                     </div>
                                  ) : (
                                     <div className="hidden hover:flex w-full h-full items-center justify-center opacity-20">
                                        <Plus size={20} className="text-blue-400" />
                                     </div>
                                  )}
                               </div>
                            );
                         })}
                      </div>
                   ))}

                </div>
             </div>
          </div>
        )}

        {/* === TAB: ROLES & PERMISSIONS === */}
        {activeTab === 'ROLES' && (
          <div className="h-full flex overflow-hidden">
             
             {/* Roles List */}
             <div className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
                {roles.map(role => (
                   <button
                      key={role.id}
                      onClick={() => setEditingRole(role)}
                      className={`w-full p-4 text-left border-l-4 transition-all hover:bg-gray-50 flex items-center justify-between ${
                         editingRole?.id === role.id 
                            ? 'border-purple-500 bg-purple-50 text-purple-900' 
                            : 'border-transparent text-gray-600'
                      }`}
                   >
                      <span className="font-bold text-sm">{role.name}</span>
                      {role.isSystem && <Lock size={14} className="text-gray-400" />}
                   </button>
                ))}
             </div>

             {/* Permission Editor */}
             <div className="flex-1 bg-gray-50 p-8 overflow-y-auto">
                {editingRole ? (
                   <div className="max-w-4xl mx-auto">
                      <div className="mb-8 flex items-center gap-3">
                         <div className="p-3 bg-purple-100 rounded-xl text-purple-600">
                            <ShieldCheck size={32} />
                         </div>
                         <div>
                            <h2 className="text-2xl font-black text-gray-800">{editingRole.name}</h2>
                            <p className="text-gray-500 text-sm">Configura qué puede hacer este rol.</p>
                         </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                         {['SALES', 'CASH', 'ADMIN', 'SYSTEM'].map(category => {
                            // Filter logic would go here if PermissionDetail had category
                            // Since types were updated, we assume mocked AVAILABLE_PERMISSIONS needs categories update
                            // For visual demo, we group by what we have or mock it.
                            
                            // Let's filter AVAILABLE_PERMISSIONS manually based on key prefix or list
                            let perms = [];
                            if (category === 'SALES') perms = AVAILABLE_PERMISSIONS.filter(p => ['CAN_APPLY_DISCOUNT', 'CAN_VOID_ITEM', 'CAN_MANAGE_TABLES'].includes(p.key));
                            if (category === 'CASH') perms = AVAILABLE_PERMISSIONS.filter(p => ['CAN_FINALIZE_PAYMENT', 'CAN_CLOSE_REGISTER'].includes(p.key));
                            if (category === 'ADMIN') perms = AVAILABLE_PERMISSIONS.filter(p => ['CAN_ACCESS_SETTINGS', 'CAN_VIEW_REPORTS', 'CAN_MANAGE_CUSTOMERS'].includes(p.key));
                            
                            if (perms.length === 0) return null;

                            return (
                               <div key={category} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200">
                                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 border-b border-gray-100 pb-2">
                                     {category === 'SALES' ? 'Punto de Venta' : category === 'CASH' ? 'Caja y Dinero' : 'Administración'}
                                  </h4>
                                  <div className="space-y-3">
                                     {perms.map(perm => {
                                        const isEnabled = editingRole.permissions.includes(perm.key);
                                        return (
                                           <div 
                                              key={perm.key} 
                                              onClick={() => !editingRole.isSystem && togglePermission(editingRole.id, perm.key)}
                                              className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                                                 isEnabled 
                                                    ? 'bg-purple-50 border-purple-200' 
                                                    : 'bg-gray-50 border-transparent hover:border-gray-200'
                                              } ${editingRole.isSystem ? 'opacity-50 pointer-events-none' : ''}`}
                                           >
                                              <div className="flex-1">
                                                 <p className={`text-sm font-bold ${isEnabled ? 'text-purple-700' : 'text-gray-600'}`}>{perm.label}</p>
                                                 <p className="text-[10px] text-gray-400 leading-tight">{perm.description}</p>
                                              </div>
                                              <div className={`w-10 h-6 rounded-full relative transition-colors duration-300 ${isEnabled ? 'bg-purple-500' : 'bg-gray-300'}`}>
                                                 <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 ${isEnabled ? 'left-5' : 'left-1'}`} />
                                              </div>
                                           </div>
                                        );
                                     })}
                                  </div>
                               </div>
                            );
                         })}
                      </div>
                   </div>
                ) : (
                   <div className="h-full flex items-center justify-center text-gray-400">
                      <p>Selecciona un rol para editar</p>
                   </div>
                )}
             </div>
          </div>
        )}

      </div>
    </div>
  );
};

export default TeamHub;