import { db } from '../utils/db';
import { Activity, ActivityNature, ActivityStatus, ServiceType } from '../types';
import { v4 as uuidv4 } from 'uuid';

class AgendaService {
    /**
     * Get all service types
     */
    async getServiceTypes(): Promise<ServiceType[]> {
        const types = await db.get('serviceTypes' as any) as ServiceType[] || [];
        if (types.length === 0) {
            return this.seedServiceTypes();
        }
        return types;
    }

    /**
     * Save a service type (create or update)
     */
    async saveServiceType(type: ServiceType): Promise<ServiceType> {
        await db.saveDocument('serviceTypes' as any, type);
        return type;
    }

    /**
     * Save multiple service types (useful for reordering)
     */
    async saveServiceTypes(types: ServiceType[]): Promise<void> {
        await db.save('serviceTypes' as any, types);
    }

    /**
     * Delete a service type
     */
    async deleteServiceType(id: string): Promise<void> {
        await db.deleteDocument('serviceTypes' as any, id);
    }

    /**
     * Seed initial service types
     */
    private async seedServiceTypes(): Promise<ServiceType[]> {
        const initialTypes: ServiceType[] = [
            // CRM
            { id: uuidv4(), name: 'MEETING', label: 'Reunión', nature: 'CRM', color: '#4f46e5', isActive: true },
            { id: uuidv4(), name: 'CALL', label: 'Llamada', nature: 'CRM', color: '#0ea5e9', isActive: true },
            { id: uuidv4(), name: 'EMAIL', label: 'Email', nature: 'CRM', color: '#8b5cf6', isActive: true },
            { id: uuidv4(), name: 'VISIT', label: 'Visita', nature: 'CRM', color: '#f59e0b', isActive: true },
            { id: uuidv4(), name: 'TECHNICAL', label: 'Técnico', nature: 'CRM', color: '#10b981', isActive: true },
            { id: uuidv4(), name: 'LUNCH', label: 'Almuerzo', nature: 'CRM', color: '#f97316', isActive: true },
            { id: uuidv4(), name: 'OTHER', label: 'Otro', nature: 'CRM', color: '#6b7280', isActive: true },
            // BOOKING
            { id: uuidv4(), name: 'SPACE_RENTAL', label: 'Alquiler Espacio', nature: 'BOOKING', color: '#10b981', isActive: true },
            { id: uuidv4(), name: 'WEDDING', label: 'Boda', nature: 'BOOKING', color: '#ec4899', isActive: true },
            { id: uuidv4(), name: 'CONFERENCE', label: 'Conferencia', nature: 'BOOKING', color: '#6366f1', isActive: true },
            { id: uuidv4(), name: 'OTHER', label: 'Otro', nature: 'BOOKING', color: '#94a3b8', isActive: true },
        ];

        await db.save('serviceTypes' as any, initialTypes);
        return initialTypes;
    }

    /**
     * Check if a space is available for a given timeframe
     */
    async checkAvailability(spaceId: string, start: string, end: string, excludeActivityId?: string): Promise<{ available: boolean, conflict?: Activity }> {
        const all = await db.get('activities' as any) as Activity[] || [];
        const startTime = new Date(start).getTime();
        const endTime = new Date(end).getTime();

        const conflict = all.find(a => {
            if (a.id === excludeActivityId) return false;
            if (a.nature !== 'BOOKING' || a.spaceId !== spaceId) return false;
            if (a.status === 'CANCELLED') return false;

            const aStart = new Date(a.startDate).getTime();
            const aEnd = new Date(a.endDate).getTime();

            // Check for overlap
            return (startTime < aEnd && endTime > aStart);
        });

        return {
            available: !conflict,
            conflict
        };
    }

    /**
     * Create a new activity
     */
    async createActivity(activity: Partial<Activity>): Promise<Activity> {
        const isBooking = activity.nature === 'BOOKING';

        // 1. Availability Check for Booking
        if (isBooking && activity.spaceId) {
            const availability = await this.checkAvailability(
                activity.spaceId,
                activity.startDate || new Date().toISOString(),
                activity.endDate || new Date(Date.now() + 3600000).toISOString()
            );
            if (!availability.available) {
                throw new Error(`Conflicto de disponibilidad: El espacio ya está reservado para "${availability.conflict?.title}"`);
            }
        }

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
            items: activity.items || [],
            required_deposit: activity.required_deposit || 0,
            current_balance: activity.current_balance || 0,
            payment_status: activity.payment_status || 'PENDING',
            ...activity
        } as Activity;

        // 2. Commit Inventory if it has items
        if (newActivity.items && newActivity.items.length > 0 && (newActivity.status === 'PLANNED' || newActivity.status === 'CONFIRMED')) {
            await db.commitInventory(newActivity.items, newActivity.startDate);
        }

        await db.saveDocument('activities' as any, newActivity);
        return newActivity;
    }

    /**
     * Update an activity
     */
    async updateActivity(id: string, updates: Partial<Activity>): Promise<Activity> {
        const existing = await db.getDocument('activities' as any, id) as Activity;
        if (!existing) throw new Error('Actividad no encontrada');

        // 1. Availability check if room/time changed
        const spaceChanged = updates.spaceId && updates.spaceId !== existing.spaceId;
        const timeChanged = (updates.startDate && updates.startDate !== existing.startDate) ||
            (updates.endDate && updates.endDate !== existing.endDate);

        if (existing.nature === 'BOOKING' && (spaceChanged || timeChanged)) {
            const availability = await this.checkAvailability(
                updates.spaceId || existing.spaceId!,
                updates.startDate || existing.startDate,
                updates.endDate || existing.endDate,
                existing.id
            );
            if (!availability.available) {
                throw new Error(`Conflicto de disponibilidad: El espacio ya está reservado para "${availability.conflict?.title}"`);
            }
        }

        // 2. Re-commit inventory if items changed
        if (updates.items) {
            const oldItems = existing.items || [];
            const newItems = updates.items;

            // Rollback old items
            for (const item of oldItems) {
                await db.adjustCommittedStock(item.id, 'wh_central', -item.quantity);
            }

            // Commit new items
            for (const item of newItems) {
                await db.adjustCommittedStock(item.id, 'wh_central', item.quantity);
            }
        } else if (timeChanged || spaceChanged) {
            // If time or space changed but items didn't, we might need to re-verify but 
            // the commitment stays the same unless we have warehouse-specific commitment
        }

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

    /**
     * Get attendance logs for a specific range
     */
    async getAttendanceLogs(start: string, end: string): Promise<any[]> {
        const all = await db.get('attendanceLogs' as any) as any[] || [];
        const startTime = new Date(start).getTime();
        const endTime = new Date(end).getTime();

        return all.filter(log => {
            const logTime = new Date(log.timestamp).getTime();
            return logTime >= startTime && logTime <= endTime;
        });
    }
}

export const agendaService = new AgendaService();
