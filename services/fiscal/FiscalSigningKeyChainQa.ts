import { Capacitor, registerPlugin } from '@capacitor/core';
import { captureFiscalStatusBoundContext } from './FiscalBoundContext';
import { fiscalWorkflowV2Client } from './FiscalWorkflowV2Client';

interface KeyChainQaPlugin {
    verify(options: { certificateSha256: string }): Promise<{ verified: boolean }>;
}

const pluginName = 'FiscalSigningKeyChainQa';
const keyChain = registerPlugin<KeyChainQaPlugin>(pluginName);

export const canVerifyFiscalKeyChainQa = (): boolean =>
    import.meta.env?.VITE_POS_FISCAL_LOCAL_SIGNING_QA === 'true'
    && Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
    && Capacitor.isPluginAvailable(pluginName);

export async function verifyFiscalKeyChainQa(
    terminalId: string, issuerRnc: string, environment: 0 | 1,
    { supported = canVerifyFiscalKeyChainQa, readAuth = captureFiscalStatusBoundContext,
        readCertificate = fiscalWorkflowV2Client.readLocalSigningCertificate, native = keyChain } = {},
): Promise<void> {
    if (!supported()) throw Error('FISCAL_SIGNING_KEYCHAIN_UNAVAILABLE');
    const auth = readAuth();
    if (auth.descriptor.terminalId !== terminalId) throw Error('FISCAL_SIGNING_TERMINAL_CHANGED');
    const certificateSha256 = await readCertificate(issuerRnc, environment);
    auth.assertCurrent();
    if (!certificateSha256) throw Error('FISCAL_SIGNING_CERTIFICATE_AUTHORITY_REQUIRED');

    const result = await native.verify({ certificateSha256 });
    auth.assertCurrent();
    if (result?.verified !== true) throw Error('FISCAL_SIGNING_KEYCHAIN_UNAVAILABLE');

    // The operator may leave the system picker open while the approval changes.
    const currentFingerprint = await readCertificate(issuerRnc, environment);
    auth.assertCurrent();
    if (currentFingerprint !== certificateSha256) throw Error('FISCAL_SIGNING_CERTIFICATE_AUTHORITY_CHANGED');
}
