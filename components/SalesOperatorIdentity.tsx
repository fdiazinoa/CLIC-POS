import React, { useState } from 'react';
import type { User } from '../types';
import { isGeneratedAvatarPlaceholder } from '../utils/userPhoto';

const OperatorPhoto: React.FC<{ photo: string; name: string }> = ({ photo, name }) => {
  const [failed, setFailed] = useState(false);
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
  return photo && !isGeneratedAvatarPlaceholder(photo) && !failed ? (
    <img src={photo} alt={`Foto de ${name}`} onError={() => setFailed(true)} className="h-full w-full object-cover" />
  ) : <span aria-hidden="true">{initials}</span>;
};

const SalesOperatorIdentity: React.FC<{
  user: Pick<User, 'id' | 'name' | 'photo'>;
  terminalLabel: string;
  compact?: boolean;
}> = ({ user, terminalLabel, compact = false }) => {
  const photo = typeof user.photo === 'string' ? user.photo.trim() : '';
  return (
    <div data-testid="sales-operator-identity" className="flex min-w-0 items-center gap-2">
      <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 font-bold text-slate-700 ${compact ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'}`}>
        <OperatorPhoto key={JSON.stringify([user.id, photo])} photo={photo} name={user.name} />
      </div>
      <div className={`min-w-0 ${compact ? 'max-w-[110px]' : 'max-w-[160px]'}`}>
        <div title={user.name} className="truncate text-xs font-bold text-slate-800">{user.name}</div>
        <div title={terminalLabel} className="truncate text-[11px] text-slate-500">{terminalLabel}</div>
      </div>
    </div>
  );
};

export default SalesOperatorIdentity;
