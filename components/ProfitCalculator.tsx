
import React, { useState, useEffect } from 'react';
import { X, Check, Calculator, PieChart, TrendingUp, DollarSign } from 'lucide-react';

interface ProfitCalculatorProps {
  initialCost: number;
  initialPrice: number; // Final Price including tax
  initialMargin: number; // Percentage
  taxRate: number; // e.g. 0.18 for 18%
  currencySymbol: string;
  onApply: (values: { cost: number; price: number; margin: number }) => void;
  onClose: () => void;
}

const ProfitCalculator: React.FC<ProfitCalculatorProps> = ({
  initialCost,
  initialPrice,
  initialMargin,
  taxRate,
  currencySymbol,
  onApply,
  onClose
}) => {
  // State
  const [cost, setCost] = useState<string>(initialCost.toString());
  const [margin, setMargin] = useState<string>(initialMargin.toString());
  const [price, setPrice] = useState<string>(initialPrice.toString());

  // Derived numeric values for chart
  const numCost = parseFloat(cost) || 0;
  const numMargin = parseFloat(margin) || 0;
  const numPrice = parseFloat(price) || 0;

  // --- LOGIC ---

  // 1. Calculate Price based on Cost + Margin
  const calculateFromCostMargin = (c: number, m: number) => {
    const netPrice = c * (1 + m / 100);
    const finalPrice = netPrice * (1 + taxRate);
    setPrice(finalPrice.toFixed(2));
  };

  // 2. Calculate Margin based on Cost + Final Price
  const calculateFromPrice = (p: number, c: number) => {
    if (c <= 0) return;
    const netPrice = p / (1 + taxRate);
    const m = ((netPrice - c) / c) * 100;
    setMargin(m.toFixed(2));
  };

  // Handlers
  const handleCostChange = (val: string) => {
    setCost(val);
    const c = parseFloat(val) || 0;
    const m = parseFloat(margin) || 0;
    calculateFromCostMargin(c, m);
  };

  const handleMarginChange = (val: string) => {
    setMargin(val);
    const c = parseFloat(cost) || 0;
    const m = parseFloat(val) || 0;
    calculateFromCostMargin(c, m);
  };

  const handlePriceChange = (val: string) => {
    setPrice(val);
    const p = parseFloat(val) || 0;
    const c = parseFloat(cost) || 0;
    calculateFromPrice(p, c);
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleMarginChange(e.target.value);
  };

  // --- CHART DATA ---
  const netPrice = numPrice / (1 + taxRate);
  const taxAmount = numPrice - netPrice;
  const profitAmount = netPrice - numCost;

  // Percentages for Pie Chart (conic-gradient)
  // Total is numPrice (100%)
  const costPct = numPrice > 0 ? (numCost / numPrice) * 100 : 0;
  const profitPct = numPrice > 0 ? (profitAmount / numPrice) * 100 : 0;
  // taxPct is the remainder

  // Colors
  const colorCost = '#EF4444'; // Red
  const colorProfit = '#10B981'; // Green
  const colorTax = '#9CA3AF'; // Gray

  const pieStyle = {
    background: `conic-gradient(
      ${colorCost} 0% ${costPct}%, 
      ${colorProfit} ${costPct}% ${costPct + profitPct}%, 
      ${colorTax} ${costPct + profitPct}% 100%
    )`
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="bg-slate-900 text-white p-6 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-xl">
              <Calculator size={24} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Calculadora de Rentabilidad</h2>
              <p className="text-xs text-slate-400">Ajusta costos y márgenes dinámicamente</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="p-8 flex flex-col md:flex-row gap-8">
          
          {/* LEFT: INPUTS */}
          <div className="flex-1 space-y-6">
            
            {/* Cost Input */}
            <div className="bg-red-50 p-4 rounded-2xl border border-red-100">
              <label className="text-xs font-bold text-red-800 uppercase tracking-wider mb-1 block">1. Costo Unitario</label>
              <div className="relative">
                <span className="absolute left-0 top-1/2 -translate-y-1/2 text-red-400 font-bold text-lg pl-4 pointer-events-none">{currencySymbol}</span>
                <input 
                  type="number" 
                  value={cost}
                  onChange={(e) => handleCostChange(e.target.value)}
                  className="w-full bg-transparent text-3xl font-black text-red-900 outline-none pl-16"
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Margin Slider & Input */}
            <div className="bg-emerald-50 p-4 rounded-2xl border border-emerald-100">
              <div className="flex justify-between items-end mb-2">
                <label className="text-xs font-bold text-emerald-800 uppercase tracking-wider block">2. Margen Deseado</label>
                <div className="flex items-baseline gap-1">
                  <input 
                    type="number" 
                    value={margin}
                    onChange={(e) => handleMarginChange(e.target.value)}
                    className="w-20 bg-white border border-emerald-200 rounded-lg text-right font-bold text-emerald-700 px-2 py-1 outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                  <span className="text-emerald-600 font-bold">%</span>
                </div>
              </div>
              <input 
                type="range" 
                min="0" 
                max="300" 
                step="5"
                value={numMargin} 
                onChange={handleSliderChange}
                className="w-full h-2 bg-emerald-200 rounded-lg appearance-none cursor-pointer accent-emerald-600"
              />
              <div className="flex justify-between text-[10px] text-emerald-600/60 font-bold mt-1 px-1">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
                <span>+</span>
              </div>
            </div>

            {/* Price Input */}
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 shadow-inner">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">3. Precio Venta (Final)</label>
              <div className="relative">
                <span className="absolute left-0 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-lg pl-4 pointer-events-none">{currencySymbol}</span>
                <input 
                  type="number" 
                  value={price}
                  onChange={(e) => handlePriceChange(e.target.value)}
                  className="w-full bg-transparent text-4xl font-black text-slate-800 outline-none pl-16"
                  placeholder="0.00"
                />
              </div>
              <div className="mt-2 text-right">
                <span className="text-xs font-bold text-slate-400 bg-white px-2 py-1 rounded border border-slate-200">
                  Incluye impuestos ({(taxRate * 100).toFixed(0)}%)
                </span>
              </div>
            </div>

          </div>

          {/* RIGHT: VISUALIZATION */}
          <div className="w-full md:w-64 flex flex-col items-center justify-center bg-gray-50 rounded-3xl border border-gray-100 p-6">
             <div className="relative w-48 h-48 rounded-full shadow-xl mb-6 transition-all duration-500" style={pieStyle}>
                <div className="absolute inset-2 bg-white rounded-full flex flex-col items-center justify-center">
                   <span className="text-gray-400 text-xs font-bold uppercase">Rentabilidad</span>
                   <span className={`text-3xl font-black ${profitAmount > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                      {currencySymbol}{profitAmount.toFixed(2)}
                   </span>
                   <span className="text-xs font-medium text-gray-400">Neta por unidad</span>
                </div>
             </div>

             <div className="w-full space-y-3">
                <div className="flex justify-between items-center text-sm">
                   <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-red-500"></div>
                      <span className="text-gray-600 font-medium">Costo</span>
                   </div>
                   <span className="font-bold text-gray-800">{currencySymbol}{numCost.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                   <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-gray-400"></div>
                      <span className="text-gray-600 font-medium">Impuesto</span>
                   </div>
                   <span className="font-bold text-gray-800">{currencySymbol}{taxAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center text-sm pt-2 border-t border-gray-200">
                   <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                      <span className="text-gray-800 font-bold">Ganancia</span>
                   </div>
                   <span className="font-bold text-emerald-600">{currencySymbol}{profitAmount.toFixed(2)}</span>
                </div>
             </div>
          </div>

        </div>

        {/* Footer */}
        <div className="p-6 bg-white border-t border-gray-100 flex justify-end gap-3">
           <button onClick={onClose} className="px-6 py-3 rounded-xl font-bold text-gray-500 hover:bg-gray-100 transition-colors">
              Cancelar
           </button>
           <button 
             onClick={() => onApply({ cost: numCost, price: numPrice, margin: numMargin })} 
             className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 active:scale-95 transition-all flex items-center gap-2"
           >
              <Check size={20} /> Aplicar Precio
           </button>
        </div>

      </div>
    </div>
  );
};

export default ProfitCalculator;
