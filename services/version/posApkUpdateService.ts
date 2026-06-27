import { Capacitor } from '@capacitor/core';
import type { BusinessConfig } from '../../types';

export type PosApkLocalVersion = {
  versionName: string | null;
  versionCode: number | null;
  platform: string | null;
  packageName?: string | null;
};

export type PosApkRelease = {
  version_name: string;
  version_code: number;
  apk_url?: string | null;
  direct_download_url?: string | null;
  checksum_sha256?: string | null;
  changelog?: string | null;
  published_at?: string | null;
};

export type PosApkUpdateAvailable = {
  hasUpdate: true;
  local: PosApkLocalVersion;
  release: PosApkRelease;
  endpointUrl: string;
};

export type PosApkUpdateResult =
  | PosApkUpdateAvailable
  | {
      hasUpdate: false;
      local: PosApkLocalVersion;
      release?: PosApkRelease | null;
      endpointUrl: string;
      reason: 'NO_RELEASE' | 'LOCAL_VERSION_UNKNOWN' | 'NOT_NEWER';
    };

type LatestReleaseResponse = {
  status?: string;
  release?: Partial<PosApkRelease> | null;
};

type CheckOptions = {
  config?: BusinessConfig | null;
  endpointUrl?: string;
  timeoutMs?: number;
  force?: boolean;
};

const DEFAULT_POS_APK_LATEST_URL = 'https://cloud-admin-gamma.vercel.app/api/pos-apk/latest';
const POS_APK_LATEST_URL_STORAGE_KEY = 'clic_pos_apk_latest_url';
const POS_APK_LOCAL_VERSION_CODE_OVERRIDE_KEY = 'clic_pos_apk_local_version_code_override';
const POS_APK_LOCAL_VERSION_NAME_OVERRIDE_KEY = 'clic_pos_apk_local_version_name_override';

