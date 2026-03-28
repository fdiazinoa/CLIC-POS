import { BusinessConfig } from '../../types';
import { extractTerminalOperationalDocumentState } from '../../utils/terminalConfigSnapshot';
import { mergeDocumentSeriesCollection } from '../../utils/documentSeriesIdentity';
import { saveSetting } from '../db';

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const persistOperationalDocumentState = (
  config: BusinessConfig | null | undefined,
  terminalId?: string | null
) => {
  const resolvedTerminalId = asString(terminalId);
  if (!config || Array.isArray(config) || !resolvedTerminalId) {
    return {
      terminalId: resolvedTerminalId || null,
      savedDocumentSeries: 0,
      savedFiscalRanges: 0,
    };
  }

  try {
    const operationalState = extractTerminalOperationalDocumentState(config, resolvedTerminalId);
    const mergedDocumentSeries = mergeDocumentSeriesCollection(operationalState.documentSeries || []);

    if (Array.isArray(mergedDocumentSeries) && mergedDocumentSeries.length > 0) {
      saveSetting('internalSequences', mergedDocumentSeries);
    }

    if (Array.isArray(operationalState.fiscalRanges) && operationalState.fiscalRanges.length > 0) {
      saveSetting('fiscalRanges', operationalState.fiscalRanges);
    }

    saveSetting('active_terminal_id', resolvedTerminalId);

    return {
      terminalId: resolvedTerminalId,
      savedDocumentSeries: mergedDocumentSeries?.length || 0,
      savedFiscalRanges: operationalState.fiscalRanges?.length || 0,
    };
  } catch (error) {
    console.warn('⚠️ Could not persist operational document state to local backend:', error);
    return {
      terminalId: resolvedTerminalId,
      savedDocumentSeries: 0,
      savedFiscalRanges: 0,
    };
  }
};
