import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronLeft, ChevronRight, MessageSquare, Plus, X } from 'lucide-react';
import { ComboGroup, Modifier, ModifierGroup, Product, ProductFractionOption } from '../types';
import {
  focusFirstModifierOption,
  isModifierSelectionCountValid,
  MODIFIER_MODAL_LAYOUT,
  paginateModifierOptions,
} from '../utils/modifierModalPresentation';
import { resolveRestaurantProductConfig } from '../utils/restaurantProductConfig';
import './ModifierModal.css';

interface ModifierModalProps {
  product: Product;
  currencySymbol: string;
  themeColor: string;
  onClose: () => void;
  onConfirm: (modifiers: string[], finalPrice: number, note?: string, restaurantConfig?: Record<string, unknown>) => void;
}

const SINGLE_ADVANCE_DELAY_MS = 250;

type Step =
  | { id: string; kind: 'fraction'; name: string; partIndex: number }
  | { id: string; kind: 'modifier'; name: string; group: ModifierGroup }
  | { id: string; kind: 'combo'; name: string; group: ComboGroup }
  | { id: 'note'; kind: 'note'; name: string };

interface OptionCardProps {
  id: string;
  label: string;
  meta: string;
  selected: boolean;
  multiple: boolean;
  onSelect: (id: string) => void;
}

