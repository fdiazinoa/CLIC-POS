import React, { useState } from 'react';
import ModernLoginScreen from './ModernLoginScreen';
import type { RoleDefinition, TerminalConfig, User } from '../types';
import { productionSettingsOperators } from '../utils/productionSettingsOperator';

/** The device escape PIN opens settings; catalogue changes still need a real operator. */
export default function ProductionSettingsOperatorBoundary({ currentUser, users, roles, config, terminalLabel, subVertical, children }: {
  currentUser?: User | null; users: User[]; roles: RoleDefinition[]; config?: TerminalConfig;
  terminalLabel?: string; subVertical: string; children: (actorId: string) => React.ReactNode;
}) {
  const [operator, setOperator] = useState<User>();
  const eligible = productionSettingsOperators(users, roles);
  const authenticated = eligible.find(user => user.id === operator?.id && user.pin === operator.pin);
  if (currentUser) return <>{children(currentUser.id)}</>;
  if (authenticated) return <>{children(authenticated.id)}</>;
  return <section aria-label="Acceso a centros de producción">
    <p role="status" className="p-4 font-bold">Identifícate con un usuario autorizado para asignar artículos a centros de producción.</p>
    {!config || !eligible.length
      ? <p className="p-4">No hay usuarios activos con permiso de Ajustes en esta terminal. Revisa usuarios y roles en el ERP y sincroniza.</p>
      : <ModernLoginScreen config={config} terminalLabel={terminalLabel} subVertical={subVertical}
          availableUsers={eligible} onLogin={user => {
            const verified = eligible.find(candidate => candidate.id === user.id && candidate.pin === user.pin);
            if (verified) setOperator(verified);
          }} />}
  </section>;
}
