import React, { createContext, useContext } from 'react';
import { useKioskSecurity } from '../../hooks/useKioskSecurity';

interface KioskSecurityProviderProps {
  children: React.ReactNode;
  validateSupervisorPin?: (pin: string) => boolean;
}

type KioskSecurityContextType = ReturnType<typeof useKioskSecurity>;

const KioskSecurityContext = createContext<KioskSecurityContextType | undefined>(undefined);

export const KioskSecurityProvider: React.FC<KioskSecurityProviderProps> = ({
  children,
  validateSupervisorPin
}) => {
  const security = useKioskSecurity({ validateSupervisorPin });

  return (
    <KioskSecurityContext.Provider value={security}>
      {children}
    </KioskSecurityContext.Provider>
  );
};

export const useKioskSecurityContext = () => {
  const context = useContext(KioskSecurityContext);
  if (!context) {
    throw new Error('useKioskSecurityContext must be used within KioskSecurityProvider');
  }
  return context;
};
