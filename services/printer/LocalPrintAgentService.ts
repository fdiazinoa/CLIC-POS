import { notifyPrintQueued } from './PrintFeedback';
export interface LocalPrintJobPayload {
    html: string;
    contentType?: 'HTML' | 'ESC_POS';
    dataBase64?: string;
    printerId?: string;
    printerName?: string;
    printerAddress?: string;
    connection?: string;
    role?: string;
    jobType?: string;
    referenceId?: string;
    copies?: number;
}

interface LocalPrintJobResponse {
    status?: string;
    message?: string;
}

const DEFAULT_AGENT_URL = 'http://localhost:8001/api/print/jobs';

export const LocalPrintAgentService = {
    sendHtmlJob: async (payload: LocalPrintJobPayload): Promise<boolean> => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        try {
            const endpoint = (import.meta as any)?.env?.VITE_PRINT_AGENT_URL || DEFAULT_AGENT_URL;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...payload,
                    contentType: 'HTML'
                }),
                signal: controller.signal,
            });

            if (!response.ok) return false;

            const data = (await response.json()) as LocalPrintJobResponse;
            if (data.status === 'queued') notifyPrintQueued();
            return data.status === 'success' || data.status === 'queued';
        } catch (error) {
            console.warn('Silent print agent unavailable:', error);
            return false;
        } finally {
            clearTimeout(timeout);
        }
    },

    sendEscPosJob: async (payload: Omit<LocalPrintJobPayload, 'html'> & { dataBase64: string }): Promise<boolean> => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        try {
            const endpoint = (import.meta as any)?.env?.VITE_PRINT_AGENT_URL || DEFAULT_AGENT_URL;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...payload,
                    contentType: 'ESC_POS',
                    html: '',
                }),
                signal: controller.signal,
            });

            if (!response.ok) return false;

            const data = (await response.json()) as LocalPrintJobResponse;
            if (data.status === 'queued') notifyPrintQueued();
            return data.status === 'success' || data.status === 'queued';
        } catch (error) {
            console.warn('Silent ESC/POS print agent unavailable:', error);
            return false;
        } finally {
            clearTimeout(timeout);
        }
    },
};
