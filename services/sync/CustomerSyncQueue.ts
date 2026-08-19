import { Customer } from '../../types';
import { db } from '../../utils/db';
import { permissionService } from './PermissionService';

export type CustomerMutationOperation = 'UPSERT' | 'DELETE';

export interface CustomerMutation {
  id: string;
  customerId: string;
  operation: CustomerMutationOperation;
  customer?: Customer;
  terminalId: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: 'PENDING' | 'SYNCING' | 'RETRY_WAIT' | 'SYNCED_ACTIVE' | 'SYNCED_MASTER' | 'COMPLETED' | 'BLOCKED_FUNCTIONAL';
  syncError?: string;
}

export const queueCustomerMutation = async (
  operation: CustomerMutationOperation,
  customerOrId: Customer | string,
): Promise<CustomerMutation> => {
  const customerId = typeof customerOrId === 'string' ? customerOrId : String(customerOrId.id);
  const now = new Date().toISOString();
  const mutation: CustomerMutation = {
    id: `customer-${operation.toLowerCase()}-${customerId}-${Date.now()}`,
    customerId,
    operation,
    customer: typeof customerOrId === 'string' ? undefined : customerOrId,
    terminalId: permissionService.getTerminalId() || 'LOCAL',
    createdAt: now,
    updatedAt: now,
    syncStatus: 'PENDING',
  };
  await db.saveDocument('customerMutations' as any, mutation as any);
  return mutation;
};
