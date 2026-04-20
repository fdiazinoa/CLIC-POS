import { CustomerDisplayConfig } from '../types';

const DISPLAY_QUERY_PARAM = 'view=VISOR';

const DISPLAY_SESSION_KEYS = [
  'HDMI',
  'USB',
  'NETWORK',
] as const;

type DisplayLaunchMode = 'HDMI' | 'USB' | 'NETWORK';

export interface DisplayLaunchResult {
  opened: boolean;
  mode: DisplayLaunchMode;
  url: string;
  usedSecondScreen: boolean;
}

export interface DisplayPlacement {
  left: number;
  top: number;
  width: number;
  height: number;
}

const DEFAULT_DISPLAY_CONFIG: CustomerDisplayConfig = {
  isEnabled: true,
  welcomeMessage: '¡Bienvenido a CLIC POS!',
  showItemImages: true,
  showQrPayment: true,
  layout: 'SPLIT',
  connectionType: 'HDMI',
  ipAddress: '',
  ads: [],
};

export const normalizeCustomerDisplayConnectionType = (
  value?: CustomerDisplayConfig['connectionType'] | null,
): DisplayLaunchMode => {
  switch ((value || '').toUpperCase()) {
    case 'USB':
      return 'USB';
    case 'NETWORK':
      return 'NETWORK';
    case 'HDMI':
    case 'VIRTUAL':
    default:
      return 'HDMI';
  }
};

export const normalizeCustomerDisplayConfig = (
  raw?: Partial<CustomerDisplayConfig> | null,
): CustomerDisplayConfig => ({
  ...DEFAULT_DISPLAY_CONFIG,
  ...raw,
  connectionType: normalizeCustomerDisplayConnectionType(raw?.connectionType) as CustomerDisplayConfig['connectionType'],
  ipAddress: typeof raw?.ipAddress === 'string' ? raw.ipAddress.trim() : '',
  ads: Array.isArray(raw?.ads) ? raw.ads : DEFAULT_DISPLAY_CONFIG.ads,
});

const buildNetworkVisorUrl = (ipAddress: string): string => {
  const trimmed = ipAddress.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withProtocol);
  url.searchParams.set('view', 'VISOR');
  return url.toString();
};

export const buildCustomerDisplayUrl = (config: CustomerDisplayConfig): string => {
  const normalized = normalizeCustomerDisplayConfig(config);
  if (normalizeCustomerDisplayConnectionType(normalized.connectionType) === 'NETWORK' && normalized.ipAddress) {
    return buildNetworkVisorUrl(normalized.ipAddress);
  }

  const path = window.location.pathname || '/';
  const basePath = path === '/' ? '' : path.replace(/\/+$/, '');
  return `${basePath || ''}/?${DISPLAY_QUERY_PARAM}`;
};

export const detectSecondaryDisplayPlacement = async (): Promise<DisplayPlacement | null> => {
  if (typeof window === 'undefined') return null;

  if ('getScreenDetails' in window) {
    try {
      const details = await (window as any).getScreenDetails();
      const candidate = details?.screens?.find((screen: any) => !screen?.isPrimary)
        || details?.screens?.find((screen: any) => screen !== details?.currentScreen);

      if (candidate) {
        return {
          left: Number(candidate.left || 0),
          top: Number(candidate.top || 0),
          width: Number(candidate.width || 1280),
          height: Number(candidate.height || 720),
        };
      }
    } catch (error) {
      console.warn('[customerDisplay] screen details unavailable', error);
    }
  }

  const availWidth = window.screen?.availWidth || 0;
  const availHeight = window.screen?.availHeight || 0;
  const outerWidth = window.outerWidth || 0;
  const outerHeight = window.outerHeight || 0;
  const screenX = typeof window.screenX === 'number' ? window.screenX : 0;
  const screenY = typeof window.screenY === 'number' ? window.screenY : 0;

  const remainingWidth = availWidth - (screenX + outerWidth);
  if (remainingWidth > 320) {
    return {
      left: screenX + outerWidth,
      top: screenY,
      width: remainingWidth,
      height: Math.max(outerHeight, availHeight || 720),
    };
  }

  return null;
};

const buildDisplayWindowFeatures = (placement?: DisplayPlacement | null) => {
  if (!placement) {
    return 'left=0,top=0,width=1024,height=768,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no';
  }

  return [
    `left=${Math.round(placement.left)}`,
    `top=${Math.round(placement.top)}`,
    `width=${Math.max(640, Math.round(placement.width))}`,
    `height=${Math.max(480, Math.round(placement.height))}`,
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
    'resizable=yes',
    'scrollbars=no',
  ].join(',');
};

export const resetCustomerDisplayAutoLaunch = (contextKey = 'default') => {
  if (typeof window === 'undefined') return;
  DISPLAY_SESSION_KEYS.forEach((mode) => {
    sessionStorage.removeItem(`clic_pos_customer_display_${contextKey}_${mode}`);
  });
};

export const launchCustomerDisplay = async (
  config: CustomerDisplayConfig,
  options?: { contextKey?: string },
): Promise<DisplayLaunchResult> => {
  const normalized = normalizeCustomerDisplayConfig(config);
  const mode = normalizeCustomerDisplayConnectionType(normalized.connectionType);
  const url = buildCustomerDisplayUrl(normalized);
  const placement = mode === 'NETWORK' ? null : await detectSecondaryDisplayPlacement();
  const features = buildDisplayWindowFeatures(placement);
  const target = mode === 'NETWORK' ? 'clic_pos_visor_network' : 'clic_pos_visor';

  const visorWindow = window.open(url, target, features);
  if (!visorWindow) {
    throw new Error(
      mode === 'NETWORK'
        ? 'No pudimos abrir el visor por IP. Revise la URL y permisos del navegador/aplicación.'
        : 'No pudimos abrir el visor en la segunda pantalla. Revise permisos de ventanas y que la pantalla externa esté conectada.',
    );
  }

  try {
    visorWindow.focus?.();
  } catch {
    // no-op
  }

  if (options?.contextKey) {
    sessionStorage.setItem(`clic_pos_customer_display_${options.contextKey}_${mode}`, String(Date.now()));
  }

  return {
    opened: true,
    mode,
    url,
    usedSecondScreen: Boolean(placement),
  };
};

export const maybeAutoLaunchCustomerDisplay = async (
  config: CustomerDisplayConfig | null | undefined,
  options?: { contextKey?: string },
): Promise<DisplayLaunchResult | null> => {
  if (typeof window === 'undefined' || !config?.isEnabled) return null;

  const normalized = normalizeCustomerDisplayConfig(config);
  const mode = normalizeCustomerDisplayConnectionType(normalized.connectionType);
  const contextKey = options?.contextKey || 'default';
  const sessionKey = `clic_pos_customer_display_${contextKey}_${mode}`;

  if (sessionStorage.getItem(sessionKey)) {
    return null;
  }

  if (mode === 'NETWORK' && !normalized.ipAddress) {
    return null;
  }

  try {
    return await launchCustomerDisplay(normalized, { contextKey });
  } catch (error) {
    console.warn('[customerDisplay] auto launch failed', error);
    return null;
  }
};
