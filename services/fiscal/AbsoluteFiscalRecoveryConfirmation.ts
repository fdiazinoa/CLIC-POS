import type { AbsoluteFiscalRecoveryCandidate } from '../db/AbsoluteFiscalRecoveryStore';

const verificationKey: JsonWebKey = {
    kty: 'EC', crv: 'P-256', x: 'PPj3NRC9cB9b_qf-pyyqiIiZ5djDnExjJoXR1DSP2hE', y: 'jsTADuDlmNgKa0LKiuoNvwbcRMeDVImPPJp0cSJTdos',
};

/** Field order is part of the one-time support signature format. */
export function absoluteFiscalConfirmationBytes(candidate: AbsoluteFiscalRecoveryCandidate, checkedAtMs: number) {
    const { checkoutId, transactionId, operationId, authorizationId, allocationId, ncf, snapshotHash } = candidate;
    return new TextEncoder().encode(JSON.stringify({
        purpose: 'ABSOLUTE_FISCAL_RECOVERY_V2', checkoutId, transactionId, operationId, authorizationId, allocationId, ncf,
        snapshotHash, checkedAtMs, erpAbsence: true, msellerHttp: 404,
    }));
}

export async function verifyAbsoluteFiscalConfirmation(candidate: AbsoluteFiscalRecoveryCandidate, confirmation: string, key: JsonWebKey = verificationKey): Promise<boolean> {
    const match = /^(\d{13})\.([a-f0-9]{128})$/.exec(confirmation);
    if (!match) return false;
    const checkedAtMs = Number(match[1]);
    const elapsed = Date.now() - checkedAtMs;
    if (elapsed > 10 * 60_000 || elapsed < -60_000) return false;
    const signature = Uint8Array.from(match[2].match(/../g)!, hex => Number.parseInt(hex, 16));
    try {
        const publicKey = await crypto.subtle.importKey('jwk', key, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, absoluteFiscalConfirmationBytes(candidate, checkedAtMs));
    } catch { return false; }
}
