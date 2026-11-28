import type { FiscalWorkflowCheckoutV2, FiscalWorkflowScope } from './FiscalWorkflowV2Types';
import { fiscalWorkflowScopeKey } from './FiscalWorkflowV2Types';

const tenantId = 'b2e01916-309a-414f-b9f0-636352d25318';
const terminalId = '31d2162e-1767-4f74-8e72-7c73a3341e96';
const companyId = '39ac760d-bd18-4611-8251-84eaec00dea1';
const storeId = '7f3a2d1a-4d10-4f9c-afed-9b4d55f417c2';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAbsoluteFiscalRecoveryScope(scope: FiscalWorkflowScope): boolean {
    return scope.tenantId === tenantId && scope.terminalId === terminalId && scope.companyId === companyId && scope.storeId === storeId;
}

export function absoluteFiscalRecoveryIdentity(scope: FiscalWorkflowScope, checkout: FiscalWorkflowCheckoutV2 | null) {
    if (!isAbsoluteFiscalRecoveryScope(scope) || !checkout || checkout.scopeKey !== fiscalWorkflowScopeKey(scope)) return null;
    if (checkout.phase !== 'EFFECT_POSSIBLE' || checkout.permit !== null || checkout.fiscalSaleContext || checkout.committedNumbering) return null;
    if (!uuid.test(checkout.checkoutId) || !checkout.checkoutId.startsWith('496e3827-') || !uuid.test(checkout.transactionId) || !uuid.test(checkout.operationId)) return null;
    const allocation = checkout.allocation;
    if (!allocation || allocation.ncfType !== 'E32' || !/^E32\d{10}$/.test(allocation.ncf) || !uuid.test(allocation.authorizationId) || !uuid.test(allocation.allocationId)) return null;
    const issuance = checkout.allocationIssuance;
    if (allocation.environment !== 2 || issuance?.issuerRnc !== '131397662' || issuance.ncf !== allocation.ncf || issuance.companyId !== companyId || issuance.tenantId !== tenantId || issuance.terminalId !== terminalId) return null;
    return {
        checkoutId: checkout.checkoutId,
        transactionId: checkout.transactionId,
        operationId: checkout.operationId,
        authorizationId: allocation.authorizationId,
        allocationId: allocation.allocationId,
        ncf: allocation.ncf,
    };
}
