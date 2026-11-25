const traceSections = new Set([
  'terminals', 'terminalSnapshots', 'companyInfo', 'metadata', 'fiscalCompliance',
  'tariffs', 'taxes', 'inventoryScope', 'business_config', 'businessConfig', 'operational',
  'posCategories', 'roles', 'paymentMethods', 'documentSeries', 'promotions', 'campaigns', 'coupons',
]);

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => equalJson(value, right[index]));
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length
    && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && equalJson(a[key], b[key]));
}

/** Compare the values as persisted JSON. Array order remains meaningful. */
export function terminalConfigChangedSections(previous: Record<string, unknown>, next: Record<string, unknown>): string[] {
  const changed = new Set<string>();
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const before = Object.hasOwn(previous, key) ? JSON.stringify(previous[key]) : undefined;
    const after = Object.hasOwn(next, key) ? JSON.stringify(next[key]) : undefined;
    if (before === after || (before !== undefined && after !== undefined && equalJson(JSON.parse(before), JSON.parse(after)))) {
      continue;
    }
    // Field names from the payload can be dynamic. Only export known section names.
    changed.add(traceSections.has(key) ? key : 'other');
  }
  return [...changed];
}
