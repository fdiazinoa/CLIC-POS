import { v4 as uuidv4 } from 'uuid';
import type {
  InvoiceAuditEvent,
  InvoiceAuditEventType,
  InvoiceReviewFlag,
  InvoiceReviewPriority,
  Transaction,
  User,
} from '../../types';
import { dbAdapter } from '../db';
import { db } from '../../utils/db';
import { durableOutboxRepository } from '../sync/DurableOutboxRepository';
import { isSyncFeatureEnabled } from '../sync/SyncFeatureFlags';
import { permissionService } from '../sync/PermissionService';
import { readTerminalCredentialsSync } from '../sync/TerminalCredentialStore';

type ReviewCategory = InvoiceReviewFlag['category'];

type InvoiceIdentity = Pick<Transaction, 'id' | 'displayId' | 'terminalId'>;

interface ActorContext {
  actor: User;
  authorizedBy?: User;
}

export interface CreateInvoiceReviewInput extends ActorContext {
  transaction: InvoiceIdentity;
  category: ReviewCategory;
  priority: InvoiceReviewPriority;
  comment: string;
}

export interface RecordInvoiceAuditInput extends ActorContext {
  transaction: InvoiceIdentity;
  eventType: InvoiceAuditEventType;
  reason?: string;
  previousData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

const cleanRequiredText = (value: unknown, label: string): string => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${label} es obligatorio.`);
  return normalized;
};

const resolveIdentity = (transaction: InvoiceIdentity) => {
  const credentials = readTerminalCredentialsSync();
  return {
    tenantId: credentials.erpTenantId || credentials.tenantId || undefined,
    companyId: credentials.companyId || undefined,
    storeId: credentials.storeId || undefined,
    terminalId: transaction.terminalId
      || permissionService.getTerminalId()
      || credentials.erpTerminalId
      || credentials.terminalId
      || 'LOCAL',
  };
};

export const buildInvoiceAuditEvent = (input: RecordInvoiceAuditInput): InvoiceAuditEvent => {
  const occurredAt = new Date().toISOString();
  const identity = resolveIdentity(input.transaction);
  const id = uuidv4();
  return {
    id,
    transactionId: cleanRequiredText(input.transaction.id, 'El identificador de la factura'),
    transactionDisplayId: input.transaction.displayId,
    eventType: input.eventType,
    previousData: input.previousData,
    newData: input.newData,
    reason: input.reason?.trim() || undefined,
    metadata: input.metadata,
    ...identity,
    actorId: input.actor.id,
    actorName: input.actor.name,
    authorizedById: input.authorizedBy?.id,
    authorizedByName: input.authorizedBy?.name,
    occurredAt,
    idempotencyKey: id,
    syncStatus: 'PENDING',
  };
};

const commitReviewAndAudit = async (
  review: InvoiceReviewFlag,
  auditEvent: InvoiceAuditEvent,
): Promise<void> => {
  if (isSyncFeatureEnabled('sqlite_outbox_v2') && durableOutboxRepository.isSupported()) {
    await durableOutboxRepository.commitFinancialTransaction({
      documents: [
        { collectionName: 'invoiceReviewFlags', document: review },
        { collectionName: 'invoiceAuditEvents', document: auditEvent },
      ],
      outboxEvent: {
        eventId: auditEvent.idempotencyKey,
        eventType: 'INVOICE_REVIEW_FLAGGED',
        aggregateType: 'INVOICE_REVIEW',
        aggregateId: review.id,
        schemaVersion: 1,
        payload: {
          aggregateVersion: 1,
          review,
          auditEvent,
          occurred_at: auditEvent.occurredAt,
        },
        createdAt: auditEvent.occurredAt,
      },
    });
    return;
  }

  await db.saveDocument('invoiceReviewFlags', review);
  try {
    await db.saveDocument('invoiceAuditEvents', auditEvent);
  } catch (error) {
    await dbAdapter.deleteDocument('invoiceReviewFlags', review.id).catch(() => undefined);
    throw error;
  }
};

export const createInvoiceReview = async (
  input: CreateInvoiceReviewInput,
): Promise<{ review: InvoiceReviewFlag; auditEvent: InvoiceAuditEvent }> => {
  const now = new Date().toISOString();
  const identity = resolveIdentity(input.transaction);
  const review: InvoiceReviewFlag = {
    id: uuidv4(),
    transactionId: cleanRequiredText(input.transaction.id, 'El identificador de la factura'),
    transactionDisplayId: input.transaction.displayId,
    status: 'OPEN',
    category: input.category,
    priority: input.priority,
    comment: cleanRequiredText(input.comment, 'El comentario'),
    ...identity,
    createdById: input.actor.id,
    createdByName: input.actor.name,
    createdAt: now,
    updatedAt: now,
    syncStatus: 'PENDING',
  };

  const auditEvent = buildInvoiceAuditEvent({
    transaction: input.transaction,
    eventType: 'REVIEW_FLAGGED',
    reason: review.comment,
    newData: {
      reviewId: review.id,
      category: review.category,
      priority: review.priority,
      status: review.status,
    },
    actor: input.actor,
    authorizedBy: input.authorizedBy,
  });

  await commitReviewAndAudit(review, auditEvent);
  return { review, auditEvent };
};

export const recordInvoiceAuditEvent = async (
  input: RecordInvoiceAuditInput,
): Promise<InvoiceAuditEvent> => {
  const event = buildInvoiceAuditEvent(input);

  if (isSyncFeatureEnabled('sqlite_outbox_v2') && durableOutboxRepository.isSupported()) {
    await durableOutboxRepository.commitFinancialTransaction({
      documents: [
        { collectionName: 'invoiceAuditEvents', document: event },
      ],
      outboxEvent: {
        eventId: event.idempotencyKey,
        eventType: 'INVOICE_AUDIT_RECORDED',
        aggregateType: 'INVOICE_AUDIT',
        aggregateId: event.id,
        schemaVersion: 1,
        payload: {
          aggregateVersion: 1,
          auditEvent: event,
          occurred_at: event.occurredAt,
        },
        createdAt: event.occurredAt,
      },
    });
    return event;
  }

  await db.saveDocument('invoiceAuditEvents', event);
  return event;
};

export const loadInvoiceReviewFlags = async (): Promise<InvoiceReviewFlag[]> => {
  const rows = await db.get('invoiceReviewFlags');
  return Array.isArray(rows) ? rows as InvoiceReviewFlag[] : [];
};

export const loadInvoiceAuditEvents = async (): Promise<InvoiceAuditEvent[]> => {
  const rows = await db.get('invoiceAuditEvents');
  return Array.isArray(rows) ? rows as InvoiceAuditEvent[] : [];
};
