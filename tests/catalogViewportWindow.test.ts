import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogViewportWindow } from '../utils/catalogViewportWindow';

const base = {
  itemCount: 2000,
  columns: 4,
  rowHeight: 176,
  rowGap: 12,
  paddingTop: 12,
  paddingBottom: 12,
  viewportHeight: 388,
};

test('keeps all catalog rows reachable while mounting only viewport plus one row on each side', () => {
  const first = catalogViewportWindow({ ...base, scrollTop: 0 });
  assert.equal(first.startIndex, 0);
  assert.ok(first.endIndex <= 16);
  assert.equal(first.rowCount, 500);
  assert.ok(first.totalHeight > 90_000);

  const middle = catalogViewportWindow({ ...base, scrollTop: 40_000 });
  assert.ok(middle.startIndex > 800);
  assert.ok(middle.endIndex - middle.startIndex <= 20);

  const last = catalogViewportWindow({ ...base, scrollTop: first.totalHeight });
  assert.equal(last.endIndex, 2000);
  assert.ok(last.startIndex < last.endIndex);
});

test('returns full final partial row without duplicates or missing indices', () => {
  const input = { ...base, itemCount: 101 };
  const reached = new Set<number>();
  const totalHeight = catalogViewportWindow({ ...input, scrollTop: 0 }).totalHeight;
  for (let top = 0; top <= totalHeight + input.viewportHeight; top += 100) {
    const window = catalogViewportWindow({ ...input, scrollTop: top });
    for (let index = window.startIndex; index < window.endIndex; index += 1) reached.add(index);
  }
  assert.deepEqual([...reached].sort((a, b) => a - b), Array.from({ length: 101 }, (_, index) => index));
});

test('empty and small catalogs remain safe', () => {
  const empty = catalogViewportWindow({ ...base, itemCount: 0, scrollTop: 0 });
  assert.deepEqual([empty.startIndex, empty.endIndex, empty.rowCount], [0, 0, 0]);
  const small = catalogViewportWindow({ ...base, itemCount: 3, scrollTop: 10_000 });
  assert.deepEqual([small.startIndex, small.endIndex], [0, 3]);
});
