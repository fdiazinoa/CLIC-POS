import React, { useEffect, useState } from 'react';
import { X, ArrowLeft, ArrowRight, Check, AlertCircle, Split, GripVertical, MoveRight, Plus } from 'lucide-react';
import { CartItem } from '../types';

interface SplitTicketModalProps {
  originalItems: CartItem[];
  currencySymbol: string;
  onClose: () => void;
  onConfirm: (
    remainingItems: CartItem[],
    newTicketItems: CartItem[],
    extraNewTickets?: CartItem[][],
    splitCount?: number
  ) => void;
}

const cloneItems = (items: CartItem[]) => JSON.parse(JSON.stringify(items || [])) as CartItem[];
const calculateTotal = (items: CartItem[]) => items.reduce((acc, item) => acc + (Number(item.price || 0) * Number(item.quantity || 0)), 0);
const itemSignature = (item: CartItem) => JSON.stringify({
  id: item.id,
  price: item.price,
  modifiers: item.modifiers || [],
  note: item.note || '',
  restaurantConfig: item.restaurantConfig || null
});

const NumberTicker: React.FC<{ value: number; currency: string }> = ({ value, currency }) => {
  return <span className="tabular-nums tracking-tight">{currency}{value.toFixed(2)}</span>;
};

const SplitTicketModal: React.FC<SplitTicketModalProps> = ({ originalItems, currencySymbol, onClose, onConfirm }) => {
  const MAX_SPLIT_ACCOUNTS = 20;
  const [splitCount, setSplitCount] = useState(2);
  const [accounts, setAccounts] = useState<CartItem[][]>([[], []]);
  const [activeDestination, setActiveDestination] = useState(1);
  const [dragOverAccount, setDragOverAccount] = useState<number | null>(null);
  const [qtyModal, setQtyModal] = useState<{ isOpen: boolean; item: CartItem | null; sourceAccount: number; targetAccount: number }>({
    isOpen: false,
    item: null,
    sourceAccount: 0,
    targetAccount: 1
  });
  const [sliderValue, setSliderValue] = useState(1);

  useEffect(() => {
    setAccounts([cloneItems(originalItems), []]);
    setSplitCount(2);
    setActiveDestination(1);
  }, [originalItems]);

  const normalizeAccountCount = (nextCount: number) => {
    setSplitCount(nextCount);
    setActiveDestination((current) => Math.min(Math.max(1, current), nextCount - 1));
    setAccounts((current) => {
      const next = Array.from({ length: nextCount }, (_, index) => cloneItems(current[index] || []));
      if (current.length > nextCount) {
        const overflow = current.slice(nextCount).flat();
        overflow.forEach(item => {
          const existingIndex = next[0].findIndex(candidate => itemSignature(candidate) === itemSignature(item));
          if (existingIndex >= 0) {
            next[0][existingIndex] = { ...next[0][existingIndex], quantity: Number(next[0][existingIndex].quantity || 0) + Number(item.quantity || 0) };
          } else {
            next[0].push({ ...item, cartId: item.cartId || Math.random().toString(36).slice(2, 11) });
          }
        });
      }
      return next;
    });
  };

  const transferItem = (itemToMove: CartItem, sourceAccount: number, targetAccount: number, quantityToMove: number) => {
    if (sourceAccount === targetAccount || quantityToMove <= 0) return;
    setAccounts(prev => {
      const next = prev.map(group => [...group]);
      const sourceIndex = next[sourceAccount].findIndex(item => item.cartId === itemToMove.cartId);
      if (sourceIndex === -1) return prev;

      const sourceItem = next[sourceAccount][sourceIndex];
      const movingQuantity = Math.min(Number(sourceItem.quantity || 0), quantityToMove);
      if (movingQuantity <= 0) return prev;

      if (Number(sourceItem.quantity || 0) === movingQuantity) {
        next[sourceAccount].splice(sourceIndex, 1);
      } else {
        next[sourceAccount][sourceIndex] = { ...sourceItem, quantity: Number(sourceItem.quantity || 0) - movingQuantity };
      }

      const targetIndex = next[targetAccount].findIndex(item => itemSignature(item) === itemSignature(sourceItem));
      if (targetIndex >= 0) {
        next[targetAccount][targetIndex] = {
          ...next[targetAccount][targetIndex],
          quantity: Number(next[targetAccount][targetIndex].quantity || 0) + movingQuantity
        };
      } else {
        next[targetAccount].push({
          ...sourceItem,
          cartId: Math.random().toString(36).slice(2, 11),
          quantity: movingQuantity
        });
      }

      return next;
    });
  };

  const requestMove = (item: CartItem, sourceAccount: number, targetAccount: number) => {
    if (sourceAccount === targetAccount) return;
    if (Number(item.quantity || 0) > 1) {
      setSliderValue(1);
      setQtyModal({ isOpen: true, item, sourceAccount, targetAccount });
      return;
    }
    transferItem(item, sourceAccount, targetAccount, 1);
  };

  const handleItemClick = (item: CartItem, sourceAccount: number) => {
    requestMove(item, sourceAccount, sourceAccount === 0 ? activeDestination : 0);
  };

  const handleDragStart = (e: React.DragEvent, item: CartItem, sourceAccount: number) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ item, sourceAccount }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetAccount: number) => {
    e.preventDefault();
    setDragOverAccount(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      requestMove(data.item as CartItem, Number(data.sourceAccount || 0), targetAccount);
    } catch (error) {
      console.error('Drop failed', error);
    }
  };

  const confirmQtyMove = () => {
    if (qtyModal.item) {
      transferItem(qtyModal.item, qtyModal.sourceAccount, qtyModal.targetAccount, sliderValue);
      setQtyModal({ ...qtyModal, isOpen: false });
    }
  };

  const destinationsWithItems = accounts.slice(1).filter(group => group.length > 0);
  const canConfirm = destinationsWithItems.length > 0;
  const originalTotal = calculateTotal(accounts[0] || []);
  const activeTotal = calculateTotal(accounts[activeDestination] || []);

  return (
    <div className="fixed inset-0 z-[80] bg-gray-900/95 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="w-full max-w-7xl h-[90vh] flex flex-col relative">
        <div className="flex justify-between items-center mb-5 text-white">
          <div className="flex items-center gap-4">
            <div className="bg-orange-500 p-3 rounded-2xl shadow-lg shadow-orange-500/20"><Split size={28} className="text-white" /></div>
            <div>
              <h1 className="text-3xl font-black tracking-tight">Dividir Cuenta</h1>
              <p className="text-white/60 font-medium">Elige las cuentas y mueve artículos entre ellas</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors text-white"><X size={24} /></button>
        </div>

        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {[2, 3, 4].map(count => (
              <button
                key={count}
                type="button"
                onClick={() => normalizeAccountCount(count)}
                className={`px-5 py-3 rounded-2xl font-black border transition-all ${splitCount === count ? 'bg-orange-500 border-orange-400 text-white shadow-lg shadow-orange-500/20' : 'bg-white/10 border-white/10 text-white/70 hover:bg-white/15'}`}
              >
                {count} cuentas
              </button>
            ))}
            <button
              type="button"
              onClick={() => normalizeAccountCount(Math.min(MAX_SPLIT_ACCOUNTS, splitCount + 1))}
              disabled={splitCount >= MAX_SPLIT_ACCOUNTS}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-dashed border-white/30 bg-white/10 text-white transition-all hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Agregar cuenta"
              title={splitCount >= MAX_SPLIT_ACCOUNTS ? 'Máximo de cuentas alcanzado' : 'Agregar cuenta'}
            >
              <Plus size={22} strokeWidth={3} />
            </button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            {accounts.slice(1).map((items, index) => {
              const accountIndex = index + 1;
              return (
                <button
                  key={accountIndex}
                  type="button"
                  onClick={() => setActiveDestination(accountIndex)}
                  className={`px-4 py-3 rounded-2xl font-black border transition-all shrink-0 ${activeDestination === accountIndex ? 'bg-blue-600 border-blue-400 text-white' : 'bg-white/10 border-white/10 text-white/70 hover:bg-white/15'}`}
                >
                  Cuenta {accountIndex + 1}
                  {items.length > 0 && <span className="ml-2 text-xs bg-white/20 px-2 py-0.5 rounded-full">{items.length}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 flex gap-6 overflow-hidden">
          <AccountPanel
            title="Cuenta 1"
            eyebrow="Origen"
            items={accounts[0] || []}
            accountIndex={0}
            total={originalTotal}
            currencySymbol={currencySymbol}
            dragOver={dragOverAccount === 0}
            emptyText="Todo movido"
            accent="blue"
            onDragStart={handleDragStart}
            onDragOver={(account) => setDragOverAccount(account)}
            onDrop={handleDrop}
            onItemClick={handleItemClick}
          />

          <div className="w-16 flex flex-col items-center justify-center gap-4 text-white/20">
            <ArrowRight size={32} />
            <div className="w-0.5 h-20 bg-current rounded-full" />
            <ArrowLeft size={32} />
          </div>

          <AccountPanel
            title={`Cuenta ${activeDestination + 1}`}
            eyebrow="Destino activo"
            items={accounts[activeDestination] || []}
            accountIndex={activeDestination}
            total={activeTotal}
            currencySymbol={currencySymbol}
            dragOver={dragOverAccount === activeDestination}
            emptyText="Arrastra items aquí"
            accent="orange"
            onDragStart={handleDragStart}
            onDragOver={(account) => setDragOverAccount(account)}
            onDrop={handleDrop}
            onItemClick={handleItemClick}
          />
        </div>

        <div className="mt-6 flex justify-end gap-4">
          <button onClick={onClose} className="px-8 py-4 rounded-2xl font-bold text-white/70 hover:bg-white/10 transition-colors">Cancelar</button>
          <button
            onClick={() => onConfirm(accounts[0] || [], accounts[1] || [], accounts.slice(2), splitCount)}
            disabled={!canConfirm}
            className={`px-10 py-4 rounded-2xl font-bold text-xl shadow-xl flex items-center gap-3 transition-all ${!canConfirm ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-orange-500 hover:bg-orange-400 text-white hover:scale-105 active:scale-95'}`}
          >
            <Check size={24} strokeWidth={3} />Confirmar
          </button>
        </div>

        {qtyModal.isOpen && qtyModal.item && (
          <div className="absolute inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-white rounded-[2rem] p-8 w-full max-w-sm shadow-2xl animate-in zoom-in-95">
              <div className="text-center mb-8">
                <h3 className="text-lg font-bold text-gray-500 uppercase tracking-wide mb-2">¿Cuántos mover?</h3>
                <div className="text-2xl font-black text-gray-800 leading-tight mb-1">{qtyModal.item.name}</div>
                <div className="text-sm text-gray-400">Total disponible: {qtyModal.item.quantity}</div>
              </div>
              <div className="flex items-center justify-center gap-6 mb-8">
                <button onClick={() => setSliderValue(Math.max(1, sliderValue - 1))} className="w-12 h-12 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-xl font-bold text-gray-600">-</button>
                <div className="w-24 h-24 bg-blue-50 rounded-3xl flex items-center justify-center border-4 border-blue-100 shadow-inner">
                  <span className="text-5xl font-black text-blue-600">{sliderValue}</span>
                </div>
                <button onClick={() => setSliderValue(Math.min(Number(qtyModal.item!.quantity || 1), sliderValue + 1))} className="w-12 h-12 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-xl font-bold text-gray-600">+</button>
              </div>
              <div className="mb-8 px-4">
                <input type="range" min="1" max={qtyModal.item.quantity} value={sliderValue} onChange={(e) => setSliderValue(parseInt(e.target.value))} className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                <div className="flex justify-between mt-2 text-xs font-bold text-gray-400"><span>1</span><span>{qtyModal.item.quantity}</span></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setQtyModal({ ...qtyModal, isOpen: false })} className="py-4 rounded-xl font-bold text-gray-500 hover:bg-gray-100">Cancelar</button>
                <button onClick={confirmQtyMove} className="py-4 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-500 shadow-lg shadow-blue-500/30">Mover</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const AccountPanel: React.FC<{
  title: string;
  eyebrow: string;
  items: CartItem[];
  accountIndex: number;
  total: number;
  currencySymbol: string;
  dragOver: boolean;
  emptyText: string;
  accent: 'blue' | 'orange';
  onDragStart: (e: React.DragEvent, item: CartItem, accountIndex: number) => void;
  onDragOver: (accountIndex: number) => void;
  onDrop: (e: React.DragEvent, accountIndex: number) => void;
  onItemClick: (item: CartItem, accountIndex: number) => void;
}> = ({ title, eyebrow, items, accountIndex, total, currencySymbol, dragOver, emptyText, accent, onDragStart, onDragOver, onDrop, onItemClick }) => {
  const accentText = accent === 'blue' ? 'text-blue-600' : 'text-orange-600';
  const dragClass = accent === 'blue'
    ? 'bg-blue-600/20 border-blue-400 scale-[1.02] shadow-[0_0_50px_rgba(59,130,246,0.3)]'
    : 'bg-orange-600/20 border-orange-400 scale-[1.02] shadow-[0_0_50px_rgba(249,115,22,0.3)]';

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onDragOver(accountIndex); }}
      onDrop={(e) => onDrop(e, accountIndex)}
      className={`flex-1 rounded-[2.5rem] p-6 flex flex-col transition-all duration-300 border-4 ${dragOver ? dragClass : 'bg-white border-white/10 shadow-2xl'}`}
    >
      <div className="flex justify-between items-end mb-6 pb-4 border-b border-gray-100">
        <div>
          <span className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">{eyebrow}</span>
          <h2 className="text-xl font-bold text-gray-800">{title}</h2>
        </div>
        <div className={`text-3xl font-black ${accentText}`}>
          <NumberTicker value={total} currency={currencySymbol} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto space-y-3 pr-2">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-3xl m-4 text-gray-400">
            {accountIndex === 0 ? <AlertCircle size={48} className="mb-2" /> : <MoveRight size={48} className="mb-4 animate-pulse" />}
            <p className="font-bold">{emptyText}</p>
          </div>
        ) : (
          items.map(item => (
            <DraggableCard
              key={item.cartId}
              item={item}
              accountIndex={accountIndex}
              currencySymbol={currencySymbol}
              onDragStart={onDragStart}
              onClick={onItemClick}
            />
          ))
        )}
      </div>
    </div>
  );
};

const DraggableCard: React.FC<{
  item: CartItem;
  accountIndex: number;
  currencySymbol: string;
  onDragStart: (e: React.DragEvent, item: CartItem, accountIndex: number) => void;
  onClick: (item: CartItem, accountIndex: number) => void;
}> = ({ item, accountIndex, currencySymbol, onDragStart, onClick }) => (
  <div
    draggable
    onDragStart={(e) => onDragStart(e, item, accountIndex)}
    onClick={() => onClick(item, accountIndex)}
    className="group bg-white p-4 rounded-2xl shadow-sm border border-gray-200 cursor-grab active:cursor-grabbing hover:border-blue-400 hover:shadow-md transition-all relative overflow-hidden select-none"
  >
    <div className="flex items-center gap-4">
      <div className="text-gray-300 group-hover:text-blue-400"><GripVertical size={20} /></div>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg shadow-sm ${accountIndex === 0 ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{item.quantity}</div>
      <div className="flex-1">
        <h4 className="font-bold text-gray-800 leading-tight">{item.name}</h4>
        <p className="text-xs text-gray-400 mt-1 font-medium">{currencySymbol}{Number(item.price || 0).toFixed(2)} / un</p>
      </div>
      <div className="text-right font-bold text-gray-900 text-lg">{currencySymbol}{(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}</div>
    </div>
  </div>
);

export default SplitTicketModal;
