import type { BusinessConfig } from '../../types';
import { normalizeErpPaymentMethods } from '../../utils/erpPaymentMethods';

export interface PaymentMethodsSyncDependencies {
  fetchSnapshot: () => Promise<unknown[]>;
  readConfig: () => Promise<BusinessConfig>;
  save: (collection: 'config' | 'paymentMethods', value: any) => Promise<unknown>;
  notify: (config: BusinessConfig) => void;
}

/** Full small catalog: removals and disabled methods must reach checkout too. */
export const syncErpPaymentMethods = async (dependencies: PaymentMethodsSyncDependencies): Promise<number> => {
  const rows = await dependencies.fetchSnapshot();
  // Read after the request, preserving config changes made while downloading.
  const config = await dependencies.readConfig();
  if (!config || Array.isArray(config)) throw new Error('PAYMENT_METHODS_CONFIG_MISSING');
  const methods = normalizeErpPaymentMethods(rows, config.paymentMethods);
  await dependencies.save('paymentMethods', methods);
  if (config.paymentMethodsSource !== 'ERP' || JSON.stringify(methods) !== JSON.stringify(config.paymentMethods)) {
    const next: BusinessConfig = { ...config, paymentMethods: methods, paymentMethodsSource: 'ERP' };
    await dependencies.save('config', next);
    dependencies.notify(next);
  }
  return methods.length;
};
