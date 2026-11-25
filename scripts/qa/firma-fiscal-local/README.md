# Prueba de laboratorio de firma fiscal local

Esta prueba usa documentos de ejemplo y un certificado autofirmado generado para cada corrida. Ejecuta el firmador XMLDSig del JDK en el equipo de desarrollo. El APK, la impresora y los servicios fiscales quedan fuera de la prueba.

```sh
python3 scripts/qa/firma-fiscal-local/run.py /ruta/a/esquemas
```

Se requiere Python 3 y un JDK con `java` y `keytool`. El directorio de esquemas puede contener `E32.xsd`, `E34.xsd` y `RFCE.xsd`. El resultado indica qué esquemas se comprobaron. Los documentos y la clave sintética se eliminan al terminar.

La medición incluye parseo, firma y serialización de la E32 y su RFCE en una muestra conjunta, y de la E34 en otra. Reporta p50 y p95 de 100 muestras por flujo tras cinco iteraciones de calentamiento. La verificación criptográfica, la validación XSD y la prueba de SQLite se ejecutan fuera del intervalo medido.

La prueba verifica la firma con la clave pública del certificado sintético y comprueba que falla si cambia el monto. El buzón SQLite simula la recepción, conserva los bytes y comprueba que, después de reabrir la base, el mismo comprobante produce el mismo acuse y un contenido distinto genera un conflicto.

El siguiente paso de integración requiere un firmador Android con un certificado autorizado y una ruta de recepción del ERP que conserve los XML firmados. La API pública de emisión de MSeller recibe JSON y firma el documento internamente. La DGII publica servicios de recepción de e-CF y de RFCE para validar un canal directo en certificación.

- [Documentación técnica e-CF y esquemas de DGII](https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Paginas/documentacionSobreE-CF.aspx)
- [API de emisión de MSeller](https://docs.ecf.mseller.app/docs/integration/overview)
