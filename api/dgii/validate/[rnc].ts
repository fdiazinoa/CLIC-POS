const DGII_URL = 'https://dgii.gov.do/app/WebApps/ConsultasWeb2/ConsultasWeb/consultas/rnc.aspx';

type DGIIStatus = 'ACTIVO' | 'INACTIVO' | 'NO_REGISTRADO';

type DGIIResponse = {
  rnc: string;
  name: string;
  commercialName?: string;
  status: DGIIStatus;
  regimeType?: string;
  economicActivity?: string;
  error?: string;
};

const cleanText = (text: string): string =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .trim()
    .replace(/\s+/g, ' ');

const parseResponse = (html: string, rnc: string): DGIIResponse => {
  if (html.includes('No existe') || html.includes('no se encuentra') || html.includes('no encontrado')) {
    return {
      rnc,
      name: '',
      status: 'NO_REGISTRADO',
      error: 'RNC no encontrado en DGII',
    };
  }

  const result: DGIIResponse = {
    rnc,
    name: '',
    status: 'NO_REGISTRADO',
  };

  try {
    const nameMatch = html.match(/<td[^>]*>\s*(?:Nombre|Raz[óo]n\s+Social)[^<]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
    if (nameMatch) result.name = cleanText(nameMatch[1]);

    const commercialMatch = html.match(/<td[^>]*>\s*Nombre\s+Comercial[^<]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
    if (commercialMatch) result.commercialName = cleanText(commercialMatch[1]);

    const statusMatch = html.match(/<td[^>]*>\s*Estado[^<]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
    if (statusMatch) {
      const statusText = cleanText(statusMatch[1]).toUpperCase();
      if (statusText.includes('ACTIVO')) result.status = 'ACTIVO';
      else if (statusText.includes('INACTIVO') || statusText.includes('SUSPENDIDO')) result.status = 'INACTIVO';
    }

    const regimeMatch = html.match(/<td[^>]*>\s*(?:R[ée]gimen|Tipo)[^<]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
    if (regimeMatch) result.regimeType = cleanText(regimeMatch[1]);

    const activityMatch = html.match(/<td[^>]*>\s*Actividad\s+Econ[óo]mica[^<]*<\/td>\s*<td[^>]*>([^<]+)<\/td>/i);
    if (activityMatch) result.economicActivity = cleanText(activityMatch[1]);

    if (!result.name) result.status = 'NO_REGISTRADO';
  } catch (error) {
    console.error('[DGII Vercel] Parse error:', error);
    result.error = 'Error parseando respuesta DGII';
  }

  return result;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawRnc = req.query?.rnc;
  const requestedRnc = Array.isArray(rawRnc) ? rawRnc[0] : rawRnc;
  const sanitizedRNC = String(requestedRnc || '').replace(/[^0-9]/g, '');

  if (!sanitizedRNC || sanitizedRNC.length < 9 || sanitizedRNC.length > 11) {
    return res.status(400).json({
      rnc: sanitizedRNC,
      status: 'NO_REGISTRADO',
      error: 'RNC inválido',
    });
  }

  try {
    const userAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

    const initialResponse = await fetch(DGII_URL, {
      method: 'GET',
      headers: { 'User-Agent': userAgent },
    });

    if (!initialResponse.ok) {
      throw new Error(`Initial fetch failed: ${initialResponse.status}`);
    }

    const initialHtml = await initialResponse.text();
    const cookies = initialResponse.headers.get('set-cookie');

    const viewStateMatch = initialHtml.match(/id="__VIEWSTATE" value="([^"]*)"/);
    const viewStateGenMatch = initialHtml.match(/id="__VIEWSTATEGENERATOR" value="([^"]*)"/);
    const eventValidationMatch = initialHtml.match(/id="__EVENTVALIDATION" value="([^"]*)"/);

    if (!viewStateMatch || !eventValidationMatch) {
      throw new Error('Could not extract ViewState from DGII page');
    }

    const formData = new URLSearchParams();
    formData.append('__VIEWSTATE', viewStateMatch[1]);
    formData.append('__VIEWSTATEGENERATOR', viewStateGenMatch ? viewStateGenMatch[1] : '');
    formData.append('__EVENTVALIDATION', eventValidationMatch[1]);
    formData.append('ctl00$cphMain$txtRNCCedula', sanitizedRNC);
    formData.append('ctl00$cphMain$btnBuscarPorRNC', 'BUSCAR');

    const searchResponse = await fetch(DGII_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent,
        Cookie: cookies || '',
      },
      body: formData,
    });

    if (!searchResponse.ok) {
      throw new Error(`Search fetch failed: ${searchResponse.status}`);
    }

    const html = await searchResponse.text();
    const data = parseResponse(html, sanitizedRNC);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json(data);
  } catch (error: any) {
    console.error('[DGII Vercel] Request failed:', error);
    return res.status(500).json({
      rnc: sanitizedRNC,
      name: '',
      status: 'NO_REGISTRADO',
      error: error?.message || 'Error consultando DGII',
    });
  }
}
