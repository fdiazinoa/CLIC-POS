import React, { useMemo, useRef, useEffect, useState } from 'react';
import CalendarEvent from './CalendarEvent';
import {
    format,
    startOfMonth,
    endOfMonth,
    startOfWeek,
    endOfWeek,
    eachDayOfInterval,
    isSameMonth,
    isSameDay,
    addDays,
    isToday,
    startOfDay,
    parseISO,
    differenceInMinutes,
    addMinutes,
    setHours,
    setMinutes
} from 'date-fns';
import { es } from 'date-fns/locale';
import {
    Activity,
    Room,
    User,
    ActivityNature,
    ActivityType
} from '../types';
import {
    Calendar as CalendarIcon,
    Clock,
    MapPin,
    User as UserIcon,
    ChevronLeft,
    ChevronRight,
    MoreVertical,
    Building2
} from 'lucide-react';

interface AdvancedCalendarProps {
    viewMode: 'MONTH' | 'WEEK' | 'RESOURCE' | 'TEAM';
    currentDate: Date;
    onNavigate: (date: Date) => void;
    activities: Activity[];
    rooms: Room[];
    users: User[];
    onActivityClick: (activity: Activity) => void;
    onDateClick: (date: Date, resourceId?: string) => void;
}

const HOURS = Array.from({ length: 15 }, (_, i) => i + 8); // 08:00 to 22:00
const SLOT_HEIGHT = 60; // 60px per hour

