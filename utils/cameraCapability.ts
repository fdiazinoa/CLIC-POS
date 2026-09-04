import { DeviceFormFactor } from '../types';

export type CameraAvailability = 'UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE';

type MediaDeviceSummary = Pick<MediaDeviceInfo, 'kind'>;
type EnumerateDevices = () => Promise<MediaDeviceSummary[]>;

export const cameraAvailabilityFromDevices = (
  devices: MediaDeviceSummary[],
): CameraAvailability => (
  devices.some(device => device.kind === 'videoinput') ? 'AVAILABLE' : 'UNAVAILABLE'
);

export const detectCameraAvailability = async (
  enumerateDevices?: EnumerateDevices,
): Promise<CameraAvailability> => {
  const enumerate = enumerateDevices
    ?? (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices
      ? navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices)
      : undefined);

  if (!enumerate) return 'UNKNOWN';

  try {
    return cameraAvailabilityFromDevices(await enumerate());
  } catch {
    return 'UNKNOWN';
  }
};

export const shouldUseDesktopSearchClearAction = (
  formFactor: DeviceFormFactor,
  availability: CameraAvailability,
): boolean => formFactor === DeviceFormFactor.DESKTOP_POS && availability === 'UNAVAILABLE';
