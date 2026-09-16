import { requestJson } from '../network/httpClient';

export interface DeviceRequestIdentity {
  tenant_id: string;
  company_id: string;
  store_id: string;
  terminal_id: string;
  device_id: string;
}
export interface DeviceRequestReceipt {
  success: true;
  request_id: string;
  status: string;
  terminal_id: string;
  requested_device_id: string;
  binding_authorized?: boolean;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateDeviceRequestIdentity(identity: DeviceRequestIdentity) {
  if (![identity.tenant_id, identity.company_id, identity.store_id, identity.terminal_id].every(value => uuid.test(value))
    || !/^DEV-[A-Z0-9]{8,64}$/.test(identity.device_id)) {
    throw new Error('La solicitud requiere UUID completos y la identidad completa del dispositivo.');
  }
}
export function validateDeviceRequestReceipt(data: any, identity: DeviceRequestIdentity, requestId?: string): DeviceRequestReceipt {
  if (data?.success !== true || !uuid.test(data.request_id || '')
    || data.terminal_id !== identity.terminal_id || data.requested_device_id !== identity.device_id
    || (requestId ? data.request_id !== requestId || typeof data.binding_authorized !== 'boolean'
      || !['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'RESOLVED', 'IGNORED'].includes(data.status) : data.status !== 'PENDING')) {
    throw new Error('ERP no confirmó una solicitud persistida para esta terminal y dispositivo.');
  }
  return data;
}
export const isDeviceRequestApproved = (receipt: DeviceRequestReceipt) =>
  receipt.status === 'APPROVED' && receipt.binding_authorized === true;

export async function requestTerminalDeviceAuthorization(input: {
  baseUrl: string; viaMaster: boolean; identity: DeviceRequestIdentity; requestId?: string; appVersion?: string;
}) {
  validateDeviceRequestIdentity(input.identity);
  if (input.requestId && !uuid.test(input.requestId)) throw new Error('Identificador de solicitud inválido.');
  const root = input.viaMaster ? `${input.baseUrl}/device-requests`
    : `${input.baseUrl.replace(/\/$/, '')}/api/sync/terminals/${input.identity.terminal_id}/device-requests`;
  const query = new URLSearchParams(input.viaMaster ? { ...input.identity, request_id: input.requestId || '' }
    : { tenant_id: input.identity.tenant_id, company_id: input.identity.company_id,
      store_id: input.identity.store_id, device_id: input.identity.device_id });
  const response = await requestJson<DeviceRequestReceipt & { code?: string }>({
    url: input.requestId ? `${root}${input.viaMaster ? '' : `/${input.requestId}`}?${query}` : root,
    method: input.requestId ? 'GET' : 'POST', timeoutMs: 16000,
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': input.identity.device_id },
    body: input.requestId ? undefined : JSON.stringify({ ...input.identity,
      ...(input.appVersion ? { app_version: input.appVersion } : {}) }),
  });
  if (!response.ok) throw new Error(response.status === 404
    ? 'El endpoint de solicitudes ERP no está disponible o la solicitud no pertenece a este ámbito. No se confirmó el envío.'
    : `ERP no confirmó la solicitud (${response.status}: ${response.data?.code || 'ERROR'}).`);
  return validateDeviceRequestReceipt(response.data, input.identity, input.requestId);
}
