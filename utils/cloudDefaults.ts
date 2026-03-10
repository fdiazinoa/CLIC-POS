export const DEFAULT_CLOUD_ADMIN_URL = 'https://cloud-admin-gamma.vercel.app';
export const DEFAULT_CLOUD_SUPABASE_URL = 'https://cdfdgxejnbznjxuokrrx.supabase.co';
export const DEFAULT_CLOUD_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkZmRneGVqbmJ6bmp4dW9rcnJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3ODI5NzAsImV4cCI6MjA4NzM1ODk3MH0.SDFHbpa7mowPtnO3Fgf5dzFS4NnRkKkkHpD0Suo-Xg0';
export const DEFAULT_ERP_SYNC_API_URL = 'https://clic-erp.vercel.app/api/sync';

export const normalizeCloudUrl = (value?: string | null) =>
    String(value || '').trim().replace(/\/$/, '');
