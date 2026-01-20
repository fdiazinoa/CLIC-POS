
import React, { useState, useMemo } from 'react';
import {
   Users, Calendar, ShieldCheck, Clock, Check, X,
   UserPlus, ScanFace, ChevronRight, Lock,
   Trash2, AlertCircle, LogIn, LogOut, Plus,
   FileBarChart, AlertOctagon, Download, Edit2, User as UserIcon
} from 'lucide-react';
import { User, RoleDefinition, Shift, TimeRecord } from '../types';
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

// MOCK DATA FOR REPORT DEMO (Usually comes from DB)
const MOCK_TIME_RECORDS: TimeRecord[] = [
   // User 2: Normal Day
   { id: 'tr1', userId: 'u2', type: 'IN', timestamp: new Date(new Date().setHours(8, 55)).toISOString(), method: 'PIN' },
   { id: 'tr2', userId: 'u2', type: 'OUT', timestamp: new Date(new Date().setHours(17, 5)).toISOString(), method: 'PIN' },
   // User 3: Missing Out
   { id: 'tr3', userId: 'u3', type: 'IN', timestamp: new Date(new Date().setHours(14, 58)).toISOString(), method: 'PIN' },
   // User 4: Overtime
   { id: 'tr4', userId: 'u4', type: 'IN', timestamp: new Date(new Date().setHours(9, 0)).toISOString(), method: 'PIN' },
   { id: 'tr5', userId: 'u4', type: 'OUT', timestamp: new Date(new Date().setHours(20, 30)).toISOString(), method: 'PIN' },
];

// --- HELPER COMPONENTS ---

