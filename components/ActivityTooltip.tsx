import React from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { Activity } from '../types';
import { User, Clock, Package, DollarSign } from 'lucide-react';

interface ActivityTooltipProps {
    activity: Activity;
    position: { x: number; y: number };
}

const ActivityTooltip: React.FC<ActivityTooltipProps> = ({ activity, position }) => {
    const start = new Date(activity.startDate);
    const end = new Date(activity.endDate);

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'CONFIRMED': return <span className="px-2 py-0.5 bg-emerald-100 text-emerald-600 rounded-md text-[9px] font-black uppercase tracking-widest">Confirmado</span>;
            case 'COMPLETED': return <span className="px-2 py-0.5 bg-blue-100 text-blue-600 rounded-md text-[9px] font-black uppercase tracking-widest">Completado</span>;
            case 'CANCELLED': return <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-md text-[9px] font-black uppercase tracking-widest">Cancelado</span>;
            case 'IN_PROGRESS': return <span className="px-2 py-0.5 bg-amber-100 text-amber-600 rounded-md text-[9px] font-black uppercase tracking-widest">En Progreso</span>;
            default: return <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-md text-[9px] font-black uppercase tracking-widest">{status}</span>;
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            style={{
                left: position.x,
                top: position.y,
                transform: 'translate(-50%, -100%)',
                marginTop: '-12px'
            }}
            className="fixed z-[100] w-64 bg-white/95 backdrop-blur-md shadow-2xl rounded-2xl border border-gray-100 p-4 pointer-events-none"
        >
            <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 border-b border-gray-50 pb-2">
                    <h4 className="text-xs font-black text-gray-900 truncate leading-tight uppercase tracking-tight">{activity.title}</h4>
                    {getStatusBadge(activity.status)}
                </div>

                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <User size={12} className="text-indigo-500 shrink-0" />
                        <span className="text-[10px] font-bold text-gray-600 truncate">{activity.customerName || 'Sin cliente'}</span>
                    </div>

                    <div className="flex items-center gap-2">
                        <Clock size={12} className="text-purple-500 shrink-0" />
                        <span className="text-[10px] font-bold text-gray-600">
                            {format(start, 'HH:mm')} - {format(end, 'HH:mm')}
                        </span>
                    </div>

                    {activity.items && activity.items.length > 0 && (
                        <div className="flex items-center gap-2">
                            <Package size={12} className="text-amber-500 shrink-0" />
                            <span className="text-[10px] font-bold text-gray-600">
                                {activity.items.length} {activity.items.length === 1 ? 'recurso reservado' : 'recursos reservados'}
                            </span>
                        </div>
                    )}

                    {(activity.required_deposit || activity.current_balance) && (
                        <div className="pt-2 mt-1 border-t border-gray-50">
                            <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-1">
                                    <DollarSign size={10} className="text-emerald-500" />
                                    <span className="text-[9px] font-black text-gray-400 uppercase">Resumen Financiero</span>
                                </div>
                            </div>
                            <div className="flex justify-between gap-2">
                                <div className="flex-1">
                                    <p className="text-[8px] font-bold text-gray-400 uppercase">Abonado</p>
                                    <p className="text-[10px] font-black text-emerald-600">RD${(activity.required_deposit || 0).toLocaleString()}</p>
                                </div>
                                <div className="flex-1 text-right">
                                    <p className="text-[8px] font-bold text-gray-400 uppercase">Pendiente</p>
                                    <p className="text-[10px] font-black text-indigo-600">RD${(activity.current_balance || 0).toLocaleString()}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Arrow */}
            <div className="absolute left-1/2 -bottom-2 -translate-x-1/2 w-4 h-4 bg-white/95 rotate-45 border-r border-b border-gray-100" />
        </motion.div>
    );
};

export default ActivityTooltip;
