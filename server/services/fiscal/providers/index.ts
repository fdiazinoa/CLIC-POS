import { FiscalProvider, FiscalProviderId } from './base.js';
import { DigifactFiscalProvider } from './digifact.js';
import { PolarisFiscalProvider } from './polaris.js';

const providers: Record<FiscalProviderId, FiscalProvider> = {
    DIGIFACT: new DigifactFiscalProvider(),
    POLARIS: new PolarisFiscalProvider()
};

export const getFiscalProvider = (providerId: FiscalProviderId): FiscalProvider => {
    const provider = providers[providerId];
    if (!provider) {
        throw new Error(`Proveedor fiscal no soportado: ${providerId}`);
    }
    return provider;
};
