# Promociones dirigidas a variantes

CLIC-POS soporta promociones dirigidas a una o varias variantes de un artículo a partir del capability de sincronización `VARIANT_PROMOTIONS`, versión `1`.

## Contrato ERP → POS

```json
{
  "targetType": "VARIANT",
  "targetValue": "ID-ARTICULO-PADRE",
  "targetRefs": ["SKU-VARIANTE", "VARIANT-ID-ALIAS", "BARCODE-ALIAS"],
  "targetLabel": "Artículo / Variante A, Variante B"
}
```

- `targetValue` identifica exclusivamente al artículo padre.
- `targetRefs` contiene las identidades aceptadas de las variantes elegibles. El SKU de la variante es la identidad canónica; `variantId` y barcodes pueden incluirse como aliases.
- El ERP debe deduplicar la lista. El POS vuelve a deduplicarla de manera defensiva ignorando mayúsculas y espacios.
- Una promoción puede incluir referencias de una o varias variantes.

## Matching en el POS

Una línea es elegible solamente cuando:

1. pertenece al artículo padre de `targetValue`;
2. contiene al menos una identidad explícita de variante; y
3. `variantSku`, `variantId` o uno de `variantBarcodes` coincide con `targetRefs` después de normalizar mayúsculas y espacios.

No existe fallback al artículo padre. Una línea sin variante o con otra variante del mismo artículo no recibe el descuento.

Las líneas nuevas conservan `variantSku`, `variantId` y `variantBarcodes`. Estos campos, junto con `promotionTrace`, viajan dentro del artículo del ticket y se conservan en SQLite, tickets estacionados, reaperturas y payloads offline.

## Trazabilidad

Cuando aplica una promoción, la línea incluye:

```json
{
  "promotionTrace": {
    "promotionId": "PROMO-ID",
    "targetType": "VARIANT",
    "targetValue": "ID-ARTICULO-PADRE",
    "matchedVariantRef": "SKU-VARIANTE",
    "matchedTargetRef": "SKU-VARIANTE",
    "matchedVariantRefType": "SKU"
  }
}
```

`matchedVariantRefType` puede ser `SKU`, `VARIANT_ID` o `BARCODE`.

## Negociación de capability

El registro y heartbeat ERP publican:

```json
{
  "sync_capabilities": ["CONFIG_PUSH_V2", "VARIANT_PROMOTIONS"],
  "capabilities": ["CONFIG_PUSH_V2", "VARIANT_PROMOTIONS"],
  "capability_versions": {
    "VARIANT_PROMOTIONS": 1
  }
}
```

El ERP solo debe enviar reglas `targetType: "VARIANT"` a terminales que anuncien `VARIANT_PROMOTIONS` con una versión compatible. Una terminal que no anuncie el capability debe quedar fuera de esa distribución.

Como defensa adicional, CLIC-POS descarta promociones con un `targetType` explícito desconocido. Nunca las convierte automáticamente en promociones `PRODUCT`. Los payloads históricos sin `targetType` explícito conservan el fallback compatible a `PRODUCT`.
