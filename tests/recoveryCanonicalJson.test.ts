import test from "node:test";
import assert from "node:assert/strict";
import { recoveryCanonicalJson } from "../services/recovery/RecoveryJson";
test("recovery hashes use UTF-16 and explicit numeric-key order; reject non-JSON trees", () => {
  assert.equal(
    recoveryCanonicalJson({ "2": "b", "10": "a", "\uE000": 1, "😀": 2 }),
    '{"10":"a","2":"b","😀":2,"":1}',
  );
  const hole: any[] = Array(1);
  (hole as any).extra = true;
  for (const value of [hole, [undefined], NaN, new Date(), "\uD800"])
    assert.throws(() => recoveryCanonicalJson(value), /RECOVERY_JSON_/);
});
