import React, { useState } from 'react';
import { BusinessConfig, AuditLogEntry, User } from '../types';
import { ShieldAlert, Search, Calendar, User as UserIcon, Terminal } from 'lucide-react';

interface AuditLogViewerProps {
    config: BusinessConfig;
    users: User[];
}

const AuditLogViewer: React.FC<AuditLogViewerProps> = ({ config, users }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const logs = config.auditLogs || [];

    const filteredLogs = logs.filter(log => {
        const cashierName = users.find(u => u.id === log.cashierId)?.name || log.cashierId;
        const supervisorName = users.find(u => u.id === log.supervisorId)?.name || log.supervisorId;
        const searchLower = searchTerm.toLowerCase();

        return (
            log.actionType.toLowerCase().includes(searchLower) ||
            cashierName.toLowerCase().includes(searchLower) ||
            supervisorName.toLowerCase().includes(searchLower) ||
            log.reason?.toLowerCase().includes(searchLower)
        );
    }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const getUserName = (id: string) => users.find(u => u.id === id)?.name || id;

    return (
        <div className="space-y-6 animate-in fade-in">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-black text-gray-800">Auditoría de Seguridad</h2>
                    <p className="text-gray-500">Registro inmutable de intervenciones y autorizaciones.</p>
                </div>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar en logs..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                {filteredLogs.length === 0 ? (
                    <div className="p-12 text-center text-gray-400">
                        <ShieldAlert size={48} className="mx-auto mb-4 opacity-20" />
                        <p>No se encontraron registros de auditoría.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Fecha / Hora</th>
                                    <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Acción</th>
                                    <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Actores</th>
                                    <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Detalles</th>
                                    <th className="p-4 text-xs font-bold text-gray-400 uppercase tracking-widest">Contexto</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filteredLogs.map(log => (
                                    <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="p-4 text-sm font-medium text-gray-600 whitespace-nowrap">
                                            <div className="flex items-center gap-2">
                                                <Calendar size={14} className="text-gray-400" />
                                                {new Date(log.timestamp).toLocaleString()}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase ${log.actionType.includes('VOID') ? 'bg-red-100 text-red-600' :
                                                    log.actionType.includes('DISCOUNT') ? 'bg-orange-100 text-orange-600' :
                                                        'bg-blue-100 text-blue-600'
                                                }`}>
                                                {log.actionType.replace('POS_', '').replace('_', ' ')}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-col gap-1 text-xs">
                                                <div className="flex items-center gap-1 text-gray-600">
                                                    <UserIcon size={12} />
                                                    <span className="font-bold">Solicita:</span> {getUserName(log.cashierId)}
                                                </div>
                                                <div className="flex items-center gap-1 text-blue-600">
                                                    <ShieldAlert size={12} />
                                                    <span className="font-bold">Autoriza:</span> {getUserName(log.supervisorId)}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 text-sm text-gray-600">
                                            {log.originalValue !== undefined && (
                                                <div className="flex flex-col">
                                                    <span className="text-xs text-gray-400">Valor Original: ${log.originalValue}</span>
                                                    {log.newValue !== undefined && (
                                                        <span className="font-bold text-gray-800">Nuevo Valor: ${log.newValue}</span>
                                                    )}
                                                </div>
                                            )}
                                            {log.reason && (
                                                <div className="mt-1 text-xs italic text-gray-500 bg-gray-100 p-1 rounded">
                                                    "{log.reason}"
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-4 text-xs text-gray-400 font-mono">
                                            <div className="flex items-center gap-1">
                                                <Terminal size={12} /> {log.terminalId}
                                            </div>
                                            {log.ticketId && <div>Ref: {log.ticketId}</div>}
                                            {log.itemId && <div>Item: {log.itemId.substring(0, 8)}...</div>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AuditLogViewer;
