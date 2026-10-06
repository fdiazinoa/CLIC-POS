import type { TerminalConfig } from '../types';

/** Explicit false overrides historical master visibility; no RBAC permissions are added. */
export const canSeeOtherTerminalSales = (terminal: TerminalConfig | undefined): boolean =>
  terminal?.operational?.showGlobalSales ?? terminal?.security?.clerkCanSeeOtherSales ?? terminal?.isPrimaryNode === true;

export const matchesSalesTerminal = (value: unknown, aliases: unknown[]): boolean => {
  const key = String(value ?? '').trim().toLowerCase();
  return Boolean(key) && aliases.some(alias => String(alias ?? '').trim().toLowerCase() === key);
};
