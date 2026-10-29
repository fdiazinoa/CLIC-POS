# QA independiente del expediente

Estado: **PASS con límites de evidencia**

Fecha: 2026-09-19

La revisión independiente confirmó:

- coherencia de los percentiles agregados (`p50 ≤ p95 ≤ p99 ≤ máximo`);
- 15,192.099 ms, 2,661 muestras y 99.6618% idle en el perfil V8 crudo;
- cero documentos sintéticos `qa-perf-*` al finalizar;
- orientación restaurada a `accelerometer_rotation=1` y `user_rotation=0`;
- pertinencia de la decisión de no modificar el baseline sin reproducir la causa.

Límites:

- no se conservaron las 200 muestras individuales para recalcular percentiles;
- el emulador 1.1.407, la sincronización pausada y el perfil idle no representan el cliente físico
  1.1.405 durante sincronización activa;
- la evidencia de laboratorio y master-cliente corresponde al reporte operativo del usuario y no está
  adjunta a este expediente;
- la sesión restaurada no puede certificarse independientemente porque el expediente no conserva el
  identificador previo, aunque la operación de restauración reportó éxito.
