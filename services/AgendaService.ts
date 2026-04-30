import { db } from '../utils/db';
import {
    Activity,
    BookingSalesDocument,
    BookingSalesDocumentLine,
    BookingSalesDocumentType,
    Collection,
    CollectionMethod,
    Opportunity,
    OpportunityStage,
    Room,
    ServiceType,
    User,
} from '../types';
import { v4 as uuidv4 } from 'uuid';

class AgendaService {
    private readonly stageProbability: Record<OpportunityStage, number> = {
        NEW: 10,
        CONTACTED: 30,
        QUOTED: 60,
        WON: 100,
        LOST: 0
    };

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

    async getOpportunities(): Promise<Opportunity[]> {
        const opportunities = await db.get('crmOpportunities' as any) as Opportunity[] || [];
        return opportunities.sort((a, b) => {
            const left = new Date(a.expected_close_date || a.expectedCloseDate || a.updated_at || a.updatedAt || 0).getTime();
            const right = new Date(b.expected_close_date || b.expectedCloseDate || b.updated_at || b.updatedAt || 0).getTime();
            return right - left;
        });
    }

    async createOpportunity(opportunity: Partial<Opportunity>): Promise<Opportunity> {
        const now = new Date().toISOString();
        const stage = opportunity.stage || 'NEW';
        const normalized: Opportunity = {
            id: opportunity.id || uuidv4(),
            title: opportunity.title || 'Nueva oportunidad',
            customer_id: opportunity.customer_id || opportunity.customerId,
            customerId: opportunity.customerId || opportunity.customer_id,
            customer_name: opportunity.customer_name || opportunity.customerName,
            customerName: opportunity.customerName || opportunity.customer_name,
            assigned_user_id: opportunity.assigned_user_id || opportunity.assignedUserId,
            assignedUserId: opportunity.assignedUserId || opportunity.assigned_user_id,
            assigned_user_name: opportunity.assigned_user_name || opportunity.assignedUserName,
            assignedUserName: opportunity.assignedUserName || opportunity.assigned_user_name,
            stage,
            amount: Number(opportunity.amount || 0),
            probability: Number(opportunity.probability ?? this.stageProbability[stage]),
            expected_close_date: opportunity.expected_close_date || opportunity.expectedCloseDate,
            expectedCloseDate: opportunity.expectedCloseDate || opportunity.expected_close_date,
            source: opportunity.source || 'POS',
            notes: opportunity.notes,
            created_at: opportunity.created_at || opportunity.createdAt || now,
            createdAt: opportunity.createdAt || opportunity.created_at || now,
            updated_at: now,
            updatedAt: now,
            syncStatus: 'PENDING'
        };

        await db.saveDocument('crmOpportunities' as any, normalized);
        return normalized;
    }

    async updateOpportunity(id: string, updates: Partial<Opportunity>): Promise<Opportunity> {
        const existing = await db.getDocument('crmOpportunities' as any, id) as Opportunity | null;
        if (!existing) throw new Error('Oportunidad no encontrada');

        const stage = updates.stage || existing.stage;
        const updated: Opportunity = {
            ...existing,
            ...updates,
            customer_id: updates.customer_id || updates.customerId || existing.customer_id || existing.customerId,
            customerId: updates.customerId || updates.customer_id || existing.customerId || existing.customer_id,
            assigned_user_id: updates.assigned_user_id || updates.assignedUserId || existing.assigned_user_id || existing.assignedUserId,
            assignedUserId: updates.assignedUserId || updates.assigned_user_id || existing.assignedUserId || existing.assigned_user_id,
            stage,
            probability: Number(updates.probability ?? existing.probability ?? this.stageProbability[stage]),
            expected_close_date: updates.expected_close_date || updates.expectedCloseDate || existing.expected_close_date || existing.expectedCloseDate,
            expectedCloseDate: updates.expectedCloseDate || updates.expected_close_date || existing.expectedCloseDate || existing.expected_close_date,
            updated_at: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            syncStatus: 'PENDING'
        };

        await db.saveDocument('crmOpportunities' as any, updated);
        return updated;
    }

    async deleteOpportunity(id: string): Promise<void> {
        await db.deleteDocument('crmOpportunities' as any, id);
    }

