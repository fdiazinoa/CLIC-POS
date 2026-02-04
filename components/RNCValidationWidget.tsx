/**
 * RNC Validation Widget
 * 
 * Standalone component for validating RNC/C\u00e9dula with DGII
 * Integrates into CustomerManagement or any customer form
 */

import React, { useState } from 'react';
import { Search, Loader2, AlertOctagon, ShieldCheck } from 'lucide-react';
import { dgiiService, DGIIResponse } from '../services/dgii/DGIIValidationService';
import { Customer } from '../types';

interface RNCValidationWidgetProps {
    value: string;
    onChange: (value: string) => void;
    onValidated?: (data: Partial<Customer>) => void;
    formData?: Partial<Customer>;
}

export const RNCValidationWidget: React.FC<RNCValidationWidgetProps> = ({
    value,
    onChange,
    onValidated,
    formData
}) => {
    const [isValidating, setIsValidating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleValidate = async () => {
        if (!value || value.length < 9) {
            setError('RNC/C\u00e9dula debe tener al menos 9 d\u00edgitos');
            return;
        }

        setIsValidating(true);
        setError(null);

        try {
            const dgiiData: DGIIResponse = await dgiiService.validateRNC(value);

            if (dgiiData.error) {
                setError(dgiiData.error);
                return;
            }

            // Warn if not ACTIVO
            if (dgiiData.status !== 'ACTIVO') {
                alert(
                    `\u26a0\ufe0f ATENCI\u00d3N: Cont ribuyente ${dgiiData.status}\\n\\n` +
                    `RNC: ${dg iiData.rnc} \\n` +
          `Nombre: ${ dgiiData.name } \\n\\n` +
          `Este contribuyente NO est\u00e1 vigente en DGII.\\n` +
          `No se puede emitir cr\u00e9dito fiscal B01.`
        );
      }

      // Callback with validated data
      if (onValidated) {
        onValidated({
          name: dgiiData.name,
          fiscalStatus: dgiiData.status,
          verifiedAt: new Date().toISOString(),
          dgiiData: {
            commercialName: dgiiData.commercialName,
            economicActivity: dgiiData.economicActivity,
            regimeType: dgiiData.regimeType
          },
          defaultNcfType: dgiiData.status === 'ACTIVO' ? 'B01' : 'B02'
        });
      }
    } catch (err) {
      setError('Error al consultar DGII. Verifique la conexi\u00f3n.');
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div>
      <label className=\"block text-[10px] font-black text-slate-500 uppercase mb-1 ml-1\">
        RNC / C\u00e9dula / Identificaci\u00f3n
      </label>
      <div className=\"relative\">
        <input
          type=\"text\"
          value={value}
          onChange={e => {
            onChange(e.target.value);
            setError(null);
          }}
          onBlur={() => {
            if (value.length >= 9 && !formData?.verifiedAt) {
              handleValidate();
            }
          }}
          placeholder=\"101555559\"
          className=\"w-full p-3 pr-12 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-mono font-bold\"
        />
        <button
          type=\"button\"
          onClick={handleValidate}
          disabled={isValidating || !value || value.length < 9}
          className=\"absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-blue-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors\"
          title=\"Validar con DGII\"
        >
          {isValidating ? (
            <Loader2 size={18} className=\"animate-spin\" />
          ) : (
            <Search size={18} />
          )}
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className=\"mt-2 p-2 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2\">
          <AlertOctagon size={14} className=\"text-red-500 mt-0.5 flex-shrink-0\" />
          <p className=\"text-[10px] text-red-600 font-bold\">{error}</p>
        </div>
      )}

      {/* Verification Badge */}
      {formData?.fiscalStatus && formData?.verifiedAt && (
        <div
          className={`mt - 2 p - 2 rounded - lg flex items - center justify - between ${
                formData.fiscalStatus === 'ACTIVO'
                    ? 'bg-green-50 border border-green-200'
                    : 'bg-red-50 border border-red-200'
            } `}
        >
          <div className=\"flex items-center gap-2\">
            <ShieldCheck
              size={14}
              className={formData.fiscalStatus === 'ACTIVO' ? 'text-green-600' : 'text-red-600'}
            />
            <span
              className={`text - [10px] font - bold ${
                formData.fiscalStatus === 'ACTIVO' ? 'text-green-700' : 'text-red-700'
            } `}
            >
              {formData.fiscalStatus === 'ACTIVO'
                ? 'Verificado ACTIVO'
                : `DGII: ${ formData.fiscalStatus } `}
            </span>
          </div>
          <span className=\"text-[9px] text-gray-400 font-mono\">
            {new Date(formData.verifiedAt).toLocaleDateString()}
          </span>
        </div>
      )}
    </div>
  );
};
