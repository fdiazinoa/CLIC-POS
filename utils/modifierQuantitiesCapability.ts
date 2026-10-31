/**
 * Whether the ERP accepts quantities on modifier options.
 *
 * Repeating a modifier changes the sales contract, so the cashier only gets the quantity
 * stepper once the ERP confirms support (capability payload). Until then the modal behaves
 * exactly as before, so an older ERP never receives a sale it cannot validate.
 * `CLIC_MODIFIER_QUANTITIES=1|0` forces the decision on one device for testing.
 */

const SUPPORT_KEY = 'CLIC_MODIFIER_QUANTITIES_SUPPORTED';
const OVERRIDE_KEY = 'CLIC_MODIFIER_QUANTITIES';

let observed = false;

export const setModifierQuantitiesSupported = (value: boolean): void => {
  observed = Boolean(value);
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(SUPPORT_KEY, observed ? '1' : '0');
  } catch {
    /* Sin almacenamiento: queda el valor de esta sesión. */
  }
};

export const modifierQuantitiesSupported = (): boolean => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return observed;
    const override = window.localStorage.getItem(OVERRIDE_KEY);
    if (override === '1') return true;
    if (override === '0') return false;
    if (observed) return true;
    return window.localStorage.getItem(SUPPORT_KEY) === '1';
  } catch {
    return observed;
  }
};

/** Test/QA hook: forget the observation of this session. */
export const resetModifierQuantitiesSupport = (): void => { observed = false; };
