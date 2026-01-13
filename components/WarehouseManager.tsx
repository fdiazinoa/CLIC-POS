
import React, { useState } from 'react';
import { ArrowLeft, Plus, MapPin, Building2, Trash2, Save, Wifi, AlertTriangle } from 'lucide-react';
import { Warehouse, WarehouseType } from '../types';

interface WarehouseManagerProps {
  onClose: () => void;
}

const WarehouseManager: React.FC<WarehouseManagerProps> = ({ onClose }) => {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([
    { id: 'wh_1', code: 'CEN-01', name: 'Almacén Central', type: 'DISTRIBUTION', address: 'Calle Industria 45', allowPosSale: false, allowNegativeStock: false, isMain: true, storeId: 'S1' }
  ]);
  const [editingWh, setEditingWh] = useState<Warehouse | null>(null);

  const handleSave = (wh: Warehouse) => {
    setWarehouses(prev => {
      const exists = prev.find(i => i.id === wh.id);
      if (exists) return prev.map(i => i.id === wh.id ? wh : i);
      return [...prev, wh];
    });
    setEditingWh(null);
  };

  const deleteWarehouse = (id: string) => {
    // Logic: In real app, check if stock > 0
    if (confirm("¿Estás seguro? Se validará que no existan productos con stock físico.")) {
      setWarehouses(prev => prev.filter(w => w.id !== id));
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col overflow-hidden animate-in fade-in">
      <header className="bg-white border-b p-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><ArrowLeft /></button>
          <h1 className="text-xl font-bold text-gray-800">Gestión de Almacenes</h1>
        </div>
        <button 
          onClick={() => setEditingWh({ id: Date.now().toString(), code: '', name: '', type: 'PHYSICAL', address: '', allowPosSale: true, allowNegativeStock: false, isMain: false, storeId: 'S1' })}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2"
        >
          <Plus size={20} /> Nuevo Almacén
        </button>
      </header>

      <div className="flex-1 p-6 overflow-y-auto max-w-5xl mx-auto w-full">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {warehouses.map(wh => (
            <div key={wh.id} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex justify-between items-start group hover:border-blue-300 transition-all">
              <div className="flex gap-4">
                <div className={`p-3 rounded-xl ${wh.type === 'DISTRIBUTION' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                  <Building2 size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">{wh.name} <span className="text-xs text-gray-400 font-mono ml-2">[{wh.code}]</span></h3>
                  <p className="text-sm text-gray-500 flex items-center gap-1"><MapPin size={12}/> {wh.address}</p>
                  <div className="flex gap-2 mt-3">
                    <span className="text-[10px] font-bold bg-gray-100 px-2 py-1 rounded uppercase tracking-wider">{wh.type}</span>
                    {wh.allowPosSale && <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-1 rounded uppercase tracking-wider">POS OK</span>}
                    {wh.isMain && <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-1 rounded uppercase tracking-wider">Principal</span>}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => setEditingWh(wh)} className="p-2 text-gray-400 hover:text-blue-600"><Wifi size={18}/></button>
                <button onClick={() => deleteWarehouse(wh.id)} className="p-2 text-gray-400 hover:text-red-600"><Trash2 size={18}/></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {editingWh && (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg p-6 shadow-2xl animate-in zoom-in-95">
            <h2 className="text-2xl font-black text-gray-800 mb-6">Configurar Almacén</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <input type="text" placeholder="Código Corto" value={editingWh.code} onChange={e => setEditingWh({...editingWh, code: e.target.value})} className="p-3 border rounded-xl" />
                <input type="text" placeholder="Nombre Almacén" value={editingWh.name} onChange={e => setEditingWh({...editingWh, name: e.target.value})} className="p-3 border rounded-xl" />
              </div>
              <select value={editingWh.type} onChange={e => setEditingWh({...editingWh, type: e.target.value as WarehouseType})} className="w-full p-3 border rounded-xl">
                <option value="PHYSICAL">Físico / Venta POS</option>
                <option value="DISTRIBUTION">Centro de Distribución</option>
                <option value="VIRTUAL">Virtual / Mermas</option>
                <option value="TRANSIT">En Tránsito</option>
              </select>
              <input type="text" placeholder="Dirección Física" value={editingWh.address} onChange={e => setEditingWh({...editingWh, address: e.target.value})} className="w-full p-3 border rounded-xl" />
              
              <div className="space-y-3 pt-2">
                <label className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer">
                  <span className="font-bold text-sm text-gray-700">¿Permitir Venta en POS?</span>
                  <input type="checkbox" checked={editingWh.allowPosSale} onChange={e => setEditingWh({...editingWh, allowPosSale: e.target.checked})} className="w-5 h-5 rounded" />
                </label>
                <label className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100 cursor-pointer">
                  <span className="font-bold text-sm text-gray-700">¿Permitir Stock Negativo?</span>
                  <input type="checkbox" checked={editingWh.allowNegativeStock} onChange={e => setEditingWh({...editingWh, allowNegativeStock: e.target.checked})} className="w-5 h-5 rounded" />
                </label>
              </div>
            </div>
            <div className="flex gap-3 mt-8">
              <button onClick={() => setEditingWh(null)} className="flex-1 py-4 text-gray-500 font-bold">Cancelar</button>
              <button onClick={() => handleSave(editingWh)} className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg flex items-center justify-center gap-2">
                <Save size={20} /> Guardar Almacén
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WarehouseManager;
