/** ERP-owned preferences only. Invalid/absent values never replace local policy. */
const record = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const boolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return undefined;
};
const pick = (source: Record<string, any>, keys: string[]) => {
  const result: Record<string, any> = {};
  for (const key of keys) {
    const value = boolean(source[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
};
export const terminalPosOptionsPatch = (input: unknown): Record<string, any> => {
  const config = record(input);
  const operational = { ...record(config.businessConfig), ...record(config.business_config), ...record(config.operational) };
  for (const key of ['reservationPolicy', 'deliveryAlerts', 'orderNumbers']) {
    const sections = [record(config.businessConfig)[key], record(config.business_config)[key], record(config.operational)[key]];
    if (sections.some(value => Object.keys(record(value)).length)) operational[key] = Object.assign({}, ...sections.map(record));
  }
  const security = record(config.security);
  const op = pick(operational, ['expandTicket', 'bloqueo_meseros']);
  const sec = pick(security, ['requireManagerForRefunds']);
  for (const [canonical, alias] of [
    ['requirePinForVoid', 'requireManagerForVoid'],
    ['requirePinForDiscount', 'requireManagerForDiscount'],
    ['allowBiometrics', 'biometricEnabled'],
  ]) {
    const value = boolean(security[canonical] !== undefined ? security[canonical] : security[alias]);
    if (value !== undefined) sec[canonical] = sec[alias] = value;
  }
  const globalSales = boolean(operational.showGlobalSales !== undefined ? operational.showGlobalSales : security.clerkCanSeeOtherSales);
  if (globalSales !== undefined) op.showGlobalSales = sec.clerkCanSeeOtherSales = globalSales;
  const consignmentKeys = ['recibir_consignaciones', 'receiveConsignments', 'receive_consignments', 'descargar_consignaciones'];
  const consignment = boolean(consignmentKeys.map(key => operational[key]).find(value => value !== undefined));
  if (consignment !== undefined) for (const key of consignmentKeys) op[key] = consignment;
  const policy = record(operational.reservationPolicy);
  const reservation = pick(policy, ['requireAdvance']);
  for (const [key, min, max, integer] of [
    ['validityDays', 1, 3650, true], ['printCopies', 1, 100, true], ['minimumAdvancePercent', 0, 100, false],
  ] as const) {
    const value = policy[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value))) reservation[key] = value;
  }
  if (Object.keys(reservation).length) op.reservationPolicy = reservation;
  const delivery = pick(record(operational.deliveryAlerts), ['isDeliveryTerminal', 'showUberEatsToast', 'autoOpenUberEatsModal']);
  if (delivery.isDeliveryTerminal === false) delivery.autoOpenUberEatsModal = false;
  if (Object.keys(delivery).length) op.deliveryAlerts = delivery;
  const orders = pick(record(operational.orderNumbers), ['enabled']);
  if (Object.keys(orders).length) op.orderNumbers = orders;
  const ux = pick(record(config.ux), ['showProductImages']);
  if (config.ux?.viewMode === 'VISUAL' || config.ux?.viewMode === 'RETAIL') ux.viewMode = config.ux.viewMode;
  const agenda = boolean(config.startWithAgenda);
  return { operational: op, security: sec, ux, ...(agenda !== undefined ? { startWithAgenda: agenda } : {}) };
};

export const mergeTerminalPosOptions = (local: unknown, ...sources: unknown[]): Record<string, any> => {
  const base = record(local);
  const result = { operational: { ...record(base.operational) }, security: { ...record(base.security) }, ux: { ...record(base.ux) }, startWithAgenda: base.startWithAgenda };
  for (const source of sources) {
    const patch = terminalPosOptionsPatch(source);
    for (const key of ['reservationPolicy', 'deliveryAlerts', 'orderNumbers']) {
      if (patch.operational[key]) patch.operational[key] = { ...record(result.operational[key]), ...patch.operational[key] };
    }
    Object.assign(result.operational, patch.operational);
    Object.assign(result.security, patch.security);
    Object.assign(result.ux, patch.ux);
    if (patch.startWithAgenda !== undefined) result.startWithAgenda = patch.startWithAgenda;
  }
  return result;
};