const OptionCard = memo<OptionCardProps>(({ id, label, meta, selected, multiple, onSelect }) => {
  const handleClick = useCallback(() => onSelect(id), [id, onSelect]);
  return (
    <button
      type="button"
      role={multiple ? 'checkbox' : 'radio'}
      aria-checked={selected}
      data-modifier-option="true"
      onClick={handleClick}
      className={`flex min-h-[88px] w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors active:scale-[0.99] ${
        selected
          ? 'border-blue-600 bg-blue-50 text-blue-950 shadow-sm'
          : 'border-slate-200 bg-white text-slate-900 hover:border-blue-300 hover:bg-slate-50'
      }`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center border-2 ${multiple ? 'rounded-lg' : 'rounded-full'} ${
        selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-transparent'
      }`}>
        <Check size={15} strokeWidth={3.5} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-black leading-tight">{label}</span>
        <span className="mt-1 block text-sm font-bold text-slate-500">{meta}</span>
      </span>
    </button>
  );
});
OptionCard.displayName = 'OptionCard';

const ModifierModal: React.FC<ModifierModalProps> = ({
  product,
  currencySymbol,
  themeColor,
  onClose,
  onConfirm,
}) => {
  const restaurantConfigSource = useMemo(() => resolveRestaurantProductConfig(product), [product]);
  const productType = String(restaurantConfigSource.product_type || product.product_type || product.type || 'SIMPLE').toUpperCase();
  const modifierGroups = useMemo<ModifierGroup[]>(() => {
    const structured = restaurantConfigSource.modifier_groups || [];
    if (structured.length > 0) {
      return structured
        .map(group => ({ ...group, modifiers: (group.modifiers || []).filter(mod => mod.active !== false) }))
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    }
    if (!product.availableModifiers?.length) return [];
    return [{
      id: 'legacy-modifiers', name: 'Extras', selection_type: 'MULTIPLE', required: false,
      min_select: 0, max_select: null, free_quantity: 0, modifiers: product.availableModifiers,
    }];
  }, [product.availableModifiers, restaurantConfigSource.modifier_groups]);
  const comboGroups = useMemo<ComboGroup[]>(
    () => (restaurantConfigSource.combo_groups || [])
      .map(group => ({ ...group, items: (group.items || []).filter(item => item.active !== false) }))
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
    [restaurantConfigSource.combo_groups],
  );
  const fractionRule = restaurantConfigSource.fraction_rule;
  const fractionOptions = useMemo<ProductFractionOption[]>(
    () => (fractionRule?.options || []).filter(option => option.active !== false),
    [fractionRule],
  );
  const maxFractionParts = Math.max(2, Number(fractionRule?.max_parts || (fractionRule?.fraction_mode === 'QUARTER' ? 4 : 2)));
  const notePresets = restaurantConfigSource.note_presets || [];

  const steps = useMemo<Step[]>(() => [
    ...Array.from({ length: fractionOptions.length > 0 ? maxFractionParts : 0 }, (_, partIndex): Step => ({
      id: `fraction-${partIndex}`, kind: 'fraction', name: `Parte ${partIndex + 1}`, partIndex,
    })),
    ...modifierGroups.map((group): Step => ({ id: `modifier-${group.id}`, kind: 'modifier', name: group.name, group })),
    ...comboGroups.map((group): Step => ({ id: `combo-${group.id}`, kind: 'combo', name: group.name, group })),
    { id: 'note', kind: 'note', name: 'Nota' },
  ], [comboGroups, fractionOptions.length, maxFractionParts, modifierGroups]);

  const [selectedModifiersByGroup, setSelectedModifiersByGroup] = useState<Record<string, string[]>>({});
  const [selectedCombosByGroup, setSelectedCombosByGroup] = useState<Record<string, string[]>>({});
  const [selectedFractions, setSelectedFractions] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [pagesByStep, setPagesByStep] = useState<Record<string, number>>({});
  const [attemptedStepId, setAttemptedStepId] = useState<string | null>(null);
  const [completedStepIds, setCompletedStepIds] = useState<Record<string, true>>({});
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmationStartedRef = useRef(false);
  const activeStepIndexRef = useRef(activeStepIndex);
  const activeStepRef = useRef<Step | undefined>(steps[0]);
  const modifierSelectionsRef = useRef(selectedModifiersByGroup);
  const comboSelectionsRef = useRef(selectedCombosByGroup);
  const fractionSelectionsRef = useRef(selectedFractions);
  const optionAreaRef = useRef<HTMLDivElement>(null);

  modifierSelectionsRef.current = selectedModifiersByGroup;
  comboSelectionsRef.current = selectedCombosByGroup;
  fractionSelectionsRef.current = selectedFractions;

  const cancelAutoAdvance = useCallback(() => {
    if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    autoAdvanceTimer.current = null;
  }, []);

  useEffect(() => {
    activeStepIndexRef.current = activeStepIndex;
    activeStepRef.current = steps[activeStepIndex];
  }, [activeStepIndex, steps]);
  useEffect(() => cancelAutoAdvance, [cancelAutoAdvance]);
  useEffect(() => {
    cancelAutoAdvance();
  }, [cancelAutoAdvance, product.id]);

  const getModifierPrice = useCallback((modifier: Modifier) => Number(modifier.price_delta ?? modifier.price ?? 0), []);
  const getFractionOptionId = useCallback((option: ProductFractionOption) => String(option.option_product_id || option.product_id || option.id || option.name || ''), []);
  const getFractionOptionPrice = useCallback((option: ProductFractionOption) => Number(option.price_override ?? option.price ?? product.price ?? 0), [product.price]);

  const selectedModifierObjects = useMemo(() => modifierGroups.flatMap(group => {
    const selectedIds = selectedModifiersByGroup[group.id] || [];
    return selectedIds.map(id => ({ group, modifier: group.modifiers.find(mod => mod.id === id) }))
      .filter(entry => entry.modifier) as Array<{ group: ModifierGroup; modifier: Modifier }>;
  }), [modifierGroups, selectedModifiersByGroup]);
  const selectedComboObjects = useMemo(() => comboGroups.flatMap(group => {
    const selectedIds = selectedCombosByGroup[group.id] || [];
    return selectedIds.map(id => ({ group, item: group.items.find(candidate => String(candidate.id || candidate.product_id) === id) }))
      .filter(entry => entry.item) as Array<{ group: ComboGroup; item: ComboGroup['items'][number] }>;
  }), [comboGroups, selectedCombosByGroup]);
  const selectedFractionObjects = useMemo(() => Array.from({ length: maxFractionParts })
    .map((_, index) => fractionOptions.find(option => getFractionOptionId(option) === selectedFractions[index]))
    .filter(Boolean) as ProductFractionOption[], [fractionOptions, getFractionOptionId, maxFractionParts, selectedFractions]);

  const calculateFractionBase = useCallback(() => {
    if (selectedFractionObjects.length === 0 || selectedFractionObjects.length < maxFractionParts) return product.price;
    const prices = selectedFractionObjects.map(getFractionOptionPrice);
    const rule = String(fractionRule?.pricing_rule || 'HIGHEST_PRICE').toUpperCase();
    if (rule === 'HIGHEST_PRICE') return Math.max(...prices);
    if (rule === 'AVERAGE_PRICE' || rule === 'SUM_PARTS') {
      const ratio = 1 / maxFractionParts;
      return prices.reduce((sum, price) => sum + (price * ratio), 0);
    }
    if (rule === 'BASE_PLUS_DIFF') return Number(product.price || 0) + Math.max(0, Math.max(...prices) - Number(product.price || 0));
    return product.price;
  }, [fractionRule?.pricing_rule, getFractionOptionPrice, maxFractionParts, product.price, selectedFractionObjects]);
  const calculateModifiersTotal = useCallback(() => modifierGroups.reduce((sum, group) => {
    const selectedIds = selectedModifiersByGroup[group.id] || [];
    let freeRemaining = Number(group.free_quantity || 0);
    selectedIds.forEach(id => {
      const modifier = group.modifiers.find(mod => mod.id === id);
      if (!modifier || modifier.modifier_type === 'REMOVE' || modifier.affects_price === false) return;
      if (freeRemaining > 0) { freeRemaining -= 1; return; }
      sum += getModifierPrice(modifier);
    });
    return sum;
  }, 0), [getModifierPrice, modifierGroups, selectedModifiersByGroup]);
  const calculateComboTotal = useCallback(
    () => selectedComboObjects.reduce((sum, entry) => sum + Number(entry.item.price_delta || 0), 0),
    [selectedComboObjects],
  );
  const fractionBase = calculateFractionBase();
  const extrasTotal = calculateModifiersTotal() + calculateComboTotal();
  const total = fractionBase + extrasTotal;

  const fractionSelectionCount = Object.keys(selectedFractions).filter(key => selectedFractions[Number(key)]).length;
  const isStepValid = useCallback((step: Step) => {
    if (step.kind === 'note') return true;
    if (step.kind === 'modifier') return isModifierSelectionCountValid((selectedModifiersByGroup[step.group.id] || []).length, step.group);
    if (step.kind === 'combo') return isModifierSelectionCountValid((selectedCombosByGroup[step.group.id] || []).length, step.group);
    if (productType !== 'FRACTIONABLE' && fractionSelectionCount === 0) return true;
    return Boolean(selectedFractions[step.partIndex]);
  }, [fractionSelectionCount, productType, selectedCombosByGroup, selectedFractions, selectedModifiersByGroup]);

  const focusFirstOption = useCallback(() => {
    requestAnimationFrame(() => focusFirstModifierOption(optionAreaRef.current));
  }, []);
  const showStepError = useCallback((step: Step) => {
    setPagesByStep(prev => ({ ...prev, [step.id]: 0 }));
    setAttemptedStepId(step.id);
    focusFirstOption();
  }, [focusFirstOption]);
  const moveToStep = useCallback((index: number) => {
    cancelAutoAdvance();
    setAttemptedStepId(null);
    setActiveStepIndex(Math.max(0, Math.min(index, steps.length - 1)));
  }, [cancelAutoAdvance, steps.length]);
  const scheduleAutoAdvance = useCallback((stepIndex: number, stepId: string) => {
    cancelAutoAdvance();
    autoAdvanceTimer.current = setTimeout(() => {
      if (activeStepIndexRef.current !== stepIndex || stepIndex >= steps.length - 1) return;
      setAttemptedStepId(null);
      setCompletedStepIds(prev => ({ ...prev, [stepId]: true }));
      setActiveStepIndex(stepIndex + 1);
      autoAdvanceTimer.current = null;
    }, SINGLE_ADVANCE_DELAY_MS);
  }, [cancelAutoAdvance, steps.length]);

  const activeStep = steps[activeStepIndex];
  const handleOptionSelect = useCallback((optionId: string) => {
    const currentStep = activeStepRef.current;
    const currentStepIndex = activeStepIndexRef.current;
    if (!currentStep) return;
    setAttemptedStepId(null);
    if (currentStep.kind === 'fraction') {
      const next = { ...fractionSelectionsRef.current, [currentStep.partIndex]: optionId };
      fractionSelectionsRef.current = next;
      setSelectedFractions(next);
      scheduleAutoAdvance(currentStepIndex, currentStep.id);
      return;
    }
    if (currentStep.kind === 'modifier') {
      const group = currentStep.group;
      const maxSelect = group.selection_type === 'SINGLE' ? 1 : Number(group.max_select || 0);
      const current = modifierSelectionsRef.current[group.id] || [];
      if (current.includes(optionId)) {
        cancelAutoAdvance();
        const next = { ...modifierSelectionsRef.current, [group.id]: current.filter(id => id !== optionId) };
        modifierSelectionsRef.current = next;
        setSelectedModifiersByGroup(next);
      } else if (group.selection_type === 'SINGLE') {
        const next = { ...modifierSelectionsRef.current, [group.id]: [optionId] };
        modifierSelectionsRef.current = next;
        setSelectedModifiersByGroup(next);
        if (isModifierSelectionCountValid(1, group)) scheduleAutoAdvance(currentStepIndex, currentStep.id);
      } else if (maxSelect <= 0 || current.length < maxSelect) {
        const next = { ...modifierSelectionsRef.current, [group.id]: [...current, optionId] };
        modifierSelectionsRef.current = next;
        setSelectedModifiersByGroup(next);
      }
      return;
    }
    if (currentStep.kind === 'combo') {
      const group = currentStep.group;
      const maxSelect = Number(group.max_select || 1);
      const current = comboSelectionsRef.current[group.id] || [];
      if (current.includes(optionId)) {
        cancelAutoAdvance();
        const next = { ...comboSelectionsRef.current, [group.id]: current.filter(id => id !== optionId) };
        comboSelectionsRef.current = next;
        setSelectedCombosByGroup(next);
      } else if (maxSelect <= 1) {
        const next = { ...comboSelectionsRef.current, [group.id]: [optionId] };
        comboSelectionsRef.current = next;
        setSelectedCombosByGroup(next);
        if (isModifierSelectionCountValid(1, group)) scheduleAutoAdvance(currentStepIndex, currentStep.id);
      } else if (current.length < maxSelect) {
        const next = { ...comboSelectionsRef.current, [group.id]: [...current, optionId] };
        comboSelectionsRef.current = next;
        setSelectedCombosByGroup(next);
      }
    }
  }, [cancelAutoAdvance, scheduleAutoAdvance]);

  const validationMessage = activeStep && attemptedStepId === activeStep.id && !isStepValid(activeStep)
    ? activeStep.kind === 'fraction' ? 'Seleccione una opción para esta parte.' : `Seleccione ${activeStep.name}.`
    : null;

  const handleContinue = useCallback(() => {
    if (!activeStep) return;
    cancelAutoAdvance();
    if (activeStepIndex < steps.length - 1) {
      if (!isStepValid(activeStep)) { showStepError(activeStep); return; }
      setCompletedStepIds(prev => ({ ...prev, [activeStep.id]: true }));
      moveToStep(activeStepIndex + 1);
      return;
    }
    const firstInvalidIndex = steps.findIndex(step => !isStepValid(step));
    if (firstInvalidIndex >= 0) {
      const invalidStep = steps[firstInvalidIndex];
      setActiveStepIndex(firstInvalidIndex);
      setPagesByStep(prev => ({ ...prev, [invalidStep.id]: 0 }));
      setAttemptedStepId(invalidStep.id);
      focusFirstOption();
      return;
    }
    if (confirmationStartedRef.current) return;
    confirmationStartedRef.current = true;

    const selectedModifierSnapshot = selectedModifierObjects.map(({ group, modifier }) => ({
      group_id: group.id, group_name: group.name, modifier_id: modifier.id, product_id: modifier.product_id,
      name: modifier.name, modifier_type: modifier.modifier_type || 'ADD', affects_price: modifier.affects_price !== false,
      price_delta: getModifierPrice(modifier),
    }));
    const selectedFractionSnapshot = selectedFractionObjects.map(option => ({
      id: getFractionOptionId(option), product_id: option.product_id || option.option_product_id,
      name: option.name || getFractionOptionId(option), price: getFractionOptionPrice(option), ratio: 1 / maxFractionParts,
    }));
    const selectedComboSnapshot = selectedComboObjects.map(({ group, item }) => ({
      group_id: group.id, group_name: group.name, item_id: item.id || item.product_id, product_id: item.product_id,
      name: item.name || item.product_id, price_delta: Number(item.price_delta || 0),
    }));
    const labels: string[] = [];
    if (selectedFractionObjects.length > 0) labels.push(`Fracciones: ${selectedFractionObjects.map(option => option.name || getFractionOptionId(option)).join(' / ')}`);
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
    onConfirm(labels, total, note.trim() || undefined, {
      modifierGroups: selectedModifiersByGroup, comboGroups: selectedCombosByGroup, fractions: selectedFractionSnapshot,
      selected_modifiers: selectedModifierSnapshot, selected_fraction_parts: selectedFractionSnapshot,
      selected_combo_items: selectedComboSnapshot, product_type: productType,
      production_area_id: restaurantConfigSource.production_area_id, note: note.trim() || undefined,
    });
  }, [activeStep, activeStepIndex, cancelAutoAdvance, currencySymbol, focusFirstOption, getFractionOptionId, getFractionOptionPrice, getModifierPrice, isStepValid, maxFractionParts, moveToStep, note, onConfirm, productType, restaurantConfigSource.production_area_id, selectedComboObjects, selectedCombosByGroup, selectedFractionObjects, selectedModifierObjects, selectedModifiersByGroup, showStepError, steps, total]);

  const handleClose = useCallback(() => { cancelAutoAdvance(); onClose(); }, [cancelAutoAdvance, onClose]);
  const addNotePreset = useCallback((preset: string) => setNote(prev => {
    const current = prev.trim();
    if (!current) return preset;
    if (current.includes(preset)) return current;
    return `${current}; ${preset}`;
  }), []);

  const activeOptions = useMemo(() => {
    if (!activeStep || activeStep.kind === 'note') return [];
    if (activeStep.kind === 'fraction') return fractionOptions.map(option => ({
      id: getFractionOptionId(option), label: option.name || getFractionOptionId(option),
      meta: `${currencySymbol}${getFractionOptionPrice(option).toFixed(2)}`,
      selected: selectedFractions[activeStep.partIndex] === getFractionOptionId(option), multiple: false,
    }));
    if (activeStep.kind === 'modifier') return activeStep.group.modifiers.map(modifier => {
      const price = getModifierPrice(modifier);
      return {
        id: modifier.id, label: modifier.name,
        meta: modifier.modifier_type === 'REMOVE' || modifier.affects_price === false || price === 0 ? 'Sin costo' : `${price > 0 ? '+' : ''}${currencySymbol}${price.toFixed(2)}`,
        selected: (selectedModifiersByGroup[activeStep.group.id] || []).includes(modifier.id),
        multiple: activeStep.group.selection_type !== 'SINGLE',
      };
    });
    return activeStep.group.items.map(item => {
      const id = String(item.id || item.product_id || item.name);
      const delta = Number(item.price_delta || 0);
      return { id, label: item.name || id, meta: delta === 0 ? 'Sin costo' : `${delta > 0 ? '+' : ''}${currencySymbol}${delta.toFixed(2)}`, selected: (selectedCombosByGroup[activeStep.group.id] || []).includes(id), multiple: Number(activeStep.group.max_select || 1) > 1 };
    });
  }, [activeStep, currencySymbol, fractionOptions, getFractionOptionId, getFractionOptionPrice, getModifierPrice, selectedCombosByGroup, selectedFractions, selectedModifiersByGroup]);

  const currentPage = activeStep ? Math.min(pagesByStep[activeStep.id] || 0, Math.max(0, Math.ceil(activeOptions.length / MODIFIER_MODAL_LAYOUT.optionsPerPage) - 1)) : 0;
  const pageCount = Math.max(1, Math.ceil(activeOptions.length / MODIFIER_MODAL_LAYOUT.optionsPerPage));
  const pageOptions = paginateModifierOptions(activeOptions, currentPage);
  const selectedCount = activeOptions.filter(option => option.selected).length;
  const changePage = useCallback((nextPage: number) => {
    if (!activeStep) return;
    cancelAutoAdvance();
    setPagesByStep(prev => ({ ...prev, [activeStep.id]: Math.max(0, Math.min(nextPage, pageCount - 1)) }));
  }, [activeStep, cancelAutoAdvance, pageCount]);

  const summaryForStep = useCallback((step: Step) => {
    if (step.kind === 'note') return note.trim() ? 'Con nota' : 'Sin nota';
    if (step.kind === 'fraction') {
      const option = fractionOptions.find(candidate => getFractionOptionId(candidate) === selectedFractions[step.partIndex]);
      return option?.name || '';
    }
    if (step.kind === 'modifier') return `${(selectedModifiersByGroup[step.group.id] || []).length} seleccionados`;
    return `${(selectedCombosByGroup[step.group.id] || []).length} seleccionados`;
  }, [fractionOptions, getFractionOptionId, note, selectedCombosByGroup, selectedFractions, selectedModifiersByGroup]);

  const themeButtonClass = ({ blue: 'bg-blue-600 hover:bg-blue-700', orange: 'bg-orange-600 hover:bg-orange-700', gray: 'bg-slate-800 hover:bg-slate-900' } as Record<string, string>)[themeColor] || 'bg-blue-600 hover:bg-blue-700';
  const nextStep = steps[activeStepIndex + 1];
  const activeStepDetails = (() => {
    if (!activeStep || activeStep.kind === 'note') return '';
    if (activeStep.kind === 'fraction') {
      const required = productType === 'FRACTIONABLE' || fractionSelectionCount > 0;
      return `${required ? 'Obligatorio' : 'Opcional'} · Selección única${required ? ' · Mínimo 1' : ''} · Máximo 1`;
    }
    const minSelect = activeStep.group.required
      ? Math.max(1, Number(activeStep.group.min_select || 1))
      : Number(activeStep.group.min_select || 0);
    const maxSelect = activeStep.kind === 'modifier'
      ? (activeStep.group.selection_type === 'SINGLE' ? 1 : Number(activeStep.group.max_select || 0))
      : Math.max(1, Number(activeStep.group.max_select || 1));
    const multiple = activeStep.kind === 'modifier'
      ? activeStep.group.selection_type !== 'SINGLE'
      : maxSelect > 1;
    return [
      minSelect > 0 ? 'Obligatorio' : 'Opcional',
      multiple ? 'Selección múltiple' : 'Selección única',
      minSelect > 0 ? `Mínimo ${minSelect}` : '',
      maxSelect > 0 ? `Máximo ${maxSelect}` : '',
    ].filter(Boolean).join(' · ');
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-2 backdrop-blur-sm sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="modifier-modal-title" className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 shadow-2xl">
        <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-600">Modificadores</p>
              <h2 id="modifier-modal-title" className="mt-1 truncate text-2xl font-black text-slate-950 sm:text-3xl">{product.name}</h2>
              <p className="mt-1 text-sm font-bold text-slate-500 sm:text-lg">Precio base · {currencySymbol}{Number(product.price || 0).toFixed(2)}</p>
            </div>
            <button type="button" aria-label="Cerrar modificadores" onClick={handleClose} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-600 hover:bg-slate-200"><X size={22} /></button>
          </div>
          <nav aria-label="Pasos de modificadores" className="mt-4 overflow-x-auto pb-1">
            <ol className="mx-auto flex min-w-max items-start justify-center sm:min-w-0">
            {steps.map((step, index) => {
              const active = index === activeStepIndex;
              const complete = Boolean(completedStepIds[step.id]) && isStepValid(step);
              return (
                <li key={step.id} className={`flex items-start ${index === steps.length - 1 ? 'flex-none' : 'flex-1'}`}>
                  <button type="button" onClick={() => moveToStep(index)} aria-current={active ? 'step' : undefined} className="group flex min-w-24 flex-col items-center text-center">
                    <span className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-black transition-colors ${active ? 'border-blue-600 bg-blue-600 text-white' : complete ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-500'}`}>{complete && !active ? <Check size={18} strokeWidth={3} /> : index + 1}</span>
                    <span className={`mt-1.5 block max-w-28 truncate text-xs font-black ${active || complete ? 'text-blue-800' : 'text-slate-400'}`}>{step.name}</span>
                    {complete && !active && <span className="block max-w-28 truncate text-[10px] font-bold text-slate-500">{summaryForStep(step)}</span>}
                  </button>
                  {index < steps.length - 1 && <span aria-hidden="true" className={`mt-5 h-0.5 min-w-8 flex-1 ${complete ? 'bg-blue-400' : 'bg-slate-200'}`} />}
                </li>
              );
            })}
            </ol>
          </nav>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7" ref={optionAreaRef}>
          {activeStep?.kind === 'note' ? (
            <section className="mx-auto max-w-3xl">
              <div className="mb-4 flex items-center gap-3"><MessageSquare className="text-blue-600" /><div><h3 className="text-xl font-black text-slate-950">Nota de cocina</h3><p className="text-sm font-medium text-slate-500">Agrega instrucciones especiales para preparar este artículo.</p></div></div>
              {notePresets.length > 0 && <div className="mb-4 flex flex-wrap gap-2">{notePresets.map(preset => <button key={preset} type="button" onClick={() => addNotePreset(preset)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:border-blue-300 hover:bg-blue-50">{preset}</button>)}</div>}
              <textarea value={note} onChange={event => setNote(event.target.value)} className="min-h-36 w-full rounded-2xl border-2 border-slate-200 bg-white p-4 text-base font-semibold text-slate-800 outline-none focus:border-blue-500" placeholder="Ej: alérgico al maní, salsa aparte..." autoFocus />
            </section>
          ) : activeStep ? (
            <section aria-describedby={validationMessage ? 'modifier-validation-error' : undefined} className={`mx-auto max-w-6xl rounded-2xl border p-4 sm:p-5 ${validationMessage ? 'border-red-300 bg-red-50/40' : 'border-blue-200 bg-blue-50/40'}`}>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div tabIndex={-1} data-step-focus="true"><h3 className="text-2xl font-black text-slate-950">{activeStep.name}</h3><p className="mt-1 text-sm font-semibold text-slate-500 sm:text-base">{activeStepDetails}</p></div>
                <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-black text-slate-600">{selectedCount} {selectedCount === 1 ? 'seleccionado' : 'seleccionados'}</span>
              </div>
              {validationMessage && <div id="modifier-validation-error" role="alert" className="mb-4 flex items-center gap-2 text-sm font-bold text-red-700"><AlertCircle size={18} />{validationMessage}</div>}
              <div className="modifier-option-grid" role={activeOptions[0]?.multiple ? 'group' : 'radiogroup'}>{pageOptions.map(option => <OptionCard key={`${activeStep.id}-${option.id}`} {...option} onSelect={handleOptionSelect} />)}</div>
              {pageCount > 1 && <div className="mt-5 flex items-center justify-center gap-3"><button type="button" onClick={() => changePage(currentPage - 1)} disabled={currentPage === 0} className="flex min-h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 font-black text-slate-700 disabled:opacity-40"><ChevronLeft size={19} />Anterior</button><span className="min-w-16 text-center text-sm font-black text-slate-600">{currentPage + 1} de {pageCount}</span><button type="button" onClick={() => changePage(currentPage + 1)} disabled={currentPage === pageCount - 1} className="flex min-h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 font-black text-slate-700 disabled:opacity-40">Siguiente<ChevronRight size={19} /></button></div>}
            </section>
          ) : null}
        </main>

        <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-4 shadow-[0_-6px_20px_rgba(15,23,42,0.06)] sm:px-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
            <dl className="grid grid-cols-3 gap-3 text-sm sm:w-[40%] sm:grid-cols-1 sm:gap-1 sm:border-r sm:border-slate-200 sm:pr-7"><div className="sm:flex sm:items-center sm:justify-between"><dt className="font-bold text-slate-400">Base</dt><dd className="mt-1 font-black text-slate-900 sm:mt-0">{currencySymbol}{Number(fractionBase).toFixed(2)}</dd></div><div className="sm:flex sm:items-center sm:justify-between"><dt className="font-bold text-slate-400">Extras</dt><dd className="mt-1 font-black text-slate-900 sm:mt-0">{currencySymbol}{Number(extrasTotal).toFixed(2)}</dd></div><div className="sm:flex sm:items-center sm:justify-between"><dt className="font-black text-slate-600">Total</dt><dd className="mt-1 text-lg font-black text-blue-700 sm:mt-0">{currencySymbol}{Number(total).toFixed(2)}</dd></div></dl>
            <button type="button" onClick={handleContinue} className={`flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl px-6 text-base font-black text-white shadow-lg active:scale-[0.99] sm:ml-3 sm:min-h-[72px] sm:text-lg ${themeButtonClass}`}>{nextStep ? <>Continuar a {nextStep.name}<ChevronRight size={20} /></> : <><Plus size={20} />Agregar al pedido · {currencySymbol}{Number(total).toFixed(2)}</>}</button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default ModifierModal;
