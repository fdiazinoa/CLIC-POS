import React, { useState, useRef } from 'react';
import { 
  Printer, Type, ScanBarcode, QrCode, Move, Trash2, 
  Settings, Save, X, ZoomIn, ZoomOut, Copy, Grid
} from 'lucide-react';
import { LabelElement, LabelElementType, LabelTemplate, LabelDataSource } from '../types';

interface LabelDesignerProps {
  onClose: () => void;
}

const MM_TO_PX = 3.78; // Approximate px per mm for screen display

const INITIAL_TEMPLATE: LabelTemplate = {
  id: 'default',
  name: 'Etiqueta Estándar',
  widthMm: 50,
  heightMm: 25,
  elements: [
    {
      id: 'e1', type: 'TEXT', x: 2, y: 2, width: 46, height: 6, 
      content: 'Nombre Producto', dataSource: 'PRODUCT_NAME', fontSize: 12, isBold: true
    },
    {
      id: 'e2', type: 'BARCODE', x: 2, y: 10, width: 40, height: 10, 
      content: '123456', dataSource: 'PRODUCT_SKU'
    },
    {
      id: 'e3', type: 'TEXT', x: 30, y: 2, width: 18, height: 6, 
      content: '$99.00', dataSource: 'PRODUCT_PRICE', fontSize: 14, isBold: true
    }
  ]
};

