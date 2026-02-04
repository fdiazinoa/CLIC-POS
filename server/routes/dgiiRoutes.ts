import express from 'express';
// Using global fetch (Node 18+)

const router = express.Router();

const DGII_URL = 'https://dgii.gov.do/app/WebApps/ConsultasWeb2/ConsultasWeb/consultas/rnc.aspx';

interface DGIIResponse {
    rnc: string;
    name: string;
    commercialName?: string;
    status: 'ACTIVO' | 'INACTIVO' | 'NO_REGISTRADO';
    regimeType?: string;
    economicActivity?: string;
    error?: string;
}

// Helper to clean text
const cleanText = (text: string): string => {
    return text
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#\d+;/g, '')
        .trim()
        .replace(/\s+/g, ' ');
};

const parseResponse = (html: string, rnc: string): DGIIResponse => {
    // Check failure
    if (html.includes('No existe') || html.includes('no se encuentra') || html.includes('no encontrado')) {
        return {
            rnc,
            name: '',
            status: 'NO_REGISTRADO',
            error: 'RNC no encontrado en DGII'
        };
    }

    const result: DGIIResponse = {
        rnc,
        name: '',
        status: 'NO_REGISTRADO'
    };

    try {
        // Name
        const nameMatch = html.match(/<td[^>]*>\s*(?:Nombre|Raz[óo]n\s+Social)[^<]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
        if (nameMatch) result.name = cleanText(nameMatch[1]);

        // Commercial Name
        const commercialMatch = html.match(/<td[^>]*>\s*Nombre\s+Comercial[^<]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
        if (commercialMatch) result.commercialName = cleanText(commercialMatch[1]);

        // Status
        const statusMatch = html.match(/<td[^>]*>\s*Estado[^<]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
        if (statusMatch) {
            const statusText = cleanText(statusMatch[1]).toUpperCase();
            if (statusText.includes('ACTIVO')) result.status = 'ACTIVO';
            else if (statusText.includes('INACTIVO') || statusText.includes('SUSPENDIDO')) result.status = 'INACTIVO';
        }

        // Regime
        const regimeMatch = html.match(/<td[^>]*>\s*(?:R[ée]gimen|Tipo)[^<]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
        if (regimeMatch) result.regimeType = cleanText(regimeMatch[1]);

        // Activity
        const activityMatch = html.match(/<td[^>]*>\s*Actividad\s+Econ[óo]mica[^<]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
        if (activityMatch) result.economicActivity = cleanText(activityMatch[1]);

        if (!result.name) result.status = 'NO_REGISTRADO';

    } catch (e) {
        console.error('DGII Parse Error:', e);
        result.error = 'Error parseando respuesta DGII';
    }

    return result;
};

router.get('/validate/:rnc', async (req, res) => {
    const { rnc } = req.params;

    // Server-side validation
    const sanitizedRNC = rnc.replace(/[^0-9]/g, '');
    if (!sanitizedRNC || (sanitizedRNC.length < 9 && sanitizedRNC.length > 11)) {
        return res.status(400).json({ error: 'RNC inválido' });
    }

    console.log(`🔍 [Server] Scraping DGII for RNC: ${sanitizedRNC}`);

    try {
        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

        // STEP 1: GET REQUEST TO OBTAIN VIEWSTATE
        console.log('➡️ [DGII] Step 1: Fetching initial page...');
        const initialResponse = await fetch(DGII_URL, {
            method: 'GET',
            headers: { 'User-Agent': userAgent }
        });

        if (!initialResponse.ok) throw new Error(`Initial fetch failed: ${initialResponse.status}`);
        const initialHtml = await initialResponse.text();

        // Extract Cookies (important for session affinity)
        const cookies = initialResponse.headers.get('set-cookie');

        // Extract ViewState params using Regex
        const viewStateMatch = initialHtml.match(/id="__VIEWSTATE" value="([^"]*)"/);
        const viewStateGenMatch = initialHtml.match(/id="__VIEWSTATEGENERATOR" value="([^"]*)"/);
        const eventValidationMatch = initialHtml.match(/id="__EVENTVALIDATION" value="([^"]*)"/);

        if (!viewStateMatch || !eventValidationMatch) {
            throw new Error('Could not extract ViewState from DGII page');
        }

        const viewState = viewStateMatch[1];
        const viewStateGenerator = viewStateGenMatch ? viewStateGenMatch[1] : '';
        const eventValidation = eventValidationMatch[1];

        // STEP 2: POST REQUEST WITH SEARCH
        console.log('➡️ [DGII] Step 2: Posting search query...');
        const formData = new URLSearchParams();
        formData.append('__VIEWSTATE', viewState);
        formData.append('__VIEWSTATEGENERATOR', viewStateGenerator);
        formData.append('__EVENTVALIDATION', eventValidation);
        formData.append('ctl00$cphMain$txtRNCCedula', sanitizedRNC);
        formData.append('ctl00$cphMain$btnBuscarPorRNC', 'BUSCAR'); // Button trigger is often required

        const searchResponse = await fetch(DGII_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': userAgent,
                'Cookie': cookies || ''
            },
            body: formData
        });

        if (!searchResponse.ok) throw new Error(`Search fetch failed: ${searchResponse.status}`);

        const html = await searchResponse.text();
        const data = parseResponse(html, sanitizedRNC);

        // Cache control
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour at edge if possible
        res.json(data);

    } catch (error: any) {
        console.error('❌ [Server] DGII Error:', error);
        res.status(500).json({
            rnc: sanitizedRNC,
            status: 'NO_REGISTRADO',
            error: error.message
        });
    }
});

export default router;
