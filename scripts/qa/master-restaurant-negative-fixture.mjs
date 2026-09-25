import { readFileSync, writeFileSync } from 'node:fs';

const [sourcePath, destinationPath, mutation] = process.argv.slice(2);
let source = readFileSync(sourcePath, 'utf8');
const once = (before, after) => {
  if (source.split(before).length !== 2) throw new Error(`Expected one mutation boundary: ${mutation}`);
  source = source.replace(before, after);
};
if (mutation === 'cloned-http') {
  once('writeResponse(socket, 200, serializeRestaurantSnapshot(),', 'writeResponse(socket, 200, buildRestaurantSnapshot().toString(),');
} else if (mutation === 'borrowed-bridge') {
  once('fun getRestaurantState(): JSONObject = buildRestaurantSnapshot()', 'fun getRestaurantState(): JSONObject = buildRestaurantSnapshot().put("rooms", roomsSnapshot)');
} else if (mutation === 'revision-cache') {
  once('private fun serializeRestaurantSnapshot(): String = JSONObject()', `private var fixtureCachedRevision = -1L
    private var fixtureCachedBody = ""
    private fun serializeRestaurantSnapshot(): String {
        if (fixtureCachedRevision != restaurantRevision.get()) {
            fixtureCachedBody = serializeUncachedRestaurantSnapshot()
            fixtureCachedRevision = restaurantRevision.get()
        }
        return fixtureCachedBody
    }
    private fun serializeUncachedRestaurantSnapshot(): String = JSONObject()`);
} else throw new Error(`Unknown mutation: ${mutation}`);
writeFileSync(destinationPath, source);
