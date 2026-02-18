
import { db } from '../utils/db';
import { Activity, ActivityNature, ActivityStatus } from '../types';
import { v4 as uuidv4 } from 'uuid';

class AgendaService {
    /**
     * Create a new activity
     */
    async createActivity(activity: Partial<Activity>): Promise<Activity> {
        const isBooking = activity.nature === 'BOOKING';

        // Generate Display ID (e.g., ACT-001 or BKG-001)
        const prefix = isBooking ? 'BKG' : 'ACT';
        const displayId = `${prefix}-${Date.now().toString().slice(-6)}`;

        const newActivity: Activity = {
            id: uuidv4(),
            displayId,
            nature: activity.nature || 'CRM',
            type: activity.type || 'MEETING',
            title: activity.title || 'Nueva Actividad',
            description: activity.description,
            status: 'PLANNED',
            priority: activity.priority || 'MEDIUM',
            startDate: activity.startDate || new Date().toISOString(),
            endDate: activity.endDate || new Date(Date.now() + 3600000).toISOString(),
            assignedToId: activity.assignedToId || 'sys',
            assignedToName: activity.assignedToName || 'System',
            terminalId: activity.terminalId || 'T1',
            customerId: activity.customerId,
            customerName: activity.customerName,
            spaceId: activity.spaceId,
            spaceName: activity.spaceName,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: activity.assignedToId || 'sys',
            ...activity
        } as Activity;

        await db.saveDocument('activities' as any, newActivity);
        return newActivity;
    }

    /**
     * Update an activity
     */
    async updateActivity(id: string, updates: Partial<Activity>): Promise<Activity> {
        const existing = await db.getDocument('activities' as any, id) as Activity;
        if (!existing) throw new Error('Actividad no encontrada');

        const updated = {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        await db.saveDocument('activities' as any, updated);
        return updated;
    }

    /**
     * Finalize an activity with outcome
     */
    async completeActivity(id: string, outcome: string): Promise<Activity> {
        return this.updateActivity(id, {
            status: 'COMPLETED',
            outcome
        });
    }

    /**
     * Get activities for a specific customer
     */
    async getCustomerActivities(customerId: string): Promise<Activity[]> {
        const all = await db.get('activities' as any) as Activity[] || [];
        return all.filter(a => a.customerId === customerId);
    }

    /**
     * Get activities for a timeframe
     */
    async getActivitiesByRange(start: string, end: string): Promise<Activity[]> {
        const all = await db.get('activities' as any) as Activity[] || [];
        const startTime = new Date(start).getTime();
        const endTime = new Date(end).getTime();

        return all.filter(a => {
            const aStart = new Date(a.startDate).getTime();
            return aStart >= startTime && aStart <= endTime;
        });
    }

    /**
     * Delete an activity
     */
    async deleteActivity(id: string): Promise<void> {
        await db.deleteDocument('activities' as any, id);
    }

    /**
     * Convert an activity to a Quote/Reservation
     */
    async convertToQuote(activity: Activity): Promise<{ type: 'RESERVATION' | 'PARKED', id: string }> {
        const isBooking = activity.nature === 'BOOKING';

        if (isBooking) {
            // Create a Reservation
            const reservation: any = {
                id: uuidv4(),
                code: `RES-${Date.now().toString().slice(-6)}`,
                qrPayload: `RES-${activity.id}`,
                customerId: activity.customerId || 'anon',
                customerName: activity.customerName || 'Cliente Genérico',
                total: 0,
                balancePaid: 0,
                expiryDate: new Date(Date.now() + 7 * 86400000).toISOString(), // 7 days default
                status: 'ACTIVE',
                items: [],
                warehouseId: 'wh_central',
                deliveryDate: activity.startDate,
                notes: `Convertido desde Agenda: ${activity.title}. ${activity.description || ''}`,
                terminalId: activity.terminalId || 'T1',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            await db.saveDocument('reservations' as any, reservation);

            // Mark activity as completed
            await this.completeActivity(activity.id, `Convertido a Reserva: ${reservation.code}`);

            return { type: 'RESERVATION', id: reservation.id };
        } else {
            // Create a Parked Ticket (Quote)
            const parked: any = {
                id: uuidv4(),
                name: `Coti: ${activity.title}`,
                items: [],
                total: 0,
                customerId: activity.customerId,
                customerName: activity.customerName,
                timestamp: new Date().toISOString()
            };
            await db.saveDocument('parkedTickets' as any, parked);

            // Mark activity as completed
            await this.completeActivity(activity.id, `Convertido a Cotización: ${parked.name}`);

            return { type: 'PARKED', id: parked.id };
        }
    }
}

export const agendaService = new AgendaService();
