import React, { useEffect, useMemo, useState } from 'react';
import { X, Printer, Package, Copy, ListOrdered } from 'lucide-react';
import { BusinessConfig, LabelTemplate, LabelTemplateCategory } from '../types';
import { DEFAULT_LABEL_TEMPLATES } from '../constants';
import { LabelPrintRecord, printLabelsFromTemplate } from '../utils/labelPrinter';

type QuantityMode = 'RECEIVED' | 'FIXED';

export interface LabelPrintModalItem {
  productId: string;
  productName: string;
  sku?: string;
  price?: number;
  quantityReceived?: number;
}

interface LabelPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: BusinessConfig;
  items: LabelPrintModalItem[];
  sourceTitle?: string;
  terminalId?: string;
  defaultProductId?: string;
  defaultTemplateCategory?: LabelTemplateCategory;
  defaultQuantityMode?: QuantityMode;
}

const getTemplates = (config: BusinessConfig): LabelTemplate[] => {
  if (Array.isArray(config.labelTemplates) && config.labelTemplates.length > 0) {
    return [...config.labelTemplates];
  }
  return [...DEFAULT_LABEL_TEMPLATES];
};

const toPositiveInt = (value: number, fallback = 1): number => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const LabelPrintModal: React.FC<LabelPrintModalProps> = ({
  isOpen,
  onClose,
  config,
  items,
  sourceTitle,
  terminalId,
  defaultProductId,
  defaultTemplateCategory = 'ARTICLE',
  defaultQuantityMode = 'RECEIVED'
}) => {
  const [templateId, setTemplateId] = useState('');
  const [quantityMode, setQuantityMode] = useState<QuantityMode>(defaultQuantityMode);
  const [fixedQuantity, setFixedQuantity] = useState(1);
  const [copiesMultiplier, setCopiesMultiplier] = useState(1);
  const [selectedProductId, setSelectedProductId] = useState('ALL');
  const [keepDocumentOrder, setKeepDocumentOrder] = useState(true);
  const [includeZeroQty, setIncludeZeroQty] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  const templates = useMemo(() => {
    return getTemplates(config).sort((a, b) => {
      const categoryOrder = (a.category === b.category) ? 0 : (a.category === 'ARTICLE' ? -1 : 1);
      if (categoryOrder !== 0) return categoryOrder;
      return a.name.localeCompare(b.name);
    });
  }, [config.labelTemplates]);

  const normalizedItems = useMemo(() => {
    return (items || []).map((item, idx) => ({
      ...item,
      _idx: idx,
      productName: item.productName || item.productId,
      quantityReceived: Number(item.quantityReceived || 0)
    }));
  }, [items]);

  const productOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ id: string; name: string }> = [];

    normalizedItems.forEach(item => {
      if (!item.productId || seen.has(item.productId)) return;
      seen.add(item.productId);
      options.push({ id: item.productId, name: item.productName });
    });

    return options;
  }, [normalizedItems]);

  const selectedTemplate = useMemo(
    () => templates.find(template => template.id === templateId) || null,
    [templates, templateId]
  );

  const preparedRecords = useMemo((): LabelPrintRecord[] => {
    const filtered = normalizedItems.filter(item => selectedProductId === 'ALL' || item.productId === selectedProductId);
    const ordered = keepDocumentOrder
      ? filtered
      : [...filtered].sort((a, b) => a.productName.localeCompare(b.productName));

    const perItemFixed = toPositiveInt(fixedQuantity, 1);
    const multiplier = toPositiveInt(copiesMultiplier, 1);

    return ordered.map(item => {
      const receivedQty = Number.isFinite(item.quantityReceived) ? Math.floor(item.quantityReceived) : 0;
      let copies = quantityMode === 'RECEIVED' ? receivedQty : perItemFixed;

      if (quantityMode === 'RECEIVED' && includeZeroQty && copies <= 0) {
        copies = 1;
      }

      copies = Math.max(0, copies) * multiplier;

      return {
        productId: item.productId,
        productName: item.productName,
        sku: item.sku || item.productId,
        price: item.price,
        copies
      };
    }).filter(record => record.copies > 0);
  }, [
    normalizedItems,
    selectedProductId,
    keepDocumentOrder,
    quantityMode,
    fixedQuantity,
    copiesMultiplier,
    includeZeroQty
  ]);

  const totalLabels = useMemo(
    () => preparedRecords.reduce((sum, record) => sum + record.copies, 0),
    [preparedRecords]
  );

  useEffect(() => {
    if (!isOpen) return;

    const preferredTemplate = templates.find(template => template.category === defaultTemplateCategory) || templates[0];
    setTemplateId(preferredTemplate?.id || '');
    setQuantityMode(defaultQuantityMode);
    setFixedQuantity(1);
    setCopiesMultiplier(1);
    setSelectedProductId(defaultProductId || 'ALL');
    setKeepDocumentOrder(true);
    setIncludeZeroQty(false);
    setStatusMessage(null);
  }, [isOpen, templates, defaultTemplateCategory, defaultQuantityMode, defaultProductId]);

  if (!isOpen) return null;

  const handlePrint = async () => {
    if (!selectedTemplate) {
      setStatusMessage('Selecciona una plantilla de etiqueta.');
      return;
    }

    if (preparedRecords.length === 0 || totalLabels <= 0) {
      setStatusMessage('No hay etiquetas para imprimir con las opciones actuales.');
      return;
    }

    setIsPrinting(true);
    setStatusMessage(null);
    try {
      const result = await printLabelsFromTemplate({
        config,
        template: selectedTemplate,
        records: preparedRecords,
        terminalId,
        referenceId: sourceTitle || `LBL-${Date.now()}`
      });
      setStatusMessage(result.message);
    } catch (error) {
      console.error('Label print error:', error);
      setStatusMessage('Ocurrio un error al preparar la impresion de etiquetas.');
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[140] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-4xl bg-white rounded-[2rem] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-gray-50">
          <div>
            <h3 className="text-lg font-black text-gray-800 flex items-center gap-2">
              <Printer size={20} className="text-blue-600" /> Imprimir Etiquetas
            </h3>
            <p className="text-xs text-gray-500 font-medium mt-1">
              {sourceTitle || 'Configura la impresion por documento o por articulo.'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-200 text-gray-500 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[11px] uppercase font-black text-gray-500">Tipo de Etiqueta (Guardadas)</label>
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                className="w-full p-3 rounded-xl border border-gray-200 bg-white font-semibold text-sm outline-none focus:ring-2 focus:ring-blue-200"
              >
                {templates.map(template => (
                  <option key={template.id} value={template.id}>
                    {template.name} [{template.category}]
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] uppercase font-black text-gray-500">Articulo Especifico</label>
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                className="w-full p-3 rounded-xl border border-gray-200 bg-white font-semibold text-sm outline-none focus:ring-2 focus:ring-blue-200"
              >
                <option value="ALL">Todos los articulos del documento</option>
                {productOptions.map(option => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-4">
            <p className="text-xs uppercase tracking-wide font-black text-gray-500 flex items-center gap-2">
              <Package size={14} /> Cantidad de Etiquetas
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className={`p-3 rounded-xl border-2 cursor-pointer ${quantityMode === 'RECEIVED' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'}`}>
                <input
                  type="radio"
                  checked={quantityMode === 'RECEIVED'}
                  onChange={() => setQuantityMode('RECEIVED')}
                  className="mr-2"
                />
                <span className="text-sm font-bold text-gray-800">Por cantidad recibida del documento</span>
                <p className="text-xs text-gray-500 mt-1">Imprime segun `cantidad recibida` por articulo.</p>
              </label>

              <label className={`p-3 rounded-xl border-2 cursor-pointer ${quantityMode === 'FIXED' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'}`}>
                <input
                  type="radio"
                  checked={quantityMode === 'FIXED'}
                  onChange={() => setQuantityMode('FIXED')}
                  className="mr-2"
                />
                <span className="text-sm font-bold text-gray-800">Cantidad fija por articulo</span>
                <p className="text-xs text-gray-500 mt-1">Imprime una cantidad igual para cada articulo filtrado.</p>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {quantityMode === 'FIXED' && (
                <div>
                  <label className="text-[11px] uppercase font-black text-gray-500">Etiquetas por Articulo</label>
                  <input
                    type="number"
                    min={1}
                    value={fixedQuantity}
                    onChange={(e) => setFixedQuantity(toPositiveInt(Number(e.target.value), 1))}
                    className="w-full mt-1 p-2.5 rounded-xl border border-gray-200 font-bold text-sm outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
              )}

              <div>
                <label className="text-[11px] uppercase font-black text-gray-500">Multiplicador de Copias</label>
                <input
                  type="number"
                  min={1}
                  value={copiesMultiplier}
                  onChange={(e) => setCopiesMultiplier(toPositiveInt(Number(e.target.value), 1))}
                  className="w-full mt-1 p-2.5 rounded-xl border border-gray-200 font-bold text-sm outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <input
                type="checkbox"
                checked={keepDocumentOrder}
                onChange={(e) => setKeepDocumentOrder(e.target.checked)}
              />
              <ListOrdered size={16} className="text-gray-500" />
              Imprimir en el orden del documento
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <input
                type="checkbox"
                checked={includeZeroQty}
                disabled={quantityMode !== 'RECEIVED'}
                onChange={(e) => setIncludeZeroQty(e.target.checked)}
              />
              <Copy size={16} className="text-gray-500" />
              Incluir 1 etiqueta en articulos con 0 recibido
            </label>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
            <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-blue-700 uppercase tracking-wide">
              <span>Articulos seleccionados: {preparedRecords.length}</span>
              <span>Total etiquetas: {totalLabels}</span>
            </div>

            <div className="mt-3 space-y-1 max-h-40 overflow-y-auto pr-2">
              {preparedRecords.slice(0, 30).map((record, idx) => (
                <div key={`${record.productId}-${record.sku}-${idx}`} className="flex items-center justify-between text-sm text-gray-700 bg-white border border-blue-100 rounded-lg px-3 py-2">
                  <span className="font-semibold truncate mr-3">{record.productName}</span>
                  <span className="font-black text-blue-700">{record.copies}</span>
                </div>
              ))}
              {preparedRecords.length === 0 && (
                <div className="text-sm text-gray-500 italic">No hay articulos para imprimir con el filtro actual.</div>
              )}
            </div>
          </div>

          {statusMessage && (
            <div className="p-3 rounded-xl bg-gray-100 border border-gray-200 text-sm font-medium text-gray-700">
              {statusMessage}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-sm transition-colors"
          >
            Cerrar
          </button>
          <button
            onClick={handlePrint}
            disabled={isPrinting}
            className="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <Printer size={16} />
            {isPrinting ? 'Imprimiendo...' : 'Imprimir Etiquetas'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LabelPrintModal;
