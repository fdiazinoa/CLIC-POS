/**
 * Permission Service
 * 
 * Manages terminal-based permissions to enforce master-slave access control.
 * Master terminals can create/edit catalogs, slaves are read-only.
 */

import { BusinessConfig } from '../../types';

class PermissionService {
    private config: BusinessConfig | null = null;
    private currentTerminalId: string | null = null;

    /**
     * Initialize permission service with config
     */
    initialize(config: BusinessConfig, terminalId: string) {
        this.config = config;
        this.currentTerminalId = terminalId;
        console.log(`🔐 PermissionService initialized for terminal: ${terminalId}`);
    }

    /**
     * Get current terminal ID
     */
    getTerminalId(): string | null {
        return this.currentTerminalId;
    }

    getCurrentTerminalIdentityCandidates(): string[] {
        const candidates = new Set<string>();
        const addCandidate = (value: unknown) => {
            const normalized = String(value || '').trim();
            if (normalized) candidates.add(normalized);
        };

        const addStationAliases = (value: unknown) => {
            const station = String(value || '').trim();
            if (!station) return;
            addCandidate(station);
            addCandidate(`Caja ${station}`);
            addCandidate(`Caja ${station.replace(/^0+/, '') || station}`);
        };

        const terminal = this.getCurrentTerminal();
        addCandidate(this.currentTerminalId);
        addCandidate(terminal?.id);
        addCandidate(terminal?.config?.terminalName);
        addCandidate((terminal?.config as any)?.erpBinding?.terminalName);
        addStationAliases(terminal?.config?.stationNumber);
        addStationAliases((terminal?.config as any)?.erpBinding?.stationNumber);
        addCandidate(terminal?.config?.erpTerminalId);
        addCandidate((terminal?.config as any)?.erpBinding?.terminalId);

        try {
            addCandidate(localStorage.getItem('active_terminal_id'));
            addCandidate(localStorage.getItem('CLIC_POS_TERMINAL_ID'));
            addCandidate(localStorage.getItem('clic_erp_sync_terminal_id'));
            addCandidate(localStorage.getItem('clic_erp_sync_terminal_name'));
        } catch {
            // localStorage can be unavailable during non-browser tests.
        }

        return Array.from(candidates);
    }

    /**
     * Get current terminal configuration
     */
    private getCurrentTerminal(): BusinessConfig['terminals'][0] | null {
        if (!this.config || !this.currentTerminalId) return null;
        return (this.config.terminals || []).find(t => t.id === this.currentTerminalId) || null;
    }

    /**
     * Check if current terminal is MASTER
     */
    isMasterTerminal(): boolean {
        const terminal = this.getCurrentTerminal();
        return terminal?.config.isPrimaryNode === true;
    }

    /**
     * Check if current terminal is ENSLAVED
     */
    isSlaveTerminal(): boolean {
        const terminal = this.getCurrentTerminal();

        // FALLBACK: If config not yet loaded/initialized, we check localStorage
        // Presence of 'pos_master_ip' implies this terminal is intended to be a Slave
        if (!terminal) {
            return !!localStorage.getItem('pos_master_ip');
        }

        return !terminal?.config.isPrimaryNode;
    }

    /**
     * Check if terminal should visualize sales from other terminals
     */
    shouldShowGlobalSales(): boolean {
        const terminal = this.getCurrentTerminal();
        return terminal?.config.operational?.showGlobalSales === true || this.isMasterTerminal();
    }

    /**
     * Check if user can create/edit products
     */
    canManageProducts(): boolean {
        return this.isMasterTerminal();
    }

    /**
     * Check if user can create/edit customers
     */
    canManageCustomers(): boolean {
        return this.isMasterTerminal();
    }

    /**
     * Check if user can create/edit suppliers
     */
    canManageSuppliers(): boolean {
        return this.isMasterTerminal();
    }

    /**
     * Check if user can modify system configuration
     */
    canModifyConfiguration(): boolean {
        return this.isMasterTerminal();
    }

    /**
     * Check if user can create document series
     */
    canManageDocumentSeries(): boolean {
        return this.isMasterTerminal();
    }

    /**
     * Check if user can process sales (all terminals)
     */
    canProcessSales(): boolean {
        return true; // Both master and slave can process sales
    }

    /**
     * Check if user can view reports
     */
    canViewReports(): boolean {
        return true; // Both master and slave can view reports
    }

    /**
     * Check if user can access full reports (master only for consolidated)
     */
    canViewConsolidatedReports(): boolean {
        return this.isMasterTerminal();
    }

    /**
     * Get permission error message for catalog operations
     */
    getCatalogPermissionMessage(): string {
        return '🔒 Solo Lectura - Terminal Esclava\n\nLos catálogos (productos, clientes, proveedores) solo pueden ser modificados desde la Terminal Master (PC Principal).';
    }

    /**
     * Get terminal type display name
     */
    getTerminalTypeLabel(): string {
        if (this.isMasterTerminal()) return 'Master';
        if (this.isSlaveTerminal()) return 'Esclava';
        return 'Desconocido';
    }

    /**
     * Check if terminal has been initialized
     */
    isInitialized(): boolean {
        return this.config !== null && this.currentTerminalId !== null;
    }
}

export const permissionService = new PermissionService();
