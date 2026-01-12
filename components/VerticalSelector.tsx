import React from 'react';
import { ShoppingBag, Coffee, Pill, Shirt, ShoppingCart, Beer, Utensils, Briefcase } from 'lucide-react';
import { SubVertical, BusinessConfig } from '../types';
import { getInitialConfig } from '../constants';

interface VerticalSelectorProps {
  onSelect: (config: BusinessConfig) => void;
}

const VerticalSelector: React.FC<VerticalSelectorProps> = ({ onSelect }) => {
  const retailOptions = [
    { id: SubVertical.SUPERMARKET, icon: ShoppingCart, label: 'Supermercado', color: 'bg-blue-500' },
    { id: SubVertical.CLOTHING, icon: Shirt, label: 'Tienda Ropa', color: 'bg-indigo-500' },
    { id: SubVertical.PHARMACY, icon: Pill, label: 'Farmacia', color: 'bg-emerald-500' },
    { id: SubVertical.SERVICES, icon: Briefcase, label: 'Servicios', color: 'bg-purple-500' },
  ];

  const foodOptions = [
    { id: SubVertical.RESTAURANT, icon: Utensils, label: 'Restaurante', color: 'bg-orange-500' },
    { id: SubVertical.FAST_FOOD, icon: Coffee, label: 'Fast Food', color: 'bg-red-500' },
    { id: SubVertical.BAR, icon: Beer, label: 'Discoteca/Bar', color: 'bg-purple-600' },
  ];

  const handleSelect = (sub: SubVertical) => {
    const config = getInitialConfig(sub);
    onSelect(config);
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight">
            <span className="text-orange-500">CLIC</span> <span className="text-blue-400">POS</span>
          </h1>
          <p className="text-gray-400 text-lg">Selecciona la vertical de tu negocio para configurar el entorno.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Retail Section */}
          <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
            <div className="flex items-center gap-3 mb-6 border-b border-gray-700 pb-4">
              <ShoppingBag className="text-blue-400" />
              <h2 className="text-2xl font-bold text-white">Retail & Servicios</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {retailOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => handleSelect(opt.id)}
                  className={`group relative overflow-hidden bg-gray-700 hover:bg-gray-600 rounded-xl p-6 text-left transition-all hover:shadow-lg hover:-translate-y-1 border border-transparent hover:border-${opt.color.replace('bg-', '')}/30`}
                >
                  <div className={`absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity`}>
                    <opt.icon size={64} className="text-white" />
                  </div>
                  <div className={`inline-flex p-3 rounded-lg ${opt.color} text-white mb-3 shadow-lg`}>
                    <opt.icon size={24} />
                  </div>
                  <h3 className="text-white font-bold text-lg">{opt.label}</h3>
                  <p className="text-gray-400 text-xs mt-1">
                    {opt.id === SubVertical.SERVICES ? 'Citas, Profesionales' : 'Inventario, Código de Barras'}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* F&B Section */}
          <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700">
             <div className="flex items-center gap-3 mb-6 border-b border-gray-700 pb-4">
              <Utensils className="text-orange-400" />
              <h2 className="text-2xl font-bold text-white">Alimentos y Bebidas</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {foodOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => handleSelect(opt.id)}
                  className={`group relative overflow-hidden bg-gray-700 hover:bg-gray-600 rounded-xl p-6 text-left transition-all hover:shadow-lg hover:-translate-y-1 border border-transparent hover:border-${opt.color.replace('bg-', '')}/30`}
                >
                   <div className={`absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity`}>
                    <opt.icon size={64} className="text-white" />
                  </div>
                  <div className={`inline-flex p-3 rounded-lg ${opt.color} text-white mb-3 shadow-lg`}>
                    <opt.icon size={24} />
                  </div>
                  <h3 className="text-white font-bold text-lg">{opt.label}</h3>
                  <p className="text-gray-400 text-xs mt-1">Mesas, Modificadores, Cocina</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerticalSelector;