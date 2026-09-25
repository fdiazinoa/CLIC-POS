import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../native-stubs/android/ClicPOSMasterHttpServer.kt', import.meta.url), 'utf8');
test('only HTTP borrows restaurant collections for immediate String serialization', () => {
  const serializer = source.split('private fun serializeRestaurantSnapshot(): String =')[1]?.split('fun getRestaurantState()')[0];
  assert.ok(serializer);
  assert.match(serializer, /put\("rooms", roomsSnapshot\)/);
  assert.match(serializer, /put\("parkedTickets", parkedTicketsSnapshot\)/);
  assert.match(serializer, /put\("customers", catalogSnapshots\.optJSONArray\("customers"\) \?: JSONArray\(\)\)/);
  assert.doesNotMatch(serializer, /getSyncCollection|JSONArray\((roomsSnapshot|parkedTicketsSnapshot)\.toString\(\)\)/);
  assert.match(serializer, /put\("tables", buildTablesWithEditLocks\(\)\)/);
  assert.match(serializer, /productRoutingOverrides\.values\.map \{ JSONObject\(it\.toString\(\)\) \}/);
  assert.equal((source.match(/serializeRestaurantSnapshot\(\)/g) || []).length, 2);
  assert.match(source, /path == "\/api\/mesas" ->\s*writeRestaurantSnapshotResponse\(client\)/);
  assert.match(source, /writeResponse\(socket, 200, serializeRestaurantSnapshot\(\),/);
  assert.match(source, /fun getRestaurantState\(\): JSONObject = buildRestaurantSnapshot\(\)/);
  assert.match(source, /putString\(PREFS_RESTAURANT_KEY, buildRestaurantSnapshot\(\)\.toString\(\)\)/);
});
