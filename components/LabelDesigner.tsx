import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Printer, Type, ScanBarcode, QrCode,
  Settings, Save, X, ZoomIn, ZoomOut, Copy, Trash2, Plus, RotateCcw
} from 'lucide-react';
import { BusinessConfig, LabelElement, LabelElementType, LabelTemplate, LabelDataSource, LabelTemplateCategory } from '../types';
import { DEFAULT_LABEL_TEMPLATES, DEFAULT_LABEL_TEMPLATE_IDS } from '../constants';

interface LabelDesignerProps {
  config: BusinessConfig;
  onUpdateConfig: (newConfig: BusinessConfig) => void;
  onClose: () => void;
}

const MM_TO_PX = 3.78;
const CATEGORY_ORDER: Record<LabelTemplateCategory, number> = { ARTICLE: 0, GONDOLA: 1 };
const DEFAULT_TEMPLATE_IDS = new Set(DEFAULT_LABEL_TEMPLATE_IDS);
const PRINTABLE_SOURCES: LabelDataSource[] = ['PRODUCT_NAME', 'PRODUCT_PRICE', 'PRODUCT_SKU'];

const cloneTemplates = (templates: LabelTemplate[]): LabelTemplate[] => (
  templates.map(template => ({
    ...template,
    elements: template.elements.map(element => ({ ...element }))
  }))
);

const inferCategory = (template: Partial<LabelTemplate>): LabelTemplateCategory => {
  if (template.category === 'ARTICLE' || template.category === 'GONDOLA') {
    return template.category;
  }

  const name = `${template.id || ''} ${template.name || ''}`.toLowerCase();
  return name.includes('gondola') ? 'GONDOLA' : 'ARTICLE';
};

const normalizeTemplate = (template: LabelTemplate): LabelTemplate => ({
  ...template,
  category: inferCategory(template),
  elements: template.elements.map(element => ({ ...element }))
});

const sortTemplates = (templates: LabelTemplate[]): LabelTemplate[] => (
  [...templates].sort((a, b) => {
    const byCategory = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    if (byCategory !== 0) return byCategory;
    return a.name.localeCompare(b.name);
  })
);

const mergeWithMissingDefaults = (templates: LabelTemplate[]): LabelTemplate[] => {
  const normalized = templates.map(normalizeTemplate);
  const currentIds = new Set(normalized.map(template => template.id));

  const missingDefaults = DEFAULT_LABEL_TEMPLATES
    .filter(template => !currentIds.has(template.id))
    .map(template => normalizeTemplate(template));

  return sortTemplates([...normalized, ...missingDefaults]);
};

const getTemplatesFromConfig = (config: BusinessConfig): LabelTemplate[] => {
  if (Array.isArray(config.labelTemplates) && config.labelTemplates.length > 0) {
    return mergeWithMissingDefaults(cloneTemplates(config.labelTemplates));
  }
  return sortTemplates(cloneTemplates(DEFAULT_LABEL_TEMPLATES));
};

const createCustomTemplate = (category: LabelTemplateCategory): LabelTemplate => ({
  id: `lbl-custom-${Date.now()}`,
  name: category === 'ARTICLE' ? 'Articulo Personalizado' : 'Gondola Personalizada',
  category,
  widthMm: category === 'ARTICLE' ? 50 : 100,
  heightMm: category === 'ARTICLE' ? 25 : 35,
  elements: [
    {
      id: `el-name-${Date.now()}`,
      type: 'TEXT',
      x: 2,
      y: 2,
      width: 35,
      height: 6,
      content: 'Nombre Producto',
      dataSource: 'PRODUCT_NAME',
      fontSize: 10,
      isBold: true
    },
    {
      id: `el-price-${Date.now() + 1}`,
      type: 'TEXT',
      x: 38,
      y: 2,
      width: 10,
      height: 6,
      content: '$99.00',
      dataSource: 'PRODUCT_PRICE',
      fontSize: 11,
      isBold: true
    },
    {
      id: `el-bar-${Date.now() + 2}`,
      type: 'BARCODE',
      x: 2,
      y: 10,
      width: 40,
      height: 10,
      content: '123456',
      dataSource: 'PRODUCT_SKU'
    }
  ]
});

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));
const hasPrintableData = (template: LabelTemplate): boolean => (
  template.elements.some(element => PRINTABLE_SOURCES.includes(element.dataSource))
);

