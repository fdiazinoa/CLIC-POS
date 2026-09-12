import type { TaxDefinition } from '../types';

const normalizeTaxToken = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const taxMatchesIdentifier = (
  tax: Pick<TaxDefinition, 'id'> & Partial<Pick<TaxDefinition, 'code'>>,
  identifier: unknown
): boolean => {
  const token = normalizeTaxToken(identifier);
  if (!token) return false;

  return [tax.id, tax.code]
    .map((value) => normalizeTaxToken(value))
    .filter(Boolean)
    .includes(token);
};

export const findTaxByIdentifier = <T extends Pick<TaxDefinition, 'id'> & Partial<Pick<TaxDefinition, 'code'>>>(
  taxes: T[] | undefined,
  identifier: unknown
) => (Array.isArray(taxes) ? taxes.find((tax) => taxMatchesIdentifier(tax, identifier)) || null : null) as T | null;

export const taxIdentifierSetMatches = (
  identifiers: unknown[] | undefined,
  tax: Pick<TaxDefinition, 'id'> & Partial<Pick<TaxDefinition, 'code'>>
): boolean => Array.isArray(identifiers) && identifiers.some((identifier) => taxMatchesIdentifier(tax, identifier));

export const canonicalizeTaxIdentifiers = (
  identifiers: unknown[] | undefined,
  taxes: Array<Pick<TaxDefinition, 'id'> & Partial<Pick<TaxDefinition, 'code'>>> | undefined
): string[] => {
  const current = Array.isArray(identifiers)
    ? identifiers.filter((identifier): identifier is string => typeof identifier === 'string' && identifier.trim().length > 0)
    : [];

  if (!Array.isArray(taxes) || taxes.length === 0) {
    return Array.from(new Set(current.map((identifier) => identifier.trim())));
  }

  return Array.from(new Set(
    current
      .map((identifier) => findTaxByIdentifier(taxes, identifier)?.id || null)
      .filter((identifier): identifier is string => Boolean(identifier))
  ));
};

export const normalizeTaxIdentifiersForSelection = (
  identifiers: unknown[] | undefined,
  tax: Pick<TaxDefinition, 'id'> & Partial<Pick<TaxDefinition, 'code'>>
): string[] => {
  const current = Array.isArray(identifiers)
    ? identifiers.filter((identifier): identifier is string => typeof identifier === 'string' && identifier.trim().length > 0)
    : [];

  return current.filter((identifier) => !taxMatchesIdentifier(tax, identifier));
};