const LabelDesigner: React.FC<LabelDesignerProps> = ({ onClose }) => {
  const [template, setTemplate] = useState<LabelTemplate>(INITIAL_TEMPLATE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(2); // Zoom factor for better visibility
  const canvasRef = useRef<HTMLDivElement>(null);

  // Dragging State
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // --- ACTIONS ---

  const addElement = (type: LabelElementType) => {
    const newEl: LabelElement = {
      id: Math.random().toString(36).substr(2, 9),
      type,
      x: 5,
      y: 5,
      width: type === 'QR' ? 15 : 40,
      height: type === 'QR' ? 15 : 8,
      content: type === 'TEXT' ? 'Texto' : '123456',
      dataSource: 'CUSTOM_TEXT',
      fontSize: 10,
      isBold: false
    };
    setTemplate(prev => ({ ...prev, elements: [...prev.elements, newEl] }));
    setSelectedId(newEl.id);
  };

  const updateElement = (id: string, updates: Partial<LabelElement>) => {
    setTemplate(prev => ({
      ...prev,
      elements: prev.elements.map(el => el.id === id ? { ...el, ...updates } : el)
    }));
  };

  const deleteElement = (id: string) => {
    setTemplate(prev => ({
      ...prev,
      elements: prev.elements.filter(el => el.id !== id)
    }));
    setSelectedId(null);
  };

  // --- DRAG LOGIC (CANVAS) ---

  const handlePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedId(id);
    setDraggingId(id);
    
    const element = template.elements.find(el => el.id === id);
    if (element) {
      // Calculate offset relative to the element's top-left corner
      // Note: Coordinates in template are in MM, events in PX
      // We need to work in MM for state, but convert from screen PX
      
      const rect = e.currentTarget.getBoundingClientRect();
      const offsetX = (e.clientX - rect.left) / (MM_TO_PX * zoom);
      const offsetY = (e.clientY - rect.top) / (MM_TO_PX * zoom);
      setDragOffset({ x: offsetX, y: offsetY });
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (draggingId && canvasRef.current) {
      const canvasRect = canvasRef.current.getBoundingClientRect();
      
      // Calculate new position relative to canvas
      let newX = (e.clientX - canvasRect.left) / (MM_TO_PX * zoom) - dragOffset.x;
      let newY = (e.clientY - canvasRect.top) / (MM_TO_PX * zoom) - dragOffset.y;

      // Snap to grid (optional, say 1mm)
      newX = Math.round(newX);
      newY = Math.round(newY);

      // Boundaries check
      // const element = template.elements.find(el => el.id === draggingId);
      // if (element) {
      //    newX = Math.max(0, Math.min(newX, template.widthMm - element.width));
      //    newY = Math.max(0, Math.min(newY, template.heightMm - element.height));
      // }

      updateElement(draggingId, { x: newX, y: newY });
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setDraggingId(null);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handlePrint = () => {
    alert(`Enviando a impresora: ${template.name} (${template.widthMm}x${template.heightMm}mm)`);
  };

  const selectedElement = template.elements.find(el => el.id === selectedId);

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden animate-in fade-in">
      
      {/* --- LEFT TOOLBAR --- */}
      <div className="w-20 bg-white border-r border-gray-200 flex flex-col items-center py-6 gap-4 shadow-sm z-10">
        <button onClick={onClose} className="p-2 mb-4 bg-gray-100 rounded-full hover:bg-gray-200 text-gray-500">
          <X size={20} />
        </button>
        
        <div className="w-full px-2 flex flex-col gap-3">
           <ToolButton icon={Type} label="Texto" onClick={() => addElement('TEXT')} />
           <ToolButton icon={ScanBarcode} label="Barras" onClick={() => addElement('BARCODE')} />
           <ToolButton icon={QrCode} label="QR" onClick={() => addElement('QR')} />
        </div>

        <div className="mt-auto flex flex-col gap-3">
           <button onClick={() => setZoom(z => Math.min(z + 0.5, 4))} className="p-2 text-gray-400 hover:text-blue-600"><ZoomIn size={20} /></button>
           <button onClick={() => setZoom(z => Math.max(z - 0.5, 1))} className="p-2 text-gray-400 hover:text-blue-600"><ZoomOut size={20} /></button>
        </div>
      </div>

      {/* --- CENTER CANVAS AREA --- */}
      <div 
        className="flex-1 bg-gray-100 relative overflow-hidden flex items-center justify-center p-8"
        onPointerMove={handlePointerMove}
        onPointerUp={() => setDraggingId(null)} // Global release
      >
        {/* Background Grid Pattern */}
        <div className="absolute inset-0 opacity-10 pointer-events-none" 
             style={{ 
               backgroundImage: 'radial-gradient(#9ca3af 1px, transparent 1px)', 
               backgroundSize: '20px 20px' 
             }} 
        />

        {/* The Label Canvas */}
        <div 
          ref={canvasRef}
          className="bg-white shadow-2xl relative transition-all duration-200 cursor-crosshair"
          style={{
            width: `${template.widthMm * MM_TO_PX * zoom}px`,
            height: `${template.heightMm * MM_TO_PX * zoom}px`,
            borderRadius: '4px' // Slight round for aesthetic
          }}
        >
           {/* Render Elements */}
           {template.elements.map(el => (
              <div
                key={el.id}
                onPointerDown={(e) => handlePointerDown(e, el.id)}
                className={`absolute group select-none flex items-center justify-center overflow-hidden cursor-move ${
                   selectedId === el.id ? 'ring-2 ring-blue-500 z-10' : 'hover:ring-1 hover:ring-blue-300'
                }`}
                style={{
                   left: `${el.x * MM_TO_PX * zoom}px`,
                   top: `${el.y * MM_TO_PX * zoom}px`,
                   width: `${el.width * MM_TO_PX * zoom}px`,
                   height: `${el.height * MM_TO_PX * zoom}px`,
                }}
              >
                 {/* Visual Representation based on Type */}
                 {el.type === 'TEXT' && (
                    <span 
                      style={{ 
                         fontSize: `${(el.fontSize || 10) * zoom}px`, 
                         fontWeight: el.isBold ? 'bold' : 'normal',
                         whiteSpace: 'nowrap'
                      }}
                      className="text-gray-800"
                    >
                       {el.dataSource === 'CUSTOM_TEXT' ? el.content : `[${el.dataSource.replace('PRODUCT_', '')}]`}
                    </span>
                 )}

                 {el.type === 'BARCODE' && (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 border border-gray-200">
                       <div className="flex-1 w-full px-1 flex items-end justify-center gap-[1px]">
                          {[...Array(15)].map((_, i) => (
                             <div key={i} className="bg-black" style={{ width: i % 2 === 0 ? '2px' : '1px', height: '80%' }} />
                          ))}
                       </div>
                       <span className="text-[8px] leading-none mb-0.5 font-mono">12345678</span>
                    </div>
                 )}

                 {el.type === 'QR' && (
                    <div className="w-full h-full bg-white border border-gray-200 p-1">
                       <div className="w-full h-full bg-black" style={{ clipPath: 'polygon(0% 0%, 0% 100%, 25% 100%, 25% 25%, 75% 25%, 75% 75%, 25% 75%, 25% 100%, 100% 100%, 100% 0%)' }}></div>
                    </div>
                 )}

                 {/* Selection Handles (Visual only for now) */}
                 {selectedId === el.id && (
                    <>
                       <div className="absolute top-0 left-0 w-2 h-2 bg-blue-500 rounded-full -translate-x-1/2 -translate-y-1/2" />
                       <div className="absolute bottom-0 right-0 w-2 h-2 bg-blue-500 rounded-full translate-x-1/2 translate-y-1/2" />
                    </>
                 )}
              </div>
           ))}
        </div>

        {/* Paper Size Indicator */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-800/80 text-white px-4 py-1.5 rounded-full text-xs font-mono backdrop-blur-sm">
           {template.widthMm}mm x {template.heightMm}mm
        </div>
      </div>

      {/* --- RIGHT/BOTTOM PROPERTIES PANEL --- */}
      <div className="w-80 bg-white border-l border-gray-200 shadow-xl flex flex-col z-20">
         
         <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">
               <Settings size={18} /> Propiedades
            </h3>
            <button onClick={handlePrint} className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-lg shadow-sm transition-colors">
               <Printer size={18} />
            </button>
         </div>

         <div className="flex-1 overflow-y-auto p-5 space-y-6">
            
            {/* Global Settings */}
            {!selectedElement && (
               <div className="space-y-4">
                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre Plantilla</label>
                     <input 
                        type="text" 
                        value={template.name} 
                        onChange={(e) => setTemplate({...template, name: e.target.value})}
                        className="w-full p-2 bg-gray-50 border rounded-lg text-sm"
                     />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                     <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Ancho (mm)</label>
                        <input 
                           type="number" 
                           value={template.widthMm} 
                           onChange={(e) => setTemplate({...template, widthMm: parseInt(e.target.value)})}
                           className="w-full p-2 bg-gray-50 border rounded-lg text-sm font-mono"
                        />
                     </div>
                     <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Alto (mm)</label>
                        <input 
                           type="number" 
                           value={template.heightMm} 
                           onChange={(e) => setTemplate({...template, heightMm: parseInt(e.target.value)})}
                           className="w-full p-2 bg-gray-50 border rounded-lg text-sm font-mono"
                        />
                     </div>
                  </div>
               </div>
            )}

            {/* Element Specific Settings */}
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
                        <option value="PRODUCT_SKU">Código / SKU</option>
                     </select>
                     
                     {selectedElement.dataSource === 'CUSTOM_TEXT' && (
                        <input 
                           type="text" 
                           value={selectedElement.content}
                           onChange={(e) => updateElement(selectedElement.id, { content: e.target.value })}
                           className="w-full p-2 bg-gray-50 border rounded-lg text-sm"
                           placeholder="Escribe aquí..."
                        />
                     )}
                  </div>

                  {selectedElement.type === 'TEXT' && (
                     <div className="grid grid-cols-2 gap-3">
                        <div>
                           <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Tamaño</label>
                           <input 
                              type="number" 
                              value={selectedElement.fontSize} 
                              onChange={(e) => updateElement(selectedElement.id, { fontSize: parseInt(e.target.value) })}
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

                  {/* Positioning (Fine tuning) */}
                  <div className="grid grid-cols-2 gap-3 pt-4 border-t border-gray-100">
                     <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Pos X (mm)</label>
                        <input 
                           type="number" 
                           value={Math.round(selectedElement.x)} 
                           onChange={(e) => updateElement(selectedElement.id, { x: parseInt(e.target.value) })}
                           className="w-full p-1.5 bg-gray-50 border rounded text-xs font-mono"
                        />
                     </div>
                     <div>
                        <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Pos Y (mm)</label>
                        <input 
                           type="number" 
                           value={Math.round(selectedElement.y)} 
                           onChange={(e) => updateElement(selectedElement.id, { y: parseInt(e.target.value) })}
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

const ToolButton: React.FC<{ icon: any; label: string; onClick: () => void }> = ({ icon: Icon, label, onClick }) => (
   <button 
      onClick={onClick}
      className="w-full flex flex-col items-center gap-1 p-3 rounded-xl hover:bg-blue-50 text-gray-600 hover:text-blue-600 transition-all border border-transparent hover:border-blue-100 active:scale-95"
   >
      <Icon size={24} />
      <span className="text-[10px] font-bold uppercase">{label}</span>
   </button>
);

export default LabelDesigner;
