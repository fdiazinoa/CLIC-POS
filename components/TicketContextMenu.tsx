import React, { useRef, useEffect } from 'react';
import { 
  Edit2, Users, PieChart, Split, Percent, Clock, X, UserPlus 
} from 'lucide-react';

interface TicketContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onAction: (action: string) => void;
}

const TicketContextMenu: React.FC<TicketContextMenuProps> = ({ x, y, onClose, onAction }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close if clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Adjust position to not overflow screen
  const style: React.CSSProperties = {
    top: Math.min(y, window.innerHeight - 300), 
    left: Math.min(x, window.innerWidth - 220), 
  };

  const menuItems = [
    { id: 'RENAME', label: 'Cambiar Alias', icon: Edit2, color: 'text-gray-700' },
    { id: 'ASSIGN_CUSTOMER', label: 'Asignar Cliente', icon: UserPlus, color: 'text-blue-600' },
    { id: 'SPLIT_BILL', label: 'Dividir Cuenta (Items)', icon: Split, color: 'text-orange-600' },
    { id: 'FRACTION', label: 'Fraccionar (Partes Iguales)', icon: PieChart, color: 'text-purple-600' },
    { id: 'APPLY_DISCOUNT', label: 'Descuento Global', icon: Percent, color: 'text-red-500' },
    { id: 'SHOW_TIME', label: 'Ver Tiempo en Espera', icon: Clock, color: 'text-green-600' },
  ];

  return (
    <div 
      ref={menuRef}
      style={style}
      className="fixed z-[100] bg-white rounded-xl shadow-2xl border border-gray-200 w-64 overflow-hidden animate-in zoom-in-95 duration-100 origin-top-left"
    >
      <div className="bg-gray-50 px-4 py-2 border-b border-gray-100 flex justify-between items-center">
        <span className="text-xs font-bold text-gray-500 uppercase">Opciones de Ticket</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={14} />
        </button>
      </div>
      <div className="py-1">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => { onAction(item.id); onClose(); }}
            className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors active:bg-blue-50 group"
          >
            <item.icon size={18} className={item.color} />
            <span className="text-sm font-medium text-gray-700 group-hover:text-gray-900">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default TicketContextMenu;