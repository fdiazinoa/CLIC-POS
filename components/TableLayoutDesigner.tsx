import React, { useState, useRef, useEffect, MouseEvent } from 'react';
import {
    Square, Circle, Move, Save, Trash2, Plus,
    Layout, Grid, Armchair, Ban, Settings
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
    const [isDragging, setIsDragging] = useState(false);
    const [showRoomSettings, setShowRoomSettings] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });
    const canvasRef = useRef<HTMLDivElement>(null);

    // Snap to Grid function
    const snapToGrid = (val: number) => Math.round(val / GRID_SIZE) * GRID_SIZE;

    // Add new table
    const handleAddTable = (shape: TableShape) => {
        const newTable: Table = {
            id: crypto.randomUUID(),
            roomId: currentRoomId,
            name: `Mesa ${tables.filter(t => t.roomId === currentRoomId).length + 1}`,
            nombre: `Mesa ${tables.filter(t => t.roomId === currentRoomId).length + 1}`,
            posX: 100 + (tables.length * 10), // Offset slightly to see new ones
            posY: 100 + (tables.length * 10),
            width: shape === 'OBSTACLE' ? 100 : 80,
            height: shape === 'OBSTACLE' ? 20 : 80,
            shape,
            rotation: 0,
            capacity: 4
        };
        // Dedup: Ensure we don't just append if something weird happens, but this is a new ID.
        // The issue 'ghost tables' might be re-renders or hydration issues.
        onUpdateTables([...tables, newTable]);
        setSelectedTableId(newTable.id);
    };

    // Dragging Logic
    const handleMouseDown = (e: MouseEvent, tableId: string) => {
        e.stopPropagation();
        const table = tables.find(t => t.id === tableId);
        if (!table) return;

        setSelectedTableId(tableId);
        setIsDragging(true);

        // Calculate offset relative to the table's top-left
        // e.clientX is global, we need table pos relative to canvas
        // Actually easier: just track the diff between mouse and table corner
        // But table.posX is relative to canvas.
        // Let's rely on movementX/Y or simple start/current delta

        // Better:
        // startX, startY = mouse global
        // initialTableX, initialTableY = table pos

        // We'll attach global window listeners for drag to avoid losing focus
    };

    // Update Table Prop
    const updateTable = (id: string, updates: Partial<Table>) => {
        onUpdateTables(tables.map(t => t.id === id ? { ...t, ...updates } : t));
    };

    const deleteTable = (id: string) => {
        onUpdateTables(tables.filter(t => t.id !== id));
        setSelectedTableId(null);
    };

    // Custom Drag Hook equivalent inside the component
    useEffect(() => {
        const handleGlobalMouseMove = (e: globalThis.MouseEvent) => {
            if (!isDragging || !selectedTableId || !canvasRef.current) return;

            const canvasRect = canvasRef.current.getBoundingClientRect();
            const relativeX = e.clientX - canvasRect.left;
            const relativeY = e.clientY - canvasRect.top;

            // Center the table on the mouse cursor roughly (or use offset if we stored it)
            // Simpler: Just snap the center or top-left to mouse
            // Let's snap top-left for now but allow refinement

            let newX = snapToGrid(relativeX - 40); // 40 is half width roughly
            let newY = snapToGrid(relativeY - 40);

            // Boundaries
            if (newX < 0) newX = 0;
            if (newY < 0) newY = 0;
            if (newX > CANVAS_WIDTH - 40) newX = CANVAS_WIDTH - 40;
            if (newY > CANVAS_HEIGHT - 40) newY = CANVAS_HEIGHT - 40;

            updateTable(selectedTableId, { posX: newX, posY: newY });
        };

        const handleGlobalMouseUp = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            window.addEventListener('mousemove', handleGlobalMouseMove);
            window.addEventListener('mouseup', handleGlobalMouseUp);
        }

        return () => {
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [isDragging, selectedTableId]);

    const selectedTable = tables.find(t => t.id === selectedTableId);

    return (
        <div className="flex flex-col h-full bg-slate-50 rounded-xl overflow-hidden shadow-xl border border-slate-200">
            {/* Toolbar */}
            <div className="bg-white p-4 border-b flex justify-between items-center shrink-0">
                <div className="flex items-center gap-4">
                    <h2 className="font-black text-slate-800 flex items-center gap-2"><Layout size={20} /> Diseñador de Sala</h2>

                    <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
                        {rooms.map(room => (
                            <button
                                key={room.id}
                                onClick={() => onChangeRoom(room.id)}
                                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${currentRoomId === room.id ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                {room.name}
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
                    <div className="w-px h-8 bg-slate-200 mx-2"></div>
                    <button onClick={() => onSave(tables)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-lg shadow-blue-200">
                        <Save size={16} /> Guardar Distribución
                    </button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Canvas Area */}
                <div className="flex-1 bg-slate-200/50 p-8 overflow-auto flex items-center justify-center relative">

                    <div
                        ref={canvasRef}
                        className="bg-white shadow-2xl relative select-none overflow-hidden"
                        style={{
                            width: CANVAS_WIDTH,
                            height: CANVAS_HEIGHT,
                            backgroundImage: 'radial-gradient(circle, #cbd5e1 1px, transparent 1px)',
                            backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`
                        }}
                    >
                        {/* Grid Watermark */}
                        <div className="absolute top-2 right-2 flex items-center gap-1 text-[10px] text-slate-300 font-mono pointer-events-none">
                            <Grid size={12} /> SNAP: {GRID_SIZE}px
                        </div>

                        {tables.filter(t => t.roomId === currentRoomId).map(table => (
                            <div
                                key={table.id}
                                onMouseDown={(e) => handleMouseDown(e, table.id)}
                                className={`absolute cursor-move flex flex-col items-center justify-center transition-shadow group
                       ${selectedTableId === table.id ? 'ring-2 ring-blue-500 z-10 shadow-xl' : 'hover:ring-2 hover:ring-blue-300 z-0'}
                       ${table.shape === 'CIRCLE' ? 'rounded-full' : 'rounded-lg'}
                       ${table.shape === 'OBSTACLE' ? 'bg-slate-800 text-white rounded-sm' : 'bg-white border-2 border-slate-300 text-slate-700'}
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
                                        <Armchair size={16} className="mb-0.5 opacity-30" />
                                        <span className="text-[10px] font-black leading-tight pointer-events-none whitespace-nowrap overflow-hidden text-ellipsis max-w-[90%] text-center">
                                            {table.name}
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
                            <p className="text-xs text-slate-500">Editando {selectedTable.name}</p>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Nombre</label>
                                <input
                                    type="text"
                                    value={selectedTable.name}
                                    onChange={e => updateTable(selectedTable.id, { name: e.target.value })}
                                    className="w-full p-2 bg-slate-50 border rounded-lg text-sm font-bold shadow-sm focus:border-blue-500 outline-none"
                                />
                            </div>

                            {selectedTable.shape !== 'OBSTACLE' && (
                                <div>
                                    <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Capacidad (Pax)</label>
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => updateTable(selectedTable.id, { capacity: Math.max(1, (selectedTable.capacity || 2) - 1) })} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold">-</button>
                                        <div className="flex-1 text-center font-bold text-lg">{selectedTable.capacity}</div>
                                        <button onClick={() => updateTable(selectedTable.id, { capacity: (selectedTable.capacity || 2) + 1 })} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold">+</button>
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
                                    value={rooms.find(r => r.id === currentRoomId)?.name || ''}
                                    onChange={(e) => {
                                        const room = rooms.find(r => r.id === currentRoomId);
                                        if (room && onUpdateRoom) onUpdateRoom({ ...room, name: e.target.value });
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
                                onClick={() => setShowRoomSettings(false)}
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
