import { DeviceFormFactor } from '../types';

/** Physical profile is the opt-in. A narrow desktop/tablet keeps its existing UI. */
export const usesHandheldSalePresentation = (
  formFactor: DeviceFormFactor,
  retail: boolean,
  restaurant: boolean,
  kiosk = false,
): boolean => formFactor === DeviceFormFactor.HANDHELD && (retail || restaurant) && !kiosk;
