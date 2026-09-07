import test from "node:test";
import assert from "node:assert/strict";
import { recoveryUuid } from "../services/recovery/RecoveryUuid";
test("older WebView uses cryptographic random bytes with v4 and variant bits", () => {
  let calls = 0;
  const source = {
    getRandomValues: (a: Uint8Array) => {
      calls++;
      a.fill(255);
      return a;
    },
  } as any;
  assert.equal(recoveryUuid(source), "ffffffff-ffff-4fff-bfff-ffffffffffff");
  assert.equal(calls, 1);
  assert.throws(() => recoveryUuid({} as any), /SECURE_RANDOM_UNAVAILABLE/);
});
