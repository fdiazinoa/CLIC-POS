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
