import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
    Square, Circle, Save, Trash2, Plus,
    Layout, Grid, Armchair, Ban, Settings, Wine
} from 'lucide-react';
import { Table, Room, TableShape } from '../types';

interface TableLayoutDesignerProps {
    rooms: Room[];
    currentRoomId: string;
    tables: Table[];
    onSave: (tables: Table[]) => void;
    onUpdateTables: (tables: Table[]) => void;
    onCreateRoom?: (name: string) => void;
    onChangeRoom: (roomId: string) => void;
    onUpdateRoom?: (room: Room) => void;
}

const GRID_SIZE = 20; // px
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

const TableLayoutDesigner: React.FC<TableLayoutDesignerProps> = ({
    rooms, currentRoomId, tables, onSave, onUpdateTables, onCreateRoom, onChangeRoom, onUpdateRoom
}) => {
    const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
    const [showRoomSettings, setShowRoomSettings] = useState(false);
    const [canvasSize, setCanvasSize] = useState({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
    const canvasHostRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLDivElement>(null);
    const dragStateRef = useRef<{
        tableId: string;
        pointerId: number;
        offsetX: number;
        offsetY: number;
    } | null>(null);

    // Snap to Grid function
    const snapToGrid = (val: number) => Math.round(val / GRID_SIZE) * GRID_SIZE;
    const generateTableId = () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        return `tbl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    };
    const getRoomLabel = (room: Room) => room.name?.trim() || room.nombre?.trim() || 'Sala';
    const getTableLabel = (table: Table) => {
        const fallbackByShape: Record<TableShape, string> = {
            SQUARE: 'Mesa',
            CIRCLE: 'Mesa',
            OBSTACLE: 'Muro',
            BAR: 'Barra',
            BOOTH: 'Sofa'
        };
        return table.name?.trim() || table.nombre?.trim() || fallbackByShape[table.shape] || 'Mesa';
    };
    const currentRoom = rooms.find(r => r.id === currentRoomId);
    const currentRoomTables = useMemo(
        () => tables.filter(t => t.roomId === currentRoomId),
        [tables, currentRoomId]
    );

    useEffect(() => {
        const host = canvasHostRef.current;
        if (!host) return;

        const measureCanvas = () => {
            const rect = host.getBoundingClientRect();
            const contentWidth = Math.max(
                CANVAS_WIDTH,
                ...currentRoomTables.map(table => Number(table.posX || 0) + Number(table.width || 0) + GRID_SIZE)
            );
            const contentHeight = Math.max(
                CANVAS_HEIGHT,
                ...currentRoomTables.map(table => Number(table.posY || 0) + Number(table.height || 0) + GRID_SIZE)
            );

            const nextSize = {
                width: Math.max(contentWidth, Math.floor(rect.width)),
                height: Math.max(contentHeight, Math.floor(rect.height))
            };

            setCanvasSize(prev => {
                if (prev.width === nextSize.width && prev.height === nextSize.height) return prev;
                return nextSize;
            });
        };

        measureCanvas();
        const observer = new ResizeObserver(measureCanvas);
        observer.observe(host);
        return () => observer.disconnect();
    }, [currentRoomId, currentRoomTables]);

    // Add new table
    const handleAddTable = (shape: TableShape) => {
        const isObstacle = shape === 'OBSTACLE';
        const elementConfig: Record<TableShape, { baseName: string; width: number; height: number; capacity: number }> = {
            SQUARE: { baseName: 'Mesa', width: 100, height: 100, capacity: 1 },
            CIRCLE: { baseName: 'Mesa', width: 100, height: 100, capacity: 1 },
            OBSTACLE: { baseName: 'Muro', width: 120, height: 20, capacity: 0 },
            BAR: { baseName: 'Barra', width: 180, height: 60, capacity: 1 },
            BOOTH: { baseName: 'Sofa', width: 160, height: 90, capacity: 4 }
        };
        const config = elementConfig[shape];
        const elementName = `${config.baseName} ${tables.filter(t => t.roomId === currentRoomId && t.shape === shape).length + 1}`;

        const newTable: Table = {
            id: generateTableId(),
            roomId: currentRoomId,
            name: elementName,
            nombre: elementName,
            posX: 100 + (tables.length * 10), // Offset slightly to see new ones
            posY: 100 + (tables.length * 10),
            width: config.width,
            height: config.height,
            shape,
            rotation: 0,
            capacity: config.capacity,
            consumo_minimo_mesa: 0,
            comensales_minimos: isObstacle ? 0 : 1
        };
        // Dedup: Ensure we don't just append if something weird happens, but this is a new ID.
        // The issue 'ghost tables' might be re-renders or hydration issues.
        onUpdateTables([...tables, newTable]);
        setSelectedTableId(newTable.id);
    };

    // Pointer Dragging Logic (desktop + touch)
    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>, tableId: string) => {
        e.stopPropagation();
        const table = tables.find(t => t.id === tableId && t.roomId === currentRoomId);
        if (!table || !canvasRef.current) return;

        const canvasRect = canvasRef.current.getBoundingClientRect();

        setSelectedTableId(tableId);
        dragStateRef.current = {
            tableId,
            pointerId: e.pointerId,
            offsetX: e.clientX - canvasRect.left - table.posX,
            offsetY: e.clientY - canvasRect.top - table.posY
        };

        if (e.currentTarget.setPointerCapture) {
            e.currentTarget.setPointerCapture(e.pointerId);
        }
    };

    // Update Table Prop
    const updateTable = (id: string, updates: Partial<Table>) => {
        onUpdateTables(tables.map(t => t.id === id ? { ...t, ...updates } : t));
    };

    const deleteTable = (id: string) => {
        onUpdateTables(tables.filter(t => t.id !== id));
        setSelectedTableId(null);
    };

    const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== e.pointerId || !canvasRef.current) return;

        e.preventDefault();
        const canvasRect = canvasRef.current.getBoundingClientRect();
        const draggedTable = tables.find(t => t.id === dragState.tableId);
        if (!draggedTable) return;

        let newX = snapToGrid(e.clientX - canvasRect.left - dragState.offsetX);
        let newY = snapToGrid(e.clientY - canvasRect.top - dragState.offsetY);

        const maxX = Math.max(0, canvasSize.width - draggedTable.width);
        const maxY = Math.max(0, canvasSize.height - draggedTable.height);

        if (newX < 0) newX = 0;
        if (newY < 0) newY = 0;
        if (newX > maxX) newX = maxX;
        if (newY > maxY) newY = maxY;

        updateTable(dragState.tableId, { posX: newX, posY: newY });
    };

    const handleCanvasPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== e.pointerId) return;

        dragStateRef.current = null;
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
    };

    const selectedTable = tables.find(t => t.id === selectedTableId);

    return (
        <div className="flex flex-col h-full min-h-[calc(100vh-1px)] bg-slate-950 overflow-hidden">
            {/* Toolbar */}
            <div className="bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3 flex justify-between items-center shrink-0 shadow-sm">
                <div className="flex items-center gap-4">
                    <h2 className="font-black text-slate-800 flex items-center gap-2"><Layout size={20} /> Diseñador de Sala</h2>

                    <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
                        {rooms.map(room => (
                            <button
                                key={room.id}
                                onClick={() => onChangeRoom(room.id)}
                                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${currentRoomId === room.id ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                {getRoomLabel(room)}
                            </button>
                        ))}
                        <button onClick={() => onCreateRoom?.("Nueva Sala")} className="px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 rounded-md">
                            <Plus size={14} />
                        </button>
                    </div>
                    {/* Room Settings Button */}
                    <button
                        onClick={() => setShowRoomSettings(true)}
                        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
                        title="Configurar Sala"
                    >
                        <Settings size={18} />
                    </button>

                </div>

                <div className="flex gap-2">
                    <button onClick={() => handleAddTable('SQUARE')} className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-bold text-slate-700" title="Mesa Cuadrada">
                        <Square size={16} /> Cuadrada
                    </button>
                    <button onClick={() => handleAddTable('CIRCLE')} className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-bold text-slate-700" title="Mesa Redonda">
                        <Circle size={16} /> Redonda
                    </button>
                    <button onClick={() => handleAddTable('OBSTACLE')} className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-bold text-slate-700" title="Obstáculo (Muro)">
                        <Ban size={16} /> Muro
                    </button>
                    <button onClick={() => handleAddTable('BAR')} className="flex items-center gap-2 px-3 py-2 bg-amber-50 hover:bg-amber-100 rounded-lg text-xs font-bold text-amber-700" title="Barra">
                        <Wine size={16} /> Barra
                    </button>
                    <button onClick={() => handleAddTable('BOOTH')} className="flex items-center gap-2 px-3 py-2 bg-indigo-50 hover:bg-indigo-100 rounded-lg text-xs font-bold text-indigo-700" title="Sofa / Booth">
                        <Armchair size={16} /> Sofa
                    </button>
                    <div className="w-px h-8 bg-slate-200 mx-2"></div>
                    <button onClick={() => onSave(tables)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-lg shadow-blue-200">
                        <Save size={16} /> Guardar Distribución
                    </button>
                </div>
            </div>

            <div className="flex flex-1 min-h-0 overflow-hidden">
                {/* Canvas Area */}
                <div
                    ref={canvasHostRef}
                    className="flex-1 bg-gradient-to-br from-[#06172b] via-[#081124] to-[#101023] overflow-auto flex items-start justify-start relative"
                >
                    <div
                        className="absolute inset-0 pointer-events-none opacity-45"
                        style={{
                            backgroundImage: [
                                'linear-gradient(rgba(148,163,184,0.13) 1px, transparent 1px)',
                                'linear-gradient(90deg, rgba(148,163,184,0.13) 1px, transparent 1px)'
                            ].join(','),
                            backgroundSize: '34px 34px'
                        }}
                    />

                    <div
                        ref={canvasRef}
                        onPointerMove={handleCanvasPointerMove}
                        onPointerUp={handleCanvasPointerEnd}
                        onPointerCancel={handleCanvasPointerEnd}
                        className="bg-white/95 shadow-2xl relative select-none overflow-hidden touch-none"
                        style={{
                            width: canvasSize.width,
                            height: canvasSize.height,
                            backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)',
                            backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`
                        }}
                    >
                        {/* Grid Watermark */}
                        <div className="absolute top-2 right-2 flex items-center gap-1 text-[10px] text-slate-300 font-mono pointer-events-none">
                            <Grid size={12} /> SNAP: {GRID_SIZE}px
                        </div>

                        {currentRoomTables.map(table => (
                            <div
                                key={table.id}
                                onPointerDown={(e) => handlePointerDown(e, table.id)}
                                className={`absolute cursor-move flex flex-col items-center justify-center transition-shadow group
                       ${selectedTableId === table.id ? 'ring-2 ring-blue-500 z-10 shadow-xl' : 'hover:ring-2 hover:ring-blue-300 z-0'}
                       ${table.shape === 'CIRCLE' || table.shape === 'BAR' ? 'rounded-full' : table.shape === 'BOOTH' ? 'rounded-2xl' : 'rounded-lg'}
                       ${table.shape === 'OBSTACLE' ? 'bg-slate-800 text-white rounded-sm' : table.shape === 'BAR' ? 'bg-amber-50 border-2 border-amber-300 text-amber-800' : table.shape === 'BOOTH' ? 'bg-indigo-50 border-2 border-indigo-300 text-indigo-800' : 'bg-white border-2 border-slate-300 text-slate-700'}
                    `}
                                style={{
                                    left: table.posX,
                                    top: table.posY,
                                    width: table.width,
                                    height: table.height,
                                    transform: `rotate(${table.rotation || 0}deg)`
                                }}
                            >
                                {table.shape !== 'OBSTACLE' && (
                                    <>
                                        {table.shape === 'BAR' ? (
                                            <Wine size={16} className="mb-0.5 opacity-40" />
                                        ) : (
                                            <Armchair size={16} className="mb-0.5 opacity-30" />
                                        )}
                                        <span className="text-[10px] font-black leading-tight pointer-events-none whitespace-nowrap overflow-hidden text-ellipsis max-w-[90%] text-center">
                                            {getTableLabel(table)}
                                        </span>
                                        <span className="text-[8px] text-slate-400 font-bold pointer-events-none">{table.capacity}p</span>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>

                </div>

                {/* Property Editor Panel (Right Side) */}
                {selectedTable && (
                    <div className="w-64 bg-white border-l border-slate-200 p-6 flex flex-col gap-6 animate-in slide-in-from-right duration-200">
                        <div>
                            <h3 className="font-bold text-slate-800 mb-1">Propiedades</h3>
                            <p className="text-xs text-slate-500">Editando {getTableLabel(selectedTable)}</p>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Nombre</label>
                                <input
                                    type="text"
                                    value={selectedTable.name ?? selectedTable.nombre ?? ''}
                                    onChange={e => updateTable(selectedTable.id, { name: e.target.value, nombre: e.target.value })}
                                    className="w-full p-2 bg-slate-50 border rounded-lg text-sm font-bold shadow-sm focus:border-blue-500 outline-none"
                                />
                            </div>

                            {selectedTable.shape !== 'OBSTACLE' && (
                                <div>
                                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Capacidad (Pax)</label>
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => updateTable(selectedTable.id, { capacity: Math.max(1, (selectedTable.capacity || 1) - 1) })} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold">-</button>
                                        <div className="flex-1 text-center font-bold text-lg">{selectedTable.capacity || 1}</div>
                                        <button onClick={() => updateTable(selectedTable.id, { capacity: (selectedTable.capacity || 1) + 1 })} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold">+</button>
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Ancho</label>
                                    <input
                                        type="number"
                                        step={GRID_SIZE}
                                        value={selectedTable.width}
                                        onChange={e => updateTable(selectedTable.id, { width: parseInt(e.target.value) })}
                                        className="w-full p-2 bg-slate-50 border rounded-lg text-sm font-bold shadow-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Alto</label>
                                    <input
                                        type="number"
                                        step={GRID_SIZE}
                                        value={selectedTable.height}
                                        onChange={e => updateTable(selectedTable.id, { height: parseInt(e.target.value) })}
                                        className="w-full p-2 bg-slate-50 border rounded-lg text-sm font-bold shadow-sm"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Rotación</label>
                                <input
                                    type="range"
                                    min="0"
                                    max="360"
                                    step="15"
                                    value={selectedTable.rotation}
                                    onChange={e => updateTable(selectedTable.id, { rotation: parseInt(e.target.value) })}
                                    className="w-full accent-blue-600"
                                />
                                <div className="text-center text-xs font-mono text-slate-500">{selectedTable.rotation}°</div>
                            </div>

                            {selectedTable.shape !== 'OBSTACLE' && (
                                <>
                                    <div>
                                        <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Consumo Mínimo Mesa</label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={selectedTable.consumo_minimo_mesa ?? 0}
                                            onChange={e => updateTable(selectedTable.id, { consumo_minimo_mesa: Math.max(0, parseFloat(e.target.value) || 0) })}
                                            className="w-full p-2 bg-slate-50 border rounded-lg text-sm font-bold shadow-sm"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Mínimo Comensales</label>
                                        <input
                                            type="number"
                                            min="1"
                                            step="1"
                                            value={selectedTable.comensales_minimos ?? 1}
                                            onChange={e => updateTable(selectedTable.id, { comensales_minimos: Math.max(1, parseInt(e.target.value) || 1) })}
                                            className="w-full p-2 bg-slate-50 border rounded-lg text-sm font-bold shadow-sm"
                                        />
                                    </div>
                                </>
                            )}

                        </div>

                        <div className="mt-auto pt-6 border-t">
                            <button
                                onClick={() => deleteTable(selectedTable.id)}
                                className="w-full py-3 bg-red-50 text-red-600 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-red-100 transition-colors"
                            >
                                <Trash2 size={16} /> Eliminar Elemento
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Room Settings Modal */}
            {showRoomSettings && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-96 animate-in zoom-in-95">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="font-bold text-lg text-slate-800">Configurar Sala</h3>
                            <button onClick={() => setShowRoomSettings(false)} className="text-slate-400 hover:text-slate-600">
                                <Plus size={24} className="rotate-45" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nombre</label>
                                <input
                                    type="text"
                                    value={currentRoom?.name ?? currentRoom?.nombre ?? ''}
                                    onChange={(e) => {
                                        if (currentRoom && onUpdateRoom) onUpdateRoom({ ...currentRoom, name: e.target.value, nombre: e.target.value });
                                    }}
                                    className="w-full p-3 bg-slate-50 border rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Capacidad Total</label>
                                    <input
                                        type="number"
                                        value={rooms.find(r => r.id === currentRoomId)?.capacidad_personas || ''}
                                        onChange={(e) => {
                                            const room = rooms.find(r => r.id === currentRoomId);
                                            if (room && onUpdateRoom) onUpdateRoom({ ...room, capacidad_personas: parseInt(e.target.value) || 0 });
                                        }}
                                        className="w-full p-3 bg-slate-50 border rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Consumo Mín.</label>
                                    <input
                                        type="number"
                                        value={rooms.find(r => r.id === currentRoomId)?.consumo_minimo || ''}
                                        onChange={(e) => {
                                            const room = rooms.find(r => r.id === currentRoomId);
                                            if (room && onUpdateRoom) onUpdateRoom({ ...room, consumo_minimo: parseFloat(e.target.value) || 0 });
                                        }}
                                        className="w-full p-3 bg-slate-50 border rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                            </div>

                            <button
                                onClick={() => {
                                    if (currentRoom && onUpdateRoom) {
                                        const normalizedName = (currentRoom.name ?? currentRoom.nombre ?? '').trim() || 'Sala';
                                        onUpdateRoom({ ...currentRoom, name: normalizedName, nombre: normalizedName });
                                    }
                                    setShowRoomSettings(false);
                                }}
                                className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl mt-4 hover:bg-blue-700"
                            >
                                Listo
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TableLayoutDesigner;