const AdvancedCalendar: React.FC<AdvancedCalendarProps> = ({
    viewMode,
    currentDate,
    onNavigate,
    activities,
    rooms,
    users,
    onActivityClick,
    onDateClick
}) => {
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 60000); // Update every minute
        return () => clearInterval(timer);
    }, []);

    const scrollContainerRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to 8am on mount
    useEffect(() => {
        if (scrollContainerRef.current && viewMode !== 'MONTH') {
            scrollContainerRef.current.scrollTop = 0;
        }
    }, [viewMode, currentDate]);


    // --- MONTH VIEW ---
    const renderMonthView = () => {
        const monthStart = startOfMonth(currentDate);
        const monthEnd = endOfMonth(monthStart);
        const startDate = startOfWeek(monthStart);
        const endDate = endOfWeek(monthEnd);

        const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });
        const weekDays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

        return (
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Day Labels */}
                <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/50">
                    {weekDays.map(day => (
                        <div key={day} className="py-2 text-center text-[10px] font-black text-gray-400 uppercase tracking-widest">
                            {day}
                        </div>
                    ))}
                </div>

                {/* Calendar Grid */}
                <div className="flex-1 grid grid-cols-7 auto-rows-fr overflow-y-auto custom-scrollbar">
                    {calendarDays.map((day, idx) => {
                        const isCurrentMonth = isSameMonth(day, monthStart);
                        const dayActivities = activities.filter(act => isSameDay(parseISO(act.startDate), day));

                        return (
                            <div
                                key={day.toString()}
                                onClick={() => onDateClick(day)}
                                className={`
                  min-h-[120px] p-2 border-r border-b border-gray-50 transition-colors cursor-pointer
                  ${isCurrentMonth ? 'bg-white' : 'bg-gray-50/30'}
                  ${isToday(day) ? 'ring-2 ring-inset ring-indigo-500/20 bg-indigo-50/10' : ''}
                  hover:bg-gray-50/80
                `}
                            >
                                <div className="flex justify-between items-start mb-1">
                                    <span className={`
                    text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full
                    ${isToday(day) ? 'bg-indigo-600 text-white shadow-md' : isCurrentMonth ? 'text-gray-700' : 'text-gray-300'}
                  `}>
                                        {format(day, 'd')}
                                    </span>
                                    {dayActivities.length > 0 && (
                                        <span className="text-[9px] font-black text-gray-300 uppercase tracking-tighter">
                                            {dayActivities.length} {dayActivities.length === 1 ? 'ACT' : 'ACTS'}
                                        </span>
                                    )}
                                </div>

                                <div className="space-y-1">
                                    {dayActivities.slice(0, 3).map(act => (
                                        <CalendarEvent
                                            key={act.id}
                                            activity={act}
                                            onClick={onActivityClick}
                                            viewMode={viewMode}
                                            isMonthView
                                        />
                                    ))}
                                    {dayActivities.length > 3 && (
                                        <div className="text-[8px] font-black text-gray-400 text-center uppercase tracking-widest pt-1">
                                            + {dayActivities.length - 3} más
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    // --- TIMELINE VIEW (WEEK / RESOURCE / TEAM) ---
    const renderTimelineView = () => {
        let columns: any[] = [];
        if (viewMode === 'WEEK') {
            columns = eachDayOfInterval({
                start: startOfWeek(currentDate, { weekStartsOn: 1 }),
                end: endOfWeek(currentDate, { weekStartsOn: 1 })
            }).map(day => ({
                id: day.toString(),
                date: day,
                label: format(day, 'EEE', { locale: es }),
                subLabel: format(day, 'd'),
                isToday: isToday(day)
            }));
        } else if (viewMode === 'RESOURCE') {
            columns = rooms.map(r => ({
                id: r.id,
                date: currentDate,
                label: r.name || r.nombre,
                subLabel: 'Sala',
                isToday: false
            }));
        } else if (viewMode === 'TEAM') {
            columns = users.map(u => ({
                id: u.id,
                date: currentDate,
                label: u.name,
                subLabel: u.role || 'Personal',
                isToday: false
            }));
        }

        const getPosition = (dateStr: string) => {
            const date = parseISO(dateStr);
            const startOfCal = setHours(startOfDay(date), 8);
            const diff = differenceInMinutes(date, startOfCal);
            return (diff / 60) * SLOT_HEIGHT;
        };

        const getHeight = (start: string, end: string) => {
            const diff = differenceInMinutes(parseISO(end), parseISO(start));
            return Math.max((diff / 60) * SLOT_HEIGHT, 30); // Min height 30px
        };

        const filterActivity = (act: Activity, column: any) => {
            const isOnDay = isSameDay(parseISO(act.startDate), column.date);
            if (!isOnDay) return false;

            if (viewMode === 'RESOURCE') return act.spaceId === column.id;
            if (viewMode === 'TEAM') return act.assignedToId === column.id;

            return true; // For WEEK, we already filtered columns by day
        };

        return (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
                {/* Header */}
                <div className="flex border-b-2 border-gray-200 bg-gray-50/50">
                    <div className="w-20 border-r border-gray-200 shrink-0" />
                    {columns.map(col => (
                        <div key={col.id} className="flex-1 py-4 text-center border-r border-gray-200 last:border-r-0 min-w-[150px]">
                            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">
                                {col.label}
                            </p>
                            <div className="flex justify-center">
                                <p className={`text-lg font-black w-10 h-10 flex items-center justify-center rounded-full transition-all ${col.isToday ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-900'}`}>
                                    {col.subLabel}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Scrollable Timeline */}
                <div
                    ref={scrollContainerRef}
                    className="flex-1 overflow-both relative custom-scrollbar bg-white"
                >
                    <div className="flex min-h-full" style={{ height: `${HOURS.length * SLOT_HEIGHT}px` }}>
                        {/* Time Labels */}
                        <div className="w-20 border-r border-gray-200 shrink-0 bg-gray-50/50 sticky left-0 z-40 backdrop-blur-sm">
                            {HOURS.map(hour => (
                                <div key={hour} className="h-[60px] relative">
                                    <span className="absolute -top-3 left-0 right-0 text-center text-[11px] font-black text-gray-600">
                                        {hour}:00
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Columns */}
                        {columns.map(col => (
                            <div key={col.id} className={`flex-1 relative border-r border-gray-100 last:border-r-0 min-w-[150px] ${col.isToday ? 'bg-indigo-50/20' : ''}`}>
                                {/* Hour Lines */}
                                {HOURS.map(hour => (
                                    <div key={hour} className="h-[60px] border-b border-gray-200 last:border-b-0" />
                                ))}

                                {/* LIVE TIME INDICATOR */}
                                {col.isToday && (
                                    <div
                                        className="absolute left-0 right-0 z-30 pointer-events-none"
                                        style={{ top: `${getPosition(now.toISOString())}px` }}
                                    >
                                        <div className="relative w-full border-t-2 border-red-500 shadow-sm">
                                            <div className="absolute -left-1.5 -top-1.5 w-3 h-3 bg-red-500 rounded-full shadow-md shadow-red-500/50" />
                                        </div>
                                    </div>
                                )}

                                {/* Activities */}
                                {activities
                                    .filter(act => filterActivity(act, col))
                                    .map(act => (
                                        <CalendarEvent
                                            key={act.id}
                                            activity={act}
                                            onClick={onActivityClick}
                                            viewMode={viewMode}
                                            style={{
                                                top: `${getPosition(act.startDate)}px`,
                                                height: `${getHeight(act.startDate, act.endDate)}px`
                                            }}
                                        />
                                    ))
                                }

                                {/* Clickable Area for New Activity */}
                                <div
                                    className="absolute inset-0 z-0"
                                    onClick={(e) => {
                                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                        const y = e.clientY - rect.top;
                                        const minutes = (y / SLOT_HEIGHT) * 60;
                                        const baseDate = startOfDay(col.date);
                                        const clickedDate = addMinutes(setHours(baseDate, 8), minutes);
                                        onDateClick(clickedDate, viewMode === 'RESOURCE' ? col.id : undefined);
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-white select-none">
            {/* Calendar Header / Navigation */}
            <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100 bg-white/80 backdrop-blur-md z-30 shrink-0">
                <div className="flex items-center gap-6">
                    <h2 className="text-2xl font-black text-gray-900 tracking-tighter capitalize">
                        {format(currentDate, 'MMMM yyyy', { locale: es })}
                    </h2>
                    <div className="flex bg-gray-100/80 rounded-2xl p-1.5 border border-gray-200/50 shadow-inner">
                        <button
                            onClick={() => onNavigate(addDays(currentDate, viewMode === 'MONTH' ? -30 : -7))}
                            className="p-1 px-3 hover:bg-white rounded-xl transition-all text-gray-500 shadow-sm"
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <button
                            onClick={() => onNavigate(new Date())}
                            className="px-4 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-indigo-600 transition-colors"
                        >
                            Hoy
                        </button>
                        <button
                            onClick={() => onNavigate(addDays(currentDate, viewMode === 'MONTH' ? 30 : 7))}
                            className="p-1 px-3 hover:bg-white rounded-xl transition-all text-gray-500 shadow-sm"
                        >
                            <ChevronRight size={18} />
                        </button>
                    </div>
                </div>

                {/* Mini Stats or Legend */}
                <div className="flex items-center gap-8">
                    <div className="flex items-center gap-2.5 group">
                        <span className="w-3 h-3 rounded-full bg-indigo-500 border-4 border-indigo-100 group-hover:scale-125 transition-transform" />
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">CRM</span>
                    </div>
                    <div className="flex items-center gap-2.5 group">
                        <span className="w-3 h-3 rounded-full bg-emerald-500 border-4 border-emerald-100 group-hover:scale-125 transition-transform" />
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Reserva</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-hidden relative">
                {viewMode === 'MONTH' ? renderMonthView() : renderTimelineView()}
            </div>
        </div>
    );
};

export default AdvancedCalendar;
