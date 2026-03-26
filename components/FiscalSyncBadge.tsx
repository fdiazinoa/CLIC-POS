import React from 'react';
import { AlertCircle, CheckCircle2, Clock3, FileText } from 'lucide-react';
import { Transaction } from '../types';
import { getFiscalCodeFromNcf, isElectronicFiscalCode } from '../utils/fiscal/fiscalHelpers';

interface FiscalSyncBadgeProps {
  transaction: Pick<Transaction, 'ncf' | 'ncfType' | 'legacyNcf' | 'electronicNcf' | 'fiscalSyncStatus'>;
  compact?: boolean;
}

interface FiscalBadgeMeta {
  label: string;
  shortLabel: string;
  className: string;
  icon: React.ReactNode;
}

export const getFiscalSyncBadgeMeta = (
  transaction: FiscalSyncBadgeProps['transaction']
): FiscalBadgeMeta | null => {
  const fiscalCode = transaction.ncfType
    || getFiscalCodeFromNcf(transaction.electronicNcf || transaction.legacyNcf || transaction.ncf);

  if (!fiscalCode) return null;

  if (!isElectronicFiscalCode(fiscalCode)) {
    return {
      label: 'NCF legacy B',
      shortLabel: 'Legacy B',
      className: 'bg-slate-100 text-slate-600 border-slate-200',
      icon: <FileText size={12} />
    };
  }

  switch (transaction.fiscalSyncStatus) {
    case 'SYNCED':
      return {
        label: 'e-CF sincronizado',
        shortLabel: 'e-CF OK',
        className: 'bg-emerald-100 text-emerald-700 border-emerald-200',
        icon: <CheckCircle2 size={12} />
      };
    case 'ERROR':
      return {
        label: 'e-CF con error',
        shortLabel: 'e-CF Error',
        className: 'bg-red-100 text-red-700 border-red-200',
        icon: <AlertCircle size={12} />
      };
    case 'PENDING':
      return {
        label: 'e-CF pendiente',
        shortLabel: 'e-CF Pend.',
        className: 'bg-amber-100 text-amber-700 border-amber-200',
        icon: <Clock3 size={12} />
      };
    default:
      return {
        label: 'e-CF sin enviar',
        shortLabel: 'e-CF Nuevo',
        className: 'bg-blue-100 text-blue-700 border-blue-200',
        icon: <Clock3 size={12} />
      };
  }
};

const FiscalSyncBadge: React.FC<FiscalSyncBadgeProps> = ({ transaction, compact = false }) => {
  const meta = getFiscalSyncBadgeMeta(transaction);
  if (!meta) return null;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-black ${compact ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-xs'} ${meta.className}`}
      title={meta.label}
    >
      {meta.icon}
      <span>{compact ? meta.shortLabel : meta.label}</span>
    </span>
  );
};

export default FiscalSyncBadge;
