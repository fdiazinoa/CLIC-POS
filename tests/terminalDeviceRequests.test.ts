import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validateDeviceRequestIdentity, validateDeviceRequestReceipt, isDeviceRequestApproved, requestTerminalDeviceAuthorization } from '../services/setup/terminalDeviceRequests';
const identity = { tenant_id: '9eda7d73-76e4-4432-ad13-4934fefe8f69', company_id: '6b6153ce-501e-4702-9ae9-34a3f1ab9042',
  store_id: 'de8dd318-12e7-4a3f-b0e8-4ea1bdb70c07', terminal_id: '0efd23be-d73f-42aa-ab7d-5895b56edee0', device_id: 'DEV-50WKC4HD' };
const receipt = { success: true as const, request_id: 'ff405c30-1fd7-4f03-a1d1-36e997250e44', status: 'PENDING',
  terminal_id: identity.terminal_id, requested_device_id: identity.device_id };
test('only full UUID and full device identity can request authorization', () => {
  validateDeviceRequestIdentity(identity);
  for (const field of Object.keys(identity)) assert.throws(() => validateDeviceRequestIdentity({ ...identity, [field]: 'truncated...' }));
});
test('receipt must confirm persisted request, exact terminal, device and pending state', () => {
  assert.equal(validateDeviceRequestReceipt(receipt, identity), receipt);
  for (const override of [{ success: false }, { request_id: '' }, { terminal_id: identity.store_id },
    { requested_device_id: 'DEV-HUUCIX17' }, { status: 'APPROVED' }]) {
    assert.throws(() => validateDeviceRequestReceipt({ ...receipt, ...override }, identity));
  }
});
test('APPROVED without authorized binding never activates, nor do other states', () => {
  for (const status of ['PENDING', 'REJECTED', 'EXPIRED', 'RESOLVED', 'IGNORED']) assert.equal(isDeviceRequestApproved({ ...receipt, status, binding_authorized: true }), false);
  assert.equal(isDeviceRequestApproved({ ...receipt, status: 'APPROVED', binding_authorized: false }), false);
  assert.equal(isDeviceRequestApproved({ ...receipt, status: 'APPROVED', binding_authorized: true }), true);
  assert.throws(() => validateDeviceRequestReceipt(receipt, identity, receipt.request_id));
});
test('explicit POST/retry use exact payload, no takeover or admin credentials; GET uses receipt', async () => {
  const original = globalThis.fetch;
  const calls: { url: string; options: any }[] = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ ...receipt, ...(options?.method === 'GET' ? { binding_authorized: false } : {}) }), { status: 200 });
  };
  try {
    const input = { baseUrl: 'https://erp.example', viaMaster: false, identity };
    for (let i = 0; i < 2; i++) assert.equal((await requestTerminalDeviceAuthorization(input)).request_id, receipt.request_id);
    await requestTerminalDeviceAuthorization({ ...input, requestId: receipt.request_id });
    assert.deepEqual(JSON.parse(calls[0].options.body), identity);
    assert.equal(calls[0].options.headers['X-Device-Id'], identity.device_id);
    assert.equal(calls[0].options.headers.Authorization, undefined);
    assert.match(calls[2].url, new RegExp(`/device-requests/${receipt.request_id}\\?`));
    assert.equal(calls[2].options.method, 'GET');
    globalThis.fetch = async () => new Response('{"success":false}', { status: 404 });
    await assert.rejects(requestTerminalDeviceAuthorization(input), /No se confirmó el envío/);
  } finally { globalThis.fetch = original; }
});
test('native administrative request is separate from bind and cannot write binding', () => {
  const native = readFileSync(new URL('../native-stubs/android/ClicPOSMasterHttpServer.kt', import.meta.url), 'utf8');
  const handler = native.slice(native.indexOf('private fun handleDeviceRequest'), native.indexOf('@Synchronized\n    private fun bindTerminal'));
  assert.match(handler, /DEVICE_REQUEST_SCOPE_INVALID/);
  assert.match(handler, /DEVICE_REQUEST_UNSUPPORTED_FIELD/);
  assert.doesNotMatch(handler, /persistTerminalBinding|configSnapshot\s*=|takeover/i);
  assert.match(native, /can_request_authorization/);
  assert.match(native, /MASTER_SETUP_FORCE_TRANSFER_FORBIDDEN/);
});
