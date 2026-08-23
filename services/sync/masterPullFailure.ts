export type MasterPullFailureKind = 'AUTHENTICATION' | 'SCOPE' | 'OPERATIONAL_ACCESS';

export interface MasterPullFailureClassification {
    kind: MasterPullFailureKind;
    backendCode: string;
    authStatus: string;
    message: string;
}

const normalizeCode = (value: string | null | undefined): string =>
    String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');

const isAuthenticationCode = (code: string): boolean =>
    /^(?:AUTH_REQUIRED|AUTH_FAILED|SYNC_TOKEN_(?:MISSING|INVALID|REJECTED)|DEVICE_TOKEN_(?:MISSING|INVALID|REQUIRED)|DEVICE_NOT_AUTHORIZED)$/.test(code);

const readBackendCode = (responseBody: string | null | undefined): string => {
    if (!responseBody) return '';
    try {
        const payload = JSON.parse(responseBody);
        return normalizeCode(
            payload?.code
            || payload?.errorCode
            || payload?.error_code
            || payload?.statusCode
            || payload?.status_code
            || payload?.error?.code,
        );
    } catch {
        return '';
    }
};

export const classifyMasterPullFailure = (input: {
    collection: string;
    status: number;
    backendCode?: string | null;
    responseBody?: string | null;
}): MasterPullFailureClassification => {
    const normalizedCode = normalizeCode(input.backendCode) || readBackendCode(input.responseBody);

    if (input.status === 401 || isAuthenticationCode(normalizedCode)) {
        const backendCode = normalizedCode || 'AUTH_REQUIRED';
        return {
            kind: 'AUTHENTICATION',
            backendCode,
            authStatus: backendCode,
            message: `AUTH_REQUIRED: Falta autenticación/syncToken para descargar ${input.collection}.`,
        };
    }

    if (normalizedCode === 'SYNC_SCOPE_FORBIDDEN') {
        return {
            kind: 'SCOPE',
            backendCode: normalizedCode,
            authStatus: normalizedCode,
            message: `SYNC_SCOPE_FORBIDDEN: La terminal no tiene permiso para descargar ${input.collection} dentro de su alcance autorizado. Revise tenant, empresa, sucursal y terminal.`,
        };
    }

    if (normalizedCode === 'PULL_MASTERS_NOT_ALLOWED') {
        return {
            kind: 'OPERATIONAL_ACCESS',
            backendCode: normalizedCode,
            authStatus: 'ACCESS_BLOCKED',
            message: `PULL_MASTERS_NOT_ALLOWED: El ERP bloqueó la descarga de ${input.collection} porque la licencia, facturación o permisos operativos de la terminal no están activos. Reactive el tenant y vuelva a intentar.`,
        };
    }

    const backendCode = normalizedCode || 'PULL_MASTERS_FORBIDDEN';
    return {
        kind: 'OPERATIONAL_ACCESS',
        backendCode,
        authStatus: 'ACCESS_BLOCKED',
        message: `${backendCode}: El ERP no permitió descargar ${input.collection}. Revise el estado de la licencia y los permisos de la terminal.`,
    };
};
