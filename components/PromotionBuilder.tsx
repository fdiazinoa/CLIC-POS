
import React, { useState } from 'react';
import { 
  Gift, Tag, Package, Clock, Check, X, Save, 
  CalendarDays, ShoppingBag, ArrowRight 
} from 'lucide-react';
import { Product, BusinessConfig, Promotion, PromotionType } from '../types';

interface PromotionBuilderProps {
  products: Product[];
  config: BusinessConfig;
  onClose: () => void;
}

const PROMO_TYPES: { id: PromotionType; label: string; icon: any; color: string; description: string }[] = [
  { 
    id: 'DISCOUNT', 
    label: 'Descuento %', 
    icon: Tag, 
    color: 'bg-blue-500', 
    description: 'Reduce el precio por un porcentaje.' 
  },
  { 
    id: 'BOGO', 
    label: '2x1 (BOGO)', 
    icon: Gift, 
    color: 'bg-purple-500', 
    description: 'Compra X y llévate Y gratis.' 
  },
  { 
    id: 'BUNDLE', 
    label: 'Pack Ahorro', 
    icon: Package, 
    color: 'bg-orange-500', 
    description: 'Precio especial al comprar varios items.' 
  },
  { 
    id: 'HAPPY_HOUR', 
    label: 'Hora Feliz', 
    icon: Clock, 
    color: 'bg-pink-500', 
    description: 'Descuentos activos solo en cierto horario.' 
  },
];

const DAYS = [
  { key: 'L', label: 'Lunes' },
  { key: 'M', label: 'Martes' },
  { key: 'X', label: 'Miércoles' },
  { key: 'J', label: 'Jueves' },
  { key: 'V', label: 'Viernes' },
  { key: 'S', label: 'Sábado' },
  { key: 'D', label: 'Domingo' }
];

