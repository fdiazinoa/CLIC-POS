export interface LicenseStatus {
    isValid: boolean;
    reason?: string;
}

export const checkLicenseStatus = async (
    tenantId: string,
    deviceId: string
): Promise<LicenseStatus> => {
    try {
        const _meta = import.meta as any;
        const supabaseUrl = _meta.env.VITE_SUPABASE_URL || localStorage.getItem('CLIC_POS_MASTER_URL');
        const supabaseKey = _meta.env.VITE_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseKey) {
            // Failsafe: Si no hay credenciales de la nube configuradas localmente, asumimos modo on-premise puro.
            console.warn("No Cloud Supabase configuration found. License check bypassed.");
            return { isValid: true };
        }

        // 1. Validar estado del tenant
        const res = await fetch(`${supabaseUrl}/rest/v1/tenants?id=eq.${tenantId}&select=status`, {
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            },
            signal: AbortSignal.timeout(5000) // Fast fail
        });

        if (!res.ok) throw new Error('Failed to fetch tenant status from Cloud');

        const tenants = await res.json();
        if (!tenants || tenants.length === 0) {
            // Si el ID existe pero no en la nube de administración
            return { isValid: true };
        }

        const status = tenants[0].status;
        if (status === 'SUSPENDED') {
            return { isValid: false, reason: 'Servicio Suspendido. Por favor, contacte a soporte o regularice su pago para restaurar el servicio.' };
        }

        // 2. Transmitir latido de pulso (Check-in de terminal) de forma asíncrona sin bloquear
        fetch(`${supabaseUrl}/rest/v1/terminals?device_token=eq.${deviceId}`, {
            method: 'PATCH',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ last_checkin_at: new Date().toISOString() })
        }).catch(e => console.warn("Check-in silenciado falló", e));

        return { isValid: true };

    } catch (error) {
        console.error("License validation local network/fetch fail, allowing offline tolerance usage: ", error);
        // Tolerancia a fallos: permitimos operar de forma offline si la red se corta y no se pudo validar
        return { isValid: true };
    }
}
