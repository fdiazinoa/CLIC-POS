import {isDocumentSeriesCompatibleWithType} from '../../utils/documentSeriesIdentity';
import type { FinancialNumberReservation, FinancialNumberResult } from './DatabaseAdapter';

/** The same validation/issuance arithmetic is used by ordinary native reservations and format commits. */
export function planFinancialNumbers(input: FinancialNumberReservation, series: any | undefined, counter: any | undefined): {
  result: FinancialNumberResult; series?: any; counter?: any;
} {
  const result: FinancialNumberResult = {};
  let nextSeries: any;
  let nextCounter: any;
  if (input.seriesId) {
    if (!series || series.id !== input.seriesId || series.active === false
      || input.documentType && !isDocumentSeriesCompatibleWithType(input.documentType,series)) {
      throw new Error('POS_FORMAT_SERIES_FORBIDDEN');
    }
    const next = series.nextNumber ?? 1;
    if (!Number.isSafeInteger(next) || next <= 0 || next >= Number.MAX_SAFE_INTEGER
      || series.maxNumber && next > series.maxNumber) throw new Error('POS_FORMAT_SEQUENCE_EXHAUSTED');
    nextSeries = {...series, nextNumber: next + 1};
    Object.assign(result, {seriesNumber: next,
      displayId: `${series.prefix || ''}${String(next).padStart(series.padding || 6, '0')}`, series: nextSeries});
  }
  if (input.global) {
    const count = counter?.count ?? 0;
    if (!Number.isSafeInteger(count) || count < 0 || count >= Number.MAX_SAFE_INTEGER) throw new Error('POS_FORMAT_SEQUENCE_EXHAUSTED');
    nextCounter = {...counter, id: 'value', count: count + 1};
    result.globalSequence = count + 1;
  }
  return {result, series: nextSeries, counter: nextCounter};
}

/** Current metadata wins; only already-issued counter values are retained against stale generic snapshots. */
export const FINANCIAL_COUNTER_UPSERT_SQL = `CASE
 WHEN documents.collection_name='internalSequences' THEN json_set(excluded.data,'$.nextNumber',
   MAX(COALESCE(json_extract(documents.data,'$.nextNumber'),1),COALESCE(json_extract(excluded.data,'$.nextNumber'),1)))
 WHEN documents.collection_name='localFiscalBuffer'
  AND json_extract(documents.data,'$.allocationId') IS json_extract(excluded.data,'$.allocationId')
  AND json_extract(documents.data,'$.fiscalRangeId') IS json_extract(excluded.data,'$.fiscalRangeId')
  AND json_extract(documents.data,'$.terminalId') IS json_extract(excluded.data,'$.terminalId')
  AND json_extract(documents.data,'$.type') IS json_extract(excluded.data,'$.type')
  AND json_extract(documents.data,'$.prefix') IS json_extract(excluded.data,'$.prefix')
  AND json_extract(documents.data,'$.startNumber') IS json_extract(excluded.data,'$.startNumber')
  AND json_extract(documents.data,'$.endNumber') IS json_extract(excluded.data,'$.endNumber')
  AND json_extract(documents.data,'$.expiryDate') IS json_extract(excluded.data,'$.expiryDate')
 THEN json_set(excluded.data,'$.currentNumber',MAX(COALESCE(json_extract(documents.data,'$.currentNumber'),1),COALESCE(json_extract(excluded.data,'$.currentNumber'),1)))
 WHEN documents.collection_name='globalSequenceCounter' THEN json_set(excluded.data,'$.count',
   MAX(COALESCE(json_extract(documents.data,'$.count'),0),COALESCE(json_extract(excluded.data,'$.count'),0)))
 ELSE __FINANCIAL_DOCUMENT__ END`;
