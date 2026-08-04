
/**
 * NetworkScanner.ts
 * Service responsible for discovering the Master server on the local network.
 */

import { isEligibleOperationalMasterConfig } from '../../utils/masterServerEligibility';

export class NetworkScanner {
    private static readonly TIMEOUT_MS = 400;
    private static readonly CONFIG_VALIDATION_TIMEOUT_MS = 2_500;
    private static readonly PORTS = [3000, 3001];
    private static readonly BATCH_SIZE = 32;

    /**
     * Attempts to find the Master server IP on the local network.
     * @param currentIp Optional hint for the current subnet.
     * @returns The base URL of the Master server if found, otherwise null.
     */
    static async findMaster(currentIp?: string, expectedTenantId?: string): Promise<string | null> {
        console.log('🕵️‍♂️ NetworkScanner: Starting scan...');

        const subnets = this.determineSubnets(currentIp);

        for (const subnet of subnets) {
            console.log(`🕵️‍♂️ NetworkScanner: Scanning subnet ${subnet}.x ...`);
            const foundUrl = await this.scanSubnet(subnet, expectedTenantId);
            if (foundUrl) {
                console.log(`✅ NetworkScanner: FOUND MASTER at ${foundUrl}`);
                return foundUrl;
            }
        }

        console.warn('❌ NetworkScanner: Master not found in any common subnet.');
        return null;
    }

    private static determineSubnets(currentIp?: string): string[] {
        const subnets = new Set<string>();

        // Priority 1: Subnet from current IP hint
        if (currentIp && this.isValidIp(currentIp)) {
            subnets.add(this.getSubnet(currentIp));
            return Array.from(subnets);
        }

        // Priority 2: Common local subnets
        subnets.add('192.168.1');
        subnets.add('192.168.0');
        subnets.add('10.0.0');

        return Array.from(subnets);
    }

    private static getSubnet(ip: string): string {
        return ip.split('.').slice(0, 3).join('.');
    }

    private static isValidIp(ip: string): boolean {
        return /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(ip);
    }

    private static async scanSubnet(subnet: string, expectedTenantId?: string): Promise<string | null> {
        const ips = [];
        for (let i = 1; i < 255; i++) {
            ips.push(`${subnet}.${i}`);
        }

        // Process in batches
        for (let i = 0; i < ips.length; i += this.BATCH_SIZE) {
            const batch = ips.slice(i, i + this.BATCH_SIZE);
            const promiseResults = await Promise.all(
                batch.map(ip => this.checkIp(ip, expectedTenantId))
            );

            const found = promiseResults.find(url => url !== null);
            if (found) return found;
        }

        return null;
    }

    private static async checkIp(ip: string, expectedTenantId?: string): Promise<string | null> {
        const matches = await Promise.all(this.PORTS.map(async port => {
            const url = `http://${ip}:${port}`;
            if (await this.verifyIdent(url, expectedTenantId)) {
                return url;
            }
            return null;
        }));
        return matches.find(Boolean) || null;
    }

    private static async verifyIdent(baseUrl: string, expectedTenantId?: string): Promise<boolean> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);
        try {
            const res = await fetch(`${baseUrl}/api/sync/identify`, {
                signal: controller.signal,
                method: 'GET',
                mode: 'cors'
            });
            if (res.ok) {
                const data = await res.json();
                // Validate it's actually our Master server
                const discoveredTenantId = String(data.tenantId || '').trim();
                const tenantMatches = !expectedTenantId
                    || !discoveredTenantId
                    || discoveredTenantId === expectedTenantId;
                if (data.app === 'CLIC-POS' && data.role === 'MASTER' && tenantMatches) {
                    // La identidad es liviana; la configuración puede ser grande y necesita
                    // su propio margen para distinguir la Master real de un KDS mal anunciado.
                    clearTimeout(timeoutId);
                    const configController = new AbortController();
                    const configTimeoutId = setTimeout(
                        () => configController.abort(),
                        this.CONFIG_VALIDATION_TIMEOUT_MS
                    );
                    try {
                        const configResponse = await fetch(`${baseUrl}/api/config`, {
                            signal: configController.signal,
                        });
                        if (!configResponse.ok) return false;
                        return isEligibleOperationalMasterConfig(await configResponse.json());
                    } finally {
                        clearTimeout(configTimeoutId);
                    }
                }
            }
        } catch (e) {
            // Ignore connection errors
        } finally {
            clearTimeout(timeoutId);
        }
        return false;
    }
}
