import React, { useRef, useState, useEffect } from 'react';
import {
    ChevronLeft, ChevronRight, Calendar as CalendarIcon,
    Clock, MapPin, User, MoreHorizontal, Filter,
    Layout, Grid, Users, Building2
} from 'lucide-react';
import {
    format, addMonths, subMonths, startOfMonth, endOfMonth,
    startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay,
    addWeeks, subWeeks, isToday, parseISO, startOfDay
} from 'date-fns';
import { es } from 'date-fns/locale';
import { Activity, Room, User as UserType, ServiceType } from '../types';

interface AdvancedCalendarProps {
    viewMode: 'MONTH' | 'WEEK' | 'RESOURCE' | 'TEAM';
    currentDate: Date;
    onNavigate: (date: Date) => void;
    activities: Activity[];
    rooms: Room[];
    users: UserType[];
    serviceTypes: ServiceType[];
    onActivityClick: (activity: Activity) => void;
    onDateClick: (date: Date, resourceId?: string) => void;
}

const AdvancedCalendar: React.FC<AdvancedCalendarProps> = ({
    viewMode,
    currentDate,
    onNavigate,
    activities,
    rooms,
    users,
    serviceTypes,
    onActivityClick,
    onDateClick
}) => {

    const getTypeColor = (activity: Activity) => {
        const typeDef = serviceTypes.find(t => t.name === activity.type && t.nature === activity.nature);
        if (typeDef?.color) return typeDef.color;

        // Fallback colors if not found in dynamic types
        if (activity.nature === 'BOOKING') return '#9333ea'; // Purple
        return '#4f46e5'; // Indigo
    };

    const renderMonthView = () => {
        const monthStart = startOfMonth(currentDate);
        const monthEnd = endOfMonth(monthStart);
        const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
        const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

        const dateFormat = "d";
        const rows = [];
        let days = [];
        let day = startDate;
        let formattedDate = "";

        while (day <= endDate) {
            for (let i = 0; i < 7; i++) {
                formattedDate = format(day, dateFormat);
                const cloneDay = day;
                const dateActivities = activities.filter(act =>
                    isSameDay(parseISO(act.startDate), day)
                );

                days.push(
                    <div
                        key={day.toString()}
                        className={`min-h-[120px] bg-white border border-gray-100 p-2 relative group hover:bg-gray-50 transition-colors cursor-pointer
                            ${!isSameMonth(day, monthStart) ? "text-gray-300 bg-gray-50/50" : "text-gray-700"}
                            ${isToday(day) ? "bg-indigo-50/30" : ""}
                        `}
                        onClick={() => onDateClick(cloneDay)}
                    >
                        <div className={`flex justify-between items-start mb-2`}>
                            <span className={`text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full
                                ${isToday(day) ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : ""}
                            `}>
                                {formattedDate}
                            </span>
                            {dateActivities.length > 0 && (
                                <span className="text-[10px] font-black text-gray-300 bg-gray-100 px-1.5 py-0.5 rounded-md">
                                    {dateActivities.length}
                                </span>
                            )}
                        </div>
                        <div className="space-y-1.5">
                            {dateActivities.slice(0, 3).map(act => {
                                const color = getTypeColor(act);
                                return (
                                    <div
                                        key={act.id}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onActivityClick(act);
                                        }}
                                        className="text-[10px] p-1.5 rounded-lg font-bold truncate shadow-sm hover:scale-[1.02] transition-transform cursor-pointer flex items-center gap-1.5 border-l-2"
                                        style={{
                                            backgroundColor: `${color}15`, // 15% opacity hex
                                            color: color,
                                            borderLeftColor: color
                                        }}
                                    >
                                        <span className="shrink-0">{format(parseISO(act.startDate), 'HH:mm')}</span>
                                        <span className="truncate">{act.title}</span>
                                    </div>
                                )
                            })}
                            {dateActivities.length > 3 && (
                                <div className="text-[10px] text-center text-gray-400 font-bold hover:text-indigo-600">
                                    + {dateActivities.length - 3} más
                                </div>
                            )}
                        </div>

                        {/* Add button on hover */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none">
                            <div className="bg-indigo-600 text-white p-1.5 rounded-xl shadow-xl scale-90 group-hover:scale-100 transition-transform duration-200">
                                <span className="text-[10px] font-black uppercase px-2">+ Añadir</span>
                            </div>
                        </div>
                    </div>
                );
                day = addDays(day, 1);
            }
            rows.push(
                <div className="grid grid-cols-7" key={day.toString()}>
                    {days}
                </div>
            );
            days = [];
        }
        return <div className="bg-white rounded-none">{rows}</div>;
    };

    // Placeholder for other views (Resource, Team, Week) - using simple implementations for now
    if (viewMode === 'WEEK') {
        const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
        const hours = Array.from({ length: 14 }, (_, i) => i + 8); // 8:00 to 21:00

        return (
            <div className="flex h-full flex-col bg-white overflow-hidden">
                <div className="grid grid-cols-8 border-b border-gray-100">
                    <div className="p-4 border-r border-gray-100"></div>
                    {Array.from({ length: 7 }).map((_, i) => {
                        const d = addDays(weekStart, i);
                        return (
                            <div key={i} className={`p-4 text-center border-r border-gray-100 ${isToday(d) ? 'bg-indigo-50/50' : ''}`}>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{format(d, 'EEE', { locale: es })}</p>
                                <p className={`text-xl font-black ${isToday(d) ? 'text-indigo-600' : 'text-gray-900'}`}>{format(d, 'd')}</p>
                            </div>
                        );
                    })}
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {hours.map(hour => (
                        <div key={hour} className="grid grid-cols-8 min-h-[60px]">
                            <div className="border-r border-b border-gray-100 p-2 text-xs font-bold text-gray-400 text-right sticky left-0 bg-white">
                                {hour}:00
                            </div>
                            {Array.from({ length: 7 }).map((_, i) => {
                                const d = addDays(weekStart, i);
                                // Find activities for this hour
                                const cellActivities = activities.filter(act =>
                                    isSameDay(parseISO(act.startDate), d) &&
                                    parseISO(act.startDate).getHours() === hour
                                );

                                return (
                                    <div
                                        key={i}
                                        onClick={() => {
                                            const clickedDate = addDays(weekStart, i);
                                            clickedDate.setHours(hour);
                                            onDateClick(clickedDate);
                                        }}
                                        className="border-r border-b border-gray-100 p-1 relative hover:bg-gray-50 cursor-pointer"
                                    >
                                        {cellActivities.map(act => {
                                            const color = getTypeColor(act);
                                            return (
                                                <div
                                                    key={act.id}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onActivityClick(act);
                                                    }}
                                                    className="text-[9px] p-1 rounded font-bold truncate mb-1 border-l-2 shadow-sm"
                                                    style={{
                                                        backgroundColor: `${color}15`,
                                                        color: color,
                                                        borderLeftColor: color
                                                    }}
                                                >
                                                    {act.title}
                                                </div>
                                            )
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (viewMode === 'RESOURCE') {
        // Simple Resource View
        return (
            <div className="flex h-full flex-col bg-white overflow-hidden p-8 items-center justify-center text-gray-400">
                <Building2 size={48} className="mb-4 opacity-20" />
                <p className="font-bold">Vista por Recursos en desarrollo</p>
            </div>
        )
    }

    if (viewMode === 'TEAM') {
        return (
            <div className="flex h-full flex-col bg-white overflow-hidden p-8 items-center justify-center text-gray-400">
                <Users size={48} className="mb-4 opacity-20" />
                <p className="font-bold">Vista de Equipo en desarrollo</p>
            </div>
        )
    }

    // Default Month View
    return (
        <div className="flex-1 flex flex-col h-full bg-white">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => onNavigate(subMonths(currentDate, 1))}
                        className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
                    >
                        <ChevronLeft size={20} />
                    </button>
                    <h2 className="text-2xl font-black text-gray-900 tracking-tight capitalize">
                        {format(currentDate, 'MMMM yyyy', { locale: es })}
                    </h2>
                    <button
                        onClick={() => onNavigate(addMonths(currentDate, 1))}
                        className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
                    >
                        <ChevronRight size={20} />
                    </button>
                </div>

                <button
                    onClick={() => onNavigate(new Date())}
                    className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-gray-200 transition-colors"
                >
                    Hoy
                </button>
            </div>

            <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/50">
                {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(day => (
                    <div key={day} className="py-3 text-center text-xs font-black text-gray-400 uppercase tracking-widest">
                        {day}
                    </div>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {renderMonthView()}
            </div>
        </div>
    );
};

export default AdvancedCalendar;
