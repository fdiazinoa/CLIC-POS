import React, { useState, useEffect, useMemo } from 'react';
import {
    Clock,
    Users,
    ChefHat,
    LayoutGrid,
    ListOrdered,
    AlertTriangle,
    CheckCircle2,
    Timer
} from 'lucide-react';

interface KDSItem {
    id: string;
    producto_id: string;
    nombre: string;
    cantidad: number;
    modificadores: string[] | null;
    estado_cocina: 'PENDIENTE' | 'EN_PREPARACION' | 'LISTO';
    hora_inicio_preparacion: string | null;
}

interface KDSOrder {
    id: string;
    displayId: string;
    date: string;
    userName: string;
    customerId: string;
    customerName: string;
    items: KDSItem[];
}

const KitchenDisplay: React.FC = () => {
    const [orders, setOrders] = useState<KDSOrder[]>([]);
    const [showSummary, setShowSummary] = useState(false);
    const [loading, setLoading] = useState(true);

    // Poll for updates every 5 seconds
    useEffect(() => {
        const fetchOrders = async () => {
            try {
                const response = await fetch('http://localhost:8001/api/cocina/ordenes-activas');
                if (response.ok) {
                    const data = await response.json();
                    setOrders(data);
                }
            } catch (error) {
                console.error("Error fetching KDS orders:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchOrders();
        const interval = setInterval(fetchOrders, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleUpdateStatus = async (id: string, newStatus: string, type: 'item' | 'order') => {
        try {
            await fetch('http://localhost:8001/api/cocina/cambiar-estado', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item_id: type === 'item' ? id : null,
                    orden_id: type === 'order' ? id : null,
                    nuevo_estado: newStatus
                })
            });
            // Immediate optimistic update or wait for next poll
        } catch (error) {
            console.error("Error updating KDS status:", error);
        }
    };

    // Production Summary Logic
    const productionSummary = useMemo(() => {
        const summary: Record<string, number> = {};
        orders.forEach(order => {
            order.items.forEach(item => {
                if (item.estado_cocina !== 'LISTO') {
                    summary[item.nombre] = (summary[item.nombre] || 0) + item.cantidad;
                }
            });
        });
        return Object.entries(summary).sort((a, b) => b[1] - a[1]);
    }, [orders]);

    if (loading && orders.length === 0) {
        return (
            <div className="h-screen w-full bg-gray-900 flex items-center justify-center text-gray-400">
                <ChefHat className="animate-bounce mr-4" size={48} />
                <span className="text-2xl font-bold">Cargando Cocina...</span>
            </div>
        );
    }

    return (
        <div className="h-screen w-full bg-gray-950 text-gray-100 flex flex-col overflow-hidden font-sans">

            {/* KDS Header */}
            <header className="bg-gray-900 border-b border-gray-800 p-4 flex items-center justify-between shadow-2xl z-10">
                <div className="flex items-center gap-4">
                    <div className="p-2 bg-blue-600 rounded-xl">
                        <ChefHat size={28} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black uppercase tracking-tighter">Kitchen Display System</h1>
                        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest leading-none">Real-time Production Hub</p>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <div className="hidden md:flex items-center gap-4 text-xs font-bold uppercase text-gray-500">
                        <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-emerald-500 rounded-full" /> Normal</div>
                        <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-amber-500 rounded-full" /> Alerta</div>
                        <div className="flex items-center gap-1.5"><div className="w-2 h-2 bg-red-500 rounded-full" /> Crítico</div>
                    </div>

                    <button
                        onClick={() => setShowSummary(!showSummary)}
                        className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-black text-sm transition-all shadow-lg ${showSummary ? 'bg-blue-600 text-white shadow-blue-500/20' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}
                    >
                        {showSummary ? <LayoutGrid size={18} /> : <ListOrdered size={18} />}
                        {showSummary ? 'Ver Tickets' : 'Ver Resumen'}
                    </button>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="flex-1 overflow-x-auto p-6 scroll-smooth">
                {showSummary ? (
                    /* 1. Production Summary View */
                    <div className="max-w-4xl mx-auto animate-in fade-in zoom-in-95 duration-300">
                        <div className="bg-gray-900 rounded-[2.5rem] border border-gray-800 shadow-2xl overflow-hidden mt-8">
                            <div className="p-8 border-b border-gray-800 flex items-center justify-between">
                                <h2 className="text-3xl font-black flex items-center gap-3">
                                    <ChefHat className="text-blue-500" /> Resumen de Producción
                                </h2>
                                <div className="px-4 py-2 bg-gray-800 rounded-full text-xs font-bold text-gray-400">
                                    Total Diferentes: {productionSummary.length}
                                </div>
                            </div>
                            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                {productionSummary.map(([name, qty]) => (
                                    <div key={name} className="flex items-center justify-between p-6 bg-gray-800/50 rounded-3xl border border-gray-700 hover:border-blue-500/50 transition-colors">
                                        <span className="text-xl font-bold text-gray-200">{name}</span>
                                        <span className="text-5xl font-black text-blue-500 leading-none">{qty}</span>
                                    </div>
                                ))}
                                {productionSummary.length === 0 && (
                                    <div className="col-span-full py-20 text-center text-gray-600 font-bold italic">
                                        No hay productos pendientes en cocina.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    /* 2. Ticket Grid View */
                    <div className="flex h-full gap-6">
                        {orders.map(order => (
                            <TicketCard
                                key={order.id}
                                order={order}
                                onStatusChange={handleUpdateStatus}
                            />
                        ))}
                        {orders.length === 0 && (
                            <div className="w-full flex flex-col items-center justify-center opacity-20">
                                <ChefHat size={120} strokeWidth={1} />
                                <p className="text-2xl font-black uppercase mt-4 tracking-tighter">Cocina Limpia</p>
                            </div>
                        )}
                    </div>
                )}
            </main>

        </div>
    );
};

const TicketCard: React.FC<{
    order: KDSOrder,
    onStatusChange: (id: string, s: string, t: 'item' | 'order') => void
}> = ({ order, onStatusChange }) => {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        const start = new Date(order.date).getTime();
        const update = () => {
            setElapsed(Math.floor((Date.now() - start) / 60000));
        };
        update();
        const interval = setInterval(update, 30000);
        return () => clearInterval(interval);
    }, [order.date]);

    // Aging Logic
    const getSeverity = () => {
        if (elapsed >= 20) return 'critical';
        if (elapsed >= 10) return 'warning';
        return 'normal';
    };

    const severity = getSeverity();
    const severityColors = {
        normal: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
        warning: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
        critical: 'border-red-500 bg-red-500/10 text-white animate-pulse-slow'
    };

    return (
        <div className={`w-80 h-full flex flex-col bg-gray-900 rounded-[2rem] border-2 shadow-2xl transition-all duration-500 ${severityColors[severity].split(' ')[0]}`}>

            {/* Card Header */}
            <div className={`p-4 rounded-t-[1.8rem] flex flex-col gap-2 ${severityColors[severity]}`}>
                <div className="flex items-center justify-between">
                    <span className="text-2xl font-black tracking-tighter"># Mesa ??</span>
                    <div className="flex items-center gap-1.5 text-xs font-black bg-black/20 px-3 py-1 rounded-full">
                        <Timer size={12} /> {elapsed} min
                    </div>
                </div>
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest opacity-80">
                    <span className="flex items-center gap-1"><Users size={10} /> {order.userName}</span>
                    <span>ID: {order.displayId || order.id.slice(-4)}</span>
                </div>
            </div>

            {/* Items List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {order.items.map((item) => (
                    <div
                        key={item.id}
                        onClick={() => onStatusChange(item.id, item.estado_cocina === 'LISTO' ? 'PENDIENTE' : 'LISTO', 'item')}
                        className={`cursor-pointer transition-all ${item.estado_cocina === 'LISTO' ? 'opacity-30 grayscale line-through' : ''}`}
                    >
                        <div className="flex items-start gap-3">
                            <span className="text-2xl font-black text-blue-500 leading-tight">{item.cantidad}x</span>
                            <div className="flex-1">
                                <p className="text-xl font-bold leading-tight text-gray-200">{item.nombre}</p>
                                {item.modificadores && item.modificadores.length > 0 && (
                                    <ul className="mt-1 space-y-0.5">
                                        {item.modificadores.map((mod, i) => (
                                            <li key={i} className="text-red-300 text-sm font-bold uppercase flex items-center gap-1">
                                                <span className="text-xs">↳</span> {mod}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Card Footer */}
            <div className="p-4 bg-gray-800/50 rounded-b-[1.8rem]">
                <button
                    onClick={() => onStatusChange(order.id, 'LISTO', 'order')}
                    className="w-full py-4 bg-gray-100 text-gray-900 rounded-2xl font-black text-lg hover:bg-white active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-xl"
                >
                    <CheckCircle2 size={24} /> MARCHAR / LISTO
                </button>
            </div>

            <style>{`
        .animate-pulse-slow {
          animation: pulse-slow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @keyframes pulse-slow {
          50% { opacity: .8; border-color: rgb(239 68 68); }
        }
      `}</style>
        </div>
    );
};

export default KitchenDisplay;
