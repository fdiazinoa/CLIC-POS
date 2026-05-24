export const DEVICE_REVOKED_EVENT = 'clic-pos-device-revoked';
export const DEVICE_SUPERSEDED_MESSAGE = 'Este equipo ya no está autorizado para esta terminal. La caja fue tomada por otro dispositivo.';

export type DeviceRevocationReason = 'DEVICE_SUPERSEDED' | 'DEVICE_REVOKED' | 'TERMINAL_TAKEOVER';

export type DeviceRevocationDetail = {
  reason: DeviceRevocationReason;
  message: string;
  terminalId?: string | null;
  previousDeviceId?: string | null;
  newDeviceId?: string | null;
  payload?: unknown;
};

const normalize = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

export const resolveLocalDeviceId = (): string => (
  normalize(localStorage.getItem('CLIC_POS_DEVICE_ID'))
  || normalize(localStorage.getItem('pos_device_id'))
);

export const persistLocalDeviceId = (deviceId: string) => {
  const normalized = normalize(deviceId);
  if (!normalized) return;
  localStorage.setItem('pos_device_id', normalized);
  localStorage.setItem('CLIC_POS_DEVICE_ID', normalized);
};

export const isDeviceSupersededError = (error: unknown): boolean => {
  const record = error && typeof error === 'object' ? error as Record<string, any> : {};
  const code = normalize(record.code || record.errorCode).toUpperCase();
  const status = Number(record.status);
  const message = normalize(record.message).toLowerCase();

  return (
    code === 'DEVICE_SUPERSEDED'
    || (status === 403 && message.includes('terminal autorizada'))
    || message.includes('device_superseded')
    || message.includes('dispositivo ya no')
    || message.includes('equipo ya no')
  );
};

export const dispatchDeviceRevoked = (detail: DeviceRevocationDetail) => {
  window.dispatchEvent(new CustomEvent<DeviceRevocationDetail>(DEVICE_REVOKED_EVENT, {
    detail,
  }));
};
