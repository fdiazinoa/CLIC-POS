import express from 'express';
import { getFiscalProvider } from '../services/fiscal/providers/index.js';
import {
    deleteLocalFiscalCredential,
    deleteSupabaseFiscalCredential,
    inspectFiscalProviderCredential,
    saveLocalFiscalCredential,
    saveSupabaseFiscalCredential
} from '../services/fiscal/credentials.js';
import {
    ElectronicDocumentCode,
    FiscalCompanyInfo,
    FiscalIssueOptions,
    FiscalProviderId,
    FiscalProviderTestRequest,
    FiscalTransactionInput
} from '../services/fiscal/providers/base.js';

const router = express.Router();

const SUPPORTED_PROVIDER_IDS: FiscalProviderId[] = ['POLARIS'];
const SUPPORTED_DOCUMENT_CODES: ElectronicDocumentCode[] = ['E31', 'E32', 'E34'];

const normalizeProviderId = (value: unknown): FiscalProviderId => {
    const normalized = String(value || 'POLARIS').trim().toUpperCase() as FiscalProviderId;
    if (!SUPPORTED_PROVIDER_IDS.includes(normalized)) {
        throw new Error(`Proveedor fiscal inválido: ${value || 'N/D'}`);
    }
    return normalized;
};

const normalizeEnvironment = (value: unknown): number => {
    const parsed = Number(value ?? process.env.POLARIS_ENVIRONMENT ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeDocumentCode = (value: unknown): ElectronicDocumentCode => {
    const normalized = String(value || '').trim().toUpperCase() as ElectronicDocumentCode;
    if (!SUPPORTED_DOCUMENT_CODES.includes(normalized)) {
        throw new Error(`Tipo de documento electrónico inválido: ${value || 'N/D'}`);
    }
    return normalized;
};

const validateCompanyInfo = (companyInfo: unknown): FiscalCompanyInfo => {
    const next = (companyInfo || {}) as FiscalCompanyInfo;
    if (!next?.name || !next?.rnc) {
        throw new Error('companyInfo.name y companyInfo.rnc son obligatorios.');
    }
    return next;
};

const optionalCompanyInfo = (companyInfo: unknown): FiscalCompanyInfo | undefined => {
    if (!companyInfo) return undefined;
    return validateCompanyInfo(companyInfo);
};

const validateTransaction = (transaction: unknown): FiscalTransactionInput => {
    const next = (transaction || {}) as FiscalTransactionInput;
    if (!next?.id) throw new Error('transaction.id es obligatorio.');
    if (!next?.date) throw new Error('transaction.date es obligatorio.');
    if (!Array.isArray(next?.items)) throw new Error('transaction.items es obligatorio.');
    if (!next?.electronicNcf && !next?.ncf) {
        throw new Error('transaction.electronicNcf o transaction.ncf es obligatorio para emitir e-CF.');
    }
    return next;
};

router.post('/providers/test', async (req, res) => {
    try {
        const providerId = normalizeProviderId(req.body?.providerId);
        const environment = normalizeEnvironment(req.body?.environment);
        const companyInfo = req.body?.companyInfo ? validateCompanyInfo(req.body?.companyInfo) : undefined;
        const options = (req.body?.options || {}) as FiscalIssueOptions;
        const authToken = String(req.body?.authToken || '').trim() || undefined;
        const provider = getFiscalProvider(providerId);
        const result = await provider.testConnection({
            environment,
            companyInfo,
            credentialKey: options?.credentialKey,
            authToken
        } satisfies FiscalProviderTestRequest);
        res.json(result);
    } catch (error: any) {
        console.error('❌ [Fiscal] Provider test failed:', error);
        res.status(400).json({
            success: false,
            message: error?.message || 'No se pudo validar el proveedor fiscal.'
        });
    }
});

router.get('/credentials/meta', async (req, res) => {
    try {
        const providerId = normalizeProviderId(req.query.providerId);
        const companyRnc = String(req.query.companyRnc || '').trim();
        const credentialKey = String(req.query.credentialKey || '').trim() || undefined;
        const meta = await inspectFiscalProviderCredential(
            providerId,
            companyRnc ? { name: '', rnc: companyRnc } : undefined,
            credentialKey
        );
        res.json(meta);
    } catch (error: any) {
        console.error('❌ [Fiscal] Credential meta lookup failed:', error);
        res.status(400).json({
            success: false,
            message: error?.message || 'No se pudo consultar la credencial fiscal.'
        });
    }
});

router.post('/credentials/local', async (req, res) => {
    try {
        const providerId = normalizeProviderId(req.body?.providerId);
        const companyInfo = optionalCompanyInfo(req.body?.companyInfo);
        const options = (req.body?.options || {}) as FiscalIssueOptions;
        const authToken = String(req.body?.authToken || '').trim();
        const label = String(req.body?.label || '').trim() || undefined;
        const credentialKey = options?.credentialKey || companyInfo?.rnc;

        if (!authToken) {
            throw new Error('authToken es obligatorio para guardar la credencial local.');
        }

        saveLocalFiscalCredential(providerId, authToken, credentialKey, label);
        const meta = await inspectFiscalProviderCredential(providerId, companyInfo, options?.credentialKey);
        res.json({
            success: true,
            message: 'Credencial fiscal guardada localmente.',
            meta
        });
    } catch (error: any) {
        console.error('❌ [Fiscal] Local credential save failed:', error);
        res.status(400).json({
            success: false,
            message: error?.message || 'No se pudo guardar la credencial fiscal.'
        });
    }
});

router.post('/credentials/supabase', async (req, res) => {
    try {
        const providerId = normalizeProviderId(req.body?.providerId);
        const companyInfo = optionalCompanyInfo(req.body?.companyInfo);
        const options = (req.body?.options || {}) as FiscalIssueOptions;
        const authToken = String(req.body?.authToken || '').trim();
        const credentialKey = options?.credentialKey || companyInfo?.rnc;

        if (!authToken) {
            throw new Error('authToken es obligatorio para guardar la credencial en Supabase.');
        }

        await saveSupabaseFiscalCredential(providerId, authToken, credentialKey);
        const meta = await inspectFiscalProviderCredential(providerId, companyInfo, options?.credentialKey);
        res.json({
            success: true,
            message: 'Credencial fiscal guardada en Supabase.',
            meta
        });
    } catch (error: any) {
        console.error('❌ [Fiscal] Supabase credential save failed:', error);
        res.status(400).json({
            success: false,
            message: error?.message || 'No se pudo guardar la credencial fiscal en Supabase.'
        });
    }
});

router.delete('/credentials/local', async (req, res) => {
    try {
        const providerId = normalizeProviderId(req.body?.providerId);
        const companyInfo = optionalCompanyInfo(req.body?.companyInfo);
        const options = (req.body?.options || {}) as FiscalIssueOptions;
        const credentialKey = options?.credentialKey || companyInfo?.rnc;

        deleteLocalFiscalCredential(providerId, credentialKey);
        const meta = await inspectFiscalProviderCredential(providerId, companyInfo, options?.credentialKey);
        res.json({
            success: true,
            message: 'Credencial fiscal local eliminada.',
            meta
        });
    } catch (error: any) {
        console.error('❌ [Fiscal] Local credential delete failed:', error);
        res.status(400).json({
            success: false,
            message: error?.message || 'No se pudo eliminar la credencial fiscal local.'
        });
    }
});

router.delete('/credentials/supabase', async (req, res) => {
    try {
        const providerId = normalizeProviderId(req.body?.providerId);
        const companyInfo = optionalCompanyInfo(req.body?.companyInfo);
        const options = (req.body?.options || {}) as FiscalIssueOptions;
        const credentialKey = options?.credentialKey || companyInfo?.rnc;

        await deleteSupabaseFiscalCredential(providerId, credentialKey);
        const meta = await inspectFiscalProviderCredential(providerId, companyInfo, options?.credentialKey);
        res.json({
            success: true,
            message: 'Credencial fiscal en Supabase eliminada.',
            meta
        });
    } catch (error: any) {
        console.error('❌ [Fiscal] Supabase credential delete failed:', error);
        res.status(400).json({
            success: false,
            message: error?.message || 'No se pudo eliminar la credencial fiscal en Supabase.'
        });
    }
});

router.post('/documents/issue', async (req, res) => {
    try {
        const providerId = normalizeProviderId(req.body?.providerId);
        const environment = normalizeEnvironment(req.body?.environment);
        const documentCode = normalizeDocumentCode(req.body?.documentCode);
        const companyInfo = validateCompanyInfo(req.body?.companyInfo);
        const transaction = validateTransaction(req.body?.transaction);
        const options = (req.body?.options || {}) as FiscalIssueOptions;
        const authToken = String(req.body?.authToken || '').trim() || undefined;

        const provider = getFiscalProvider(providerId);
        const result = await provider.issueDocument({
            environment,
            documentCode,
            companyInfo,
            transaction,
            options: {
                ...options,
                authToken
            }
        });

        res.status(result.success ? 200 : 422).json(result);
    } catch (error: any) {
        console.error('❌ [Fiscal] Document issue failed:', error);
        res.status(400).json({
            success: false,
            message: error?.message || 'No se pudo emitir el documento fiscal.'
        });
    }
});

router.get('/documents/status', async (req, res) => {
    try {
        const providerId = normalizeProviderId(req.query.providerId);
        const environment = normalizeEnvironment(req.query.environment);
        const providerTransactionId = String(req.query.providerTransactionId || '').trim();
        const credentialKey = String(req.query.credentialKey || '').trim() || undefined;
        const companyRnc = String(req.query.companyRnc || '').trim() || undefined;
        const authToken = String(req.header('x-fiscal-authtoken') || '').trim() || undefined;
        if (!providerTransactionId) {
            throw new Error('providerTransactionId es obligatorio.');
        }

        const provider = getFiscalProvider(providerId);
        const result = await provider.getStatus({
            environment,
            providerTransactionId,
            companyRnc,
            credentialKey,
            authToken
        });
        res.json(result);
    } catch (error: any) {
        console.error('❌ [Fiscal] Status check failed:', error);
        res.status(400).json({
            success: false,
            message: error?.message || 'No se pudo consultar el estado del documento fiscal.'
        });
    }
});

export default router;
