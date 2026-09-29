import type { BusinessConfig } from '../../types';
import { requestJson, type RequestJsonResult } from '../network/httpClient';
import { legacyMutationJournal, type LegacyMutationJournal } from '../sync/LegacyMutationJournal';
import {
  dispatchLegacyLanMutation,
  persistLegacyLanMutationCompletion,
} from '../sync/LegacyLanMutationTransport';
import {
  persistClientBindingRecovery,
  resolveMasterAuthorityIdentity,
  validateClientBindingAck,
} from './clientBindingRecovery';

const CONTEXT_KIND = 'CLIENT_TERMINAL_BIND_V1';

export interface ClientBindContract {
  authorityUrl: string;
  authorityFingerprint: string;
  terminalId: string;
  deviceId: string;
  masterTerminalId: string;
  tenantId: string;
  companyId: string;
  storeId: string;
}

type BindResponse = Record<string, any> & { config?: BusinessConfig };
export interface ClientBindMutationResult {
  ok: boolean;
  status: number;
  data: BindResponse | null;
  text: string;
}
type Request = <T>(input: Parameters<typeof requestJson>[0]) => Promise<RequestJsonResult<T>>;

const contextFor = (contract: ClientBindContract): Record<string, unknown> => ({
  kind: CONTEXT_KIND,
  authorityUrl: contract.authorityUrl,
  authorityFingerprint: contract.authorityFingerprint,
  terminalId: contract.terminalId,
  deviceId: contract.deviceId,
  masterTerminalId: contract.masterTerminalId,
  tenantId: contract.tenantId,
  companyId: contract.companyId,
  storeId: contract.storeId,
});

const sameIntent = (context: Record<string, unknown>, contract: ClientBindContract): boolean =>
  context.kind === CONTEXT_KIND
  && context.authorityUrl === contract.authorityUrl
  && context.authorityFingerprint === contract.authorityFingerprint
  && context.terminalId === contract.terminalId
  && context.deviceId === contract.deviceId
  && context.masterTerminalId === contract.masterTerminalId;

const persistAckRecovery = (contract: ClientBindContract): void => {
  persistClientBindingRecovery({
    authorityUrl: contract.authorityUrl,
    authorityFingerprint: contract.authorityFingerprint,
    masterTerminalId: contract.masterTerminalId,
    terminalId: contract.terminalId,
    deviceId: contract.deviceId,
    tenantId: contract.tenantId,
    companyId: contract.companyId,
    storeId: contract.storeId,
  });
  localStorage.setItem('clic_terminal_binding_status', 'BINDING_RESTORE_PENDING');
  localStorage.setItem('clic_pos_terminal_setup_pending', '1');
};

const validateResponse = (response: BindResponse, contract: ClientBindContract): BusinessConfig =>
  validateClientBindingAck({
    response,
    terminalId: contract.terminalId,
    deviceId: contract.deviceId,
    masterTerminalId: contract.masterTerminalId,
    tenantId: contract.tenantId,
    companyId: contract.companyId,
    storeId: contract.storeId,
  });

export const reconcileClientBindingMutation = async (
  contract: ClientBindContract,
  options: { journal?: LegacyMutationJournal; request?: Request } = {},
): Promise<ClientBindMutationResult | null> => {
  const journal = options.journal || legacyMutationJournal;
  const pending = journal.getBlockingEntries().filter(entry => entry.reconciliationContext?.kind === CONTEXT_KIND);
  if (pending.length === 0) return null;
  if (pending.length !== 1 || !sameIntent(pending[0].reconciliationContext || {}, contract)) {
    throw new Error('CLIENT_BIND_OUTCOME_UNKNOWN: existe otro vínculo ambiguo pendiente de revisión.');
  }

  const result = await (options.request || requestJson)<BusinessConfig>({
    url: `${contract.authorityUrl}/api/config`,
    method: 'GET',
    timeoutMs: 5_000,
    diagnosticContext: { scope: 'CLIENT_BIND_RECONCILIATION' },
  });
  if (!result.ok || !result.data || resolveMasterAuthorityIdentity(result.data as any).toLowerCase() !== contract.masterTerminalId.toLowerCase()) {
    throw new Error('CLIENT_BIND_OUTCOME_UNKNOWN: la autoridad no confirmó inequívocamente el vínculo.');
  }

  const response: BindResponse = {
    success: true,
    terminal_id: contract.terminalId,
    master_terminal_id: contract.masterTerminalId,
    current_device_id: contract.deviceId,
    tenant_id: contract.tenantId,
    company_id: contract.companyId,
    store_id: contract.storeId,
    config: result.data,
  };
  validateResponse(response, contract);
  persistAckRecovery(contract);
  await journal.acknowledge(pending[0].id, 'SAFE_IDEMPOTENT_REPLAY', `CLIENT_BIND_READBACK:${contract.terminalId}`);
  return { ok: true, status: 200, data: response, text: JSON.stringify(response) };
};

export const dispatchClientBindingMutation = async (input: {
  contract: ClientBindContract;
  endpointUrl: string;
  body: Record<string, unknown>;
  journal?: LegacyMutationJournal;
  request?: Request;
}): Promise<ClientBindMutationResult> => {
  const journal = input.journal || legacyMutationJournal;
  const reconciled = await reconcileClientBindingMutation(input.contract, {
    journal,
    request: input.request,
  });
  if (reconciled) return reconciled;

  try {
    const receipt = await dispatchLegacyLanMutation<BindResponse>({
      url: input.endpointUrl,
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(input.body),
      timeoutMs: 12_000,
      operation: 'CLIENT_TERMINAL_BIND',
      journal,
      reconciliationContext: contextFor(input.contract),
      safePreSideEffectStatuses: [400, 404, 409],
      validateResponse: data => { validateResponse(data, input.contract); },
    });
    if (!receipt.response.ok) {
      await receipt.completeAfterDurableCommit(
        `CLIENT_BIND_REJECTED:${receipt.response.status}`,
        () => persistLegacyLanMutationCompletion(
          receipt.correlationId,
          `CLIENT_BIND_REJECTED:${receipt.response.status}`,
          receipt.response.status,
        ),
      );
      return {
        ok: false,
        status: receipt.response.status,
        data: receipt.data,
        text: await receipt.response.text(),
      };
    }
    persistAckRecovery(input.contract);
    await receipt.completeAfterDurableCommit(
      `CLIENT_BIND_ACK:${input.contract.terminalId}`,
      () => persistLegacyLanMutationCompletion(
        receipt.correlationId,
        `CLIENT_BIND_ACK:${input.contract.terminalId}`,
        receipt.response.status,
      ),
    );
    return {
      ok: true,
      status: receipt.response.status,
      data: receipt.data,
      text: await receipt.response.text(),
    };
  } catch (error) {
    try {
      const recovered = await reconcileClientBindingMutation(input.contract, {
        journal,
        request: input.request,
      });
      if (recovered) return recovered;
    } catch {
      // The original ambiguous mutation remains fail-closed until exact readback succeeds.
    }
    throw error;
  }
};
