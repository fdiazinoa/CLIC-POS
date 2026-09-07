import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectNativeZConfiguration } from "../services/recovery/NativeZConfiguration";
import { buildNativeZReportContent } from "../services/recovery/NativeZReport";
import {
  decodeOriginal,
  encodeOriginal,
} from "../services/recovery/OriginalCodec";
const corpus = JSON.parse(
  readFileSync(
    new URL("./fixtures/nativeZReport-parent.json", import.meta.url),
    "utf8",
  ),
);
process.env.TZ = corpus.timezone;
for (const f of corpus.fixtures)
  test(
    "frozen configuration reproduces complete native output: " + f.name,
    () => {
      const input = decodeOriginal(f.input) as any;
      const config = projectNativeZConfiguration(input.config);
      const result = buildNativeZReportContent({
        ...input,
        config,
        currentTerminal: config.terminals.find(
          (t) => t.id === input.terminalId,
        ),
      });
      assert.equal(encodeOriginal(result), f.expected);
    },
  );
test("configuration projection preserves method precedence and presence, excludes credentials and unrelated terminal data", () => {
  const input = decodeOriginal(corpus.fixtures[2].input) as any;
  input.config.paymentMethods.unshift({
    id: "CASH",
    name: "Primero",
    type: "CASH",
    isEnabled: false,
    integrationConfig: { token: "DO_NOT_COPY" },
  });
  input.config.paymentMethods[1].password = "DO_NOT_COPY";
  input.config.emailConfig = { password: "DO_NOT_COPY" };
  input.config.terminals[0].config.hardware = { password: "DO_NOT_COPY" };
  input.config.terminals[0].config.erpBinding = {
    terminalId: "erp-t1",
    token: "DO_NOT_COPY",
  };
  const before = encodeOriginal(input.config);
  const config = projectNativeZConfiguration(input.config);
  assert.equal(encodeOriginal(input.config), before);
  assert(!encodeOriginal(config).includes("DO_NOT_COPY"));
  assert.equal(config.paymentMethods[0].name, "Primero");
  assert.equal(
    encodeOriginal(
      buildNativeZReportContent({
        ...input,
        config,
        currentTerminal: config.terminals[0],
      }),
    ),
    encodeOriginal(buildNativeZReportContent(input)),
  );
  const projected = projectNativeZConfiguration({
    currencies: undefined,
    taxes: null,
    paymentMethods: [],
  } as any);
  assert(Object.hasOwn(projected, "currencies"));
  assert.equal(projected.currencies, undefined);
  assert.equal(projected.taxes, null);
  assert(!Object.hasOwn(projected, "terminals"));
  assert.throws(
    () =>
      projectNativeZConfiguration({
        paymentMethods: [{ name: { secret: "not-a-label" } }],
      } as any),
    /UNSUPPORTED/,
  );
});
