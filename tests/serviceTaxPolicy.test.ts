import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getInitialConfig } from '../constants';
import { SubVertical, type Transaction } from '../types';
import { calculateTaxBreakdownFromItems } from '../utils/fiscalBreakdown';
import { buildServiceTypeReport, shouldApplyRestaurantServiceCharge } from '../utils/orderServiceType';
import {
  normalizeServiceTaxPolicies,
  resolveAppliedServiceTaxPolicy,
} from '../utils/serviceTaxPolicy';
import { applyTerminalConfigSnapshot } from '../utils/terminalConfigSnapshot';

test('normaliza políticas ERP snake_case y camelCase preservando una lista vacía explícita', () => {
  const policies = normalizeServiceTaxPolicies({
    dine_in: {
      applicable_tax_ids: ['vat-18'],
      legal_tip: { enabled: true, percentage: 10 },
    },
    TAKEOUT: {
      taxIds: [],
      legalTip: { enabled: false, percentage: 0 },
    },
  });

  assert.deepEqual(policies?.DINE_IN?.taxIds, ['vat-18']);
  assert.equal(policies?.DINE_IN?.legalTip?.percentage, 10);
  assert.deepEqual(policies?.TAKEOUT?.taxIds, []);
});

test('la terminal tiene prioridad sobre la política general y se congela su origen', () => {
  const config = getInitialConfig(SubVertical.SUPERMARKET);
  config.serviceTaxPolicies = {
    TAKEOUT: { taxIds: ['tax-18'], legalTip: { enabled: false, percentage: 0 } },
  };
  const terminal = config.terminals[0].config;
  terminal.financial.serviceTaxPolicies = {
    TAKEOUT: { taxIds: ['tax-exempt'], legalTip: { enabled: true, percentage: 5 } },
  };

  const policy = resolveAppliedServiceTaxPolicy(config, terminal, 'TAKEOUT');
  assert.equal(policy.source, 'TERMINAL');
  assert.deepEqual(policy.taxIds, ['tax-exempt']);
  assert.deepEqual(policy.legalTip, { enabled: true, percentage: 5 });
});

test('la lista de servicio filtra impuestos sin convertir un artículo exento en gravado', () => {
  const config = getInitialConfig(SubVertical.SUPERMARKET);
  const terminal = config.terminals[0].config;
  const taxed = calculateTaxBreakdownFromItems([
    { price: 100, quantity: 1, appliedTaxIds: ['tax-18', 'tax-propina'] },
  ], config, { terminalConfig: terminal, allowedTaxIds: ['tax-18'] });
  const exempt = calculateTaxBreakdownFromItems([
    { price: 100, quantity: 1, appliedTaxIds: ['tax-exempt'] },
  ], config, { terminalConfig: terminal, allowedTaxIds: ['tax-18'] });

  assert.deepEqual(taxed.map((line) => line.id), ['tax-18']);
  assert.deepEqual(exempt, []);
});

test('una política explícita permite propina legal por servicio sin depender del modo restaurante', () => {
  assert.equal(shouldApplyRestaurantServiceCharge({
    isRestaurantMode: false,
    serviceType: 'DELIVERY',
    serviceCharge: undefined,
    legalTipPolicy: { enabled: true, percentage: 7.5 },
    grossAfterDiscount: 100,
    guests: 0,
  }), true);
});

test('los valores iniciales preservan la propina legal solo en verticales de alimentos', () => {
  const retail = resolveAppliedServiceTaxPolicy(
    getInitialConfig(SubVertical.SUPERMARKET),
    undefined,
    'DINE_IN',
  );
  const restaurant = resolveAppliedServiceTaxPolicy(
    getInitialConfig(SubVertical.RESTAURANT),
    undefined,
    'DINE_IN',
  );

  assert.equal(retail.legalTip?.enabled, false);
  assert.equal(restaurant.legalTip?.enabled, true);
  assert.equal(restaurant.legalTip?.percentage, 10);
});

test('el snapshot ERP aplica políticas generales y excepciones de terminal', () => {
  const config = getInitialConfig(SubVertical.SUPERMARKET);
  const terminalId = config.terminals[0].id;
  const result = applyTerminalConfigSnapshot(config, {
    terminalId,
    posDeviceId: 'device-1',
    bindingMode: 'MASTER',
    incomingSnapshot: {
      business_config: {
        service_tax_policies: {
          TAKEOUT: { tax_ids: ['tax-18'], legal_tip_enabled: false },
        },
      },
      resolved: {
        financial: {
          service_tax_policies: {
            DELIVERY: { tax_ids: ['tax-18'], legal_tip_percentage: 5, legal_tip_enabled: true },
          },
        },
      },
    } as any,
  });

  assert.deepEqual(result.config.serviceTaxPolicies?.TAKEOUT?.taxIds, ['tax-18']);
  assert.deepEqual(result.config.terminals[0].config.financial.serviceTaxPolicies?.DELIVERY?.taxIds, ['tax-18']);
  assert.equal(result.config.terminals[0].config.financial.serviceTaxPolicies?.DELIVERY?.legalTip?.percentage, 5);
});

test('el cierre Z acumula impuestos y propina legal por tipo de servicio', () => {
  const transaction = (patch: Partial<Transaction>): Transaction => ({
    id: patch.id || 'tx', displayId: patch.id || 'tx', documentType: 'TICKET', seriesId: 'T',
    date: '2026-09-01T12:00:00.000Z', items: [], total: 100, payments: [], userId: 'u',
    userName: 'U', terminalId: 't1', status: 'COMPLETED', ...patch,
  });
  const report = buildServiceTypeReport([
    transaction({ id: 'local', serviceType: 'DINE_IN', total: 128, taxAmount: 18, serviceChargeAmount: 10 }),
    transaction({ id: 'takeout', serviceType: 'TAKEOUT', total: 118, taxAmount: 18, serviceChargeAmount: 0 }),
  ]);

  assert.deepEqual(
    report.summary.slice(0, 2).map((line) => [line.serviceType, line.taxAmount, line.serviceChargeAmount]),
    [['DINE_IN', 18, 10], ['TAKEOUT', 18, 0]],
  );
});

test('modo supermercado muestra una cuadrícula 3x4 sin scroll horizontal', () => {
  const source = readFileSync(new URL('../components/ActionGrid.tsx', import.meta.url), 'utf8');
  assert.match(source, /grid-cols-4/);
  assert.match(source, /max-h-\[200px\]/);
  assert.match(source, /overflow-x-hidden/);
  assert.doesNotMatch(source, /overflow-x-auto/);
});
