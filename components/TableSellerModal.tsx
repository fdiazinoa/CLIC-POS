import React, { useEffect, useMemo, useState } from 'react';
import { Check, User as UserIcon, UserCheck, X } from 'lucide-react';
import type { User } from '../types';
import { isGeneratedAvatarPlaceholder } from '../utils/userPhoto';
import './ModernLoginScreen.css';

interface TableSellerModalProps {
  tableName: string;
  users: User[];
  selectedSellerId?: string;
  assigning: boolean;
  onSelect: (sellerId: string) => void;
  onClose: () => void;
}

const TableSellerModal: React.FC<TableSellerModalProps> = ({
  tableName, users, selectedSellerId, assigning, onSelect, onClose,
}) => {
  const [failedUserPhotos, setFailedUserPhotos] = useState<Record<string, boolean>>({});
  const activeUsers = useMemo(() => users
    .filter(user => user.isActive !== false)
    .sort((a, b) => a.name.localeCompare(b.name)), [users]);

  useEffect(() => {
    if (assigning) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [assigning, onClose]);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      role="presentation"
      onClick={event => { if (event.target === event.currentTarget && !assigning) onClose(); }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="table-seller-title"
        className="flex max-h-[88vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[2rem] border border-slate-700/60 bg-[#020617] text-white shadow-2xl"
      >
        <header className="relative shrink-0 border-b border-white/10 px-6 pb-5 pt-7 text-center sm:px-10">
          <button
            type="button"
            aria-label="Cerrar selector de vendedor"
            disabled={assigning}
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full bg-slate-800 p-2.5 text-slate-300 transition-colors hover:bg-slate-700 hover:text-white disabled:opacity-40"
          >
            <X size={20} />
          </button>
          <div className="modern-lock-icon-container">
            <UserCheck className="text-blue-400" size={28} aria-hidden="true" />
          </div>
          <p className="modern-login-subtitle">{tableName}</p>
          <h2 id="table-seller-title" className="modern-login-title">Seleccionar vendedor</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-slate-400">
            Se asigna a todas las cuentas abiertas de esta mesa. La cajera que cobra permanece igual.
          </p>
        </header>

        <div className="min-h-0 overflow-y-auto px-4 py-5 sm:px-8">
          {activeUsers.length > 0 ? (
            <div className="modern-user-grid mx-auto" style={{ maxWidth: 600 }}>
              {activeUsers.map(user => {
                const photoSrc = typeof user.photo === 'string' ? user.photo.trim() : '';
                const shouldShowPhoto = photoSrc && !isGeneratedAvatarPlaceholder(photoSrc) && !failedUserPhotos[user.id];
                const selected = selectedSellerId === String(user.id);
                return (
                  <button
                    key={user.id}
                    type="button"
                    aria-label={`Asignar ${user.name} como vendedor de ${tableName}`}
                    aria-pressed={selected}
                    disabled={assigning}
                    onClick={() => onSelect(String(user.id))}
                    className={`modern-user-card ${selected ? 'active' : ''} disabled:cursor-wait disabled:opacity-50`}
                  >
                    <div className="modern-user-avatar-wrapper">
                      <div className="modern-user-avatar">
                        {shouldShowPhoto ? (
                          <img
                            src={photoSrc}
                            alt=""
                            className="h-full w-full object-cover"
                            onError={() => setFailedUserPhotos(previous => ({ ...previous, [user.id]: true }))}
                          />
                        ) : (
                          <UserIcon className="modern-user-avatar-fallback" aria-hidden="true" />
                        )}
                      </div>
                      {selected && <Check size={18} className="absolute -right-2 -top-2 rounded-full bg-sky-500 p-0.5 text-white" aria-hidden="true" />}
                    </div>
                    <span className="modern-user-name break-words">{user.name}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-slate-400">No hay usuarios activos disponibles.</p>
          )}
        </div>
      </section>
    </div>
  );
};

export default TableSellerModal;
