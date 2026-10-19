# Isolated POS fiscal workflow producer

This harness is called by the ERP's isolated PostgreSQL integration runner. It never opens ADB, operational SQLite, Supabase, or a provider endpoint. Node 22 and the existing POS dependencies are required.

```sh
node scripts/validation/fiscal-workflow-pos-producer.mjs --input /tmp/pg-seed.json --state /tmp/pos-fixture.db --output /tmp/pos-wire.json
node scripts/validation/fiscal-workflow-pos-producer.mjs --state /tmp/pos-fixture.db --status /tmp/erp-state-dto.json --output /tmp/pos-status-result.json
```

The input must identify `ERP_PG_WORKFLOW_PERMIT_SEED_V1` with schemaVersion 1, an actual isolated ERP permit DTO, scope, and the synthetic commercial `sourceFixture`. Scope, catalog stamps, fiscal range/allocation, and NCF sequence come from that fixture. An existing output state file is never overwritten. The synthetic state file includes an explicit guard marker; status mode refuses any other SQLite file and never reseeds it.

Production callers executed by producer mode:

- The actual `beforeV3PaymentEffects` callback, then the native checkout store and payment-effect journal.
- Native fiscal-number reservation and `snapshotFiscalIssuance` using the fixture's exact lot identity and limits.
- Actual `transactionService.createTransaction`, normalizer, App completion handler, financial planner, and `CapacitorSQLiteAdapter` writer.
- A repeated completion of the same producer result, which must preserve the two original outbox events.

Output includes the source/history read back from native SQLite, exact SALE_POSTED/PAYMENT_POSTED event payloads, checkout, consumed permit, watch list, fiscal reservation counts, and source SHA-256. The harness never supplies a birth, financial fingerprint, or outbox payload to the writer. Authority/catalog/session transports are controlled fixtures, not proof of live device authorization.

Status mode executes actual `createFiscalWorkflowV2Client.consult`, proof verification, native sidecar CAS, and update event. It then lets the normal singleton read the same SQLite sidecar and calls the actual verified print-display/acceptance, ESC/POS, email, and SVG QR producers. Only the GET response is injected from the ERP runner's actual DTO. It asserts byte-for-byte conservation of original financial documents, history, inventory ledger, reservations, numbering, and outbox. Artifacts are `OUTPUT.print.bin` and `OUTPUT.print.svg`; they demonstrate rendered payloads, not physical printing or DGII production acceptance. Independent QA must decode the QR and inspect the genuine ERP/fake-provider evidence.

Historical STATUS_ONLY documents, the operational tickets 41/42/46, migrations, and actual provider ISSUE are outside this harness.