const SlideUnlock: React.FC<{ onUnlock: () => void; label: string; mode: 'IN' | 'OUT' }> = ({ onUnlock, label, mode }) => {
   const [sliderValue, setSliderValue] = useState(0);

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
   const [activeTab, setActiveTab] = useState<'CLOCK' | 'USERS' | 'SCHEDULE' | 'ROLES' | 'REPORTS'>('CLOCK');

   // Clock-in State
   const [pin, setPin] = useState('');
   const [authenticatedUser, setAuthenticatedUser] = useState<User | null>(null);
   const [isFaceScanning, setIsFaceScanning] = useState(false);
   const [timeRecords, setTimeRecords] = useState<TimeRecord[]>(MOCK_TIME_RECORDS);

   // Schedule State
   const [shifts, setShifts] = useState<Shift[]>(INITIAL_SHIFTS);
   const [draggedShiftTemplate, setDraggedShiftTemplate] = useState<Shift | null>(null);

   // Roles State
   const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);

   // Users Management State
   const [isUserModalOpen, setIsUserModalOpen] = useState(false);
   const [editingUser, setEditingUser] = useState<User | null>(null);
   const [userForm, setUserForm] = useState<Partial<User>>({});

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
         id: Math.random().toString(36).substr(2, 9),
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

   // --- LOGIC: USER MANAGEMENT ---
   const handleSaveUser = () => {
      if (!userForm.name || !userForm.pin || !userForm.role) return alert("Completa todos los campos");

      if (editingUser) {
         onUpdateUsers(users.map(u => u.id === editingUser.id ? { ...editingUser, ...userForm } as User : u));
      } else {
         const newUser: User = {
            id: `u-${Date.now()}`,
            name: userForm.name!,
            pin: userForm.pin!,
            role: userForm.role!,
            photo: userForm.photo
         };
         onUpdateUsers([...users, newUser]);
      }
      setIsUserModalOpen(false);
      setUserForm({});
      setEditingUser(null);
   };

   const handleDeleteUser = (id: string) => {
      if (confirm("¿Eliminar usuario?")) {
         onUpdateUsers(users.filter(u => u.id !== id));
      }
   };

   const openUserModal = (user?: User) => {
      if (user) {
         setEditingUser(user);
         setUserForm(user);
      } else {
         setEditingUser(null);
         setUserForm({ role: 'CASHIER' }); // Default role
      }
      setIsUserModalOpen(true);
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
   const handleAddRole = () => {
      const newRole: RoleDefinition = {
         id: `role_${Date.now()}`,
         name: 'Nuevo Rol',
         permissions: ['SALE'],
         isSystem: false
      };
      onUpdateRoles([...roles, newRole]);
      setEditingRole(newRole);
   };

   const handleUpdateRoleName = (roleId: string, newName: string) => {
      onUpdateRoles(roles.map(r => r.id === roleId ? { ...r, name: newName } : r));
      // Update local state to reflect typing immediately
      if (editingRole && editingRole.id === roleId) {
         setEditingRole({ ...editingRole, name: newName });
      }
   };

   const togglePermission = (roleId: string, permKey: string) => {
      const updatedRoles = roles.map(role => {
         if (role.id === roleId) {
            const hasPerm = role.permissions.includes(permKey);
            const newRole = {
               ...role,
               permissions: hasPerm
                  ? role.permissions.filter(p => p !== permKey)
                  : [...role.permissions, permKey]
            };
            // Also update local state
            if (editingRole?.id === roleId) setEditingRole(newRole);
            return newRole;
         }
         return role;
      });
      onUpdateRoles(updatedRoles);
   };

   const handleDeleteRole = (roleId: string) => {
      if (confirm("¿Eliminar este rol?")) {
         onUpdateRoles(roles.filter(r => r.id !== roleId));
         if (editingRole?.id === roleId) setEditingRole(null);
      }
   };

   // --- LOGIC: REPORTS ---
   const dailyReports = useMemo(() => {
      const reports: any[] = [];
      users.forEach(user => {
         const userRecords = timeRecords.filter(r => r.userId === user.id).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
         if (userRecords.length > 0) {
            const firstIn = userRecords.find(r => r.type === 'IN');
            const lastOut = userRecords.reverse().find(r => r.type === 'OUT');
            let totalHours = 0;
            let status = 'OK';
            if (firstIn && lastOut && new Date(lastOut.timestamp) > new Date(firstIn.timestamp)) {
               const diffMs = new Date(lastOut.timestamp).getTime() - new Date(firstIn.timestamp).getTime();
               totalHours = diffMs / (1000 * 60 * 60);
               if (totalHours > 8) status = 'OVERTIME';
            } else if (firstIn && !lastOut) {
               status = 'MISSING_OUT';
            }
            if (firstIn) {
               reports.push({
                  id: user.id + firstIn.timestamp,
                  userName: user.name,
                  date: new Date(firstIn.timestamp).toLocaleDateString(),
                  inTime: new Date(firstIn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  outTime: lastOut ? new Date(lastOut.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-',
                  totalHours: totalHours.toFixed(2),
                  status
               });
            }
         }
      });
      return reports;
   }, [timeRecords, users]);

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
                  onClick={() => setActiveTab('USERS')}
                  className={`pb-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === 'USERS' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
               >
                  <Users size={18} /> Equipo
               </button>
               <button
                  onClick={() => setActiveTab('SCHEDULE')}
                  className={`pb-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === 'SCHEDULE' ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
               >
                  <Calendar size={18} /> Turnos & Horarios
               </button>
               <button
                  onClick={() => setActiveTab('REPORTS')}
                  className={`pb-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === 'REPORTS' ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
               >
                  <FileBarChart size={18} /> Reporte de Horas
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

            {/* === TAB: CLOCK IN/OUT (REDESIGNED) === */}
            {activeTab === 'CLOCK' && (
               <div className="h-full flex flex-col items-center justify-center p-6 bg-gray-50/50">
                  {/* ... Clock Content (Unchanged) ... */}
                  <div className="w-full max-w-[380px] flex flex-col gap-6">
                     <div className="bg-white rounded-[2.5rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] p-8 flex flex-col items-center relative z-10">
                        <div className="mb-8 text-center w-full">
                           <div className="w-20 h-20 rounded-full bg-blue-50 mx-auto mb-6 flex items-center justify-center shadow-inner border border-blue-100/50">
                              {authenticatedUser ? (
                                 <img src={authenticatedUser.photo || ''} alt="User" className="w-full h-full rounded-full object-cover" />
                              ) : (
                                 <Lock size={32} className="text-blue-500" strokeWidth={2.5} />
                              )}
                           </div>
                           <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
                              {authenticatedUser ? `Hola, ${authenticatedUser.name.split(' ')[0]}` : 'Ingresa tu PIN'}
                           </h2>
                           <p className="text-slate-400 text-sm font-medium mt-2 uppercase tracking-wide text-[10px]">
                              {authenticatedUser ? 'Desliza para registrar' : 'Control de Asistencia'}
                           </p>
                        </div>

                        {!authenticatedUser && (
                           <div className="flex gap-4 mb-10 justify-center">
                              {[0, 1, 2, 3].map(i => (
                                 <div key={i} className={`w-3.5 h-3.5 rounded-full transition-all duration-300 ${pin.length > i ? 'bg-blue-500 scale-110 shadow-sm shadow-blue-200' : 'bg-slate-200'}`} />
                              ))}
                           </div>
                        )}

                        {authenticatedUser ? (
                           <div className="w-full space-y-4 animate-in slide-in-from-bottom-10 fade-in duration-500">
                              <SlideUnlock label="Entrada" mode="IN" onUnlock={() => handleClockAction('IN')} />
                              <SlideUnlock label="Salida" mode="OUT" onUnlock={() => handleClockAction('OUT')} />
                              <button onClick={() => { setAuthenticatedUser(null); setPin(''); }} className="w-full py-3 text-slate-400 text-xs font-bold uppercase tracking-wider hover:text-slate-600 transition-colors mt-2">Cancelar</button>
                           </div>
                        ) : (
                           <div className="w-full px-2">
                              <div className="grid grid-cols-3 gap-3 mb-2">
                                 {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                                    <button key={n} onClick={() => handlePinPress(n.toString())} className="h-16 rounded-2xl bg-white hover:bg-slate-50 text-2xl font-bold text-slate-700 transition-all active:scale-95 shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-slate-100">{n}</button>
                                 ))}
                                 <div className="h-16"></div>
                                 <button onClick={() => handlePinPress('0')} className="h-16 rounded-2xl bg-white hover:bg-slate-50 text-2xl font-bold text-slate-700 transition-all active:scale-95 shadow-[0_2px_10px_rgba(0,0,0,0.03)] border border-slate-100">0</button>
                                 <button onClick={() => handlePinPress('BACK')} className="h-16 rounded-2xl flex items-center justify-center active:scale-95 transition-all text-slate-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={24} /></button>
                              </div>
                           </div>
                        )}
                     </div>
                  </div>
               </div>
            )}

            {/* === TAB: USER MANAGEMENT === */}
            {activeTab === 'USERS' && (
               <div className="h-full flex flex-col p-8 bg-gray-50">
                  {/* ... Users Content (Unchanged) ... */}
                  <div className="flex justify-between items-center mb-6">
                     <div>
                        <h2 className="text-2xl font-black text-gray-800">Directorio de Equipo</h2>
                        <p className="text-gray-500 text-sm">Gestiona accesos y roles de empleados.</p>
                     </div>
                     <button onClick={() => openUserModal()} className="px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2">
                        <UserPlus size={18} /> Nuevo Usuario
                     </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto pb-20">
                     {users.map(user => {
                        const role = roles.find(r => r.id === user.role);
                        return (
                           <div key={user.id} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-all group relative overflow-hidden">
                              <div className={`absolute top-0 right-0 w-20 h-20 bg-gradient-to-bl from-${role?.id === 'ADMIN' ? 'red' : 'indigo'}-50 to-transparent rounded-bl-full opacity-50`}></div>
                              <div className="flex items-start justify-between mb-4">
                                 <div className="flex items-center gap-4">
                                    <div className="w-14 h-14 rounded-full bg-gray-100 overflow-hidden border-2 border-white shadow-sm">
                                       {user.photo ? <img src={user.photo} alt={user.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-gray-400"><UserIcon size={24} /></div>}
                                    </div>
                                    <div>
                                       <h3 className="font-bold text-gray-800 text-lg leading-tight">{user.name}</h3>
                                       <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full uppercase tracking-wide">{role?.name || user.role}</span>
                                    </div>
                                 </div>
                                 <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => openUserModal(user)} className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"><Edit2 size={16} /></button>
                                    <button onClick={() => handleDeleteUser(user.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={16} /></button>
                                 </div>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-gray-400 font-mono bg-gray-50 p-2 rounded-lg">
                                 <Lock size={12} /><span>PIN: ••••</span>
                              </div>
                           </div>
                        );
                     })}
                  </div>
                  {/* User Modal */}
                  {isUserModalOpen && (
                     <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
                        <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl">
                           <h3 className="text-xl font-bold text-gray-800 mb-6">{editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}</h3>
                           <div className="space-y-4">
                              <div>
                                 <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre Completo</label>
                                 <input type="text" value={userForm.name || ''} onChange={e => setUserForm({ ...userForm, name: e.target.value })} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Ej. Juan Pérez" />
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                 <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">PIN (4 Dígitos)</label>
                                    <input type="password" maxLength={4} value={userForm.pin || ''} onChange={e => setUserForm({ ...userForm, pin: e.target.value })} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-mono tracking-widest text-center" placeholder="0000" />
                                 </div>
                                 <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Rol</label>
                                    <select value={userForm.role || 'CASHIER'} onChange={e => setUserForm({ ...userForm, role: e.target.value })} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm">
                                       {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                    </select>
                                 </div>
                              </div>
                              <div>
                                 <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Foto de Perfil</label>
                                 <div className="flex items-center gap-4">
                                    <div className="w-16 h-16 rounded-full bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden shrink-0">
                                       {userForm.photo ? (
                                          <img src={userForm.photo} alt="Preview" className="w-full h-full object-cover" />
                                       ) : (
                                          <UserIcon size={24} className="text-gray-400" />
                                       )}
                                    </div>
                                    <div className="flex-1">
                                       <input
                                          type="file"
                                          accept="image/*"
                                          onChange={(e) => {
                                             const file = e.target.files?.[0];
                                             if (file) {
                                                const reader = new FileReader();
                                                reader.onloadend = () => {
                                                   setUserForm({ ...userForm, photo: reader.result as string });
                                                };
                                                reader.readAsDataURL(file);
                                             }
                                          }}
                                          className="w-full text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                       />
                                       <p className="text-[10px] text-gray-400 mt-1">Formatos: JPG, PNG. Se guardará localmente.</p>
                                    </div>
                                 </div>
                              </div>
                           </div>
                           <div className="flex gap-3 mt-8">
                              <button onClick={() => setIsUserModalOpen(false)} className="flex-1 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-xl">Cancelar</button>
                              <button onClick={handleSaveUser} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-md">Guardar</button>
                           </div>
                        </div>
                     </div>
                  )}
               </div>
            )}

            {/* === TAB: SCHEDULE === */}
            {activeTab === 'SCHEDULE' && (
               <div className="h-full flex flex-col lg:flex-row">
                  {/* ... Schedule Content (Unchanged) ... */}
                  <div className="w-full lg:w-64 bg-white border-r border-gray-200 p-4 flex flex-col gap-4 overflow-y-auto z-10">
                     <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Plantillas de Turno</h3>
                     {UNASSIGNED_SHIFTS.map(shift => (
                        <div key={shift.id} draggable onDragStart={(e) => setDraggedShiftTemplate(shift)} className={`p-4 rounded-xl cursor-grab active:cursor-grabbing shadow-sm border ${shift.color} hover:brightness-95 transition-all`}>
                           <div className="font-bold text-sm">{shift.label}</div>
                           <div className="text-xs opacity-80 mt-1 flex items-center gap-1"><Clock size={12} /> {shift.startTime} - {shift.endTime}</div>
                        </div>
                     ))}
                  </div>
                  <div className="flex-1 overflow-x-auto p-4 md:p-6 bg-gray-50">
                     <div className="min-w-[800px]">
                        <div className="grid grid-cols-[200px_repeat(7,1fr)] gap-2 mb-2">
                           <div className="p-2 font-bold text-gray-400 text-xs uppercase text-right pr-4 self-end">Empleado</div>
                           {['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].map((day, idx) => (
                              <div key={day} className={`p-2 text-center rounded-lg font-bold text-sm ${idx === new Date().getDay() ? 'bg-blue-600 text-white shadow-md' : 'text-gray-600 bg-white'}`}>{day}</div>
                           ))}
                        </div>
                        {users.map(user => (
                           <div key={user.id} className="grid grid-cols-[200px_repeat(7,1fr)] gap-2 mb-2">
                              <div className="bg-white p-3 rounded-xl border border-gray-100 flex items-center gap-3 shadow-sm sticky left-0 z-10">
                                 <div className="w-8 h-8 rounded-full bg-gray-200 overflow-hidden">{user.photo ? <img src={user.photo} alt="User" className="w-full h-full object-cover" /> : <Users size={16} className="m-2 text-gray-500" />}</div>
                                 <div><p className="text-sm font-bold text-gray-800 leading-tight">{user.name}</p><p className="text-[10px] text-gray-400 font-medium">{roles.find(r => r.id === user.role)?.name}</p></div>
                              </div>
                              {[0, 1, 2, 3, 4, 5, 6].map(dayIdx => {
                                 const userShift = shifts.find(s => s.userId === user.id && s.dayOfWeek === dayIdx);
                                 return (
                                    <div key={dayIdx} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, user.id, dayIdx)} className={`relative h-20 rounded-xl border-2 border-dashed transition-all flex flex-col justify-center p-2 ${userShift ? `border-transparent shadow-sm ${userShift.color}` : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50'}`}>
                                       {userShift ? (
                                          <div className="relative group">
                                             <p className="font-bold text-xs">{userShift.label}</p>
                                             <p className="text-[10px] opacity-80">{userShift.startTime} - {userShift.endTime}</p>
                                             <button onClick={() => deleteShift(userShift.id)} className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 p-1 bg-white rounded-full text-red-500 shadow-sm hover:scale-110 transition-all"><X size={12} /></button>
                                          </div>
                                       ) : <div className="hidden hover:flex w-full h-full items-center justify-center opacity-20"><Plus size={20} className="text-blue-400" /></div>}
                                    </div>
                                 );
                              })}
                           </div>
                        ))}
                     </div>
                  </div>
               </div>
            )}

            {/* === TAB: REPORTS (HR ANALYTICS) === */}
            {activeTab === 'REPORTS' && (
               <div className="h-full flex flex-col bg-gray-50 p-8 overflow-hidden">
                  {/* ... Reports Content (Unchanged) ... */}
                  <div className="flex justify-between items-end mb-6">
                     <div><h2 className="text-2xl font-black text-gray-800 flex items-center gap-2"><FileBarChart className="text-emerald-600" /> Reporte de Jornada</h2><p className="text-gray-500 mt-1">Resumen de horas trabajadas y alertas de asistencia.</p></div>
                     <button className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-gray-600 font-bold text-sm shadow-sm hover:bg-gray-50 flex items-center gap-2"><Download size={16} /> Exportar Excel</button>
                  </div>
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex-1 flex flex-col">
                     <div className="overflow-x-auto flex-1">
                        <table className="w-full text-left">
                           <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                              <tr>
                                 <th className="p-4 font-bold text-gray-500 text-xs uppercase tracking-wider">Empleado</th>
                                 <th className="p-4 font-bold text-gray-500 text-xs uppercase tracking-wider">Fecha</th>
                                 <th className="p-4 font-bold text-gray-500 text-xs uppercase tracking-wider">Entrada</th>
                                 <th className="p-4 font-bold text-gray-500 text-xs uppercase tracking-wider">Salida</th>
                                 <th className="p-4 font-bold text-gray-500 text-xs uppercase tracking-wider text-right">Total Horas</th>
                                 <th className="p-4 font-bold text-gray-500 text-xs uppercase tracking-wider text-center">Estado</th>
                              </tr>
                           </thead>
                           <tbody className="divide-y divide-gray-100 text-sm">
                              {dailyReports.map((report) => (
                                 <tr key={report.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="p-4 font-bold text-gray-800">{report.userName}</td>
                                    <td className="p-4 text-gray-600">{report.date}</td>
                                    <td className="p-4 font-mono text-gray-600">{report.inTime}</td>
                                    <td className="p-4 font-mono text-gray-600">{report.outTime}</td>
                                    <td className="p-4 font-mono font-bold text-right">{report.totalHours}h</td>
                                    <td className="p-4 text-center">
                                       {report.status === 'OK' && <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-bold">Normal</span>}
                                       {report.status === 'OVERTIME' && <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-bold flex items-center justify-center gap-1"><AlertOctagon size={10} /> Extras</span>}
                                       {report.status === 'MISSING_OUT' && <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-xs font-bold flex items-center justify-center gap-1"><AlertCircle size={10} /> Sin Salida</span>}
                                    </td>
                                 </tr>
                              ))}
                              {dailyReports.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-gray-400 italic">No hay registros de jornada para este período.</td></tr>}
                           </tbody>
                        </table>
                     </div>
                  </div>
               </div>
            )}

            {/* === TAB: ROLES & PERMISSIONS === */}
            {activeTab === 'ROLES' && (
               <div className="h-full flex overflow-hidden">

                  {/* Roles List Sidebar */}
                  <div className="w-72 bg-white border-r border-gray-200 flex flex-col shrink-0">
                     <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                        <span className="text-xs font-black text-gray-500 uppercase tracking-widest">LISTA DE ROLES</span>
                        <button
                           onClick={handleAddRole}
                           className="bg-purple-600 text-white p-2 rounded-lg hover:bg-purple-700 shadow-md transition-all active:scale-95 flex items-center justify-center"
                           title="Crear Nuevo Rol"
                        >
                           <Plus size={18} strokeWidth={3} />
                        </button>
                     </div>

                     <div className="flex-1 overflow-y-auto">
                        {roles.map(role => (
                           <button
                              key={role.id}
                              onClick={() => setEditingRole(role)}
                              className={`w-full p-4 text-left border-l-4 transition-all hover:bg-gray-50 flex items-center justify-between group ${editingRole?.id === role.id
                                    ? 'border-purple-500 bg-purple-50 text-purple-900'
                                    : 'border-transparent text-gray-600'
                                 }`}
                           >
                              <span className="font-bold text-sm truncate pr-2">{role.name}</span>
                              {role.isSystem ? (
                                 <Lock size={14} className="text-gray-400 shrink-0" />
                              ) : (
                                 <span className="opacity-0 group-hover:opacity-100 text-purple-400 transition-opacity">
                                    <ChevronRight size={14} />
                                 </span>
                              )}
                           </button>
                        ))}
                     </div>
                  </div>

                  {/* Permission Editor */}
                  <div className="flex-1 bg-gray-50 p-8 overflow-y-auto">
                     {editingRole ? (
                        <div className="max-w-4xl mx-auto">
                           <div className="mb-8 flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                 <div className="p-4 bg-purple-100 rounded-2xl text-purple-600 shadow-sm">
                                    <ShieldCheck size={32} />
                                 </div>
                                 <div>
                                    {/* Editable Name if not system */}
                                    {!editingRole.isSystem ? (
                                       <div className="relative group">
                                          <input
                                             type="text"
                                             value={editingRole.name}
                                             onChange={(e) => handleUpdateRoleName(editingRole.id, e.target.value)}
                                             className="text-3xl font-black text-gray-800 bg-transparent border-b-2 border-transparent hover:border-gray-300 focus:border-purple-500 outline-none w-full transition-all"
                                             autoFocus
                                          />
                                          <Edit2 size={14} className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                                       </div>
                                    ) : (
                                       <h2 className="text-3xl font-black text-gray-800">{editingRole.name}</h2>
                                    )}
                                    <p className="text-gray-500 text-sm mt-1">
                                       {editingRole.isSystem ? 'Rol de sistema (Solo lectura parcial).' : 'Define los accesos para este perfil.'}
                                    </p>
                                 </div>
                              </div>

                              {!editingRole.isSystem && (
                                 <button
                                    onClick={() => handleDeleteRole(editingRole.id)}
                                    className="px-4 py-2 border border-red-200 text-red-600 rounded-xl font-bold text-sm hover:bg-red-50 flex items-center gap-2 transition-colors"
                                 >
                                    <Trash2 size={16} /> Eliminar Rol
                                 </button>
                              )}
                           </div>

                           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {['SALES', 'CASH', 'ADMIN', 'SYSTEM'].map(category => {
                                 // Filter logic matches AVAILABLE_PERMISSIONS categories
                                 const perms = AVAILABLE_PERMISSIONS.filter(p => p.category === category);
                                 if (perms.length === 0) return null;

                                 return (
                                    <div key={category} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-200">
                                       <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-6 flex items-center gap-2 pb-2 border-b border-gray-100">
                                          {category === 'SALES' ? 'Punto de Venta' : category === 'CASH' ? 'Caja y Dinero' : 'Administración'}
                                       </h4>
                                       <div className="space-y-4">
                                          {perms.map(perm => {
                                             const isEnabled = editingRole.permissions.includes(perm.key);
                                             return (
                                                <div
                                                   key={perm.key}
                                                   onClick={() => !editingRole.isSystem && togglePermission(editingRole.id, perm.key)}
                                                   className={`flex items-center justify-between p-4 rounded-2xl border-2 transition-all cursor-pointer ${isEnabled
                                                         ? 'bg-purple-50 border-purple-500 shadow-sm'
                                                         : 'bg-white border-gray-100 hover:border-gray-300'
                                                      } ${editingRole.isSystem ? 'opacity-60 cursor-not-allowed' : ''}`}
                                                >
                                                   <div className="flex-1 pr-4">
                                                      <p className={`text-sm font-bold mb-0.5 ${isEnabled ? 'text-purple-900' : 'text-gray-700'}`}>{perm.label}</p>
                                                      <p className="text-[10px] text-gray-400 leading-tight">{perm.description}</p>
                                                   </div>

                                                   {/* Toggle Switch Visual */}
                                                   <div className={`w-10 h-6 rounded-full relative transition-colors duration-300 shrink-0 ${isEnabled ? 'bg-purple-600' : 'bg-gray-300'}`}>
                                                      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-300 ${isEnabled ? 'left-5' : 'left-1'}`} />
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
                        <div className="h-full flex flex-col items-center justify-center text-gray-400">
                           <div className="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center mb-4">
                              <ShieldCheck size={48} className="text-gray-400" />
                           </div>
                           <p className="text-lg font-bold text-gray-500">Selecciona un rol</p>
                           <p className="text-sm">o crea uno nuevo para comenzar.</p>
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