    async getOpportunityActivities(opportunityId: string): Promise<Activity[]> {
        const all = await db.get('activities' as any) as Activity[] || [];
        return all.filter(activity => activity.opportunityId === opportunityId);
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
            opportunityId: activity.opportunityId,
            opportunityTitle: activity.opportunityTitle,
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

    private buildBookingDocumentLines(activity: Activity, rooms: Room[] = []): BookingSalesDocumentLine[] {
        const lines: BookingSalesDocumentLine[] = [];
        const room = rooms.find(r => r.id === activity.spaceId);
        const roomName = activity.spaceName || room?.name || room?.nombre;
        const roomPrice = Number(room?.base_price || room?.consumo_minimo || 0);

        if (activity.spaceId || roomName) {
            lines.push({
                id: uuidv4(),
                itemId: activity.spaceId ? `space:${activity.spaceId}` : undefined,
                name: roomName ? `Espacio: ${roomName}` : 'Espacio / Salón',
                description: `Reserva ${activity.displayId} del ${new Date(activity.startDate).toLocaleString()}`,
                quantity: 1,
                unitPrice: roomPrice,
                total: roomPrice,
                source: 'SPACE'
            });
        }

        for (const item of activity.items || []) {
            const quantity = Number(item.quantity || 1);
            const unitPrice = Number(item.price || 0);
            lines.push({
                id: uuidv4(),
                itemId: item.id,
                name: item.name,
                description: item.description,
                quantity,
                unitPrice,
                total: quantity * unitPrice,
                source: 'ITEM'
            });
        }

        return lines;
    }

    async generateSalesDocumentFromBooking(
        activityId: string,
        documentType: BookingSalesDocumentType,
        rooms: Room[] = [],
        currentUser?: User,
        terminalId = 'T1'
    ): Promise<BookingSalesDocument> {
        const activity = await db.getDocument('activities' as any, activityId) as Activity | null;
        if (!activity) throw new Error('Booking no encontrado');
        if (activity.nature !== 'BOOKING') throw new Error('Solo los bookings pueden generar documentos comerciales');

        const lines = this.buildBookingDocumentLines(activity, rooms);
        const subtotal = lines.reduce((sum, line) => sum + Number(line.total || 0), 0);
        const prefix: Record<BookingSalesDocumentType, string> = {
            QUOTE: 'COT',
            SALES_ORDER: 'PED',
            INVOICE: 'FAC'
        };

        const document: BookingSalesDocument = {
            id: uuidv4(),
            displayId: `${prefix[documentType]}-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`,
            documentType,
            status: documentType === 'INVOICE' ? 'INVOICED' : 'DRAFT',
            bookingActivityId: activity.id,
            opportunityId: activity.opportunityId,
            customerId: activity.customerId,
            customerName: activity.customerName,
            date: new Date().toISOString(),
            expectedDate: activity.startDate,
            subtotal,
            total: subtotal,
            lines,
            notes: `Generado desde booking ${activity.displayId}: ${activity.title}`,
            createdBy: currentUser?.id,
            terminalId,
            syncStatus: 'PENDING'
        };

        await db.saveDocument('erp_sales_documents' as any, document);
        await this.updateActivity(activity.id, {
            linked_document_id: document.id,
            linkedDocumentId: document.id,
            linkedTransactionId: document.id,
            linkedDocumentType: document.documentType,
            linkedDocumentDisplayId: document.displayId
        });

        if (activity.opportunityId) {
            await this.updateOpportunity(activity.opportunityId, {
                stage: documentType === 'INVOICE' ? 'WON' : 'QUOTED',
                amount: subtotal
            });
        }

        return document;
    }

    async registerBookingAdvance(
        activityId: string,
        amount: number,
        method: CollectionMethod,
        currentUser: User,
        terminalId = 'T1',
        reference?: string
    ): Promise<Collection> {
        const activity = await db.getDocument('activities' as any, activityId) as Activity | null;
        if (!activity) throw new Error('Booking no encontrado');
        if (activity.nature !== 'BOOKING') throw new Error('Solo los bookings pueden registrar anticipos');
        if (!activity.customerId || !activity.customerName) {
            throw new Error('Debe asignar un cliente antes de registrar un anticipo');
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error('El monto del anticipo debe ser mayor que cero');
        }

        const collectionId = uuidv4();
        const collection: Collection = {
            id: collectionId,
            displayId: `ANT-${Date.now().toString().slice(-6)}`,
            customerId: activity.customerId,
            customerName: activity.customerName,
            date: new Date().toISOString(),
            totalAmount: amount,
            method,
            currencyCode: 'DOP',
            exchangeRate: 1,
            receivedAmountOriginal: amount,
            receivedAmountBase: amount,
            appliedAmountBase: 0,
            unappliedAmountBase: amount,
            reference: reference || activity.linkedDocumentDisplayId || activity.displayId,
            userId: currentUser.id,
            userName: currentUser.name,
            terminalId,
            bookingActivityId: activity.id,
            opportunityId: activity.opportunityId,
            allocations: [],
            notes: `Anticipo de cliente para booking ${activity.displayId}${activity.linkedDocumentDisplayId ? ` / ${activity.linkedDocumentDisplayId}` : ''}`,
            syncStatus: 'PENDING'
        };

        await db.saveDocument('collections' as any, collection);
        const currentBalance = Number(activity.current_balance || 0) + amount;
        const requiredDeposit = Number(activity.required_deposit || 0);
        await this.updateActivity(activity.id, {
            status: 'CONFIRMED',
            current_balance: currentBalance,
            payment_status: requiredDeposit > 0 && currentBalance >= requiredDeposit ? 'PAID' : 'PARTIAL'
        });

        return collection;
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
