
import { createClient } from '@supabase/supabase-js';

const _env = (import.meta as any).env || {};
const supabaseUrl = _env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = _env.VITE_SUPABASE_ANON_KEY || '';
const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

if (!hasSupabaseConfig) {
    console.warn('⚠️ Supabase credentials missing in .env. Cloud features will be disabled.');
}

// Keep runtime alive even when .env is missing. Activation/login will still fail gracefully.
const safeUrl = supabaseUrl || 'https://placeholder.supabase.co';
const safeAnonKey = supabaseAnonKey || 'placeholder-anon-key';

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
