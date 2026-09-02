import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getInitialConfig } from '../constants';
import { SubVertical } from '../types';
import { buildServiceTaxPolicyConfigUpdate } from '../utils/serviceTaxPolicy';

test('guardar tipos de servicio actualiza configuración local sin alterar definiciones fiscales', () => {
  const config = getInitialConfig(SubVertical.SUPERMARKET);
  const originalTaxes = config.taxes;
  const nextConfig = buildServiceTaxPolicyConfigUpdate(config, {
    DINE_IN: { taxIds: ['tax-18'], legalTip: { enabled: false, percentage: 0 } },
    TAKEOUT: { taxIds: [], legalTip: { enabled: false, percentage: 0 } },
    DELIVERY: { taxIds: ['tax-inexistente'], legalTip: { enabled: true, percentage: 5 } },
  });

  assert.equal(nextConfig.taxes, originalTaxes);
  assert.deepEqual(nextConfig.serviceTaxPolicies?.TAKEOUT?.taxIds, []);
  assert.deepEqual(nextConfig.serviceTaxPolicies?.DELIVERY?.taxIds, []);
  assert.equal(nextConfig.serviceTaxPolicies?.DELIVERY?.legalTip?.percentage, 5);
});

test('tipos de servicio tiene una pantalla independiente y no depende de taxes/upsert', () => {
  const settingsSource = readFileSync(new URL('../components/Settings.tsx', import.meta.url), 'utf8');
  const serviceTypeSource = readFileSync(new URL('../components/ServiceTypeSettings.tsx', import.meta.url), 'utf8');
  const taxSource = readFileSync(new URL('../components/TaxSettings.tsx', import.meta.url), 'utf8');

  assert.match(settingsSource, /case 'SERVICE_TYPES'/);
  assert.match(settingsSource, /label="Tipo de servicio"/);
  assert.match(serviceTypeSource, /buildServiceTaxPolicyConfigUpdate/);
  assert.match(serviceTypeSource, /onUpdateConfig\(nextConfig\)/);
  assert.doesNotMatch(serviceTypeSource, /saveTaxes|taxes\/upsert|apiSyncAdapter/);
  assert.doesNotMatch(taxSource, /ServiceTaxPolicyEditor|serviceTaxPolicies/);
});

test('la excepción por terminal vive en su propia pestaña y no dentro de Fiscal', () => {
  const source = readFileSync(new URL('../components/TerminalSettings.tsx', import.meta.url), 'utf8');
  const serviceStart = source.indexOf("activeTab === 'SERVICE_TYPES'");
  const fiscalStart = source.indexOf("activeTab === 'FISCAL'", serviceStart);

  assert.ok(serviceStart > 0);
  assert.ok(fiscalStart > serviceStart);
  assert.match(source.slice(serviceStart, fiscalStart), /ServiceTaxPolicyEditor/);
  assert.doesNotMatch(source.slice(fiscalStart), /ServiceTaxPolicyEditor/);
});
