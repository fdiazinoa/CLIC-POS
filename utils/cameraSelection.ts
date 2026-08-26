export interface CameraSelectionCandidate {
  id: string;
  label?: string;
}

const BACK_CAMERA_PATTERN = /back|rear|environment|trasera|posterior/i;
const FRONT_CAMERA_PATTERN = /front|user|frontal/i;

export const selectPreferredBackCameraId = (
  devices: CameraSelectionCandidate[],
): string | undefined => {
  if (!Array.isArray(devices) || devices.length === 0) return undefined;

  const backCameras = devices.filter(device => BACK_CAMERA_PATTERN.test(String(device.label || '')));
  return backCameras.find(device => String(device.id) === '0')?.id
    || backCameras[0]?.id
    || devices.find(device => String(device.id) === '0')?.id
    || devices.find(device => !FRONT_CAMERA_PATTERN.test(String(device.label || '')))?.id
    || devices[0]?.id;
};
