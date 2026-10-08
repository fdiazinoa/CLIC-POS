/** Invalidate an asynchronous read when the product, manual value, connection
 * or modal lifetime changes. A late native reply must never restore its weight. */
export function createWeightReadGuard() {
  let generation = 0;
  return {
    invalidate() { generation++; },
    begin() {
      const current = ++generation;
      return () => generation === current;
    },
  };
}
