import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveKdsReportsBaseUrl, resolveKdsReportsPort } from '../utils/kdsReportsEndpoint';

test('el puerto del KDS se resuelve como en la pantalla de cocina', () => {
  assert.equal(resolveKdsReportsPort({ search: '', storedPort: null }), '8001');
  assert.equal(resolveKdsReportsPort({ search: '', storedPort: '8010' }), '8010');
  // El emparejamiento manda sobre la preferencia guardada.
  assert.equal(resolveKdsReportsPort({ search: '?kdsPort=8020', storedPort: '8010' }), '8020');
  // Un valor inválido cae al puerto por defecto en vez de romper los informes.
  assert.equal(resolveKdsReportsPort({ search: '?kdsPort=abc', storedPort: 'no-es-puerto' }), '8001');
});

test('la base de los informes apunta al mismo host y puerto que sirve la cocina', () => {
  assert.equal(
    resolveKdsReportsBaseUrl({ hostname: '10.0.0.42', search: '', storedPort: null }),
    'http://10.0.0.42:8001',
  );
  assert.equal(
    resolveKdsReportsBaseUrl({ hostname: '10.0.0.42', storedPort: '9001' }),
    'http://10.0.0.42:9001',
  );
  // Un host nulo (APK o webview sin hostname) usa localhost.
  assert.equal(resolveKdsReportsBaseUrl({ hostname: '', storedPort: null }), 'http://localhost:8001');
  assert.equal(resolveKdsReportsBaseUrl({ hostname: '0.0.0.0', storedPort: null }), 'http://localhost:8001');
  // Una URL explícita manda y se le quitan las barras finales.
  assert.equal(
    resolveKdsReportsBaseUrl({ override: 'http://cocina.local:8001///' }),
    'http://cocina.local:8001',
  );
});

test('si el ERP declara el equipo de cocina, los informes van a ese equipo', async () => {
  const { resolveKdsReportsBaseUrlForAreas } = await import('../utils/kdsReportsEndpoint');
  // Sin cocina declarada no hay override: se usa el host de este equipo.
  assert.equal(resolveKdsReportsBaseUrlForAreas([]), null);
  assert.equal(resolveKdsReportsBaseUrlForAreas([{ kds_host: '   ', kds_port: '8001' }]), null);
  assert.equal(
    resolveKdsReportsBaseUrlForAreas([{ kds_host: '10.0.0.42', kds_port: '8100', modo_salida: 'KDS' }]),
    'http://10.0.0.42:8100',
  );
  // Una URL completa se respeta tal cual.
  assert.equal(
    resolveKdsReportsBaseUrlForAreas([{ kds_host: 'http://cocina.local:9000/', modo_salida: 'AMBOS' }]),
    'http://cocina.local:9000',
  );
  // Un puerto inválido cae al de siempre, y una sola área que solo imprime sirve como pista.
  assert.equal(
    resolveKdsReportsBaseUrlForAreas([{ kds_host: 'cocina', kds_port: 'x', modo_salida: 'IMPRESORA' }]),
    'http://cocina:8001',
  );
  // La cocina real manda sobre un área que solo imprime.
  assert.equal(
    resolveKdsReportsBaseUrlForAreas([
      { kds_host: 'impresora', kds_port: '8001', modo_salida: 'PRINTER' },
      { kds_host: 'kds-maestro', kds_port: '8001', modo_salida: 'AMBOS' },
    ]),
    'http://kds-maestro:8001',
  );
});
