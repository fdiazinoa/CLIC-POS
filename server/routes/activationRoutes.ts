import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

type TenantType = 'full' | 'pos_only';

type DistributorRow = {
    id: string;
    name: string;
};

const router = Router();

const DOTENV_FILES = ['.env.local', '.env'];

const parseDotEnvFile = (): Record<string, string> => {
    const collected: Record<string, string> = {};

    for (const fileName of DOTENV_FILES) {
        const absolutePath = path.resolve(process.cwd(), fileName);
        if (!fs.existsSync(absolutePath)) continue;

        const content = fs.readFileSync(absolutePath, 'utf8');
        for (const rawLine of content.split('\n')) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;

            const equalIndex = line.indexOf('=');
            if (equalIndex <= 0) continue;

            const key = line.slice(0, equalIndex).trim();
            const value = line.slice(equalIndex + 1).trim();
            if (!key || key in collected) continue;

            collected[key] = value.replace(/^['"]|['"]$/g, '');
        }
    }

    return collected;
};

const fileEnv = parseDotEnvFile();

const getEnvValue = (...keys: string[]): string => {
    for (const key of keys) {
        const processValue = process.env[key];
        if (typeof processValue === 'string' && processValue.trim().length > 0) {
            return processValue.trim();
        }

        const fileValue = fileEnv[key];
        if (typeof fileValue === 'string' && fileValue.trim().length > 0) {
            return fileValue.trim();
        }
    }

    return '';
};

const normalizeOptional = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const normalizeBoolean = (value: unknown, fallback = true): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'si'].includes(normalized)) return true;
        if (['false', '0', 'no'].includes(normalized)) return false;
    }
    return fallback;
};

const normalizeType = (value: unknown): TenantType => {
    return value === 'pos_only' ? 'pos_only' : 'full';
};

const slugifyTenantName = (input: string): string => {
    return input
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 63);
};

const generateTempPassword = (): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const length = 14;
    return Array.from({ length }, () => chars[crypto.randomInt(chars.length)]).join('');
};

const getErrorMessage = (error: unknown): string => {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;

    if (
        typeof error === 'object'
        && error !== null
        && 'message' in error
        && typeof (error as { message?: string }).message === 'string'
    ) {
        return (error as { message: string }).message;
    }

    if (
        typeof error === 'object'
        && error !== null
        && 'error_description' in error
        && typeof (error as { error_description?: string }).error_description === 'string'
    ) {
        return (error as { error_description: string }).error_description;
    }

    return 'Error desconocido';
};

const createSupabaseAdminClient = () => {
    const supabaseUrl = getEnvValue('SUPABASE_URL', 'VITE_SUPABASE_URL');
    const serviceRoleKey = getEnvValue('SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
        return null;
    }

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        db: { schema: 'landlord' },
    });
};

router.get('/distributors', async (_req, res) => {
    const supabaseAdmin = createSupabaseAdminClient();
    if (!supabaseAdmin) {
        return res.status(500).json({
            error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY (o VITE_SUPABASE_SERVICE_ROLE_KEY) en el servidor.',
        });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('distributors')
            .select('id,name')
            .eq('is_active', true)
            .order('name', { ascending: true });

        if (error) {
            const code = (error as { code?: string }).code;
            if (code === '42P01') return res.json([]);
            throw error;
        }

        return res.json((data || []) as DistributorRow[]);
    } catch (error) {
        console.error('Error fetching distributors for activation:', error);
        return res.status(500).json({ error: 'No se pudieron cargar los distribuidores.' });
    }
});

