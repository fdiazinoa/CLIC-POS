import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Calendar, Users, Building2, Plus, ChevronLeft,
    Search, Filter, MoreVertical, Layout, Grid,
    RefreshCw, Zap, Target, Clock, AlertTriangle, Tag
} from 'lucide-react';
import {
    BusinessConfig,
    User,
    Customer,
    Room,
    Activity,
    Warehouse,
    ServiceType,
    Opportunity
} from '../types';
import AdvancedCalendar from './AdvancedCalendar';
import ActivityModal from './ActivityModal';
import ServiceTypeManager from './ServiceTypeManager'; // Import the new component
import SpaceTimelineView from './SpaceTimelineView';
import TeamTimelineView from './TeamTimelineView';
import PipelineKanban from './PipelineKanban';
import { agendaService } from '../services/AgendaService';
import { startOfMonth, endOfMonth, addMonths, subMonths, format, startOfDay, endOfDay } from 'date-fns';
import { AttendanceLog } from '../types';

interface AgendaManagerProps {
    config: BusinessConfig;
    currentUser: User;
    customers: Customer[];
    rooms: Room[];
    users: User[];
    warehouses: Warehouse[];
    onUpdateRooms?: (rooms: Room[]) => void;
    onClose: () => void;
}

const AgendaManager: React.FC<AgendaManagerProps> = ({
    config,
    currentUser,
    customers,
    rooms,
    users,
    warehouses,
    onUpdateRooms,
    onClose
}) => {
    const [activeTab, setActiveTab] = useState<'PIPELINE' | 'CALENDAR' | 'SPACES' | 'TYPES'>('PIPELINE');
    const [viewMode, setViewMode] = useState<'MONTH' | 'WEEK' | 'RESOURCE' | 'TEAM'>('MONTH');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [activities, setActivities] = useState<Activity[]>([]);
    const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
    const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]); // New state
    const [attendanceLogs, setAttendanceLogs] = useState<AttendanceLog[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showActivityModal, setShowActivityModal] = useState(false);
    const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
    const [prefilledDate, setPrefilledDate] = useState<Date | null>(null);
    const [prefilledResourceId, setPrefilledResourceId] = useState<string | null>(null);

    // FETCH DATA
    const fetchActivities = useCallback(async () => {
        setIsLoading(true);
        try {
            // Fetch range: current month +/- 1 month
            const all = await agendaService.getActivitiesByRange(
                startOfMonth(subMonths(currentDate, 1)).toISOString(),
                endOfMonth(addMonths(currentDate, 1)).toISOString()
            );
            setActivities(all);

            // Fetch attendance for the current day
            const logs = await agendaService.getAttendanceLogs(
                startOfDay(currentDate).toISOString(),
                endOfDay(currentDate).toISOString()
            );
            setAttendanceLogs(logs);
        } catch (error) {
            console.error("Failed to fetch activities:", error);
        } finally {
            setIsLoading(false);
        }
    }, [currentDate]);

    const fetchServiceTypes = useCallback(async () => {
        try {
            const types = await agendaService.getServiceTypes();
            setServiceTypes(types);
        } catch (error) {
            console.error("Failed to fetch service types:", error);
        }
    }, []);

    const fetchOpportunities = useCallback(async () => {
        try {
            setOpportunities(await agendaService.getOpportunities());
        } catch (error) {
            console.error("Failed to fetch opportunities:", error);
        }
    }, []);

    useEffect(() => {
        fetchActivities();
        fetchServiceTypes();
        fetchOpportunities();
    }, [fetchActivities, fetchServiceTypes, fetchOpportunities]);

    // HANDLERS
    const handleSaveActivity = async (activityData: Partial<Activity>) => {
        if (selectedActivity) {
            await agendaService.updateActivity(selectedActivity.id, activityData);
        } else {
            await agendaService.createActivity({
                ...activityData,
                terminalId: config.terminals[0]?.id || 'T1'
            });
        }
        fetchActivities();
        fetchOpportunities();
    };

    const handleCreateOpportunity = async (opportunityData: Partial<Opportunity>) => {
        await agendaService.createOpportunity(opportunityData);
        await fetchOpportunities();
    };

    const handleUpdateOpportunity = async (id: string, updates: Partial<Opportunity>) => {
        await agendaService.updateOpportunity(id, updates);
        await fetchOpportunities();
    };

    const activityCountsByOpportunity = useMemo(() => activities.reduce<Record<string, number>>((acc, activity) => {
        if (activity.opportunityId) acc[activity.opportunityId] = (acc[activity.opportunityId] || 0) + 1;
        return acc;
    }, {}), [activities]);

    const activeTerminalId = config.terminals[0]?.id || 'T1';

    const handleDeleteActivity = async (id: string) => {
        await agendaService.deleteActivity(id);
        fetchActivities();
    };

    const handleUpdateActivity = async (activityId: string, newUserId: string, newStartDate: Date) => {
        const activity = activities.find(a => a.id === activityId);
        if (!activity) return;

        const oldStart = new Date(activity.startDate);
        const oldEnd = new Date(activity.endDate);
        const duration = oldEnd.getTime() - oldStart.getTime();

        const newEndDate = new Date(newStartDate.getTime() + duration);
        const newUser = users.find(u => u.id === newUserId);

        try {
            await agendaService.updateActivity(activityId, {
                assignedToId: newUserId,
                assignedToName: newUser?.name || activity.assignedToName,
                startDate: newStartDate.toISOString(),
                endDate: newEndDate.toISOString()
            });
            fetchActivities();
        } catch (error) {
            console.error("Failed to update activity:", error);
        }
    };

    return (
        <div className="h-screen flex flex-col bg-gray-50 overflow-hidden font-sans select-none">
            {/* Glassmorphism Header */}
            <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200 px-8 py-4 flex items-center justify-between sticky top-0 z-50 shadow-sm">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-500"
                    >
                        <ChevronLeft size={24} />
                    </button>
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-2xl shadow-lg shadow-indigo-200">
                            <Calendar size={20} />
                        </div>
                        <div>
                            <h1 className="text-xl font-black text-gray-900 tracking-tight leading-none mb-1">CRM & Ventas</h1>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Pipeline, Agenda & Bookings</p>
                        </div>
                    </div>
                </div>

                {/* View Switcher */}
                <div className="flex bg-gray-100 p-1 rounded-2xl border border-gray-200 shadow-inner">
                    <button
                        onClick={() => setActiveTab('PIPELINE')}
                        className={`flex items-center gap-2 px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'PIPELINE' ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-gray-200' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        <Target size={14} />
                        <span className="hidden md:inline">Pipeline</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('CALENDAR')}
                        className={`flex items-center gap-2 px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'CALENDAR' ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-gray-200' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        <Calendar size={14} />
                        <span className="hidden md:inline">Agenda</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('SPACES')}
                        className={`flex items-center gap-2 px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'SPACES' ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-gray-200' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        <Building2 size={14} />
                        <span className="hidden md:inline">Espacios</span>
                    </button>
                    <button
                        onClick={() => setActiveTab('TYPES')}
                        className={`flex items-center gap-2 px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'TYPES' ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-gray-200' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        <Tag size={14} />
                        <span className="hidden md:inline">Tipos</span>
                    </button>
                </div>

                {activeTab === 'CALENDAR' && (
                    <div className="flex bg-gray-100 p-1 rounded-2xl border border-gray-200 shadow-inner ml-4">
                        {[
                            { id: 'MONTH', label: 'Mes', icon: <Grid size={14} /> },
                            { id: 'WEEK', label: 'Semana', icon: <Layout size={14} /> },
                            { id: 'RESOURCE', label: 'Espacios', icon: <Building2 size={14} /> },
                            { id: 'TEAM', label: 'Equipo', icon: <Users size={14} /> }
                        ].map(view => (
                            <button
                                key={view.id}
                                onClick={() => setViewMode(view.id as any)}
                                className={`
                    flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all
                    ${viewMode === view.id
                                        ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-gray-200'
                                        : 'text-gray-400 hover:text-gray-600'}
                  `}
                            >
                                {view.icon}
                                <span className="hidden md:inline">{view.label}</span>
                            </button>
                        ))}
                    </div>
                )}

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => {
                            fetchActivities();
                            fetchOpportunities();
                        }}
                        className={`p-2.5 bg-gray-100 text-gray-500 rounded-xl hover:bg-gray-200 transition-all ${isLoading ? 'animate-spin' : ''}`}
                    >
                        <RefreshCw size={18} />
                    </button>
                    <button
                        onClick={() => {
                            setSelectedActivity(null);
                            setPrefilledDate(null);
                            setShowActivityModal(true);
                        }}
                        className="p-2.5 bg-indigo-600 text-white rounded-2xl shadow-xl shadow-indigo-200 hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2 px-6"
                    >
                        <Plus size={20} strokeWidth={3} />
                        <span className="text-sm font-black uppercase tracking-widest">Nueva</span>
                    </button>
                </div>
            </header>

            <main className="flex-1 overflow-hidden p-8 flex gap-8">
                {activeTab === 'PIPELINE' ? (
                    <PipelineKanban
                        opportunities={opportunities}
                        customers={customers}
                        users={users}
                        activityCounts={activityCountsByOpportunity}
                        onCreateOpportunity={handleCreateOpportunity}
                        onUpdateOpportunity={handleUpdateOpportunity}
                    />
                ) : activeTab === 'CALENDAR' ? (
                    <>
                        {/* Main Calendar Area */}
                        <div className="flex-1 bg-white/60 backdrop-blur-md rounded-[2.5rem] border border-white shadow-2xl shadow-gray-200/50 overflow-hidden flex flex-col relative text-gray-900">
                            {isLoading && activities.length === 0 ? (
                                <div className="absolute inset-0 z-20 bg-white/50 backdrop-blur-sm flex items-center justify-center flex-col gap-4">
                                    <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                                    <p className="font-bold text-[10px] uppercase tracking-widest text-indigo-600">Sincronizando...</p>
                                </div>
                            ) : null}

                            {viewMode === 'RESOURCE' ? (
                                <SpaceTimelineView
                                    activities={activities}
                                    rooms={rooms}
                                    onActivityClick={(act) => {
                                        setSelectedActivity(act);
                                        setShowActivityModal(true);
                                    }}
                                    onAddActivity={(date, spaceId) => {
                                        setSelectedActivity(null);
                                        setPrefilledDate(date);
                                        setPrefilledResourceId(spaceId);
                                        setShowActivityModal(true);
                                    }}
                                />
                            ) : viewMode === 'TEAM' ? (
                                <TeamTimelineView
                                    activities={activities}
                                    users={users}
                                    attendanceLogs={attendanceLogs}
                                    serviceTypes={serviceTypes}
                                    onActivityClick={(act) => {
                                        setSelectedActivity(act);
                                        setShowActivityModal(true);
                                    }}
                                    onAddActivity={(date, userId) => {
                                        setSelectedActivity(null);
                                        setPrefilledDate(date);
                                        setPrefilledResourceId(userId);
                                        setShowActivityModal(true);
                                    }}
                                    onUpdateActivity={handleUpdateActivity}
                                />
                            ) : (
                                <AdvancedCalendar
                                    viewMode={viewMode}
                                    currentDate={currentDate}
                                    onNavigate={setCurrentDate}
                                    activities={activities}
                                    rooms={rooms}
                                    users={users}
                                    onActivityClick={(act) => {
                                        setSelectedActivity(act);
                                        setShowActivityModal(true);
                                    }}
                                    onDateClick={(date, resourceId) => {
                                        setSelectedActivity(null);
                                        setPrefilledDate(date);
                                        setPrefilledResourceId(resourceId || null);
                                        setShowActivityModal(true);
                                    }}
                                    serviceTypes={serviceTypes}
                                />
                            )}
                        </div>

                        {/* Sidebar Stats/Filters */}
                        <aside className="w-80 flex flex-col gap-6 shrink-0 text-gray-900">
                            <div className="bg-white/60 backdrop-blur-md rounded-[2rem] p-6 border border-white shadow-xl shadow-gray-200/50">
                                <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Filter size={16} className="text-indigo-500" />
                                    Métricas
                                </h3>
                                <div className="space-y-3">
                                    <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-100/50">
                                        <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">CRM Activos</p>
                                        <p className="text-2xl font-black text-indigo-600">
                                            {activities.filter(a => a.nature === 'CRM' && a.status !== 'COMPLETED').length}
                                        </p>
                                    </div>
                                    <div className="p-4 rounded-2xl bg-purple-50 border border-purple-100/50">
                                        <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest mb-1">Bookings Pend.</p>
                                        <p className="text-2xl font-black text-purple-600">
                                            {activities.filter(a => a.nature === 'BOOKING' && a.status !== 'COMPLETED').length}
                                        </p>
                                    </div>

                                    <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100/50">
                                        <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest mb-1">Tareas Urgentes</p>
                                        <p className="text-2xl font-black text-amber-600">
                                            {activities.filter(a => a.priority === 'URGENT' && a.status !== 'COMPLETED').length}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white/60 backdrop-blur-md rounded-[2rem] p-6 border border-white shadow-xl shadow-gray-200/50">
                                <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Zap size={16} className="text-amber-500" />
                                    Recordatorios
                                </h3>
                                <div className="space-y-3">
                                    {activities
                                        .filter(a => a.status !== 'COMPLETED' && new Date(a.startDate) <= new Date(Date.now() + 86400000))
                                        .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
                                        .slice(0, 3)
                                        .map(act => (
                                            <div key={act.id} className="p-3 rounded-xl bg-white border border-gray-100 shadow-sm flex items-start gap-3">
                                                <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${new Date(act.startDate) < new Date() ? 'bg-red-500 animate-pulse' : 'bg-amber-400'}`} />
                                                <div>
                                                    <p className="text-[10px] font-bold text-gray-800 line-clamp-1">{act.title}</p>
                                                    <p className="text-[9px] text-gray-400 font-bold">{format(new Date(act.startDate), 'HH:mm')}</p>
                                                </div>
                                            </div>
                                        ))
                                    }
                                    {activities.filter(a => a.status !== 'COMPLETED' && new Date(a.startDate) <= new Date(Date.now() + 86400000)).length === 0 && (
                                        <p className="text-[10px] text-gray-400 italic text-center py-2">Sin pendientes hoy.</p>
                                    )}
                                </div>
                            </div>

                            <div className="flex-1 bg-white/60 backdrop-blur-md rounded-[2rem] p-6 border border-white shadow-xl shadow-gray-200/50 overflow-hidden flex flex-col">
                                <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest mb-4">Próximos Eventos</h3>
                                <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2">
                                    {activities
                                        .filter(a => new Date(a.startDate) >= new Date())
                                        .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
                                        .slice(0, 10)
                                        .map(act => (
                                            <div
                                                key={act.id}
                                                onClick={() => {
                                                    setSelectedActivity(act);
                                                    setShowActivityModal(true);
                                                }}
                                                className="group p-3 rounded-2xl hover:bg-white transition-all cursor-pointer border border-transparent hover:border-gray-100"
                                            >
                                                <p className="text-[10px] font-black text-gray-400 uppercase mb-1">
                                                    {format(new Date(act.startDate), 'dd MMM, HH:mm')}
                                                </p>
                                                <p className="text-xs font-bold text-gray-800 line-clamp-1 group-hover:text-indigo-600 transition-colors">
                                                    {act.title}
                                                </p>
                                                <div className="flex items-center gap-1 mt-1">
                                                    <span className={`w-1.5 h-1.5 rounded-full ${act.nature === 'BOOKING' ? 'bg-purple-500' : 'bg-indigo-500'}`} />
                                                    <span className="text-[9px] font-bold text-gray-400 uppercase">{act.type}</span>
                                                </div>
                                            </div>
                                        ))
                                    }
                                    {activities.length === 0 && (
                                        <p className="text-xs text-gray-400 italic font-medium text-center py-8">No hay eventos próximos.</p>
                                    )}
                                </div>
                            </div>
                        </aside>
                    </>
                ) : activeTab === 'SPACES' ? (
                    <div className="flex-1 bg-white/60 backdrop-blur-md rounded-[2.5rem] border border-white shadow-2xl shadow-gray-200/50 overflow-hidden">
                        <SpaceTimelineView
                            activities={activities}
                            rooms={rooms}
                            onActivityClick={(act) => {
                                setSelectedActivity(act);
                                setShowActivityModal(true);
                            }}
                            onAddActivity={(date, spaceId) => {
                                setSelectedActivity(null);
                                setPrefilledDate(date);
                                setPrefilledResourceId(spaceId);
                                setShowActivityModal(true);
                            }}
                        />
                    </div>
                ) : (
                    <div className="flex-1 bg-white/60 backdrop-blur-md rounded-[2.5rem] border border-white shadow-2xl shadow-gray-200/50 overflow-hidden">
                        <ServiceTypeManager
                            onClose={() => setActiveTab('CALENDAR')}
                            onUpdate={fetchServiceTypes}
                        />
                    </div>
                )}
            </main>

            {/* MODALS */}
            <ActivityModal
                isOpen={showActivityModal}
                onClose={() => {
                    setShowActivityModal(false);
                    setSelectedActivity(null);
                    setPrefilledDate(null);
                    setPrefilledResourceId(null);
                }}
                activity={selectedActivity}
                initialDate={prefilledDate}
                initialResourceId={prefilledResourceId}
                customers={customers}
                rooms={rooms}
                users={users}
                serviceTypes={serviceTypes}
                currentUser={currentUser}
                terminalId={activeTerminalId}
                onSave={handleSaveActivity}
                onDelete={handleDeleteActivity}
                onActivityUpdated={() => {
                    fetchActivities();
                    fetchOpportunities();
                }}
                onUpdateRooms={onUpdateRooms}
            />
        </div>
    );
};

export default AgendaManager;
