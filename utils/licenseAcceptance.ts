import { LICENSE_DOCUMENT_HASH, licenseClause } from '../legal/licenseClause';

export interface AcceptanceIdentity {
    tenantId: string;
    legalName: string;
    userId: string;
    userName?: string;
}
export interface LocalLicenseAcceptance extends AcceptanceIdentity {
    version: string;
    documentHash: string;
    acceptedAtDeviceUtc: string;
    timeSource: 'device';
}
type AcceptanceStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const acceptanceKey = (tenantId: string, version: string = licenseClause.version): string =>
    `clic_license_acceptance:${encodeURIComponent(tenantId)}:${encodeURIComponent(version)}`;

export function readLicenseAcceptance(storage: AcceptanceStorage, tenantId: string): LocalLicenseAcceptance | null {
    if (!tenantId.trim()) throw new Error('No se identificó el cliente para registrar la aceptación.');
    const raw = storage.getItem(acceptanceKey(tenantId));
    if (raw === null) return null;
    let value: LocalLicenseAcceptance;
    try { value = JSON.parse(raw); } catch { return null; }
    if (!value || typeof value !== 'object') return null;
    if (value.tenantId !== tenantId || value.version !== licenseClause.version || value.documentHash !== LICENSE_DOCUMENT_HASH) return null;
    if (!value.userId || !value.legalName || value.timeSource !== 'device' || typeof value.acceptedAtDeviceUtc !== 'string'
        || !Number.isFinite(Date.parse(value.acceptedAtDeviceUtc))) return null;
    return value;
}

export function recordLicenseAcceptance(storage: AcceptanceStorage, identity: AcceptanceIdentity, confirmed: boolean, now = new Date()): LocalLicenseAcceptance {
    if (!confirmed) throw new Error('Debes leer y aceptar las condiciones para continuar.');
    if (!identity.tenantId.trim() || !identity.userId.trim() || !identity.legalName.trim()) throw new Error('Faltan datos del cliente o del usuario.');
    const previous = readLicenseAcceptance(storage, identity.tenantId);
    if (previous) return previous;
    const record: LocalLicenseAcceptance = {
        tenantId: identity.tenantId, legalName: identity.legalName, userId: identity.userId,
        ...(identity.userName ? { userName: identity.userName } : {}),
        version: licenseClause.version, documentHash: LICENSE_DOCUMENT_HASH,
        acceptedAtDeviceUtc: now.toISOString(), timeSource: 'device',
    };
    storage.setItem(acceptanceKey(identity.tenantId), JSON.stringify(record));
    const persisted = readLicenseAcceptance(storage, identity.tenantId);
    if (!persisted || JSON.stringify(persisted) !== JSON.stringify(record)) throw new Error('No se pudo confirmar el guardado de la aceptación. Reintenta.');
    return persisted;
}
