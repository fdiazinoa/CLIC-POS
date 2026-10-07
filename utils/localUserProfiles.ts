import type { User } from '../types';

export type LocalUserProfile = Pick<User, 'photo' | 'biometrics'>;
export const LOCAL_USER_PROFILE_CHANGED = 'clic-local-user-profile-changed';
const scopeKey = (tenantId: string) => `clic_local_user_profiles_v1:${encodeURIComponent(tenantId || 'LOCAL')}`;
export const currentProfileTenant = () => localStorage.getItem('clic_tenant_id')?.trim() || '';

export function readLocalUserProfiles(tenantId: string, storage: Pick<Storage, 'getItem'> = localStorage): Record<string, LocalUserProfile> {
  try {
    const value = JSON.parse(storage.getItem(scopeKey(tenantId)) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function applyLocalUserProfiles(users: User[], tenantId = currentProfileTenant(), storage: Pick<Storage, 'getItem'> = localStorage): User[] {
  const profiles = readLocalUserProfiles(tenantId, storage);
  return users.map(user => {
    const profile = Object.prototype.hasOwnProperty.call(profiles, user.id) ? profiles[user.id] : undefined;
    // Local records can never replace ERP identity, PIN, roles or permissions.
    return profile ? { ...user, photo: profile.photo ?? user.photo, biometrics: profile.biometrics ?? user.biometrics } : user;
  });
}

export function saveLocalUserProfile(userId: string, profile: LocalUserProfile, tenantId = currentProfileTenant(), storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  const profiles = readLocalUserProfiles(tenantId, storage);
  Object.defineProperty(profiles, userId, { enumerable: true, configurable: true, writable: true,
    value: { photo: profile.photo, biometrics: profile.biometrics } });
  // Let quota/storage errors reach the caller; never report success before persistence.
  storage.setItem(scopeKey(tenantId), JSON.stringify(profiles));
}
