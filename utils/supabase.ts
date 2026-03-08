
import { createClient } from '@supabase/supabase-js';
import {
    DEFAULT_CLOUD_SUPABASE_ANON_KEY,
    DEFAULT_CLOUD_SUPABASE_URL,
    normalizeCloudUrl,
} from './cloudDefaults';

const _env = (import.meta as any).env || {};
const supabaseUrl = normalizeCloudUrl(_env.VITE_SUPABASE_URL || DEFAULT_CLOUD_SUPABASE_URL);
const supabaseAnonKey = String(_env.VITE_SUPABASE_ANON_KEY || DEFAULT_CLOUD_SUPABASE_ANON_KEY || '').trim();
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

if (!hasSupabaseConfig) {
    console.warn('⚠️ Supabase credentials missing in .env. Cloud features will be disabled.');
}

const safeUrl = supabaseUrl || DEFAULT_CLOUD_SUPABASE_URL;
const safeAnonKey = supabaseAnonKey || DEFAULT_CLOUD_SUPABASE_ANON_KEY;

export const supabase = createClient(safeUrl, safeAnonKey);

const CLOUD_ACCESS_TOKEN_KEY = 'clic_cloud_access_token';
const CLOUD_REFRESH_TOKEN_KEY = 'clic_cloud_refresh_token';

const persistSessionTokens = (session: {
    access_token?: string | null;
    refresh_token?: string | null;
} | null | undefined) => {
    if (!session?.access_token || !session?.refresh_token) {
        localStorage.removeItem(CLOUD_ACCESS_TOKEN_KEY);
        localStorage.removeItem(CLOUD_REFRESH_TOKEN_KEY);
        return;
    }

    localStorage.setItem(CLOUD_ACCESS_TOKEN_KEY, session.access_token);
    localStorage.setItem(CLOUD_REFRESH_TOKEN_KEY, session.refresh_token);
};

export const clearPersistedSupabaseSession = () => {
    localStorage.removeItem(CLOUD_ACCESS_TOKEN_KEY);
    localStorage.removeItem(CLOUD_REFRESH_TOKEN_KEY);
};

export const ensureSupabaseSessionRestored = async () => {
    try {
        const existingSession = await supabase.auth.getSession();
        if (existingSession.data.session?.access_token) {
            persistSessionTokens(existingSession.data.session);
            return existingSession.data.session;
        }

        const accessToken = localStorage.getItem(CLOUD_ACCESS_TOKEN_KEY) || '';
        const refreshToken = localStorage.getItem(CLOUD_REFRESH_TOKEN_KEY) || '';
        if (!accessToken || !refreshToken) {
            return null;
        }

        const restored = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
        });

        if (restored.error || !restored.data.session) {
            clearPersistedSupabaseSession();
            return null;
        }

        persistSessionTokens(restored.data.session);
        return restored.data.session;
    } catch (error) {
        console.warn('No se pudo restaurar la sesión de Supabase:', error);
        clearPersistedSupabaseSession();
        return null;
    }
};

supabase.auth.onAuthStateChange((_event, session) => {
    persistSessionTokens(session);
});