const PromotionBuilder: React.FC<PromotionBuilderProps> = ({ products, config, onClose }) => {
  // Form State
  const [promoName, setPromoName] = useState('');
  const [selectedType, setSelectedType] = useState<PromotionType>('DISCOUNT');
  const [targetType, setTargetType] = useState<'PRODUCT' | 'CATEGORY' | 'SEASON' | 'GROUP' | 'ALL'>('PRODUCT');
  const [targetValue, setTargetValue] = useState('');
  const [benefitValue, setBenefitValue] = useState<number>(0);
  const [activeDays, setActiveDays] = useState<string[]>(['L','M','X','J','V','S','D']);
  const [timeStart, setTimeStart] = useState('00:00');
  const [timeEnd, setTimeEnd] = useState('23:59');
  const [isActive, setIsActive] = useState(true);

  // Computed Lists
  const categories = Array.from(new Set(products.map(p => p.category)));
  const seasons = config.seasons || [];
  const groups = config.productGroups || [];

  // Handlers
  const toggleDay = (day: string) => {
    setActiveDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  const handleSave = () => {
    if (!promoName || (targetType !== 'ALL' && !targetValue)) {
      alert("Por favor completa los campos requeridos");
      return;
    }
    
    // In a real app, this would save to a database or parent state
    console.log({
      id: Math.random().toString(36).substr(2, 9),
      name: promoName,
      type: selectedType,
      targetType,
      targetValue,
      benefitValue,
      schedule: { days: activeDays, startTime: timeStart, endTime: timeEnd, isActive }
    });
    
    alert("Promoción guardada correctamente (Simulado)");
    onClose();
  };

  const currentTypeConfig = PROMO_TYPES.find(t => t.id === selectedType);

  return (
    <div className="h-full flex flex-col bg-gray-50 animate-in slide-in-from-right-10 duration-300">
      
      {/* Header */}
      <div className="flex justify-between items-center p-6 bg-white border-b border-gray-200 shadow-sm shrink-0 z-10">
        <div>
          <h2 className="text-2xl font-black text-gray-800">Nueva Promoción</h2>
          <p className="text-sm text-gray-500">Crea reglas dinámicas de precios</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-gray-100 rounded-full p-1 pr-4">
             <button 
               onClick={() => setIsActive(!isActive)}
               className={`w-10 h-6 rounded-full transition-colors relative ${isActive ? 'bg-green-500' : 'bg-gray-300'}`}
             >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${isActive ? 'left-5' : 'left-1'}`} />
             </button>
             <span className="text-xs font-bold text-gray-600">{isActive ? 'ACTIVA' : 'INACTIVA'}</span>
          </div>

          <button 
            onClick={handleSave}
            className={`px-6 py-2.5 rounded-xl font-bold text-white shadow-lg hover:brightness-110 active:scale-95 transition-all flex items-center gap-2 text-sm ${currentTypeConfig?.color || 'bg-blue-600'}`}
          >
            <Save size={18} />
            <span className="hidden sm:inline">Guardar</span>
          </button>

          <div className="h-8 w-px bg-gray-200 mx-2"></div>

          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
            <X size={24} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full space-y-8 pb-20">
        
        {/* Step 1: Promotion Type */}
        <section>
           <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">1. Tipo de Oferta</label>
           <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {PROMO_TYPES.map(type => (
                 <button
                   key={type.id}
                   onClick={() => setSelectedType(type.id)}
                   className={`relative p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 text-center group ${
                      selectedType === type.id 
                         ? `border-${type.color.replace('bg-', '')} bg-white shadow-lg scale-105 z-10` 
                         : 'border-transparent bg-white hover:bg-gray-50'
                   }`}
                 >
                    <div className={`p-3 rounded-xl text-white ${type.color} shadow-md group-hover:scale-110 transition-transform`}>
                       <type.icon size={24} />
                    </div>
                    <div>
                       <h3 className="font-bold text-gray-800 text-sm">{type.label}</h3>
                       <p className="text-[10px] text-gray-400 mt-1 leading-tight">{type.description}</p>
                    </div>
                    {selectedType === type.id && (
                       <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${type.color}`} />
                    )}
                 </button>
              ))}
           </div>
        </section>

        {/* Step 2: Rule Builder (The "Sentence") */}
        <section>
           <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">2. Regla de Negocio</label>
           
           <div className="bg-white rounded-3xl shadow-sm border border-gray-200 p-6 md:p-8 relative overflow-hidden">
              <div className={`absolute top-0 left-0 w-2 h-full ${currentTypeConfig?.color}`} />
              
              <div className="flex flex-col gap-6">
                 {/* Condition Row */}
                 <div className="flex flex-col md:flex-row md:items-center gap-4">
                    <span className="font-black text-2xl text-gray-300 w-12">SI</span>
                    <div className="flex-1 bg-gray-50 p-4 rounded-2xl flex flex-col md:flex-row gap-4 items-center border border-gray-100">
                       <div className="flex items-center gap-2 text-gray-600 font-medium">
                          <ShoppingBag size={20} />
                          <span>El cliente compra:</span>
                       </div>
                       
                       <select 
                          value={targetType}
                          onChange={(e) => setTargetType(e.target.value as any)}
                          className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100"
                       >
                          <option value="PRODUCT">Producto Específico</option>
                          <option value="CATEGORY">Categoría Completa</option>
                          <option value="SEASON">Por Temporada</option>
                          <option value="GROUP">Por Grupo/Colección</option>
                          <option value="ALL">Cualquier Producto</option>
                       </select>

                       {targetType !== 'ALL' && (
                          <select
                             value={targetValue}
                             onChange={(e) => setTargetValue(e.target.value)}
                             className="flex-1 bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 w-full md:w-auto"
                          >
                             <option value="">Seleccionar...</option>
                             {targetType === 'PRODUCT' && products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                             {targetType === 'CATEGORY' && categories.map(c => <option key={c} value={c}>{c}</option>)}
                             {targetType === 'SEASON' && seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                             {targetType === 'GROUP' && groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                          </select>
                       )}
                    </div>
                 </div>

                 <div className="flex justify-center md:justify-start pl-3">
                    <ArrowRight className="text-gray-300" size={24} transform="rotate(90 md:0)" />
                 </div>

                 {/* Consequence Row */}
                 <div className="flex flex-col md:flex-row md:items-center gap-4">
                    <span className="font-black text-2xl text-gray-300 w-12 tracking-tighter">ENTONCES</span>
                    <div className="flex-1 bg-blue-50 p-4 rounded-2xl flex flex-col md:flex-row gap-4 items-center border border-blue-100">
                       <div className="flex items-center gap-2 text-blue-700 font-medium">
                          <Gift size={20} />
                          <span>Obtiene:</span>
                       </div>

                       {selectedType === 'DISCOUNT' && (
                          <div className="flex items-center gap-2">
                             <input 
                                type="number" 
                                value={benefitValue}
                                onChange={(e) => setBenefitValue(parseFloat(e.target.value))}
                                className="w-24 text-center font-black text-2xl bg-white border border-blue-200 rounded-xl py-1 text-blue-600 outline-none"
                                placeholder="0"
                             />
                             <span className="font-bold text-blue-400">% de Descuento</span>
                          </div>
                       )}

                       {selectedType === 'BOGO' && (
                          <div className="font-bold text-blue-600 text-lg">
                             El 2do artículo GRATIS
                          </div>
                       )}

                       {selectedType === 'HAPPY_HOUR' && (
                          <div className="flex items-center gap-2">
                             <span className="text-blue-600">Precio especial de:</span>
                             <input 
                               type="number" 
                               className="w-24 text-center font-black text-2xl bg-white border border-blue-200 rounded-xl py-1 text-blue-600 outline-none"
                               placeholder="$0.00"
                             />
                          </div>
                       )}
                    </div>
                 </div>
              </div>
           </div>
        </section>

        {/* Step 3: Name & Schedule */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
           <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">3. Detalles</label>
              <input 
                 type="text" 
                 value={promoName}
                 onChange={(e) => setPromoName(e.target.value)}
                 className="w-full p-4 bg-white border border-gray-200 rounded-2xl font-bold text-gray-800 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50 transition-all"
                 placeholder="Nombre de la Promoción (Ej. Viernes Negro)"
              />
           </div>

           <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">4. Programación</label>
              <div className="bg-white p-4 rounded-2xl border border-gray-200 space-y-4">
                 
                 {/* Days Toggle */}
                 <div className="flex justify-between items-center bg-gray-50 p-2 rounded-xl">
                    <CalendarDays size={20} className="text-gray-400 ml-2" />
                    <div className="flex gap-1">
                       {DAYS.map(day => {
                          const isActiveDay = activeDays.includes(day.key);
                          return (
                             <button
                               key={day.key}
                               onClick={() => toggleDay(day.key)}
                               className={`w-8 h-8 rounded-full text-xs font-bold transition-all ${
                                  isActiveDay 
                                     ? 'bg-blue-600 text-white shadow-md scale-110' 
                                     : 'bg-white text-gray-400 hover:bg-gray-200'
                               }`}
                             >
                                {day.key}
                             </button>
                          );
                       })}
                    </div>
                 </div>

                 {/* Time Range */}
                 <div className="flex items-center gap-3">
                    <Clock size={20} className="text-gray-400 ml-2" />
                    <input 
                       type="time" 
                       value={timeStart}
                       onChange={(e) => setTimeStart(e.target.value)}
                       className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:border-blue-400"
                    />
                    <span className="text-gray-300">-</span>
                    <input 
                       type="time" 
                       value={timeEnd}
                       onChange={(e) => setTimeEnd(e.target.value)}
                       className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:border-blue-400"
                    />
                 </div>
              </div>
           </div>
        </section>

      </div>

    </div>
  );
};

export default PromotionBuilder;
