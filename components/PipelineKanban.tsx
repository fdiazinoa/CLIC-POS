import React, { useMemo, useState } from 'react';
import { CalendarDays, DollarSign, Plus, User, X } from 'lucide-react';
import { Customer, Opportunity, OpportunityStage, User as UserType } from '../types';

const STAGES: Array<{ id: OpportunityStage; label: string; hint: string; color: string }> = [
  { id: 'NEW', label: 'Nuevo', hint: 'Entrada comercial', color: 'bg-slate-100 text-slate-700 border-slate-200' },
  { id: 'CONTACTED', label: 'Contactado', hint: 'Seguimiento activo', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  { id: 'QUOTED', label: 'Cotizado', hint: 'Documento enviado', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  { id: 'WON', label: 'Ganado', hint: 'Cierre confirmado', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  { id: 'LOST', label: 'Perdido', hint: 'No convertido', color: 'bg-rose-100 text-rose-700 border-rose-200' }
];

const DEFAULT_PROBABILITY: Record<OpportunityStage, number> = {
  NEW: 10,
  CONTACTED: 30,
  QUOTED: 60,
  WON: 100,
  LOST: 0
};

interface PipelineKanbanProps {
  opportunities: Opportunity[];
  customers: Customer[];
  users: UserType[];
  activityCounts?: Record<string, number>;
  onCreateOpportunity: (opportunity: Partial<Opportunity>) => Promise<void>;
  onUpdateOpportunity: (id: string, updates: Partial<Opportunity>) => Promise<void>;
}

const PipelineKanban: React.FC<PipelineKanbanProps> = ({
  opportunities,
  customers,
  users,
  activityCounts = {},
  onCreateOpportunity,
  onUpdateOpportunity
}) => {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<Partial<Opportunity>>({
    title: '',
    stage: 'NEW',
    amount: 0,
    probability: 10,
    expected_close_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
  });

  const totalsByStage = useMemo(() => {
    return STAGES.reduce<Record<OpportunityStage, { count: number; amount: number }>>((acc, stage) => {
      const items = opportunities.filter(o => o.stage === stage.id);
      acc[stage.id] = {
        count: items.length,
        amount: items.reduce((sum, item) => sum + Number(item.amount || 0), 0)
      };
      return acc;
    }, {} as Record<OpportunityStage, { count: number; amount: number }>);
  }, [opportunities]);

  const handleDrop = async (stage: OpportunityStage) => {
    if (!draggedId) return;
    const opportunity = opportunities.find(o => o.id === draggedId);
    setDraggedId(null);
    if (!opportunity || opportunity.stage === stage) return;
    await onUpdateOpportunity(opportunity.id, {
      stage,
      probability: DEFAULT_PROBABILITY[stage]
    });
  };

  const handleCreate = async () => {
    if (!form.title?.trim()) return;
    setIsSaving(true);
    try {
      const customer = customers.find(c => c.id === form.customerId || c.id === form.customer_id);
      const user = users.find(u => u.id === form.assignedUserId || u.id === form.assigned_user_id);
      const stage = form.stage || 'NEW';
      await onCreateOpportunity({
        ...form,
        title: form.title.trim(),
        customer_id: customer?.id,
        customerId: customer?.id,
        customer_name: customer?.name,
        customerName: customer?.name,
        assigned_user_id: user?.id,
        assignedUserId: user?.id,
        assigned_user_name: user?.name,
        assignedUserName: user?.name,
        stage,
        probability: Number(form.probability ?? DEFAULT_PROBABILITY[stage]),
        amount: Number(form.amount || 0)
      });
      setShowCreate(false);
      setForm({
        title: '',
        stage: 'NEW',
        amount: 0,
        probability: 10,
        expected_close_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 rounded-[2.5rem] border border-white shadow-2xl shadow-slate-200/60 overflow-hidden">
      <header className="px-8 py-6 bg-white/90 border-b border-slate-100 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-500">CRM & Ventas</p>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">Pipeline Comercial</h2>
          <p className="text-xs font-bold text-slate-400 mt-1">Oportunidades, reservas y seguimiento comercial en una sola vista.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-5 py-3 rounded-2xl bg-blue-600 text-white text-xs font-black uppercase tracking-widest shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2"
        >
          <Plus size={16} strokeWidth={3} /> Nueva Oportunidad
        </button>
      </header>

      <div className="flex-1 overflow-x-auto p-6">
        <div className="grid grid-cols-5 gap-5 min-w-[1280px] h-full">
          {STAGES.map(stage => {
            const stageItems = opportunities.filter(o => o.stage === stage.id);
            const totals = totalsByStage[stage.id];
            return (
              <section
                key={stage.id}
                onDragOver={event => event.preventDefault()}
                onDrop={() => handleDrop(stage.id)}
                className="rounded-[2rem] bg-white/80 border border-white shadow-sm flex flex-col min-h-0"
              >
                <div className="p-5 border-b border-slate-100">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`px-3 py-1 rounded-full border text-[10px] font-black uppercase tracking-widest ${stage.color}`}>{stage.label}</span>
                    <span className="text-xs font-black text-slate-400">{totals?.count || 0}</span>
                  </div>
                  <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-widest">{stage.hint}</p>
                  <p className="text-lg font-black text-slate-900 mt-3">RD${Number(totals?.amount || 0).toLocaleString()}</p>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                  {stageItems.map(opportunity => (
                    <article
                      key={opportunity.id}
                      draggable
                      onDragStart={() => setDraggedId(opportunity.id)}
                      onDragEnd={() => setDraggedId(null)}
                      className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-black text-slate-900 leading-tight">{opportunity.title}</h3>
                        <span className="text-[10px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded-lg">{Number(opportunity.probability || 0)}%</span>
                      </div>
                      <div className="mt-4 space-y-2">
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                          <User size={13} />
                          <span className="truncate">{opportunity.customer_name || opportunity.customerName || 'Prospecto sin cliente'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                          <DollarSign size={13} />
                          <span>RD${Number(opportunity.amount || 0).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                          <CalendarDays size={13} />
                          <span>{opportunity.expected_close_date || opportunity.expectedCloseDate || 'Sin fecha'}</span>
                        </div>
                      </div>
                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{activityCounts[opportunity.id] || 0} actividades</span>
                        <span className="text-[10px] font-bold text-slate-300">{opportunity.assigned_user_name || opportunity.assignedUserName || 'Sin responsable'}</span>
                      </div>
                    </article>
                  ))}
                  {stageItems.length === 0 && (
                    <div className="h-32 rounded-2xl border-2 border-dashed border-slate-100 flex items-center justify-center text-center p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">Arrastra oportunidades aquí</p>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-[70] bg-slate-950/40 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-[2rem] bg-white p-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between mb-6">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-500">Nuevo trato</p>
                <h3 className="text-2xl font-black text-slate-900">Crear Oportunidad</h3>
              </div>
              <button onClick={() => setShowCreate(false)} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400"><X size={20} /></button>
            </div>

            <div className="space-y-4">
              <input
                value={form.title || ''}
                onChange={event => setForm(prev => ({ ...prev, title: event.target.value }))}
                placeholder="Ej: Boda Familia Pérez"
                className="w-full rounded-2xl bg-slate-50 px-5 py-4 text-sm font-black text-slate-900 outline-none focus:ring-2 focus:ring-blue-200"
              />
              <div className="grid grid-cols-2 gap-4">
                <select
                  value={form.customer_id || form.customerId || ''}
                  onChange={event => setForm(prev => ({ ...prev, customer_id: event.target.value, customerId: event.target.value }))}
                  className="rounded-2xl bg-slate-50 px-5 py-4 text-sm font-bold text-slate-700 outline-none"
                >
                  <option value="">Prospecto sin cliente</option>
                  {customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                </select>
                <select
                  value={form.assigned_user_id || form.assignedUserId || ''}
                  onChange={event => setForm(prev => ({ ...prev, assigned_user_id: event.target.value, assignedUserId: event.target.value }))}
                  className="rounded-2xl bg-slate-50 px-5 py-4 text-sm font-bold text-slate-700 outline-none"
                >
                  <option value="">Sin responsable</option>
                  {users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <input
                  type="number"
                  value={form.amount || ''}
                  onChange={event => setForm(prev => ({ ...prev, amount: Number(event.target.value) }))}
                  placeholder="Monto"
                  className="rounded-2xl bg-slate-50 px-5 py-4 text-sm font-black text-slate-900 outline-none"
                />
                <input
                  type="number"
                  value={form.probability ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, probability: Number(event.target.value) }))}
                  placeholder="Prob. %"
                  className="rounded-2xl bg-slate-50 px-5 py-4 text-sm font-black text-slate-900 outline-none"
                />
                <input
                  type="date"
                  value={(form.expected_close_date || form.expectedCloseDate || '').slice(0, 10)}
                  onChange={event => setForm(prev => ({ ...prev, expected_close_date: event.target.value, expectedCloseDate: event.target.value }))}
                  className="rounded-2xl bg-slate-50 px-5 py-4 text-sm font-black text-slate-900 outline-none"
                />
              </div>
              <textarea
                value={form.notes || ''}
                onChange={event => setForm(prev => ({ ...prev, notes: event.target.value }))}
                placeholder="Notas comerciales..."
                className="w-full rounded-2xl bg-slate-50 px-5 py-4 text-sm font-bold text-slate-700 outline-none resize-none"
                rows={3}
              />
              <button
                onClick={handleCreate}
                disabled={isSaving || !form.title?.trim()}
                className="w-full rounded-2xl bg-blue-600 py-4 text-xs font-black uppercase tracking-widest text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Crear Oportunidad
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PipelineKanban;