const LabelDesigner: React.FC<LabelDesignerProps> = ({ config, onUpdateConfig, onClose }) => {
  const [templates, setTemplates] = useState<LabelTemplate[]>(() => getTemplatesFromConfig(config));
  const [activeTemplateId, setActiveTemplateId] = useState<string>(() => getTemplatesFromConfig(config)[0]?.id || '');
  const [templateTypeFilter, setTemplateTypeFilter] = useState<LabelTemplateCategory>('ARTICLE');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(2);
  const [printCopies, setPrintCopies] = useState(1);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);

  // Dragging state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const incomingTemplates = getTemplatesFromConfig(config);
    setTemplates(incomingTemplates);
    setActiveTemplateId((prev) => incomingTemplates.some(t => t.id === prev) ? prev : (incomingTemplates[0]?.id || ''));
    setTemplateTypeFilter((prev) => {
      if (incomingTemplates.some(template => template.category === prev)) return prev;
      return incomingTemplates[0]?.category || 'ARTICLE';
    });
    setSelectedId(null);
    setIsDirty(false);
  }, [config.labelTemplates]);

  const visibleTemplates = useMemo(
    () => sortTemplates(templates).filter(template => template.category === templateTypeFilter),
    [templates, templateTypeFilter]
  );

  const activeTemplate = useMemo(
    () => templates.find(template => template.id === activeTemplateId) || null,
    [templates, activeTemplateId]
  );

  const selectedElement = useMemo(
    () => activeTemplate?.elements.find(element => element.id === selectedId) || null,
    [activeTemplate, selectedId]
  );

  useEffect(() => {
    if (!visibleTemplates.length) return;
    const activeVisible = visibleTemplates.some(template => template.id === activeTemplateId);
    if (!activeVisible) {
      setActiveTemplateId(visibleTemplates[0].id);
      setSelectedId(null);
    }
  }, [visibleTemplates, activeTemplateId]);

  const updateTemplates = (updater: (current: LabelTemplate[]) => LabelTemplate[]) => {
    setTemplates((current) => {
      const updated = mergeWithMissingDefaults(updater(current));
      return updated;
    });
    setIsDirty(true);
  };

  const updateActiveTemplate = (updater: (template: LabelTemplate) => LabelTemplate) => {
    if (!activeTemplate) return;
    updateTemplates(current => current.map(template => (
      template.id === activeTemplate.id ? updater(template) : template
    )));
  };

  const addTemplate = () => {
    const newTemplate = createCustomTemplate(templateTypeFilter);
    updateTemplates(current => [...current, newTemplate]);
    setActiveTemplateId(newTemplate.id);
    setSelectedId(null);
    setStatusMessage('Plantilla creada.');
  };

  const duplicateTemplate = () => {
    if (!activeTemplate) return;
    const clone: LabelTemplate = {
      ...activeTemplate,
      id: `lbl-copy-${Date.now()}`,
      name: `${activeTemplate.name} (Copia)`,
      elements: activeTemplate.elements.map(element => ({
        ...element,
        id: `${element.id}-c${Date.now()}`
      }))
    };

    updateTemplates(current => [...current, clone]);
    setActiveTemplateId(clone.id);
    setSelectedId(null);
    setStatusMessage('Plantilla duplicada.');
  };

  const deleteTemplate = () => {
    if (!activeTemplate) return;
    if (DEFAULT_TEMPLATE_IDS.has(activeTemplate.id)) {
      setStatusMessage('Las plantillas por defecto no se pueden eliminar.');
      return;
    }
    if (templates.length <= 1) {
      setStatusMessage('Debe existir al menos una plantilla.');
      return;
    }

    const remaining = templates.filter(template => template.id !== activeTemplate.id);
    const nextVisible = sortTemplates(remaining).filter(template => template.category === templateTypeFilter);
    updateTemplates(() => remaining);
    setActiveTemplateId(nextVisible[0]?.id || sortTemplates(remaining)[0]?.id || '');
    setSelectedId(null);
    setStatusMessage('Plantilla eliminada.');
  };

  const restoreAllDefaults = () => {
    const defaults = sortTemplates(cloneTemplates(DEFAULT_LABEL_TEMPLATES));
    setTemplates(defaults);
    setActiveTemplateId(defaults.find(template => template.category === templateTypeFilter)?.id || defaults[0]?.id || '');
    setSelectedId(null);
    setIsDirty(true);
    setStatusMessage('Plantillas por defecto restauradas.');
  };

  const restoreActiveDefault = () => {
    if (!activeTemplate) return;
    if (!DEFAULT_TEMPLATE_IDS.has(activeTemplate.id)) {
      setStatusMessage('Solo las plantillas por defecto se pueden restaurar por plantilla.');
      return;
    }

    const defaultTemplate = DEFAULT_LABEL_TEMPLATES.find(template => template.id === activeTemplate.id);
    if (!defaultTemplate) return;

    updateTemplates(current => current.map(template => (
      template.id === activeTemplate.id ? normalizeTemplate(defaultTemplate) : template
    )));
    setSelectedId(null);
    setStatusMessage(`Plantilla restaurada: ${defaultTemplate.name}`);
  };

  const addElement = (type: LabelElementType) => {
    if (!activeTemplate) return;

    const newElement: LabelElement = {
      id: `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      x: 5,
      y: 5,
      width: type === 'QR' ? 15 : 40,
      height: type === 'QR' ? 15 : 8,
      content: type === 'TEXT' ? 'Texto' : '123456',
      dataSource: type === 'TEXT' ? 'CUSTOM_TEXT' : 'PRODUCT_SKU',
      fontSize: 10,
      isBold: false
    };

    updateActiveTemplate(template => ({
      ...template,
      elements: [...template.elements, newElement]
    }));
    setSelectedId(newElement.id);
  };

  const updateElement = (id: string, updates: Partial<LabelElement>) => {
    updateActiveTemplate(template => ({
      ...template,
      elements: template.elements.map(element => (
        element.id === id ? { ...element, ...updates } : element
      ))
    }));
  };

  const deleteElement = (id: string) => {
    updateActiveTemplate(template => ({
      ...template,
      elements: template.elements.filter(element => element.id !== id)
    }));
    setSelectedId(null);
  };

  const handlePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedId(id);
    setDraggingId(id);

    const element = activeTemplate?.elements.find(el => el.id === id);
    if (element) {
      const rect = e.currentTarget.getBoundingClientRect();
      const offsetX = (e.clientX - rect.left) / (MM_TO_PX * zoom);
      const offsetY = (e.clientY - rect.top) / (MM_TO_PX * zoom);
      setDragOffset({ x: offsetX, y: offsetY });
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingId || !canvasRef.current || !activeTemplate) return;

    const element = activeTemplate.elements.find(el => el.id === draggingId);
    if (!element) return;

    const canvasRect = canvasRef.current.getBoundingClientRect();
    const rawX = (e.clientX - canvasRect.left) / (MM_TO_PX * zoom) - dragOffset.x;
    const rawY = (e.clientY - canvasRect.top) / (MM_TO_PX * zoom) - dragOffset.y;

    const nextX = clamp(Math.round(rawX), 0, Math.max(0, activeTemplate.widthMm - element.width));
    const nextY = clamp(Math.round(rawY), 0, Math.max(0, activeTemplate.heightMm - element.height));

    updateElement(draggingId, { x: nextX, y: nextY });
  };

  const handlePointerUp = () => {
    setDraggingId(null);
  };

  const handleSave = () => {
    onUpdateConfig({
      ...config,
      labelTemplates: cloneTemplates(templates)
    });
    setIsDirty(false);
    setStatusMessage('Plantillas guardadas en Ajustes.');
  };

  const handlePrintTest = () => {
    if (!activeTemplate) return;
    if (!hasPrintableData(activeTemplate)) {
      setStatusMessage('Impresion bloqueada: agrega al menos un dato (nombre, precio o SKU/codigo).');
      return;
    }

    const copies = Math.max(1, Math.floor(printCopies) || 1);
    setPrintCopies(copies);
    setStatusMessage(`Impresion de prueba enviada: ${activeTemplate.name} (${copies} copia${copies > 1 ? 's' : ''}).`);
  };

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden animate-in fade-in">
      {/* Left toolbar */}
      <div className="w-20 bg-white border-r border-gray-200 flex flex-col items-center py-6 gap-4 shadow-sm z-10">
        <button onClick={onClose} className="p-2 mb-4 bg-white border border-gray-200 rounded-full hover:bg-gray-50 text-gray-500 shadow-sm">
          <X size={20} />
        </button>

        <div className="w-full px-2 flex flex-col gap-3">
          <ToolButton icon={Type} label="Texto" onClick={() => addElement('TEXT')} disabled={!activeTemplate} />
          <ToolButton icon={ScanBarcode} label="Barras" onClick={() => addElement('BARCODE')} disabled={!activeTemplate} />
          <ToolButton icon={QrCode} label="QR" onClick={() => addElement('QR')} disabled={!activeTemplate} />
        </div>

        <div className="mt-auto flex flex-col gap-3">
          <button onClick={() => setZoom(current => Math.min(current + 0.5, 4))} className="p-2 bg-white border border-gray-200 rounded-lg text-gray-400 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 shadow-sm" title="Zoom +">
            <ZoomIn size={20} />
          </button>
          <button onClick={() => setZoom(current => Math.max(current - 0.5, 1))} className="p-2 bg-white border border-gray-200 rounded-lg text-gray-400 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50 shadow-sm" title="Zoom -">
            <ZoomOut size={20} />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        className="flex-1 bg-gray-100 relative overflow-hidden flex items-center justify-center p-8"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(#9ca3af 1px, transparent 1px)',
            backgroundSize: '20px 20px'
          }}
        />

        {!activeTemplate ? (
          <div className="bg-white border border-gray-200 rounded-2xl px-6 py-4 text-sm text-gray-500">
            No hay plantilla activa.
          </div>
        ) : (
          <>
            <div
              ref={canvasRef}
              className="bg-white shadow-2xl relative transition-all duration-200 cursor-crosshair"
              style={{
                width: `${activeTemplate.widthMm * MM_TO_PX * zoom}px`,
                height: `${activeTemplate.heightMm * MM_TO_PX * zoom}px`,
                borderRadius: '4px'
              }}
            >
              {activeTemplate.elements.map(element => (
                <div
                  key={element.id}
                  onPointerDown={(e) => handlePointerDown(e, element.id)}
                  className={`absolute group select-none flex items-center justify-center overflow-hidden cursor-move ${
                    selectedId === element.id ? 'ring-2 ring-blue-500 z-10' : 'hover:ring-1 hover:ring-blue-300'
                  }`}
                  style={{
                    left: `${element.x * MM_TO_PX * zoom}px`,
                    top: `${element.y * MM_TO_PX * zoom}px`,
                    width: `${element.width * MM_TO_PX * zoom}px`,
                    height: `${element.height * MM_TO_PX * zoom}px`
                  }}
                >
                  {element.type === 'TEXT' && (
                    <span
                      style={{
                        fontSize: `${(element.fontSize || 10) * zoom}px`,
                        fontWeight: element.isBold ? 'bold' : 'normal',
                        whiteSpace: 'nowrap'
                      }}
                      className="text-gray-800"
                    >
                      {element.dataSource === 'CUSTOM_TEXT' ? element.content : `[${element.dataSource.replace('PRODUCT_', '')}]`}
                    </span>
                  )}

                  {element.type === 'BARCODE' && (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 border border-gray-200">
                      <div className="flex-1 w-full px-1 flex items-end justify-center gap-[1px]">
                        {[...Array(15)].map((_, i) => (
                          <div key={`${element.id}-bar-${i}`} className="bg-black" style={{ width: i % 2 === 0 ? '2px' : '1px', height: '80%' }} />
                        ))}
                      </div>
                      <span className="text-[8px] leading-none mb-0.5 font-mono">12345678</span>
                    </div>
                  )}

                  {element.type === 'QR' && (
                    <div className="w-full h-full bg-white border border-gray-200 p-1">
                      <div className="w-full h-full bg-black" style={{ clipPath: 'polygon(0% 0%, 0% 100%, 25% 100%, 25% 25%, 75% 25%, 75% 75%, 25% 75%, 25% 100%, 100% 100%, 100% 0%)' }} />
                    </div>
                  )}

                  {selectedId === element.id && (
                    <>
                      <div className="absolute top-0 left-0 w-2 h-2 bg-blue-500 rounded-full -translate-x-1/2 -translate-y-1/2" />
                      <div className="absolute bottom-0 right-0 w-2 h-2 bg-blue-500 rounded-full translate-x-1/2 translate-y-1/2" />
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-800/80 text-white px-4 py-1.5 rounded-full text-xs font-mono backdrop-blur-sm">
              {activeTemplate.widthMm}mm x {activeTemplate.heightMm}mm
            </div>
          </>
        )}
      </div>

      {/* Properties */}
      <div className="w-96 bg-white border-l border-gray-200 shadow-xl flex flex-col z-20">
        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Settings size={18} /> Diseno de Etiquetas
          </h3>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={printCopies}
              onChange={(e) => setPrintCopies(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-16 p-2 bg-white border border-gray-300 rounded-lg text-sm font-mono text-center"
              title="Copias"
            />
            <button onClick={handlePrintTest} className="bg-slate-100 hover:bg-slate-200 text-slate-700 p-2 rounded-lg transition-colors" title="Imprimir prueba">
              <Printer size={18} />
            </button>
            <button
              onClick={handleSave}
              disabled={!isDirty}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white p-2 rounded-lg shadow-sm transition-colors"
              title="Guardar plantillas"
            >
              <Save size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {statusMessage && (
            <div className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
              {statusMessage}
            </div>
          )}

          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-3">
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tipo de Etiqueta</label>
            <select
              value={templateTypeFilter}
              onChange={(e) => {
                setTemplateTypeFilter(e.target.value as LabelTemplateCategory);
                setSelectedId(null);
              }}
              className="w-full p-2 bg-white border border-gray-300 rounded-lg text-sm font-bold"
            >
              <option value="ARTICLE">Articulo</option>
              <option value="GONDOLA">Gondola</option>
            </select>

            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Plantilla Activa</label>
            <select
              value={activeTemplateId}
              onChange={(e) => {
                setActiveTemplateId(e.target.value);
                setSelectedId(null);
              }}
              className="w-full p-2 bg-white border border-gray-300 rounded-lg text-sm font-bold"
            >
              {visibleTemplates.map(template => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={addTemplate} className="px-2 py-2 text-xs font-bold rounded-lg bg-white border border-gray-300 hover:bg-gray-100 flex items-center justify-center gap-1">
                <Plus size={14} /> Nueva
              </button>
              <button onClick={duplicateTemplate} disabled={!activeTemplate} className="px-2 py-2 text-xs font-bold rounded-lg bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-50 flex items-center justify-center gap-1">
                <Copy size={14} /> Duplicar
              </button>
              <button
                onClick={deleteTemplate}
                disabled={!activeTemplate || (activeTemplate ? DEFAULT_TEMPLATE_IDS.has(activeTemplate.id) : false)}
                className="px-2 py-2 text-xs font-bold rounded-lg bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-50 flex items-center justify-center gap-1"
                title={activeTemplate && DEFAULT_TEMPLATE_IDS.has(activeTemplate.id) ? 'Plantilla por defecto protegida' : 'Eliminar plantilla'}
              >
                <Trash2 size={14} /> Eliminar
              </button>
              <button
                onClick={restoreActiveDefault}
                disabled={!activeTemplate || (activeTemplate ? !DEFAULT_TEMPLATE_IDS.has(activeTemplate.id) : true)}
                className="px-2 py-2 text-xs font-bold rounded-lg bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-50 flex items-center justify-center gap-1"
              >
                <RotateCcw size={14} /> Restaurar
              </button>
              <button onClick={restoreAllDefaults} className="col-span-2 px-2 py-2 text-xs font-bold rounded-lg bg-white border border-gray-300 hover:bg-gray-100 flex items-center justify-center gap-1">
                <RotateCcw size={14} /> Restaurar Todos los Defaults
              </button>
            </div>

            <p className="text-[10px] text-gray-500">
              Defaults protegidos: Articulo (XS, S, M, L, XL) y Gondola.
            </p>
          </div>

          {!selectedElement && activeTemplate && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-gray-500 uppercase">Categoria</label>
                {DEFAULT_TEMPLATE_IDS.has(activeTemplate.id) && (
                  <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded bg-slate-100 text-slate-700">
                    Default
                  </span>
                )}
              </div>
              <select
                value={activeTemplate.category}
                onChange={(e) => {
                  const nextCategory = e.target.value as LabelTemplateCategory;
                  updateActiveTemplate(template => ({ ...template, category: nextCategory }));
                  setTemplateTypeFilter(nextCategory);
                }}
                className="w-full p-2 bg-gray-50 border rounded-lg text-sm"
              >
                <option value="ARTICLE">Articulo</option>
                <option value="GONDOLA">Gondola</option>
              </select>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre Plantilla</label>
                <input
                  type="text"
                  value={activeTemplate.name}
                  onChange={(e) => updateActiveTemplate(template => ({ ...template, name: e.target.value }))}
                  className="w-full p-2 bg-gray-50 border rounded-lg text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Ancho (mm)</label>
                  <input
                    type="number"
                    value={activeTemplate.widthMm}
                    onChange={(e) => updateActiveTemplate(template => ({ ...template, widthMm: Math.max(10, parseInt(e.target.value, 10) || 10) }))}
                    className="w-full p-2 bg-gray-50 border rounded-lg text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Alto (mm)</label>
                  <input
                    type="number"
                    value={activeTemplate.heightMm}
                    onChange={(e) => updateActiveTemplate(template => ({ ...template, heightMm: Math.max(10, parseInt(e.target.value, 10) || 10) }))}
                    className="w-full p-2 bg-gray-50 border rounded-lg text-sm font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {selectedElement && (
            <div className="space-y-5 animate-in slide-in-from-right-5">
              <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                <span className="text-sm font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded uppercase">{selectedElement.type}</span>
                <button onClick={() => deleteElement(selectedElement.id)} className="text-red-400 hover:text-red-600">
                  <Trash2 size={18} />
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Contenido / Dato</label>
                <select
                  value={selectedElement.dataSource}
                  onChange={(e) => updateElement(selectedElement.id, { dataSource: e.target.value as LabelDataSource })}
                  className="w-full p-2 bg-white border border-gray-300 rounded-lg text-sm mb-2"
                >
                  <option value="CUSTOM_TEXT">Texto Personalizado</option>
                  <option value="PRODUCT_NAME">Nombre del Producto</option>
                  <option value="PRODUCT_PRICE">Precio</option>
                  <option value="PRODUCT_SKU">Codigo / SKU</option>
                </select>

                {selectedElement.dataSource === 'CUSTOM_TEXT' && (
                  <input
                    type="text"
                    value={selectedElement.content}
                    onChange={(e) => updateElement(selectedElement.id, { content: e.target.value })}
                    className="w-full p-2 bg-gray-50 border rounded-lg text-sm"
                    placeholder="Escribe aqui..."
                  />
                )}
              </div>

              {selectedElement.type === 'TEXT' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tamano</label>
                    <input
                      type="number"
                      value={selectedElement.fontSize || 10}
                      onChange={(e) => updateElement(selectedElement.id, { fontSize: Math.max(6, parseInt(e.target.value, 10) || 10) })}
                      className="w-full p-2 bg-gray-50 border rounded-lg text-sm"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={() => updateElement(selectedElement.id, { isBold: !selectedElement.isBold })}
                      className={`w-full p-2 rounded-lg text-sm font-bold border transition-colors ${
                        selectedElement.isBold ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-300'
                      }`}
                    >
                      Negrita
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-4 border-t border-gray-100">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Pos X (mm)</label>
                  <input
                    type="number"
                    value={Math.round(selectedElement.x)}
                    onChange={(e) => updateElement(selectedElement.id, { x: parseInt(e.target.value, 10) || 0 })}
                    className="w-full p-1.5 bg-gray-50 border rounded text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Pos Y (mm)</label>
                  <input
                    type="number"
                    value={Math.round(selectedElement.y)}
                    onChange={(e) => updateElement(selectedElement.id, { y: parseInt(e.target.value, 10) || 0 })}
                    className="w-full p-1.5 bg-gray-50 border rounded text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Ancho (mm)</label>
                  <input
                    type="number"
                    value={Math.round(selectedElement.width)}
                    onChange={(e) => updateElement(selectedElement.id, { width: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className="w-full p-1.5 bg-gray-50 border rounded text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Alto (mm)</label>
                  <input
                    type="number"
                    value={Math.round(selectedElement.height)}
                    onChange={(e) => updateElement(selectedElement.id, { height: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    className="w-full p-1.5 bg-gray-50 border rounded text-xs font-mono"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ToolButton: React.FC<{ icon: any; label: string; onClick: () => void; disabled?: boolean }> = ({ icon: Icon, label, onClick, disabled }) => (
  <button
    onClick={disabled ? undefined : onClick}
    className={`w-full flex flex-col items-center gap-1 p-3 rounded-xl transition-all border bg-white ${
      disabled
        ? 'text-gray-300 border-gray-100 cursor-not-allowed opacity-70'
        : 'text-gray-600 border-gray-200 shadow-sm hover:bg-blue-50 hover:text-blue-600 hover:border-blue-100 active:scale-95'
    }`}
  >
    <Icon size={24} />
    <span className="text-[10px] font-bold uppercase">{label}</span>
  </button>
);

export default LabelDesigner;
