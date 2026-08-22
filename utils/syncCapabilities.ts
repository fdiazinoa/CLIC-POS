export const VARIANT_PROMOTIONS_CAPABILITY = 'VARIANT_PROMOTIONS';
export const VARIANT_PROMOTIONS_CAPABILITY_VERSION = 1;

export const POS_SYNC_CAPABILITY_VERSIONS = Object.freeze({
  [VARIANT_PROMOTIONS_CAPABILITY]: VARIANT_PROMOTIONS_CAPABILITY_VERSION,
});

export const supportsVariantPromotionsCapability = (capabilities: unknown): boolean => (
  Array.isArray(capabilities)
  && capabilities.some((capability) => String(capability || '').trim().toUpperCase() === VARIANT_PROMOTIONS_CAPABILITY)
);
