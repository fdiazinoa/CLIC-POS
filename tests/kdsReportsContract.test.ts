import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const componenteSource = readFileSync(new URL('../components/KdsReports.tsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../components/Settings.tsx', import.meta.url), 'utf8');
const servicioSource = readFileSync(new URL('../server/kds_reports.py', import.meta.url), 'utf8');
const kdsServiceSource = readFileSync(new URL('../server/kds_service.py', import.meta.url), 'utf8');
const endpointSource = readFileSync(new URL('../utils/kdsReportsEndpoint.ts', import.meta.url), 'utf8');

test('existe el componente de informes de KDS y se carga desde Settings', () => {
  assert.ok(componenteSource.length > 0);
  assert.match(componenteSource, /export default function KdsReports\(/);
  assert.match(settingsSource, /const KdsReports = React\.lazy\(\(\) => import\('\.\/KdsReports'\)\);/);
  assert.match(settingsSource, /case 'KDS_REPORTS':/);
  assert.match(settingsSource, /<KdsReports onClose=\{\(\) => setCurrentView\('HOME'\)\} \/>/);
  assert.match(settingsSource, /\| 'KDS_REPORTS'/);
});

test('la tarjeta "Informes de KDS" sigue el patrón de las tarjetas existentes', () => {
  const tarjeta = settingsSource
    .split('\n')
    .find((linea) => linea.includes('label="Informes de KDS"')) || '';

  assert.match(tarjeta, /<SettingsCard/);
  assert.match(tarjeta, /icon=\{BarChart3\}/);
  assert.match(tarjeta, /color="bg-emerald-700"/);
  assert.match(tarjeta, /description="Estados, tiempos, retrasos y volumen por hora"/);
  assert.match(tarjeta, /setCurrentView\('KDS_REPORTS'\)/);
  assert.match(tarjeta, /locked=\{!hasPermission\('SETTINGS_ACCESS'\)\}/);
});

test('el componente no usa datos simulados: todo viene de los endpoints de informes', () => {
  for (const endpoint of [
    'orders-by-state',
    'prep-times',
    'delays',
    'station-performance',
    'hourly-volume',
  ]) {
    assert.match(componenteSource, new RegExp(`/api/cocina/informes/${endpoint}`));
  }

  assert.match(componenteSource, /const respuesta = await fetch\(url, \{ signal, cache: 'no-store' \}\);/);
  assert.match(componenteSource, /if \(!respuesta\.ok\)/);
  assert.match(componenteSource, /No se pudieron cargar los informes de KDS:/);

  // Sin mocks, fixtures locales ni números inventados en el render.
  assert.doesNotMatch(componenteSource, /jest\.mock|vi\.mock|msw|faker|mockData|MOCK_/i);
  assert.doesNotMatch(componenteSource, /const\s+(pedidos|tiempos|retrasos|volumen)Datos\s*=\s*\[/);
  assert.doesNotMatch(componenteSource, /localStorage|indexedDB|better-sqlite3/);
});

test('el componente ofrece rangos, KPIs y las tres secciones pedidas', () => {
  for (const preset of ['HOY', 'AYER', 'SIETE_DIAS', 'PERSONALIZADO']) {
    assert.match(componenteSource, new RegExp(`id: '${preset}'`));
  }

  assert.match(componenteSource, /label="Desde"/);
  assert.match(componenteSource, /label="Hasta"/);
  assert.match(componenteSource, /aria-label="Estación"/);
  assert.match(componenteSource, /aria-label="Minutos de SLA"/);

  assert.match(componenteSource, /> Pedidos/);
  assert.match(componenteSource, /> Tiempo medio/);
  assert.match(componenteSource, /> Retrasos/);
  assert.match(componenteSource, /> Desempeño por estación/);
  assert.match(componenteSource, /> Volumen por hora/);

  // Barras simples con divs, sin librerías de gráficos nuevas.
  assert.match(componenteSource, /style=\{\{ height: `\$\{Math\.max\(/);
  assert.doesNotMatch(componenteSource, /recharts|chart\.js|d3|victory|nivo/);
});

test('el componente maneja estados vacíos y errores en español', () => {
  assert.match(componenteSource, /Sin órdenes en el rango/);
  assert.match(componenteSource, /No hay órdenes de cocina en el rango seleccionado/);
  assert.match(componenteSource, /Aún no hay ciclos completos \(recibido → listo\) en el rango seleccionado\./);
  assert.match(componenteSource, /Ningún pedido superó el SLA de/);
  assert.match(componenteSource, /El servicio KDS no respondió a tiempo\./);
  assert.match(componenteSource, /Reintentar/);
  assert.match(componenteSource, /rounded-2xl border border-gray-200 bg-white p-4/);
});

test('el backend expone las marcas del ciclo y los cinco informes', () => {
  for (const marca of ['recibido_at', 'inicio_at', 'listo_at', 'entregado_at']) {
    assert.match(servicioSource, new RegExp(`"${marca}"`));
  }
  // El servicio KDS delega las marcas en el módulo de informes y las escribe al recibir.
  assert.match(kdsServiceSource, /from kds_reports import \(/);
  assert.match(kdsServiceSource, /apply_status_transition,/);
  assert.match(kdsServiceSource, /mark_delivered,/);
  assert.match(kdsServiceSource, /estado_cocina, area_id, recibido_at\) VALUES/);

  // Migración idempotente: ALTER TABLE solo si falta la columna.
  assert.match(servicioSource, /for columna, definicion in COLUMNAS_DETALLE:/);
  assert.match(servicioSource, /ALTER TABLE ordenes_detalles ADD COLUMN \{columna\} \{definicion\}/);
  assert.match(servicioSource, /if columna in existentes:/);

  // Idempotencia de las marcas: nunca se sobrescribe una marca ya puesta.
  assert.match(servicioSource, /COALESCE\(inicio_at, \?\)/);
  assert.match(servicioSource, /COALESCE\(listo_at, \?\)/);
  assert.match(servicioSource, /COALESCE\(entregado_at, \?\)/);

  // Endpoints de solo lectura, con rango y filtro opcional por estación.
  for (const ruta of [
    'orders-by-state',
    'prep-times',
    'delays',
    'station-performance',
    'hourly-volume',
  ]) {
    assert.match(servicioSource, new RegExp(`@router\\.get\\("/${ruta}"\\)`));
  }
  assert.match(servicioSource, /APIRouter\(prefix="\/api\/cocina\/informes"/);
  assert.match(servicioSource, /estacion: Optional\[str\] = Query/);
  assert.match(servicioSource, /status_code=400/);
  assert.match(kdsServiceSource, /app\.include_router\(build_reports_router\(get_db_connection\)\)/);

  // Agregado en SQL: no se cargan filas para promediar en Python.
  assert.match(servicioSource, /ROW_NUMBER\(\) OVER/);
  assert.match(servicioSource, /GROUP BY estacion/);
  assert.match(servicioSource, /strftime\('%H'/);
});

test('los informes usan el mismo puerto que la pantalla de cocina', () => {
  // El puerto se resuelve como en KitchenDisplay (parámetro o preferencia del equipo),
  // no fijo en 8001: si la cocina sirve en otro puerto, los informes deben encontrarla.
  assert.doesNotMatch(componenteSource, /:8001`/);
  assert.match(componenteSource, /resolveKdsReportsBaseUrl as resolveKdsDeviceBaseUrl/);
  assert.match(componenteSource, /resolveKdsDeviceBaseUrl\(\{ override \}\)/);
  assert.match(endpointSource, /new URLSearchParams\(search\)\.get\('kdsPort'\)/);
  assert.match(endpointSource, /localStorage\.getItem\('CLIC_POS_KDS_PORT'\)/);
});

test('una orden devuelta no aporta un tiempo de preparación inventado', () => {
  // hora_terminado de una fila DEVUELTO es la devolución, no el momento de estar lista.
  assert.match(servicioSource, /UPPER\(COALESCE\(estado_cocina, ''\)\) <> 'DEVUELTO'/);
  assert.match(servicioSource, /listo_at_devuelto_omitido/);
});
