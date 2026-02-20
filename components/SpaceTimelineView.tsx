import React, { useState, useEffect } from 'react';
import { format, startOfDay, addDays, eachDayOfInterval, isSameDay, startOfHour, addHours, eachHourOfInterval, isWithinInterval } from 'date-fns';
import { es } from 'date-fns/locale';
import { Activity, Room } from '../types';
import { Clock, Users, Calendar, ChevronLeft, ChevronRight, Filter } from 'lucide-react';

interface SpaceTimelineViewProps {
    activities: Activity[];
    rooms: Room[];
    onActivityClick: (activity: Activity) => void;
    onAddActivity: (date: Date, spaceId: string) => void;
}

const SpaceTimelineView: React.FC<SpaceTimelineViewProps> = ({
    activities,
    rooms,
    onActivityClick,
    onAddActivity
}) => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewMode, setViewMode] = useState<'day' | 'week'>('day');

    const dayStart = startOfDay(currentDate);
    const hours = eachHourOfInterval({
        start: startOfHour(dayStart),
        end: addHours(dayStart, 23)
    });

    const isColliding = (a: Date, b: Date, start: Date, end: Date) => {
        return (a < end && b > start);
    };

    const getOccupancyColor = (activity: Activity) => {
        if (activity.status === 'CONFIRMED') return 'bg-emerald-500 text-white';
        if (activity.status === 'COMPLETED') return 'bg-blue-500 text-white';
        if (activity.status === 'CANCELLED') return 'bg-red-100 text-red-500';
        return 'bg-indigo-500 text-white';
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-3xl overflow-hidden shadow-sm border border-gray-100">
            {/* Toolbar */}
            <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
                <div className="flex items-center gap-4">
                    <h2 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                        <Clock className="text-indigo-600" size={24} />
                        Ocupación de Espacios
                    </h2>
                    <div className="flex bg-gray-100 p-1 rounded-xl">
                        <button
                            onClick={() => setViewMode('day')}
                            className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${viewMode === 'day' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-400'}`}
                        >
                            Día
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setCurrentDate(addDays(currentDate, -1))}
                        className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 transition-colors"
                    >
                        <ChevronLeft size={20} />
                    </button>
                    <div className="px-4 py-2 bg-gray-50 rounded-xl">
                        <span className="text-sm font-black text-gray-700 uppercase tracking-tighter">
                            {format(currentDate, "EEEE, d 'de' MMMM", { locale: es })}
                        </span>
                    </div>
                    <button
                        onClick={() => setCurrentDate(addDays(currentDate, 1))}
                        className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 transition-colors"
                    >
                        <ChevronRight size={20} />
                    </button>
                    <button
                        onClick={() => setCurrentDate(new Date())}
                        className="px-4 py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors"
                    >
                        Hoy
                    </button>
                </div>
            </div>

            {/* Timeline Grid */}
            <div className="flex-1 overflow-auto custom-scrollbar relative">
                <div className="min-w-[1200px]">
                    {/* Header: Hours */}
                    <div className="flex border-b border-gray-100 sticky top-0 z-20 bg-white/80 backdrop-blur-md">
                        <div className="w-48 shrink-0 border-r border-gray-100 p-4 bg-gray-50/50">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Espacio</span>
                        </div>
                        {hours.map(h => (
                            <div key={h.toISOString()} className="flex-1 min-w-[60px] p-4 text-center border-r border-gray-100 last:border-0">
                                <span className="text-[10px] font-black text-gray-900">{format(h, 'HH:mm')}</span>
                            </div>
                        ))}
                    </div>

                    {/* Body: Spaces */}
                    {rooms.map(room => (
                        <div key={room.id} className="flex border-b border-gray-100 h-20 group hover:bg-gray-50/30 transition-colors">
                            <div className="w-48 shrink-0 border-r border-gray-100 p-4 bg-white flex flex-col justify-center">
                                <span className="text-xs font-black text-gray-900 truncate">{room.name}</span>
                                <span className="text-[10px] font-bold text-gray-400 truncate flex items-center gap-1">
                                    <Users size={10} /> Cap: {room.capacidad_pax || room.capacidad_personas || 0}
                                </span>
                            </div>

                            <div className="flex-1 relative flex">
                                {/* Hour Slots - Background Grids */}
                                {hours.map(h => (
                                    <div
                                        key={h.toISOString()}
                                        className="flex-1 min-w-[60px] border-r border-gray-100/50 last:border-0 cursor-pointer hover:bg-indigo-50/30 transition-colors"
                                        onClick={() => onAddActivity(h, room.id)}
                                    />
                                ))}

                                {/* Activities Layer */}
                                {activities
                                    .filter(a => a.spaceId === room.id && isSameDay(new Date(a.startDate), currentDate))
                                    .map(activity => {
                                        const start = new Date(activity.startDate);
                                        const end = new Date(activity.endDate);
                                        const dayStartTs = dayStart.getTime();

                                        // Calculate position in percentage
                                        // 24 hours in a day
                                        const left = ((start.getTime() - dayStartTs) / (24 * 3600 * 1000)) * 100;
                                        const width = ((end.getTime() - start.getTime()) / (24 * 3600 * 1000)) * 100;

                                        return (
                                            <div
                                                key={activity.id}
                                                onClick={() => onActivityClick(activity)}
                                                style={{
                                                    left: `${Math.max(0, left)}%`,
                                                    width: `${Math.min(100, width)}%`,
                                                    top: '12%',
                                                    height: '76%'
                                                }}
                                                className={`absolute z-10 p-2 rounded-xl shadow-sm cursor-pointer border-l-4 border-black/10 flex flex-col justify-center transition-transform hover:scale-[1.02] active:scale-95 overflow-hidden ${getOccupancyColor(activity)}`}
                                            >
                                                <p className="text-[10px] font-black truncate leading-tight">{activity.title}</p>
                                                <p className="text-[9px] font-bold opacity-80 truncate">{format(start, 'HH:mm')} - {format(end, 'HH:mm')}</p>
                                            </div>
                                        );
                                    })
                                }
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Legend */}
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex items-center gap-6 shrink-0">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500" />
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Confirmado</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-indigo-500" />
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Planificado</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Completado</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-100 border border-red-200" />
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Cancelado</span>
                </div>
            </div>
        </div>
    );
};

export default SpaceTimelineView;
