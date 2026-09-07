import test from "node:test";
import assert from "node:assert/strict";
import {
  configureRecoveryAvailability,
  discoverRecoveryAvailability,
  hasDiscoveredRecoveryAvailability,
} from "../services/recovery/RecoveryAvailability";
test("authenticated capability enables empty local settings only for current scope, supports offline and revocation", async () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) || null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
  let key = "scope-a";
  const ctx = () => ({ key, terminalIds: ["T1"] });
  configureRecoveryAvailability(() => key);
  const cap = {
    enabled: true,
    contractVersion: 1,
    exactZEligible: false,
    closeAuthorization: "NOT_GRANTED",
    receivedClose: {
      scope: {
        tenantId: "tenant",
        companyId: "company",
        storeId: "store",
        terminalId: "T1",
      },
    },
  };
  assert.equal(hasDiscoveredRecoveryAvailability(storage), false);
  assert.equal(
    await discoverRecoveryAvailability(ctx, async () => cap, storage),
    true,
  );
  assert.equal(hasDiscoveredRecoveryAvailability(storage), true);
  await assert.rejects(
    discoverRecoveryAvailability(
      ctx,
      async () => {
        throw Error("offline");
      },
      storage,
    ),
  );
  assert.equal(hasDiscoveredRecoveryAvailability(storage), true);
  key = "scope-b";
  assert.equal(hasDiscoveredRecoveryAvailability(storage), false);
  key = "scope-a";
  await discoverRecoveryAvailability(
    ctx,
    async () => ({ ...cap, enabled: false }),
    storage,
  );
  assert.equal(hasDiscoveredRecoveryAvailability(storage), false);
  await assert.rejects(
    discoverRecoveryAvailability(
      ctx,
      async () => {
        key = "scope-b";
        return cap;
      },
      storage,
    ),
    /SCOPE_CHANGED/,
  );
  assert.equal(hasDiscoveredRecoveryAvailability(storage), false);
  assert.equal(
    await discoverRecoveryAvailability(
      ctx,
      async () => ({
        ...cap,
        receivedClose: {
          scope: { ...cap.receivedClose.scope, terminalId: "OTHER" },
        },
      }),
      storage,
    ),
    false,
  );
});
