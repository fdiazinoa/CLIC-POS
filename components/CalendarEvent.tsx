import React from 'react';
import { format, parseISO } from 'date-fns';
import { Activity } from '../types';
import { User as UserIcon, MapPin as MapPinIcon } from 'lucide-react';

interface CalendarEventProps {
    activity: Activity;
    onClick: (activity: Activity) => void;
    viewMode: 'MONTH' | 'WEEK' | 'RESOURCE' | 'TEAM';
    style?: React.CSSProperties;
    isMonthView?: boolean;
}

const CalendarEvent: React.FC<CalendarEventProps> = ({
    activity,
    onClick,
    viewMode,
    style,
    isMonthView = false
}) => {
    const isBooking = activity.nature === 'BOOKING';

    // Category Colors
    const colors = isBooking
        ? {
            border: 'border-l-emerald-600',
            bg: 'bg-emerald-600/[0.08]',
            dot: 'bg-emerald-500'
        }
        : {
            border: 'border-l-[#2563EB]',
            bg: 'bg-[#2563EB]/[0.08]',
            dot: 'bg-blue-500'
        };

    if (isMonthView) {
        return (
            <div
                onClick={(e) => {
                    e.stopPropagation();
                    onClick(activity);
                }}
                className={`
                    text-[9px] leading-tight p-1.5 rounded-lg border-l-[3px] truncate font-bold transition-all shadow-sm cursor-pointer
                    ${colors.border} ${colors.bg} hover:brightness-95 hover:shadow-md
                `}
            >
                <div className="flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                    <span className="truncate text-slate-900">{activity.title}</span>
                </div>
            </div>
        );
    }

    return (
        <div
            onClick={() => onClick(activity)}
            style={style}
            className={`
                absolute inset-x-1 rounded-r-md border-l-4 z-10 cursor-pointer overflow-hidden transition-all
                hover:z-20 hover:brightness-95 active:scale-[0.98] shadow-sm hover:shadow-md flex flex-col
                bg-white ${colors.border}
            `}
        >
            {/* Soft Overlay for Category Tint */}
            <div className={`absolute inset-0 ${colors.bg} pointer-events-none`} />

            <div className="relative flex-1 flex flex-col pl-3 pr-2 py-1 min-h-0 justify-center">
                {/* Time Range */}
                <span className="text-[10px] font-medium text-slate-500 uppercase tracking-tight truncate leading-tight">
                    {format(parseISO(activity.startDate), 'HH:mm')} - {format(parseISO(activity.endDate), 'HH:mm')}
                </span>

                {/* Title */}
                <p className="text-xs font-semibold leading-tight text-slate-900 truncate">
                    {activity.title}
                </p>

                {/* Metadata (only if space allows) */}
                <div className="flex flex-col gap-0.5 mt-0.5 opacity-60 overflow-hidden">
                    {viewMode !== 'TEAM' && activity.assignedToName && (
                        <div className="flex items-center gap-1 text-[9px] font-bold text-slate-600 truncate">
                            <UserIcon size={10} />
                            <span className="truncate">{activity.assignedToName}</span>
                        </div>
                    )}
                    {viewMode !== 'RESOURCE' && activity.spaceName && (
                        <div className="flex items-center gap-1 text-[9px] font-bold text-slate-600">
                            <MapPinIcon size={10} />
                            <span className="truncate">{activity.spaceName}</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CalendarEvent;