let hasCheckedForUpdateThisBoot = false;

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const toFinitePositiveNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseBridgeResult = (raw: unknown): Record<string, unknown> | null => {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return null;

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const getEnv = () => ((import.meta as ImportMeta).env || {}) as Record<string, string | undefined>;

const getLocalStorageValue = (key: string): string => {
  try {
    return normalizeString(window.localStorage.getItem(key));
  } catch {
    return '';
  }
};

const resolveCloudAdminBaseUrl = (config?: BusinessConfig | null): string => {
  const env = getEnv();
  const metadata = ((config as any)?.metadata || {}) as Record<string, unknown>;
  return normalizeString(
    metadata.cloudAdminBaseUrl
    || metadata.cloud_admin_base_url
    || env.VITE_CLOUD_ADMIN_BASE_URL
  ).replace(/\/$/, '');
};

export const resolvePosApkLatestUrl = (config?: BusinessConfig | null): string => {
  const env = getEnv();
  const metadata = ((config as any)?.metadata || {}) as Record<string, unknown>;
  const configuredBaseUrl = resolveCloudAdminBaseUrl(config);
  const explicitUrl = normalizeString(
    metadata.posApkLatestUrl
    || metadata.pos_apk_latest_url
    || getLocalStorageValue(POS_APK_LATEST_URL_STORAGE_KEY)
    || env.VITE_POS_APK_LATEST_URL
    || env.VITE_CLOUD_ADMIN_POS_APK_LATEST_URL
  );

  if (explicitUrl) return explicitUrl;
  if (configuredBaseUrl) return `${configuredBaseUrl}/api/pos-apk/latest`;
  return DEFAULT_POS_APK_LATEST_URL;
};

const fetchWithTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const normalizeLocalVersion = (raw: Record<string, unknown> | null): PosApkLocalVersion => {
  const env = getEnv();
  const overrideCode = toFinitePositiveNumber(getLocalStorageValue(POS_APK_LOCAL_VERSION_CODE_OVERRIDE_KEY));
  const overrideName = getLocalStorageValue(POS_APK_LOCAL_VERSION_NAME_OVERRIDE_KEY);
  const versionName = overrideName || normalizeString(raw?.versionName) || normalizeString(env.VITE_POS_APK_VERSION_NAME) || null;
  const versionCode = overrideCode
    || toFinitePositiveNumber(raw?.versionCode)
    || toFinitePositiveNumber(env.VITE_POS_APK_VERSION_CODE);

  return {
    versionName,
    versionCode,
    platform: normalizeString(raw?.platform) || (Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web'),
    packageName: normalizeString(raw?.packageName) || null,
  };
};

export const readInstalledPosApkVersion = async (): Promise<PosApkLocalVersion> => {
  try {
    const runtimeWindow = window as unknown as {
      ClicPOSNativePrinter?: { getDeviceInfo?: () => unknown | Promise<unknown> };
      AndroidPrinter?: { getDeviceInfo?: () => unknown };
    };
    let rawDeviceInfo: unknown = null;

    if (typeof runtimeWindow.ClicPOSNativePrinter?.getDeviceInfo === 'function') {
      rawDeviceInfo = await runtimeWindow.ClicPOSNativePrinter.getDeviceInfo();
    } else if (typeof runtimeWindow.AndroidPrinter?.getDeviceInfo === 'function') {
      rawDeviceInfo = runtimeWindow.AndroidPrinter.getDeviceInfo();
    }

    return normalizeLocalVersion(parseBridgeResult(rawDeviceInfo));
  } catch (error) {
    console.info('[posApkUpdate] No se pudo leer version instalada del APK:', error);
    return normalizeLocalVersion(null);
  }
};

const normalizeRemoteRelease = (payload: LatestReleaseResponse | null): PosApkRelease | null => {
  const release = payload?.release;
  if (!release) return null;

  const versionCode = toFinitePositiveNumber(release.version_code);
  const versionName = normalizeString(release.version_name);
  if (!versionCode || !versionName) return null;

  return {
    version_name: versionName,
    version_code: versionCode,
    apk_url: normalizeString(release.apk_url) || null,
    direct_download_url: normalizeString(release.direct_download_url) || null,
    checksum_sha256: normalizeString(release.checksum_sha256) || null,
    changelog: normalizeString(release.changelog) || null,
    published_at: normalizeString(release.published_at) || null,
  };
};

export const isRemotePosApkNewer = (
  localVersionCode: number | null | undefined,
  remoteVersionCode: number | null | undefined
): boolean => (
  Number.isFinite(Number(localVersionCode))
  && Number.isFinite(Number(remoteVersionCode))
  && Number(remoteVersionCode) > Number(localVersionCode)
);

export const checkForPosApkUpdate = async (options: CheckOptions = {}): Promise<PosApkUpdateResult | null> => {
  if (hasCheckedForUpdateThisBoot && !options.force) return null;
  if (!options.force) hasCheckedForUpdateThisBoot = true;

  const endpointUrl = options.endpointUrl || resolvePosApkLatestUrl(options.config);
  const local = await readInstalledPosApkVersion();
  const response = await fetchWithTimeout(endpointUrl, options.timeoutMs || 3500);
  if (!response.ok) {
    throw new Error(`Cloud-Admin APK latest endpoint responded ${response.status}`);
  }

  const payload = await response.json().catch(() => null) as LatestReleaseResponse | null;
  const release = normalizeRemoteRelease(payload);
  if (!release) return { hasUpdate: false, local, endpointUrl, release: null, reason: 'NO_RELEASE' };
  if (!local.versionCode) return { hasUpdate: false, local, endpointUrl, release, reason: 'LOCAL_VERSION_UNKNOWN' };
  if (!isRemotePosApkNewer(local.versionCode, release.version_code)) {
    return { hasUpdate: false, local, endpointUrl, release, reason: 'NOT_NEWER' };
  }

  return { hasUpdate: true, local, release, endpointUrl };
};

export const openPosApkDownloadUrl = async (release: PosApkRelease): Promise<void> => {
  const url = normalizeString(release.direct_download_url || release.apk_url);
  if (!url) return;

  const target = Capacitor.isNativePlatform() ? '_system' : '_blank';
  const opened = window.open(url, target, 'noopener,noreferrer');
  if (!opened && !Capacitor.isNativePlatform()) {
    window.location.assign(url);
  }
};
