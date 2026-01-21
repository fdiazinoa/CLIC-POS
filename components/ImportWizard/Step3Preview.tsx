import React from 'react';
import { SYSTEM_FIELDS } from '../../constants/importFields';

interface Step3PreviewProps {
    data: any[];
    mapping: { [key: string]: string };
    entityType: 'PRODUCT' | 'CUSTOMER' | 'SUPPLIER' | 'INVENTORY';
}

const Step3Preview: React.FC<Step3PreviewProps> = ({ data, mapping, entityType }) => {
    const fields = SYSTEM_FIELDS[entityType];
    const previewRows = data.slice(0, 5);

    // Filter fields that are actually mapped
    const mappedFields = fields.filter(f => mapping[f.id]);

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
            <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-gray-900">Previsualización de Datos</h2>
                <p className="text-gray-500">Revisa cómo se verán los datos antes de procesar. Mostrando {previewRows.length} de {data.length} filas.</p>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 text-gray-500 font-bold uppercase text-xs">
                        <tr>
                            <th className="px-6 py-4">#</th>
                            {mappedFields.map(field => (
                                <th key={field.id} className="px-6 py-4 whitespace-nowrap">
                                    {field.label}
                                    <span className="block text-[10px] text-gray-400 font-mono normal-case mt-1">
                                        Origen: {mapping[field.id]}
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {previewRows.map((row, idx) => (
                            <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                <td className="px-6 py-4 font-mono text-gray-400">{idx + 1}</td>
                                {mappedFields.map(field => {
                                    const sourceHeader = mapping[field.id];
                                    const value = row[sourceHeader];
                                    return (
                                        <td key={field.id} className="px-6 py-4 text-gray-900 max-w-xs truncate">
                                            {value !== undefined && value !== null ? String(value) : <span className="text-gray-300 italic">null</span>}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>

                {data.length === 0 && (
                    <div className="p-12 text-center text-gray-400">
                        No hay datos para mostrar.
                    </div>
                )}
            </div>

            <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-blue-800 text-sm flex items-center gap-3">
                <div className="font-bold bg-white w-8 h-8 rounded-full flex items-center justify-center border border-blue-200 shadow-sm">
                    {data.length}
                </div>
                <p>
                    Se procesarán <strong>{data.length} registros</strong>. Asegúrate de que las columnas coincidan correctamente.
                </p>
            </div>
        </div>
    );
};

export default Step3Preview;
