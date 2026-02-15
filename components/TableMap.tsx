import React, { useState, useMemo } from 'react';
import { Room, Table, User as UserType } from '../types';
import {
    Clock,
    User,
    Armchair,
    DollarSign,
    Utensils,
    AlertTriangle,
    Lock,
    Plus,
    Minus,
    Maximize2,
    TrendingUp,
    LayoutGrid
} from 'lucide-react';
import TableOptionsModal from './TableOptionsModal';

interface TableMapProps {
    rooms: Room[];
    currentRoomId?: string;
    tables: Table[];
    onTableClick: (table: Table) => void;
    currencySymbol: string;
    currentUser: UserType;
    isAdmin?: boolean;
    bloqueoMeseros?: boolean;
    isRestaurantMode?: boolean;
    onRefreshTables?: () => void;
}

const TableMap: React.FC<TableMapProps> = ({
    rooms,
    currentRoomId: initialRoomId,
    tables,
    onTableClick,
    currencySymbol,
    currentUser,
    isAdmin,
    bloqueoMeseros,
    isRestaurantMode,
    onRefreshTables
}) => {
    const [activeRoomId, setActiveRoomId] = useState<string>(initialRoomId || rooms[0]?.id || '');
    const [selectedTable, setSelectedTable] = useState<Table | null>(null);
    const [scale, setScale] = useState(1);
    const safeTables = Array.isArray(tables) ? tables : [];

    // Get active room object
    const activeRoom = rooms.find(r => r.id === activeRoomId);

    // Filter tables by active room
    const visibleTables = safeTables.filter(t => t.roomId === activeRoomId);

    // Occupation Stats
    const stats = useMemo(() => {
        const roomTables = safeTables.filter(t => t.roomId === activeRoomId && t.shape !== 'OBSTACLE');
        const occupied = roomTables.filter(t => t.status === 'OCCUPIED');
        const totalAmount = occupied.reduce((acc, t) => acc + (t.currentOrderTotal || 0), 0);

        return {
            total: roomTables.length,
            occupied: occupied.length,
            free: roomTables.length - occupied.length,
            amount: totalAmount
        };
    }, [safeTables, activeRoomId]);

    const handleZoom = (delta: number) => {
        setScale(prev => Math.min(Math.max(0.5, prev + delta), 2));
    };

    return (
        <div className="relative w-full h-full bg-slate-50 overflow-hidden select-none font-sans">
            {/* 1. Immersive Dot Pattern Background */}
            <div
                className="absolute inset-0 opacity-[0.4] pointer-events-none transition-all duration-300"
                style={{
                    backgroundImage: 'radial-gradient(#cbd5e1 2px, transparent 2px)',
                    backgroundSize: `${32 * scale}px ${32 * scale}px`,
                    backgroundPosition: 'center center'
                }}
            />

            {/* 2. Floating Occupation Dashboard (Top-Right) */}
            <div className="absolute top-6 right-6 z-20 animate-in fade-in slide-in-from-top-4 duration-500">
                <div className="bg-white/80 backdrop-blur-md p-5 rounded-[2rem] border border-white shadow-2xl flex flex-col gap-3 min-w-[200px]">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Estado de Sala</span>
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-emerald-500" />
                            <span className="text-xs font-bold text-slate-600">Libres</span>
                        </div>
                        <span className="text-sm font-black text-slate-800">{stats.free}</span>
                    </div>

                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-red-500" />
                            <span className="text-xs font-bold text-slate-600">Ocupadas</span>
                        </div>
                        <span className="text-sm font-black text-slate-800">{stats.occupied}</span>
                    </div>

                    <div className="mt-1 pt-3 border-t border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <TrendingUp size={14} className="text-blue-500" />
                            <span className="text-xs font-bold text-blue-600">Total</span>
                        </div>
                        <span className="text-base font-black text-blue-700">{currencySymbol}{stats.amount.toLocaleString()}</span>
                    </div>
                </div>
            </div>

            {/* 3. Zoom Controls (Bottom-Right) */}
            <div className="absolute bottom-6 right-6 z-20 flex flex-col gap-2">
                <button
                    onClick={() => handleZoom(0.1)}
                    className="p-3 bg-white hover:bg-slate-50 text-slate-600 rounded-2xl shadow-xl border border-slate-100 transition-all active:scale-95"
                >
                    <Plus size={20} />
                </button>
                <button
                    onClick={() => setScale(1)}
                    className="p-3 bg-white hover:bg-slate-50 text-slate-600 rounded-2xl shadow-xl border border-slate-100 transition-all active:scale-95"
                >
                    <Maximize2 size={20} />
                </button>
                <button
                    onClick={() => handleZoom(-0.1)}
                    className="p-3 bg-white hover:bg-slate-50 text-slate-600 rounded-2xl shadow-xl border border-slate-100 transition-all active:scale-95"
                >
                    <Minus size={20} />
                </button>
            </div>

            {/* 4. Room Selector "Dock" (Bottom-Middle) */}
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 animate-in slide-in-from-bottom-8 duration-700">
                <div className="bg-white/90 backdrop-blur-xl p-2 rounded-full border border-white shadow-[0_20px_50px_rgba(0,0,0,0.15)] flex items-center gap-1">
                    {rooms.map(room => {
                        const isSelected = activeRoomId === room.id;
                        const occupiedInRoom = safeTables.filter(t => t.roomId === room.id && t.status === 'OCCUPIED').length;

                        return (
                            <button
                                key={room.id}
                                onClick={() => setActiveRoomId(room.id)}
                                className={`
                                    px-6 py-3 rounded-full font-black text-sm transition-all flex items-center gap-3
                                    ${isSelected
                                        ? 'bg-slate-900 text-white shadow-xl scale-105 -translate-y-1'
                                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}
                                `}
                            >
                                <LayoutGrid size={16} className={isSelected ? 'text-blue-400' : 'text-slate-300'} />
                                {room.nombre || room.name}
                                {occupiedInRoom > 0 && (
                                    <span className={`
                                        px-2 py-0.5 rounded-full text-[10px] font-black
                                        ${isSelected ? 'bg-blue-500 text-white' : 'bg-red-500 text-white'}
                                    `}>
                                        {occupiedInRoom}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* 5. Main Canvas Area */}
            <div className="w-full h-full overflow-auto p-20 flex items-center justify-center">
                <div
                    className="relative transition-transform duration-300 ease-out"
                    style={{
                        width: 1000,
                        height: 800,
                        transform: `scale(${scale})`,
                        transformOrigin: 'center center'
                    }}
                >
                    {visibleTables.map(table => (
                        <TableNode
                            key={table.id}
                            table={table}
                            activeRoom={activeRoom}
                            currentUser={currentUser}
                            isAdmin={isAdmin}
                            bloqueoMeseros={bloqueoMeseros}
                            currencySymbol={currencySymbol}
                            onSelect={async () => {
                                if (table.status === 'OCCUPIED') {
                                    onTableClick(table);
                                } else if (isRestaurantMode) {
                                    // Direct action for restaurant
                                    try {
                                        const res = await fetch('/api/mesas/abrir', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                tableId: table.id,
                                                waiterId: currentUser.id,
                                                waiterName: currentUser.name
                                            })
                                        });
                                        const data = await res.json();
                                        if (res.ok && data.status === 'success') {
                                            if (onRefreshTables) onRefreshTables();
                                            onTableClick({ ...table, currentOrderId: data.orden_id });
                                        } else {
                                            alert(data?.message || "Error abriendo mesa");
                                        }
                                    } catch (e) {
                                        console.error(e);
                                        alert("Error de conexión con el servicio de mesas");
                                    }
                                } else {
                                    setSelectedTable(table);
                                }
                            }}
                        />
                    ))}
                </div>
            </div>

            {/* Table Options Modal */}
            {selectedTable && (
                <TableOptionsModal
                    table={selectedTable}
                    room={activeRoom}
                    allTables={safeTables}
                    onClose={() => setSelectedTable(null)}
                    onAddOrder={() => {
                        onTableClick(selectedTable);
                        setSelectedTable(null);
                    }}
                    onPrintPrecheck={() => console.log('Print precheck')}
                    onSplitItems={() => console.log('Split items')}
                    onSplitPayment={() => console.log('Split payment')}
                    onMoveTable={async (targetTableId) => {
                        try {
                            const res = await fetch('/api/mesas/mover', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ fromTableId: selectedTable.id, toTableId: targetTableId })
                            });
                            const data = await res.json();
                            if (data.success) {
                                alert("Mesa movida correctamente");
                                setSelectedTable(null);
                            } else {
                                alert("Error moviendo mesa: " + data.message);
                            }
                        } catch (e) { console.error(e); alert("Error de conexión"); }
                    }}
                    onMergeTables={() => console.log('Merge not implemented')}
                    onFree={async () => {
                        try {
                            const res = await fetch('/api/mesas/liberar', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ tableId: selectedTable.id })
                            });
                            const data = await res.json();
                            if (data.success) {
                                setSelectedTable(null);
                            } else {
                                alert("Error liberando mesa: " + data.message);
                            }
                        } catch (e) {
                            console.error(e);
                            alert("Error de conexión");
                        }
                    }}
                />
            )}
        </div>
    );
};

