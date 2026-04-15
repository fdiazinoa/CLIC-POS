import React, { useState } from 'react';
import {
  X, Plus, Printer, Scissors, CreditCard,
  ArrowRightLeft, Link as LinkIcon, FileText
} from 'lucide-react';
import { Table, Room } from '../types';

interface TableOptionsModalProps {
  table: Table;
  room?: Room;
  allTables: Table[];
  onClose: () => void;
  onAddOrder: () => void;
  onPrintPrecheck: () => void;
  onSplitItems?: () => void;
  onSplitPayment?: () => void;
  onMoveTable: (targetTableId: string) => void;
  onMergeTables?: (targetTableIds: string[]) => void;
  onFree?: () => void;
}

const TableOptionsModal: React.FC<TableOptionsModalProps> = ({
  table,
  room,
  allTables,
  onClose,
  onAddOrder,
  onPrintPrecheck,
  onSplitItems,
  onSplitPayment,
  onMoveTable,
  onMergeTables,
  onFree
}) => {
  const isOccupied = table.status === 'OCCUPIED';
  const availableTables = allTables.filter(t => t.id !== table.id && t.roomId === table.roomId && t.status === 'FREE');
  const [showMoveView, setShowMoveView] = useState(false);

  // Sub-view for Move Table to keep modal clean
  if (showMoveView) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={onClose}>
        <div className="w-full max-w-sm bg-white shadow-2xl rounded-2xl overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
          <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
            <div>
              <h3 className="text-xs font-bold tracking-wider text-gray-400 uppercase">Mover Pedido</h3>
              <h2 className="text-xl font-bold text-gray-800">De {table.nombre} a...</h2>
            </div>
            <button onClick={() => setShowMoveView(false)} className="p-2 hover:bg-gray-200 rounded-full text-gray-500 transition-colors">
              <X size={20} />
            </button>
          </div>
          <div className="p-2 max-h-[60vh] overflow-y-auto grid grid-cols-2 gap-2 bg-gray-50/30">
            {availableTables.length === 0 ? (
              <div className="col-span-2 py-12 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
                <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                  <ArrowRightLeft size={16} />
                </div>
                No hay otras mesas libres.
              </div>
            ) : (
              availableTables.map(t => (
                <button
                  key={t.id}
                  onClick={() => {
                    if (confirm(`¿Mover a ${t.nombre}?`)) onMoveTable(t.id);
                  }}
                  className="p-4 rounded-xl border border-gray-200 bg-white hover:border-blue-500 hover:bg-blue-50 hover:shadow-md transition-all text-center group flex flex-col items-center gap-1"
                >
                  <div className="font-bold text-gray-700 group-hover:text-blue-700 text-lg">{t.nombre}</div>
                  <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wide">Cap: {t.capacity || 4}</div>
                </button>
              ))
            )}
          </div>
          <div className="p-3 bg-gray-50 border-t border-gray-100 flex justify-end">
            <button onClick={() => setShowMoveView(false)} className="text-sm font-bold text-gray-500 hover:text-gray-800 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors">Volver</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-white shadow-2xl rounded-2xl overflow-hidden animate-in zoom-in-95 duration-200 ring-1 ring-black/5"
        onClick={e => e.stopPropagation()}
      >

        {/* Header */}
        <div className="p-6 border-b border-gray-100 relative bg-white">
          <h3 className="text-[10px] font-black tracking-widest text-gray-400 uppercase mb-1">ACCIONES RÁPIDAS</h3>
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-black text-gray-800 tracking-tight">{table.nombre}</h2>
              <div className="flex items-center gap-2 mt-2">
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black tracking-wide uppercase ${isOccupied ? 'bg-red-100 text-red-700 ' : 'bg-green-100 text-green-700'}`}>
                  {isOccupied ? 'Ocupada' : 'Libre'}
                </span>
                <span className="text-xs text-gray-500 font-medium">Capacidad: {table.capacity || 4} pers.</span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-800 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Lista de Botones */}
        <div className="p-2 flex flex-col gap-1 bg-white">
          {/* Grupo 1: Operativa */}
          <button onClick={onAddOrder} className="flex items-center gap-4 w-full p-3 rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-all text-left group">
            <div className={`p-2.5 rounded-lg transition-colors ${isOccupied ? 'bg-blue-50 text-blue-600 group-hover:bg-blue-100' : 'bg-green-50 text-green-600 group-hover:bg-green-100'}`}>
              {isOccupied ? <FileText size={20} /> : <Plus size={20} />}
            </div>
            <div className="flex-1">
              <div className="font-bold text-gray-700 group-hover:text-gray-900 transition-colors">
                {isOccupied ? 'Ver Comanda' : 'Abrir Mesa'}
              </div>
              <div className="text-xs text-gray-400 font-medium">
                {isOccupied ? 'Gestionar pedidos y items' : 'Iniciar una nueva orden'}
              </div>
            </div>
          </button>

          <div className="h-px bg-gray-100 my-1 mx-4" />

          {/* Grupo 2: Gestión */}
          <button onClick={() => setShowMoveView(true)} className="flex items-center gap-4 w-full p-3 rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-all text-left group">
            <div className="p-2.5 bg-gray-100 text-gray-500 rounded-lg group-hover:bg-gray-200 group-hover:text-gray-700 transition-colors">
              <ArrowRightLeft size={20} />
            </div>
            <div className="flex-1">
              <div className="font-bold text-gray-700 group-hover:text-gray-900">Mover Mesa</div>
              <div className="text-xs text-gray-400 font-medium">Cambiar ubicación del pedido</div>
            </div>
          </button>

          {onMergeTables && (
            <button onClick={() => {
              const target = prompt('Ingrese ID de mesa a unir (Desarrollo: ID interna)');
              if (target) onMergeTables([target]);
            }} className="flex items-center gap-4 w-full p-3 rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-all text-left group">
              <div className="p-2.5 bg-gray-100 text-gray-500 rounded-lg group-hover:bg-gray-200 group-hover:text-gray-700 transition-colors">
                <LinkIcon size={20} />
              </div>
              <div className="flex-1">
                <div className="font-bold text-gray-700 group-hover:text-gray-900">Unir Mesas</div>
                <div className="text-xs text-gray-400 font-medium">Combinar con otra cuenta</div>
              </div>
            </button>
          )}

          {/* Grupo 3: Financiero (Solo si ocupada) */}
          {isOccupied && (
            <>
              <div className="h-px bg-gray-100 my-1 mx-4" />
              {onSplitItems && (
                <button onClick={onSplitItems} className="flex items-center gap-4 w-full p-3 rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-all text-left group">
                  <div className="p-2.5 bg-purple-50 text-purple-600 rounded-lg group-hover:bg-purple-100 transition-colors">
                    <Scissors size={20} />
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-gray-700 group-hover:text-gray-900">Dividir Cuenta</div>
                    <div className="text-xs text-gray-400 font-medium">Separar por items o personas</div>
                  </div>
                </button>
              )}

              <button onClick={onPrintPrecheck} className="flex items-center gap-4 w-full p-3 rounded-xl hover:bg-gray-50 active:bg-gray-100 transition-all text-left group">
                <div className="p-2.5 bg-orange-50 text-orange-600 rounded-lg group-hover:bg-orange-100 transition-colors">
                  <Printer size={20} />
                </div>
                <div className="flex-1">
                  <div className="font-bold text-gray-700 group-hover:text-gray-900">Imprimir Pre-cuenta</div>
                  <div className="text-xs text-gray-400 font-medium">Enviar a impresora de caja</div>
                </div>
              </button>
            </>
          )}

          {/* Grupo 4: Cierre */}
          {isOccupied && onFree && (
            <>
              <div className="h-px bg-gray-100 my-1 mx-4" />
              <button onClick={() => { if (confirm('¿Liberar mesa? Se perderán cambios no guardados.')) onFree(); }} className="flex items-center gap-4 w-full p-3 rounded-xl hover:bg-red-50 active:bg-red-100 transition-all text-left group">
                <div className="p-2.5 bg-red-50 text-red-500 rounded-lg group-hover:bg-red-100 group-hover:text-red-600 transition-colors">
                  <X size={20} />
                </div>
                <div className="flex-1">
                  <div className="font-bold text-gray-700 group-hover:text-red-700">Cerrar / Liberar</div>
                  <div className="text-xs text-gray-400 font-medium group-hover:text-red-400">Finalizar servicio</div>
                </div>
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-center">
          <button onClick={onClose} className="text-xs font-bold text-gray-400 hover:text-gray-600 uppercase tracking-widest transition-colors">Cancelar</button>
        </div>

      </div>
    </div>
  );
};

export default TableOptionsModal;
