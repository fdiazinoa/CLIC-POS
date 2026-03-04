
import { createClient } from '@supabase/supabase-js';

const _env = (import.meta as any).env || {};
const supabaseUrl = _env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = _env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('⚠️ Supabase credentials missing in .env. Cloud features will be disabled.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
