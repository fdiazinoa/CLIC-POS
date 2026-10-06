import type { Permission, TerminalConfig } from '../types';

/** Extra PIN policy never supplies or bypasses RBAC permission. */
export const requiresTerminalPolicyPin = (security: TerminalConfig['security'] | undefined, permission: Permission): boolean => {
  if (permission === 'POS_DISCOUNT') return security?.requirePinForDiscount === true;
  if (permission === 'POS_VOID_PAID_TICKET' || permission === 'CAN_REFUND') {
    return security?.requireManagerForRefunds === true || security?.requirePinForVoid === true;
  }
  return permission.startsWith('POS_VOID_') && security?.requirePinForVoid === true;
};