const TableNode: React.FC<{
    table: Table;
    activeRoom?: Room;
    currentUser: UserType;
    isAdmin?: boolean;
    bloqueoMeseros?: boolean;
    currencySymbol: string;
    onSelect: () => void;
}> = ({ table, activeRoom, currentUser, isAdmin, bloqueoMeseros, currencySymbol, onSelect }) => {

    if (table.shape === 'OBSTACLE') {
        return (
            <div
                className="absolute bg-slate-800 rounded-lg shadow-2xl border border-slate-700 opacity-80"
                style={{
                    left: table.posX,
                    top: table.posY,
                    width: table.width,
                    height: table.height,
                    transform: `rotate(${table.rotation}deg)`
                }}
            />
        );
    }

    const isOccupied = table.status === 'OCCUPIED';
    const isLocked = isOccupied && bloqueoMeseros && table.waiterId && table.waiterId !== currentUser.id && !isAdmin;

    // Helper: Formato de tiempo transcurrido
    const timeElapsed = useMemo(() => {
        if (!table.timeSeated) return null;
        try {
            const start = new Date(table.timeSeated).getTime();
            const now = Date.now();
            const diffMinutes = Math.floor((now - start) / 60000);

            if (isNaN(diffMinutes)) return '0m';
            if (diffMinutes < 60) return `${diffMinutes}m`;
            const hours = Math.floor(diffMinutes / 60);
            const mins = diffMinutes % 60;
            return `${hours}h ${mins}m`;
        } catch (e) {
            return '0m';
        }
    }, [table.timeSeated]); // Re-calculate if timestamp changes (ideally should tick, but this is enough for initial render)

    // Helper: Lógica Financiera
    const total = table.currentOrderTotal || 0;
    const minSpend = activeRoom?.consumo_minimo || 0;
    const isBelowMin = isOccupied && minSpend > 0 && total < minSpend;

    return (
        <button
            onClick={() => {
                if (isLocked) {
                    alert(`Mesa bloqueada. Atendida por: ${table.waiterName || 'otro mesero'}`);
                    return;
                }
                onSelect();
            }}
            className={`
                absolute flex flex-col justify-between p-2 transition-all duration-300 group
                ${table.shape === 'CIRCLE' ? 'rounded-full' : 'rounded-xl'}
                ${isOccupied
                    ? (isLocked
                        ? 'bg-slate-700 border-2 border-slate-800 shadow-xl'
                        : 'bg-gradient-to-br from-red-500 to-red-600 border-2 border-red-700 shadow-lg scale-105 hover:scale-110')
                    : 'bg-white border-2 border-slate-200 hover:border-blue-400 hover:shadow-xl hover:scale-110 active:scale-95'}
            `}
            style={{
                left: table.posX,
                top: table.posY,
                width: table.width,
                height: table.height,
                transform: `rotate(${table.rotation}deg)`
            }}
        >
            {isOccupied ? (
                <>
                    {/* Header: Waiter & Time */}
                    <div className="w-full flex justify-between items-start text-[10px] font-medium text-white/90 leading-none">
                        <div className="flex items-center gap-0.5 max-w-[60%] overflow-hidden">
                            {!isLocked && <User size={10} className="shrink-0" />}
                            <span className="truncate">{table.waiterName?.split(' ')[0] || 'S/N'}</span>
                        </div>
                        {timeElapsed && (
                            <div className="flex items-center gap-0.5">
                                <Clock size={10} className="shrink-0" />
                                <span>{timeElapsed}</span>
                            </div>
                        )}
                    </div>

                    {/* Center: Table Name (HERO) */}
                    <div className="flex-1 flex items-center justify-center -mt-1">
                        <span className="text-lg font-bold text-white leading-none tracking-tight shadow-sm drop-shadow-md">
                            {table.nombre || table.name}
                        </span>
                    </div>

                    {/* Footer: Money & Alerts */}
                    <div className="w-full flex flex-col items-center justify-end leading-none">
                        <div className={`flex items-center gap-1 text-base font-bold ${isBelowMin ? 'text-yellow-300 animate-pulse' : 'text-white'}`}>
                            {isBelowMin && <AlertTriangle size={12} className="shrink-0" />}
                            <span>{currencySymbol}{total.toLocaleString()}</span>
                        </div>
                        {isBelowMin && (
                            <span className="text-[8px] text-yellow-200/80 font-medium mt-0.5">Mín. {currencySymbol}{minSpend}</span>
                        )}
                    </div>

                    {/* Lock Overlay */}
                    {isLocked && (
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60 rounded-[inherit] backdrop-blur-[1px]">
                            <Lock size={20} className="text-white drop-shadow-md" />
                        </div>
                    )}
                </>
            ) : (
                /* Empty State */
                <div className="flex flex-col items-center justify-center w-full h-full">
                    <span className="font-bold text-slate-700 text-sm">{table.nombre || table.name}</span>
                    <div className="flex items-center gap-1 text-slate-400 mt-1">
                        <User size={10} />
                        <span className="text-[10px] font-bold">{table.capacity}</span>
                    </div>
                    {/* Free Indicator Dot */}
                    <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                </div>
            )}
        </button>
    );
};

export default TableMap;
