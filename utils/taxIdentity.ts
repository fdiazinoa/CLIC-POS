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

export const canonicalizeTaxMutationValues = (
  before: unknown[] | undefined,
  after: unknown[] | undefined,
  taxes: Array<Pick<TaxDefinition, 'id'> & Partial<Pick<TaxDefinition, 'code'>>> | undefined
): { before: string[]; after: string[]; repaired: boolean } => {
  const originalBefore = Array.isArray(before)
    ? before.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map(value => value.trim())
    : [];
  const originalAfter = Array.isArray(after)
    ? after.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map(value => value.trim())
    : [];
  const canonicalBefore = canonicalizeTaxIdentifiers(originalBefore, taxes);
  const canonicalAfter = canonicalizeTaxIdentifiers(originalAfter, taxes);

  // Never turn an unknown non-empty selection into an unintended tax removal.
  if (originalAfter.length > 0 && canonicalAfter.length === 0) {
    return { before: originalBefore, after: originalAfter, repaired: false };
  }

  return {
    before: canonicalBefore,
    after: canonicalAfter,
    repaired: JSON.stringify(originalBefore) !== JSON.stringify(canonicalBefore)
      || JSON.stringify(originalAfter) !== JSON.stringify(canonicalAfter),
  };
};
