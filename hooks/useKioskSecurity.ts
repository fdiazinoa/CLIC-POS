import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CartItem, Product } from '../types';

export type SecurityLockReason = 'AUDIT' | 'VERIFICATION' | 'SCALE_DISCREPANCY' | 'MANUAL';

interface ShouldAuditInput {
  monto_total: number;
  cantidad_items: number;
  indice_confianza_cliente?: number;
  transaction_signature?: string;
}

interface UseKioskSecurityOptions {
  validateSupervisorPin?: (pin: string) => boolean;
  highValueThreshold?: number;
  highValueAuditProbability?: number;
  scaleToleranceKg?: number;
}

const DEFAULT_UNIT_WEIGHT_KG = 0.35;

const estimateLineWeight = (item: CartItem): number => {
  const quantity = Math.max(0, Number(item.quantity) || 0);
  const isWeighted = item.type === 'SERVICE' || item.operationalFlags?.isWeighted;

  if (isWeighted) {
    return quantity;
  }

  return quantity * DEFAULT_UNIT_WEIGHT_KG;
};

const getCartSignature = (cart: CartItem[]): string => (
  cart
    .map(item => `${item.id}:${Number(item.quantity || 0).toFixed(3)}`)
    .sort()
    .join('|')
);

export const useKioskSecurity = (options: UseKioskSecurityOptions = {}) => {
  const {
    validateSupervisorPin,
    highValueThreshold = 5000,
    highValueAuditProbability = 0.1,
    scaleToleranceKg = 0.35
  } = options;

  const validatePinRef = useRef<UseKioskSecurityOptions['validateSupervisorPin']>(validateSupervisorPin);

  useEffect(() => {
    validatePinRef.current = validateSupervisorPin;
  }, [validateSupervisorPin]);

  const [isLocked, setIsLocked] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [auditTriggered, setAuditTriggered] = useState(false);
  const [lockReason, setLockReason] = useState<SecurityLockReason | null>(null);
  const [lockMessage, setLockMessage] = useState('');
  const [conflictProductId, setConflictProductId] = useState<string | null>(null);
  const [conflictProductName, setConflictProductName] = useState<string | null>(null);
  const [expectedWeightKg, setExpectedWeightKg] = useState(0);
  const [sensorWeightKg, setSensorWeightKg] = useState(0);
  const [supervisorAuthorized, setSupervisorAuthorized] = useState(false);
  const [verificationOverrideSignature, setVerificationOverrideSignature] = useState<string | null>(null);
  const [auditOverrideSignature, setAuditOverrideSignature] = useState<string | null>(null);
  const [scaleOverrideSignature, setScaleOverrideSignature] = useState<string | null>(null);

  const triggerLock = useCallback((
    reason: SecurityLockReason,
    message: string,
    conflict?: { productId?: string | null; productName?: string | null }
  ) => {
    setIsLocked(true);
    setLockReason(reason);
    setLockMessage(message);
    setConflictProductId(conflict?.productId || null);
    setConflictProductName(conflict?.productName || null);
    setSupervisorAuthorized(false);
  }, []);

  const estimateCartWeightKg = useCallback((cart: CartItem[]): number => {
    const value = cart.reduce((sum, item) => sum + estimateLineWeight(item), 0);
    return Number(value.toFixed(3));
  }, []);

  const mockSensorWeightKg = useCallback((cart: CartItem[]): number => {
    const expected = estimateCartWeightKg(cart);
    const randomNoise = (Math.random() * 0.16) - 0.08;
    const mismatchInjection = Math.random() < 0.05 ? ((Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 1.2)) : 0;

    const sensor = Math.max(0, expected + randomNoise + mismatchInjection);
    return Number(sensor.toFixed(3));
  }, [estimateCartWeightKg]);

  const syncVerificationState = useCallback((cart: CartItem[]) => {
    const signature = getCartSignature(cart);
    const flagged = cart.find(item => (item as Product).requires_verification === true);
    const verificationApprovedForCurrentCart =
      Boolean(verificationOverrideSignature) && verificationOverrideSignature === signature;

    setNeedsVerification(Boolean(flagged) && !verificationApprovedForCurrentCart);

    if (!flagged && !isLocked) {
      setConflictProductId(null);
      setConflictProductName(null);
      setVerificationOverrideSignature(null);
    }

    if (verificationOverrideSignature && verificationOverrideSignature !== signature) {
      setVerificationOverrideSignature(null);
      setNeedsVerification(Boolean(flagged));
    }

    if (auditOverrideSignature && auditOverrideSignature !== signature) {
      setAuditOverrideSignature(null);
    }

    if (scaleOverrideSignature && scaleOverrideSignature !== signature) {
      setScaleOverrideSignature(null);
    }
  }, [auditOverrideSignature, isLocked, scaleOverrideSignature, verificationOverrideSignature]);

  const markNeedsVerification = useCallback((product?: Product | null) => {
    if (!product?.requires_verification) return;

    setNeedsVerification(true);
    setConflictProductId(product.id);
    setConflictProductName(product.name);
  }, []);

  const checkVerificationBeforePayment = useCallback((cart: CartItem[]): boolean => {
    const signature = getCartSignature(cart);
    const flagged = cart.find(item => (item as Product).requires_verification === true);
    const verificationApprovedForCurrentCart =
      Boolean(verificationOverrideSignature) && verificationOverrideSignature === signature;

    if (!flagged || verificationApprovedForCurrentCart) {
      return false;
    }

    setNeedsVerification(true);

    triggerLock(
      'VERIFICATION',
      'Compra mantenida para verificación por producto sensible. Un asistente validará la operación.',
      { productId: flagged.id, productName: flagged.name }
    );

    return true;
  }, [triggerLock, verificationOverrideSignature]);

  const shouldAuditTransaction = useCallback((payload: ShouldAuditInput): boolean => {
    const { monto_total, cantidad_items, indice_confianza_cliente = 0.75, transaction_signature } = payload;

    if (transaction_signature && auditOverrideSignature === transaction_signature) {
      return false;
    }

    let probability = 0.02;

    if (monto_total > highValueThreshold) {
      probability = highValueAuditProbability;
    }

    if (cantidad_items >= 20) {
      probability = Math.max(probability, 0.07);
    }

    const normalizedConfidence = Math.max(0.2, Math.min(1, indice_confianza_cliente));
    const adjustedProbability = probability * (1 + ((1 - normalizedConfidence) * 0.5));

    const triggerAudit = Math.random() < adjustedProbability;
    setAuditTriggered(triggerAudit);

    if (triggerAudit) {
      triggerLock(
        'AUDIT',
        'Auditoría aleatoria activada. Un asistente debe validar esta compra antes del pago.'
      );
    }

    return triggerAudit;
  }, [auditOverrideSignature, highValueAuditProbability, highValueThreshold, triggerLock]);

  const evaluateScaleDiscrepancy = useCallback((cart: CartItem[], sensorWeight: number): boolean => {
    const signature = getCartSignature(cart);
    if (scaleOverrideSignature && scaleOverrideSignature === signature) {
      return false;
    }

    const expected = estimateCartWeightKg(cart);
    const sensor = Number((Math.max(0, sensorWeight)).toFixed(3));

    setExpectedWeightKg(expected);
    setSensorWeightKg(sensor);

    const delta = Math.abs(expected - sensor);
    const mismatch = delta > scaleToleranceKg;

    if (mismatch) {
      triggerLock(
        'SCALE_DISCREPANCY',
        'Diferencia de peso detectada en la balanza de seguridad. Espera asistencia para continuar.'
      );
    }

    return mismatch;
  }, [estimateCartWeightKg, scaleOverrideSignature, scaleToleranceKg, triggerLock]);

  const submitSupervisorPin = useCallback((pin: string): boolean => {
    const validator = validatePinRef.current;
    const valid = Boolean(validator && validator(pin));

    if (valid) {
      setSupervisorAuthorized(true);
      return true;
    }

    return false;
  }, []);

  const setSupervisorPinValidator = useCallback((validator?: (pin: string) => boolean) => {
    validatePinRef.current = validator;
  }, []);

  const approveTransaction = useCallback((cart?: CartItem[]) => {
    const signature = cart ? getCartSignature(cart) : null;
    if (signature && lockReason === 'VERIFICATION') {
      setVerificationOverrideSignature(signature);
    }
    if (signature && lockReason === 'AUDIT') {
      setAuditOverrideSignature(signature);
    }
    if (signature && lockReason === 'SCALE_DISCREPANCY') {
      setScaleOverrideSignature(signature);
    }

    setIsLocked(false);
    setNeedsVerification(false);
    setAuditTriggered(false);
    setLockReason(null);
    setLockMessage('');
    setConflictProductId(null);
    setConflictProductName(null);
    setSupervisorAuthorized(false);
    setExpectedWeightKg(0);
    setSensorWeightKg(0);
  }, [lockReason]);

  const clearSecurityState = useCallback(() => {
    setIsLocked(false);
    setNeedsVerification(false);
    setAuditTriggered(false);
    setLockReason(null);
    setLockMessage('');
    setConflictProductId(null);
    setConflictProductName(null);
    setExpectedWeightKg(0);
    setSensorWeightKg(0);
    setSupervisorAuthorized(false);
    setVerificationOverrideSignature(null);
    setAuditOverrideSignature(null);
    setScaleOverrideSignature(null);
  }, []);

  const summary = useMemo(() => ({
    isLocked,
    needsVerification,
    auditTriggered,
    lockReason,
    lockMessage,
    conflictProductId,
    conflictProductName,
    expectedWeightKg,
    sensorWeightKg,
    supervisorAuthorized
  }), [
    isLocked,
    needsVerification,
    auditTriggered,
    lockReason,
    lockMessage,
    conflictProductId,
    conflictProductName,
    expectedWeightKg,
    sensorWeightKg,
    supervisorAuthorized
  ]);

  return {
    ...summary,
    triggerLock,
    markNeedsVerification,
    syncVerificationState,
    checkVerificationBeforePayment,
    shouldAuditTransaction,
    estimateCartWeightKg,
    mockSensorWeightKg,
    evaluateScaleDiscrepancy,
    submitSupervisorPin,
    setSupervisorPinValidator,
    approveTransaction,
    clearSecurityState
  };
};
