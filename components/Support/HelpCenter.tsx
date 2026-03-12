import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../utils/supabase'; // Ajuste de ruta

// Asegurarse de que el helper supabase pueda apuntar a landlord
const landlordDb = supabase.schema ? supabase.schema('landlord') : supabase;

// Interfaces basadas en la base de datos
interface TechnicalContext {
    terminal_id?: string;
    store_id?: string;
    app_version: string;
    battery_level?: string;
    network_type: string;
    last_5_errors: string[];
}

interface SupportTicketPayload {
    tenant_id: string; // En el mundo real esto vendría del contexto/auth
    category: string;
    priority: string;
    subject: string;
    technical_context: TechnicalContext;
    status: string;
}

const HelpCenter: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Estado del Formulario
    const [category, setCategory] = useState('Otros');
    const [priority, setPriority] = useState('Media');
    const [subject, setSubject] = useState('');

    // Estado para un "mock" del historial rápido o chat
    const [showChat, setShowChat] = useState(false);
    const [messages, setMessages] = useState<any[]>([]);
    const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
    const [replyText, setReplyText] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        if (showChat) {
            scrollToBottom();
        }
    }, [messages, showChat]);

    // Realtime Subscription
    useEffect(() => {
        if (!activeTicketId) return;

        const tenantId = localStorage.getItem('clic_tenant_id');
        if (!tenantId) return;

        console.log(`📡 Suscribiendo a ticket_messages para el ticket ${activeTicketId}...`);

        // Fetch initially
        landlordDb.from('ticket_messages')
            .select('*')
            .eq('ticket_id', activeTicketId)
            .order('created_at', { ascending: true })
            .then(({ data, error }) => {
                if (!error && data) {
                    setMessages(data);
                }
            });

        const channel = supabase.channel(`ticket_updates_${activeTicketId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'landlord',
                table: 'ticket_messages',
                filter: `ticket_id=eq.${activeTicketId}`
            }, (payload) => {
                console.log('Mensaje recibido en tiempo real:', payload);
                setMessages(prev => [...prev, payload.new]);
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [activeTicketId]);

    const toggleHelpCenter = () => setIsOpen(!isOpen);

    // Función de Auto-Diagnóstico
    const gatherTechnicalContext = async (): Promise<TechnicalContext> => {
        let batteryLevel = 'N/A';

        // Intenta obtener nivel de batería si el navegador lo soporta
        if ('getBattery' in navigator) {
            try {
                const battery: any = await (navigator as any).getBattery();
                batteryLevel = `${Math.round(battery.level * 100)}%${battery.charging ? ' (Charging)' : ''}`;
            } catch (e) {
                console.warn('Battery API not supported or error', e);
            }
        }

        const networkType = navigator.onLine ?
            ((navigator as any).connection?.effectiveType || 'Online/Unknown') : 'Offline';

        return {
            app_version: '1.2.4-clic-pos', // Mock
            battery_level: batteryLevel,
            network_type: networkType,
            // Aquí idealmente leeríamos de un store global de errores:
            last_5_errors: ['Network timeout at /api/sync', 'Failed to print receipt #432']
        };
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            const techContext = await gatherTechnicalContext();

            const tenantId = localStorage.getItem('clic_tenant_id') || 'UNKNOWN_TENANT';

            const payload = {
                tenant_id: tenantId,
                category,
                priority,
                subject,
                status: 'Abierto',
                technical_context: techContext
            };

            const { data, error } = await landlordDb.from('support_tickets').insert([payload]).select().single();

            if (error) throw error;

            const ticketId = data.id;

            // Insert initial message
            await landlordDb.from('ticket_messages').insert([{
                ticket_id: ticketId,
                sender_type: 'Client',
                message: subject
            }]);

            // Sistema contesta automático (simulado asíncrono para dar feeling)
            setTimeout(() => {
                landlordDb.from('ticket_messages').insert([{
                    ticket_id: ticketId,
                    sender_type: 'System',
                    message: `Diagnóstico automático capturado y adjuntado. Versión local: ${techContext.app_version}. Batería: ${techContext.battery_level}. Red: ${techContext.network_type}.`
                }]).then(({ error }) => {
                    if (error) console.error(error);
                });
            }, 1000);

            // Reset formulario
            setSubject('');
            setActiveTicketId(ticketId);
            setShowChat(true); // Cambiar a la vista de chat al enviar

        } catch (error) {
            console.error('Error enviando ticket:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            {/* Botón Flotante */}
            <button
                onClick={toggleHelpCenter}
                className="fixed bottom-6 right-6 z-50 p-4 rounded-full shadow-2xl bg-gradient-to-r from-blue-600 to-indigo-700 text-white hover:scale-105 transition-transform duration-300 ring-4 ring-blue-200 ring-opacity-50"
                aria-label="Abrir Centro de Soporte"
            >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
            </button>

            {/* Panel Flotante "Glassmorphism" */}
            {isOpen && (
                <div className="fixed bottom-24 right-6 z-50 w-[400px] bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl rounded-2xl overflow-hidden flex flex-col h-[550px] shadow-[0_8px_32px_0_rgba(31,38,135,0.37)]">
                    {/* Header */}
                    <div className="bg-gradient-to-r from-blue-600/90 to-indigo-700/90 p-4 text-white flex justify-between items-center shrink-0">
                        <div>
                            <h3 className="font-bold text-lg tracking-wide">Centro de Soporte</h3>
                            <p className="text-blue-100 text-xs mt-0.5">Asistencia técnica proactiva</p>
                        </div>
                        <button onClick={toggleHelpCenter} className="text-white/80 hover:text-white transition-colors">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-y-auto p-5 bg-white backdrop-blur-md relative">
                        {!showChat ? (
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-100 mb-4 text-sm text-blue-800 flex items-start gap-3">
                                    <span className="text-xl">🤖</span>
                                    <p>Al crear un ticket, <strong>adjuntaremos un diagnóstico automático</strong> (Batería, Red, Logs) para agilizar la solución.</p>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1">Categoría del Problema</label>
                                    <select
                                        value={category} onChange={e => setCategory(e.target.value)}
                                        className="w-full bg-white/50 border border-slate-200 rounded-lg p-2.5 text-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-shadow"
                                    >
                                        <option value="Ventas">Problema con Ventas / Tramos</option>
                                        <option value="Inventario">Sincronización de Inventario</option>
                                        <option value="Fiscal">Impresión Fiscal / Comprobantes</option>
                                        <option value="Hardware">Hardware (Gaveta, Lector, Balanza)</option>
                                        <option value="Pagos">Terminal de Pagos (Azul, Cardnet)</option>
                                        <option value="Otros">Otro</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1">Prioridad (Nivel de impacto)</label>
                                    <div className="flex gap-2">
                                        {['Baja', 'Media', 'Alta', 'Critica'].map(level => (
                                            <button
                                                key={level}
                                                type="button"
                                                onClick={() => setPriority(level)}
                                                className={`flex-1 py-1.5 text-xs font-medium rounded-md border transition-all ${priority === level
                                                    ? (level === 'Critica' ? 'bg-red-100 border-red-500 text-red-700 ring-1 ring-red-500' : 'bg-blue-100 border-blue-500 text-blue-700 ring-1 ring-blue-500')
                                                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                                                    }`}
                                            >
                                                {level}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1">Describe el problema</label>
                                    <textarea
                                        required
                                        value={subject} onChange={e => setSubject(e.target.value)}
                                        rows={4}
                                        placeholder="Ej. No me cuadra el cierre de caja de la terminal 2..."
                                        className="w-full bg-white/50 border border-slate-200 rounded-lg p-3 text-sm text-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-shadow resize-none"
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={isSubmitting || !subject.trim()}
                                    className="w-full mt-6 bg-slate-900 text-white font-medium py-3 rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2 shadow-lg shadow-slate-200"
                                >
                                    {isSubmitting ? (
                                        <><svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Diagnosticando y Enviando...</>
                                    ) : 'Crear Ticket de Soporte'}
                                </button>
                            </form>
                        ) : (
                            <div className="flex flex-col h-full">
                                <div className="flex-1 overflow-y-auto space-y-4 pb-20">
                                    <div className="text-center text-xs text-slate-400 font-medium mb-4">Ticket #{activeTicketId?.split('-')[0]} Creado</div>

                                    {messages.map((msg, index) => {
                                        if (msg.sender_type === 'System') {
                                            return (
                                                <div key={index} className="flex justify-start">
                                                    <div className="bg-blue-50 border border-blue-100 text-slate-700 text-sm py-2 px-3 rounded-2xl rounded-tl-sm max-w-[85%]">
                                                        <p className="flex items-center gap-1.5 font-medium text-blue-800 mb-1">
                                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                            Sistema Automatizado
                                                        </p>
                                                        <p className="text-xs text-slate-600">{msg.message}</p>
                                                    </div>
                                                </div>
                                            );
                                        }

                                        if (msg.sender_type === 'Client') {
                                            return (
                                                <div key={index} className="flex justify-end">
                                                    <div className="bg-slate-900 text-white text-sm py-2 px-3 rounded-2xl rounded-tr-sm max-w-[85%] shadow-sm">
                                                        <p>{msg.message}</p>
                                                        <span className="text-[10px] text-slate-400 block mt-1 text-right">Tú</span>
                                                    </div>
                                                </div>
                                            );
                                        }

                                        return (
                                            <div key={index} className="flex justify-start">
                                                <div className="bg-emerald-50 border border-emerald-100 text-slate-700 text-sm flex gap-2 py-2 px-3 rounded-2xl rounded-tl-sm max-w-[85%] shadow-sm">
                                                    <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center border-2 border-white shadow-sm overflow-hidden shrink-0"><span className="text-[10px] font-bold">CA</span></div>
                                                    <div>
                                                        <p>{msg.message}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    <div ref={messagesEndRef} />

                                </div>

                                {/* Chat Input Area */}
                                <div className="absolute bottom-0 left-0 right-0 p-3 bg-white border-t border-slate-100 flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="Escribe un mensaje..."
                                        className="flex-1 bg-slate-50 border-0 rounded-full px-4 text-sm focus:ring-0 focus:outline-none"
                                        value={replyText}
                                        onChange={(e) => setReplyText(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && replyText.trim() && activeTicketId) {
                                                const txt = replyText.trim();
                                                setReplyText('');
                                                landlordDb.from('ticket_messages').insert([{
                                                    ticket_id: activeTicketId,
                                                    sender_type: 'Client',
                                                    message: txt
                                                }]).then(({ error }) => {
                                                    if (error) console.error(error);
                                                });
                                            }
                                        }}
                                    />
                                    <button
                                        className="p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors shrink-0 shadow-md shadow-blue-200"
                                        onClick={() => {
                                            if (replyText.trim() && activeTicketId) {
                                                const txt = replyText.trim();
                                                setReplyText('');
                                                landlordDb.from('ticket_messages').insert([{
                                                    ticket_id: activeTicketId,
                                                    sender_type: 'Client',
                                                    message: txt
                                                }]).then(({ error }) => {
                                                    if (error) console.error(error);
                                                });
                                            }
                                        }}
                                    >
                                        <svg className="w-4 h-4 translate-x-[1px] translate-y-[-1px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

export default HelpCenter;
