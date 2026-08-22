export type RealtimeBindingScope = {
    tenantId?: string | null;
    storeId?: string | null;
    terminalId?: string | null;
    localTerminalId?: string | null;
};

const asObject = (value: unknown): Record<string, any> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as Record<string, any>;
};

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const payloadAppliesToRealtimeScope = (
    payload: unknown,
    binding: RealtimeBindingScope,
    strict: boolean,
): boolean => {
    const eventPayload = asObject(payload);
    const tenantId = asString(eventPayload.tenantId || eventPayload.tenant_id);
    const storeId = asString(eventPayload.storeId || eventPayload.store_id);
    const terminalId = asString(eventPayload.terminalId || eventPayload.terminal_id);

    if (strict && (!tenantId || !storeId || !binding.tenantId || !binding.storeId)) return false;
    if (tenantId && binding.tenantId && tenantId !== binding.tenantId) return false;
    if (storeId && binding.storeId && storeId !== binding.storeId) return false;
    if (
        terminalId
        && terminalId !== '*'
        && terminalId !== binding.terminalId
        && terminalId !== binding.localTerminalId
    ) return false;
    return true;
};

export const isSyncHintV2Payload = (payload: unknown): boolean => {
    const eventPayload = asObject(payload);
    return asString(eventPayload.type).toUpperCase() === 'SYNC_HINT'
        && Number(eventPayload.protocolVersion || eventPayload.protocol_version) === 2;
};
