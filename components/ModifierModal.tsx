import React, { useMemo, useState } from 'react';
import { X, Check, Plus, AlertCircle, MessageSquare } from 'lucide-react';
import { Product, Modifier, ModifierGroup, ComboGroup, ProductFractionOption } from '../types';
import { resolveRestaurantProductConfig } from '../utils/restaurantProductConfig';

interface ModifierModalProps {
  product: Product;
  currencySymbol: string;
  themeColor: string;
  onClose: () => void;
  onConfirm: (modifiers: string[], finalPrice: number, note?: string, restaurantConfig?: Record<string, unknown>) => void;
}

const ModifierModal: React.FC<ModifierModalProps> = ({ 
  product, 
  currencySymbol, 
  themeColor, 
  onClose, 
  onConfirm 
}) => {
  const restaurantConfigSource = useMemo(() => resolveRestaurantProductConfig(product), [product]);
  const productType = String(restaurantConfigSource.product_type || product.product_type || product.type || 'SIMPLE').toUpperCase();
  const modifierGroups = useMemo<ModifierGroup[]>(() => {
    const structured = restaurantConfigSource.modifier_groups || [];
    if (structured.length > 0) {
      return structured
        .map(group => ({
          ...group,
          modifiers: (group.modifiers || []).filter(mod => mod.active !== false),
        }))
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    }
    if (!product.availableModifiers?.length) return [];
    return [{
      id: 'legacy-modifiers',
      name: 'Extras',
      selection_type: 'MULTIPLE',
      required: false,
      min_select: 0,
      max_select: null,
      free_quantity: 0,
      modifiers: product.availableModifiers,
    }];
  }, [product.availableModifiers, restaurantConfigSource.modifier_groups]);

  const comboGroups = useMemo<ComboGroup[]>(
    () => (restaurantConfigSource.combo_groups || [])
      .map(group => ({ ...group, items: (group.items || []).filter(item => item.active !== false) }))
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    [restaurantConfigSource.combo_groups]
  );
  const fractionRule = restaurantConfigSource.fraction_rule;
  const fractionOptions = useMemo<ProductFractionOption[]>(
    () => (fractionRule?.options || []).filter(option => option.active !== false),
    [fractionRule]
  );
  const maxFractionParts = Math.max(2, Number(fractionRule?.max_parts || (fractionRule?.fraction_mode === 'QUARTER' ? 4 : 2)));
  const notePresets = restaurantConfigSource.note_presets || [];

  const [selectedModifiersByGroup, setSelectedModifiersByGroup] = useState<Record<string, string[]>>({});
  const [selectedCombosByGroup, setSelectedCombosByGroup] = useState<Record<string, string[]>>({});
  const [selectedFractions, setSelectedFractions] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');

  const toggleModifier = (modifier: Modifier) => {
    const group = modifierGroups.find(candidate => candidate.modifiers.some(mod => mod.id === modifier.id));
    if (!group) return;
    const maxSelect = group.selection_type === 'SINGLE' ? 1 : Number(group.max_select || 0);
    setSelectedModifiersByGroup(prev => {
      const current = prev[group.id] || [];
      const exists = current.includes(modifier.id);
      if (exists) return { ...prev, [group.id]: current.filter(id => id !== modifier.id) };
      if (group.selection_type === 'SINGLE') return { ...prev, [group.id]: [modifier.id] };
      if (maxSelect > 0 && current.length >= maxSelect) return prev;
      return { ...prev, [group.id]: [...current, modifier.id] };
    });
  };

  const toggleComboItem = (group: ComboGroup, itemId: string) => {
    const maxSelect = Number(group.max_select || 1);
    setSelectedCombosByGroup(prev => {
      const current = prev[group.id] || [];
      const exists = current.includes(itemId);
      if (exists) return { ...prev, [group.id]: current.filter(id => id !== itemId) };
      if (maxSelect <= 1) return { ...prev, [group.id]: [itemId] };
      if (current.length >= maxSelect) return prev;
      return { ...prev, [group.id]: [...current, itemId] };
    });
  };

  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    modifierGroups.forEach(group => {
      const selectedCount = (selectedModifiersByGroup[group.id] || []).length;
      const minSelect = group.required ? Math.max(1, Number(group.min_select || 1)) : Number(group.min_select || 0);
      if (selectedCount < minSelect) errors.push(`Seleccione ${group.name}`);
    });
    comboGroups.forEach(group => {
      const selectedCount = (selectedCombosByGroup[group.id] || []).length;
      const minSelect = group.required ? Math.max(1, Number(group.min_select || 1)) : Number(group.min_select || 0);
      if (selectedCount < minSelect) errors.push(`Seleccione ${group.name}`);
    });
    if (fractionOptions.length > 0) {
      const selectedCount = Array.from({ length: maxFractionParts }).filter((_, index) => selectedFractions[index]).length;
      if (productType === 'FRACTIONABLE' && selectedCount === 0) errors.push('Seleccione las fracciones');
      if (selectedCount > 0 && selectedCount < maxFractionParts) errors.push('Complete todas las fracciones');
    }
    return errors;
  }, [comboGroups, fractionOptions.length, maxFractionParts, modifierGroups, productType, selectedCombosByGroup, selectedFractions, selectedModifiersByGroup]);

  const getModifierPrice = (modifier: Modifier) => Number(modifier.price_delta ?? modifier.price ?? 0);
  const getFractionOptionId = (option: ProductFractionOption) => String(option.option_product_id || option.product_id || option.id || option.name || '');
  const getFractionOptionPrice = (option: ProductFractionOption) => Number(option.price_override ?? option.price ?? product.price ?? 0);

  const selectedModifierObjects = useMemo(() => modifierGroups.flatMap(group => {
    const selectedIds = selectedModifiersByGroup[group.id] || [];
    return selectedIds.map(id => ({ group, modifier: group.modifiers.find(mod => mod.id === id) })).filter(entry => entry.modifier) as Array<{ group: ModifierGroup; modifier: Modifier }>;
  }), [modifierGroups, selectedModifiersByGroup]);

  const selectedComboObjects = useMemo(() => comboGroups.flatMap(group => {
    const selectedIds = selectedCombosByGroup[group.id] || [];
    return selectedIds.map(id => ({ group, item: group.items.find(candidate => String(candidate.id || candidate.product_id) === id) })).filter(entry => entry.item) as Array<{ group: ComboGroup; item: any }>;
  }), [comboGroups, selectedCombosByGroup]);

  const selectedFractionObjects = useMemo(() => Array.from({ length: maxFractionParts })
    .map((_, index) => fractionOptions.find(option => getFractionOptionId(option) === selectedFractions[index]))
    .filter(Boolean) as ProductFractionOption[], [fractionOptions, maxFractionParts, selectedFractions]);

  const calculateFractionBase = () => {
    if (selectedFractionObjects.length === 0 || selectedFractionObjects.length < maxFractionParts) return product.price;
    const prices = selectedFractionObjects.map(getFractionOptionPrice);
    const rule = String(fractionRule?.pricing_rule || 'HIGHEST_PRICE').toUpperCase();
    if (rule === 'HIGHEST_PRICE') return Math.max(...prices);
    if (rule === 'AVERAGE_PRICE' || rule === 'SUM_PARTS') {
      const ratio = 1 / maxFractionParts;
      return prices.reduce((sum, price) => sum + (price * ratio), 0);
    }
    if (rule === 'BASE_PLUS_DIFF') {
      return Number(product.price || 0) + Math.max(0, Math.max(...prices) - Number(product.price || 0));
    }
    return product.price;
  };

  const calculateModifiersTotal = () => {
    return modifierGroups.reduce((sum, group) => {
      const selectedIds = selectedModifiersByGroup[group.id] || [];
      let freeRemaining = Number(group.free_quantity || 0);
      selectedIds.forEach(id => {
        const modifier = group.modifiers.find(mod => mod.id === id);
        if (!modifier || modifier.modifier_type === 'REMOVE' || modifier.affects_price === false) return;
        if (freeRemaining > 0) {
          freeRemaining -= 1;
          return;
        }
        sum += getModifierPrice(modifier);
      });
      return sum;
    }, 0);
  };

  const calculateComboTotal = () => selectedComboObjects.reduce((sum, entry) => sum + Number(entry.item.price_delta || 0), 0);

  const calculateTotal = () => calculateFractionBase() + calculateModifiersTotal() + calculateComboTotal();

  const buildModifierLabels = () => {
    const labels: string[] = [];
    if (selectedFractionObjects.length > 0) {
      labels.push(`Fracciones: ${selectedFractionObjects.map(option => option.name || getFractionOptionId(option)).join(' / ')}`);
    }
    selectedModifierObjects.forEach(({ group, modifier }) => {
      const price = getModifierPrice(modifier);
      const prefix = modifier.modifier_type === 'REMOVE' || modifier.affects_price === false ? '' : price > 0 ? '+ ' : '';
      labels.push(`${group.name}: ${prefix}${modifier.name}${price > 0 && modifier.affects_price !== false ? ` (${currencySymbol}${price.toFixed(2)})` : ''}`);
    });
    selectedComboObjects.forEach(({ group, item }) => {
      const delta = Number(item.price_delta || 0);
      labels.push(`${group.name}: ${item.name || item.product_id}${delta > 0 ? ` (+${currencySymbol}${delta.toFixed(2)})` : ''}`);
    });
    if (note.trim()) labels.push(`Nota: ${note.trim()}`);
    return labels;
  };

  const handleConfirm = () => {
    if (validationErrors.length > 0) return;
    const selectedModifierSnapshot = selectedModifierObjects.map(({ group, modifier }) => ({
      group_id: group.id,
      group_name: group.name,
      modifier_id: modifier.id,
      product_id: modifier.product_id,
      name: modifier.name,
      modifier_type: modifier.modifier_type || 'ADD',
      affects_price: modifier.affects_price !== false,
      price_delta: getModifierPrice(modifier),
    }));
    const selectedFractionSnapshot = selectedFractionObjects.map(option => ({
      id: getFractionOptionId(option),
      product_id: option.product_id || option.option_product_id,
      name: option.name || getFractionOptionId(option),
      price: getFractionOptionPrice(option),
      ratio: 1 / maxFractionParts,
    }));
    const selectedComboSnapshot = selectedComboObjects.map(({ group, item }) => ({
      group_id: group.id,
      group_name: group.name,
      item_id: item.id || item.product_id,
      product_id: item.product_id,
      name: item.name || item.product_id,
      price_delta: Number(item.price_delta || 0),
    }));
    onConfirm(buildModifierLabels(), calculateTotal(), note.trim() || undefined, {
      modifierGroups: selectedModifiersByGroup,
      comboGroups: selectedCombosByGroup,
      fractions: selectedFractionSnapshot,
      selected_modifiers: selectedModifierSnapshot,
      selected_fraction_parts: selectedFractionSnapshot,
      selected_combo_items: selectedComboSnapshot,
      product_type: productType,
      production_area_id: restaurantConfigSource.production_area_id,
      note: note.trim() || undefined,
    });
  };

  const addNotePreset = (preset: string) => {
    setNote(prev => {
      const current = prev.trim();
      if (!current) return preset;
      if (current.includes(preset)) return current;
      return `${current}; ${preset}`;
    });
  };

  const selectFraction = (partIndex: number, optionId: string) => {
    setSelectedFractions(prev => ({ ...prev, [partIndex]: optionId }));
  };

  const selectionTextClass = {
    blue: 'text-blue-700',
    orange: 'text-orange-700',
    gray: 'text-gray-900',
  }[themeColor] || 'text-indigo-700';

  const selectedCardClass = {
    blue: 'border-blue-300 bg-blue-50 shadow-blue-100',
    orange: 'border-orange-300 bg-orange-50 shadow-orange-100',
    gray: 'border-gray-400 bg-gray-50 shadow-gray-100',
  }[themeColor] || 'border-indigo-300 bg-indigo-50 shadow-indigo-100';

  const selectedBadgeClass = {
    blue: 'bg-blue-600 text-white',
    orange: 'bg-orange-600 text-white',
    gray: 'bg-gray-900 text-white',
  }[themeColor] || 'bg-indigo-600 text-white';

  const themeBtnClass = {
    blue: 'bg-blue-600 hover:bg-blue-700',
    orange: 'bg-orange-600 hover:bg-orange-700',
    gray: 'bg-gray-800 hover:bg-gray-900',
  }[themeColor] || 'bg-indigo-600 hover:bg-indigo-700';

  const renderSelectionButton = (selected: boolean, label: string, meta: string | null, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[4.5rem] items-center gap-3 rounded-2xl border-2 p-3 text-left shadow-sm transition-all active:scale-[0.98] ${
        selected
          ? `${selectedCardClass} ${selectionTextClass}`
          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border-2 transition-all ${
        selected ? `${selectedBadgeClass} border-transparent` : 'border-gray-200 bg-gray-50 text-transparent'
      }`}>
        <Check size={16} strokeWidth={3} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-black leading-tight">{label}</span>
        {meta && <span className="mt-1 block text-xs font-black uppercase tracking-wide text-gray-500">{meta}</span>}
      </span>
    </button>
  );

  const hasAdvancedConfiguration = modifierGroups.length > 0 || comboGroups.length > 0 || fractionOptions.length > 0 || notePresets.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="relative h-28 bg-gray-100">
          <img 
            src={product.image || "https://picsum.photos/400/200"} 
            alt={product.name} 
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent flex items-end p-5">
            <div>
              <h2 className="text-2xl font-black text-white shadow-sm">{product.name}</h2>
              <p className="text-xs font-bold uppercase tracking-widest text-white/70">{currencySymbol}{Number(product.price || 0).toFixed(2)} base</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-black/30 hover:bg-black/50 text-white rounded-full transition-colors backdrop-blur-md"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex-1 overflow-y-auto space-y-6">
          {fractionOptions.length > 0 && (
            <section>
              <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest mb-3">
                Fracciones {selectedFractionObjects.length > 0 && <span className="text-gray-400">({String(fractionRule?.pricing_rule || 'HIGHEST_PRICE')})</span>}
              </h3>
              <div className="space-y-3">
                {Array.from({ length: maxFractionParts }).map((_, partIndex) => (
                  <div key={partIndex}>
                    <p className="mb-2 text-[11px] font-black uppercase text-gray-400">Parte {partIndex + 1}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {fractionOptions.map(option => {
                        const optionId = getFractionOptionId(option);
                        return renderSelectionButton(
                          selectedFractions[partIndex] === optionId,
                          option.name || optionId,
                          `${currencySymbol}${getFractionOptionPrice(option).toFixed(2)}`,
                          () => selectFraction(partIndex, optionId)
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {modifierGroups.map(group => {
            const selectedCount = (selectedModifiersByGroup[group.id] || []).length;
            const minSelect = group.required ? Math.max(1, Number(group.min_select || 1)) : Number(group.min_select || 0);
            const maxSelect = group.selection_type === 'SINGLE' ? 1 : Number(group.max_select || 0);
            const counterLabel = maxSelect > 0 ? `${selectedCount}/${maxSelect}` : `${selectedCount}`;
            return (
            <section key={group.id}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">
                    {group.name} {group.required && <span className="text-red-500">*</span>}
                  </h3>
                  {minSelect > 0 && (
                    <p className="mt-1 text-[11px] font-bold text-gray-400">Mínimo {minSelect}</p>
                  )}
                </div>
                <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${
                  minSelect > 0 && selectedCount < minSelect ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'
                }`}>
                  {counterLabel}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.modifiers.map(mod => {
                  const selected = (selectedModifiersByGroup[group.id] || []).includes(mod.id);
                  const price = getModifierPrice(mod);
                  const meta = mod.modifier_type === 'REMOVE' || mod.affects_price === false ? 'Sin costo' : price > 0 ? `+${currencySymbol}${price.toFixed(2)}` : null;
                  return (
                    <div key={mod.id}>
                      {renderSelectionButton(selected, mod.name, meta, () => toggleModifier(mod))}
                    </div>
                  );
                })}
              </div>
            </section>
          )})}

          {comboGroups.map(group => {
            const selectedCount = (selectedCombosByGroup[group.id] || []).length;
            const minSelect = group.required ? Math.max(1, Number(group.min_select || 1)) : Number(group.min_select || 0);
            const maxSelect = Math.max(1, Number(group.max_select || 1));
            return (
            <section key={group.id}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">
                    {group.name} {group.required && <span className="text-red-500">*</span>}
                  </h3>
                  {minSelect > 0 && (
                    <p className="mt-1 text-[11px] font-bold text-gray-400">Mínimo {minSelect}</p>
                  )}
                </div>
                <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${
                  minSelect > 0 && selectedCount < minSelect ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'
                }`}>
                  {selectedCount}/{maxSelect}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.items.map(item => {
                  const itemId = String(item.id || item.product_id || item.name);
                  const selected = (selectedCombosByGroup[group.id] || []).includes(itemId);
                  const delta = Number(item.price_delta || 0);
                  return (
                    <div key={itemId}>
                      {renderSelectionButton(selected, item.name || itemId, delta > 0 ? `+${currencySymbol}${delta.toFixed(2)}` : null, () => toggleComboItem(group, itemId))}
                    </div>
                  );
                })}
              </div>
            </section>
          )})}

          <section>
            <div className="mb-3 flex items-center gap-2">
              <MessageSquare size={16} className="text-gray-400" />
              <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest">Nota cocina</h3>
            </div>
            {notePresets.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {notePresets.map(preset => (
                  <button key={preset} type="button" onClick={() => addNotePreset(preset)} className="rounded-full border border-gray-200 px-3 py-2 text-xs font-black text-gray-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700">
                    {preset}
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={note}
              onChange={event => setNote(event.target.value)}
              className="min-h-[5rem] w-full rounded-2xl border-2 border-gray-100 bg-gray-50 p-4 text-sm font-bold text-gray-700 outline-none transition-all focus:border-blue-200 focus:bg-white"
              placeholder="Ej: alérgico al maní, salsa aparte..."
            />
          </section>

          {!hasAdvancedConfiguration && (
            <p className="text-gray-400 text-center py-4">No hay modificadores disponibles para este producto.</p>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-white border-t border-gray-100 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
           {validationErrors.length > 0 && (
             <div className="mb-3 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
               <AlertCircle size={16} className="mt-0.5 shrink-0" />
               <span>{validationErrors[0]}</span>
             </div>
           )}
           <div className="flex justify-between items-center mb-4 px-2">
             <span className="text-gray-500">Total Item</span>
             <span className="text-xl font-bold text-gray-900">{currencySymbol}{calculateTotal().toFixed(2)}</span>
           </div>
           <button 
             onClick={handleConfirm}
             disabled={validationErrors.length > 0}
             className={`w-full py-3 rounded-xl font-bold text-white shadow-lg flex items-center justify-center gap-2 transition-transform active:scale-95 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none ${themeBtnClass}`}
           >
             <Plus size={20} />
             Agregar al Pedido
           </button>
        </div>

      </div>
    </div>
  );
};

export default ModifierModal;
