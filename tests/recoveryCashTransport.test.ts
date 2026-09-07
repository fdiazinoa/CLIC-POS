import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers/closePreparationSQLite";
import { captureOriginalTransport } from "../services/recovery/RecoveryDatabase";
import {
  decodeOriginal,
  encodeOriginal,
} from "../services/recovery/OriginalCodec";
import { buildErpCashMovementPayload } from "../services/sync/erpOutboundPayloads";
test("cash backup binds the final transport without replacing original timestamps, aliases or extension fields", async () => {
  const f = fixture();
  try {
    const { db } = f.open();
    const movement: any = {
      id: "CASH",
      terminalId: "T1",
      type: "OUT",
      amount: 2,
      currencyCode: "USD",
      exchangeRate: 60,
      timestamp: "2026-09-07T00:01:00-04:00",
      created_at: "2026-09-07T04:02:00Z",
      userId: "u",
      userName: "Operador",
      reason: "Gasto",
      extensions: { missing: undefined, nullable: null },
    };
    await db.saveDocument("cashMovements", movement);
    const wire = {
      ...buildErpCashMovementPayload(movement),
      device_id: "lab",
      tenant_id: "tenant",
    };
    const id = await captureOriginalTransport(
      db,
      movement,
      wire,
      "company:terminal",
      "cashMovements",
    );
    assert(id);
    const row = await db.getDocument<any>("recoveryOriginals", id);
    const envelope = decodeOriginal(row.body) as any;
    assert.equal(envelope.transport.route, "/api/sync/cash/movements");
    assert.equal(envelope.transport.item, encodeOriginal(wire));
    assert.equal(envelope.original, encodeOriginal(movement));
    assert.equal(
      await captureOriginalTransport(
        db,
        movement,
        wire,
        "company:terminal",
        "cashMovements",
      ),
      id,
    );
    assert.equal(
      await captureOriginalTransport(
        db,
        movement,
        wire,
        "other",
        "cashMovements",
      ),
      null,
    );
    assert.equal(
      await captureOriginalTransport(
        db,
        { ...movement, amount: 999 },
        wire,
        "company:terminal",
        "cashMovements",
      ),
      null,
    );
  } finally {
    f.close();
  }
});
