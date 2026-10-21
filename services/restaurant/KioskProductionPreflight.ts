import type { BusinessConfig, CartItem } from '../../types';
import { resolveRestaurantProductConfig } from '../../utils/restaurantProductConfig';
import { resolveProductionOutputTargets } from '../../utils/productionOutputMode';
import { resolveKdsBaseUrl } from '../../utils/kdsRouting';

/** Validate configured destinations before any cash/sequence/transaction effects. Connectivity retries stay durable. */
export function prepareKioskProduction(items: CartItem[], areas: unknown[], config: BusinessConfig, terminalId: string,
  options: { strict?: boolean } = {}) {
  const strict = options.strict !== false;
  const areaById = new Map(areas.filter((row: any) => row && (!strict || row.active !== false && row.is_active !== false))
    .map((row: any) => [String(row.id || '').trim(), row]));
  const selected = new Map<string, any>();
  for (const item of items) {
    const id = resolveRestaurantProductConfig(item).production_area_id;
    if (!id) throw Error(`${item.name} no tiene centro de producción configurado.`);
    const area = areaById.get(id);
    if (!area) throw Error(`${item.name} no tiene un centro de producción disponible.`);
    selected.set(id, area);
  }
  return [...selected].map(([areaId, area]) => {
    if (!strict) {
      // Existing non-V3 kiosks default omitted modes to KDS and queue missing/offline targets.
      return { areaId, area, ...resolveProductionOutputTargets(area.modo_salida),
        printerId: area.printer_id || area.printerId, kdsBaseUrl: resolveKdsBaseUrl(area, config) };
    }
    const rawMode = String(area.modo_salida || '').trim().toUpperCase();
    if (!['KDS', 'PRINTER', 'IMPRESORA', 'TICKET', 'AMBOS', 'BOTH', 'KDS_PRINTER', 'PRINTER_KDS',
      'PANTALLA_IMPRESORA', 'PANTALLA_E_IMPRESORA', 'MONITOR_TICKET'].includes(rawMode)) {
      throw Error(`${area.nombre || area.name || areaId} no tiene salida de producción configurada.`);
    }
    const targets = resolveProductionOutputTargets(rawMode);
    let printerId: string | undefined;
    if (targets.shouldPrint) {
      const explicit = Object.prototype.hasOwnProperty.call(area, 'printer_id') ? area.printer_id : area.printerId;
      const explicitClear = Object.prototype.hasOwnProperty.call(area, 'printer_id') && !area.printer_id;
      const terminal = config.terminals?.find(row => row.id === terminalId);
      const assigned = terminal?.config?.hardware?.printerAssignments?.KITCHEN;
      const printer = explicitClear ? undefined : explicit ? config.availablePrinters?.find(row => row.id === explicit)
        : config.availablePrinters?.find(row => row.productionAreaId === areaId)
          || (assigned ? config.availablePrinters?.find(row => row.id === assigned) : undefined);
      if (!printer) throw Error(`${area.nombre || area.name || areaId} no tiene una impresora configurada disponible.`);
      printerId = printer.id;
    }
    const kdsBaseUrl = targets.shouldSendKds ? resolveKdsBaseUrl(area, config) : null;
    if (targets.shouldSendKds && !kdsBaseUrl) throw Error(`${area.nombre || area.name || areaId} no tiene destino KDS configurado.`);
    return { areaId, area, ...targets, printerId, kdsBaseUrl };
  });
}
