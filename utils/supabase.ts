
import { createClient } from '@supabase/supabase-js';

const env = import.meta.env as Record<string, string | boolean | undefined>;
const supabaseUrl = (env['VITE_SUPABASE_URL'] as string | undefined) || '';
const supabaseAnonKey = (env['VITE_SUPABASE_ANON_KEY'] as string | undefined) || '';
const allowInsecureKeys = env['VITE_ALLOW_INSECURE_SUPABASE_KEYS'] === 'true';

const decodeJwtRole = (token: string): string | null => {
    try {
        const [, payload] = token.split('.');
        if (!payload) return null;
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
        const parsed = JSON.parse(atob(normalized));
        return typeof parsed.role === 'string' ? parsed.role : null;
    } catch {
        return null;
    }
};

const isPublicClientKey = (token: string): boolean => {
    if (token.startsWith('sb_publishable_')) return true;
    return decodeJwtRole(token) === 'anon';
};

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('⚠️ Supabase credentials missing in .env. Cloud features will be disabled.');
}

if (supabaseAnonKey && !allowInsecureKeys) {
    const role = decodeJwtRole(supabaseAnonKey);
    if (!isPublicClientKey(supabaseAnonKey)) {
        throw new Error(`VITE_SUPABASE_ANON_KEY must be anon or sb_publishable (current role: ${role || 'unknown'})`);
    }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