router.post('/provision-tenant', async (req, res) => {
    const supabaseAdmin = createSupabaseAdminClient();
    if (!supabaseAdmin) {
        return res.status(500).json({
            error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY (o VITE_SUPABASE_SERVICE_ROLE_KEY) en el servidor.',
        });
    }

    const name = normalizeOptional(req.body?.name);
    const email = normalizeOptional(req.body?.email);
    const contactName = normalizeOptional(req.body?.contactName);
    const contactEmail = normalizeOptional(req.body?.contactEmail);
    const city = normalizeOptional(req.body?.city);
    const taxId = normalizeOptional(req.body?.taxId);
    const capturedByDistributorId = normalizeOptional(req.body?.capturedByDistributorId);
    const servicedByDistributorId = normalizeOptional(req.body?.servicedByDistributorId);
    const type = normalizeType(req.body?.type);
    const cloudSync = normalizeBoolean(req.body?.cloudSync, true);

    if (!name || !email || !contactName || !contactEmail || !city) {
        return res.status(400).json({
            error: 'Faltan campos requeridos: nombre comercial, email de acceso, persona de contacto, mail de contacto y ciudad.',
        });
    }

    const slug = slugifyTenantName(name);
    if (!slug) {
        return res.status(400).json({ error: 'No se pudo generar un slug válido con el nombre comercial.' });
    }

    const accessEmail = email.toLowerCase();
    const contactMail = contactEmail.toLowerCase();
    const tempPassword = generateTempPassword();

    let authUserId: string | null = null;
    let tenantId: string | null = null;

    try {
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email: accessEmail,
            password: tempPassword,
            email_confirm: true,
            user_metadata: {
                name,
                full_name: name,
                slug,
                type,
                cloudSync,
                contact_name: contactName,
                contact_email: contactMail,
                city,
                captured_by_distributor_id: capturedByDistributorId,
                serviced_by_distributor_id: servicedByDistributorId,
                is_new_user: true,
                must_change_password: true,
                temporary_password: true,
            },
        });

        if (authError) throw authError;
        authUserId = authData.user?.id || null;
        if (!authUserId) {
            throw new Error('No se pudo crear el usuario admin para el tenant.');
        }

        const { data: tenantData, error: tenantError } = await supabaseAdmin.rpc('create_new_tenant', {
            p_name: name,
            p_slug: slug,
            p_email: accessEmail,
            p_type: type,
            p_cloud_sync: cloudSync,
            p_contact_name: contactName,
            p_contact_email: contactMail,
            p_city: city,
            p_captured_by_distributor_id: capturedByDistributorId,
            p_serviced_by_distributor_id: servicedByDistributorId,
        });

        if (tenantError) throw tenantError;
        tenantId = typeof tenantData === 'string' ? tenantData : null;
        if (!tenantId) {
            throw new Error('No se pudo crear el tenant en landlord.');
        }

        const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
            password: tempPassword,
            user_metadata: {
                name,
                full_name: name,
                slug,
                type,
                cloudSync,
                contact_name: contactName,
                contact_email: contactMail,
                city,
                captured_by_distributor_id: capturedByDistributorId,
                serviced_by_distributor_id: servicedByDistributorId,
                is_new_user: true,
                must_change_password: true,
                temporary_password: true,
                tenant_id: tenantId,
            },
        });

        if (metadataError) throw metadataError;

        if (taxId) {
            const { error: taxIdError } = await supabaseAdmin
                .from('tenants')
                .update({ tax_id: taxId })
                .eq('id', tenantId);
            if (taxIdError) throw taxIdError;
        }

        const { error: subscriptionError } = await supabaseAdmin
            .from('subscriptions')
            .insert({
                tenant_id: tenantId,
                plan_name: 'TRIAL',
                is_active: true,
            });

        if (subscriptionError) throw subscriptionError;

        return res.status(201).json({
            tenantId,
            slug,
            email: accessEmail,
            tempPassword,
        });
    } catch (error) {
        console.error('Error provisioning tenant from activation wizard:', error);

        if (tenantId) {
            try {
                await supabaseAdmin.from('subscriptions').delete().eq('tenant_id', tenantId);
            } catch (cleanupError) {
                console.error('Subscription cleanup failed:', cleanupError);
            }

            try {
                await supabaseAdmin.from('tenants').delete().eq('id', tenantId);
            } catch (cleanupError) {
                console.error('Tenant cleanup failed:', cleanupError);
            }
        }

        if (authUserId) {
            try {
                await supabaseAdmin.auth.admin.deleteUser(authUserId);
            } catch (cleanupError) {
                console.error('Auth user cleanup failed:', cleanupError);
            }
        }

        return res.status(400).json({ error: getErrorMessage(error) });
    }
});

export default router;
