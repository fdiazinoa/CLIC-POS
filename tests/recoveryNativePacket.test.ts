import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { fixture } from "./helpers/closePreparationSQLite";
import {
  encodeOriginal,
  decodeOriginal,
  encodeBase64,
  originalDigest,
  ORIGINAL_ENCODING,
} from "../services/recovery/OriginalCodec";
import type { ClosePreparationInput } from "../services/recovery/ClosePreparation";
const erp = process.env.CLIC_ERP_REVIEW_PATH;
const postgres = process.env.CLIC_EMBEDDED_POSTGRES_MODULE;
const hash = (s: string) => originalDigest(new TextEncoder().encode(s));

test(
  "real POS preparation → exact received ERP material → read-only packet, with SQLite reopen and PostgreSQL",
  { skip: !erp || !postgres },
  async () => {
    const { default: EmbeddedPostgres } = await import(
      pathToFileURL(postgres!).href
    );
    const { validateOriginalBatch } = await import(
      pathToFileURL(join(erp!, "server/services/posOriginalRecovery.js")).href
    );
    const { createRecoveredClosePacketProducer } = await import(
      pathToFileURL(
        join(erp!, "server/services/posRecoveredClosePacketProducer.js"),
      ).href
    );
    const probe = createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as any).port;
    await new Promise<void>((r) => probe.close(() => r()));
    const directory = await mkdtemp(join(tmpdir(), "pos-native-packet-"));
    const pg = new EmbeddedPostgres({
      databaseDir: join(directory, "db"),
      user: "postgres",
      password: "isolated-test-only",
      port,
      persistent: false,
      postgresFlags: ["-h", "127.0.0.1"],
      onLog: () => {},
      onError: () => {},
    });
    const local = fixture();
    let { db, prepare } = local.open();
    let started = false;
    let admin: any, reader: any;
    try {
      await pg.initialise();
      await pg.start();
      started = true;
      admin = pg.getPgClient("postgres", "127.0.0.1");
      await admin.connect();
      await admin.query(`create role anon;create role authenticated;create role service_role;
      create table public.erp_sync_inbox(id uuid primary key default gen_random_uuid(),event_id uuid unique,tenant_id uuid not null,store_id uuid,terminal_id uuid,event_type text,payload jsonb,status text,last_error text,processed_at timestamptz);
      create table public.erp_document_series(id uuid primary key,tenant_id uuid,company_id uuid,prefix text,padding integer,next_number bigint);
      create table public.erp_sales_documents(id uuid primary key,tenant_id uuid,company_id uuid,metadata jsonb);
      create table public.erp_accounting_journal_entries(id uuid primary key default gen_random_uuid(),tenant_id uuid,company_id uuid,source_document_type text,source_document_id uuid,journal_date date,reference text,description text,currency_code text,status text,total_debit numeric,total_credit numeric,metadata jsonb);
      create table public.erp_accounting_journal_lines(journal_entry_id uuid references public.erp_accounting_journal_entries(id),line_no integer,account_code text,debit_amount numeric,credit_amount numeric,dimension_type text,dimension_id uuid,dimension_label text,notes text,primary key(journal_entry_id,line_no));
      create table public.erp_journal_entries(id uuid default gen_random_uuid(),tenant_id uuid,company_id uuid,referencia text,descripcion text);
      grant select,insert,update,delete on all tables in schema public to service_role;`);
      for (const name of [
        "20260907130141_pos_original_recovery.sql",
        "20260907142154_pos_original_commercial_links.sql",
        "20260907150126_pos_recovered_close_exact_selection.sql",
        "20260907151348_pos_recovered_close_atomic_commit.sql",
        "20260907154009_pos_recovered_close_series_format.sql",
        "20260907155534_isolate_recovered_close_maintenance.sql",
      ]) {
        await admin.query(
          await readFile(join(erp!, "supabase/migrations", name), "utf8"),
        );
      }
      reader = pg.getPgClient("postgres", "127.0.0.1");
      await reader.connect();
      await reader.query("set role service_role");
      const scope = {
        p_tenant_id: crypto.randomUUID(),
        p_company_id: crypto.randomUUID(),
        p_store_id: crypto.randomUUID(),
        p_terminal_id: crypto.randomUUID(),
      };
      const scopeValues = Object.values(scope);
      const config = {
        id: "current",
        currencies: [{ code: "DOP", isBase: true }],
        paymentMethods: [
          { id: "cash", name: "Efectivo", type: "CASH", isEnabled: true },
        ],
        terminals: [{ id: "T1", config: {} }],
        taxes: [],
      };
      await db.saveDocument("config", config);
      const documents = [
        {
          id: "SALE1",
          terminalId: "T1",
          documentType: "TICKET",
          status: "COMPLETED",
          date: "2026-09-06T23:59:00-04:00",
          total: 100,
          items: [
            {
              id: "p1",
              cartId: "line1",
              name: "Producto",
              price: 100,
              quantity: 1,
              totalAmount: 100,
            },
          ],
          payments: [
            {
              method: "CASH",
              methodId: "cash",
              amount: 100,
              appliedAmount: 100,
            },
          ],
        },
        {
          id: "SALE2",
          terminalId: "T1",
          documentType: "TICKET",
          status: "COMPLETED",
          date: "2026-09-07T00:02:00-04:00",
          total: 50,
          items: [],
          payments: [
            { method: "CASH", methodId: "cash", amount: 50, appliedAmount: 50 },
          ],
        },
      ];
      for (const document of documents)
        await db.saveDocument("transactions", document);
      const request: ClosePreparationInput = {
        preparationId: "integration",
        scopeKey: "company:terminal",
        terminalId: "T1",
        members: documents.map((d) => ({
          collection: "transactions",
          id: d.id,
          expectedDocument: encodeOriginal(d),
        })),
        declaration: {
          cashCountedByCurrency: { DOP: 150 },
          expectedCashByCurrency: { DOP: 150 },
          cashSalesTotal: 150,
        },
        nativeZ: {
          configurationSha256: await hash(encodeOriginal(config)),
          notes: "Offline",
          user: { id: "u1", name: "QA" },
        },
      };
      const prepared = await prepare.prepare(request);
      const frozen = decodeOriginal(prepared.body) as any;
      const bindings: any[] = [];
      const eventIds: string[] = [];
      for (const member of frozen.members) {
        const source = member.source;
        const bytes = new TextEncoder().encode(source.body);
        const record = {
          version: 1,
          storageEpoch: source.storageEpoch,
          openSetId: source.openSetId,
          sequence: source.sequence,
          kind: source.kind,
          originalId: source.originalId,
          revision: source.revision,
          encoding: ORIGINAL_ENCODING,
          bodyBase64: encodeBase64(bytes),
          bodySha256: await originalDigest(bytes),
          byteLength: bytes.length,
        };
        const checked = validateOriginalBatch([record])[0];
        const received = (
          await admin.query(
            "select public.erp_pos_original_receive($1,$2,$3,$4,$5) result",
            [...scopeValues, JSON.stringify([checked])],
          )
        ).rows[0].result.receipts[0];
        const reference = {
          receiptId: received.receiptId,
          recordHash: checked.recordHash,
          storageEpoch: record.storageEpoch,
          kind: record.kind,
          originalId: record.originalId,
          revision: record.revision,
          bodySha256: record.bodySha256,
        };
        const document = decodeOriginal(member.expectedDocument) as any;
        const eventId = crypto.randomUUID();
        eventIds.push(eventId);
        const expected = { transaction: document };
        await admin.query(
          "insert into public.erp_sync_inbox(event_id,tenant_id,store_id,terminal_id,event_type,payload,status) values($1,$2,$3,$4,$5,$6,$7)",
          [
            eventId,
            scope.p_tenant_id,
            scope.p_store_id,
            scope.p_terminal_id,
            "SALE_POSTED",
            JSON.stringify({
              ...expected,
              company_id: scope.p_company_id,
              timezone: "America/Santo_Domingo",
              application_result: {
                document_id: crypto.randomUUID(),
                document_code: document.id,
                accounting_deferred_to_cash_close: true,
                deferred_accounting_lines: [
                  { accountCode: "100", debit: document.total, credit: 0 },
                  { accountCode: "200", debit: 0, credit: document.total },
                ],
              },
            }),
            "APPLIED",
          ],
        );
        await admin.query(
          "select public.erp_pos_original_link_events($1,$2,$3,$4,$5)",
          [
            ...scopeValues,
            JSON.stringify([
              {
                reference,
                events: [
                  { eventId, eventType: "SALE_POSTED", payload: expected },
                ],
              },
            ]),
          ],
        );
        bindings.push({
          group: "members",
          kind: reference.kind,
          originalId: reference.originalId,
          revision: reference.revision,
          reference,
        });
      }
      const image = async (value: unknown) => {
        const body = encodeOriginal(value);
        return { body, bodySha256: await hash(body) };
      };
      const input = {
        scope,
        closeControl: frozen.closeControl,
        nativeReport: frozen.nativeReport,
        receiptBindings: bindings,
        preparation: { body: prepared.body, bodySha256: prepared.bodySha256 },
        configuration: {
          body: frozen.nativeConfiguration.body,
          bodySha256: frozen.nativeConfiguration.bodySha256,
        },
        declaration: await image(request.declaration),
      };
      const calls: string[] = [];
      const producer = createRecoveredClosePacketProducer({
        rpc: async (name: string, args: any) => {
          assert.equal(name, "erp_pos_recovered_close_material");
          calls.push(name);
          return {
            data: (
              await reader.query(
                "select public.erp_pos_recovered_close_material($1,$2,$3,$4,$5) result",
                [
                  args.p_tenant_id,
                  args.p_company_id,
                  args.p_store_id,
                  args.p_terminal_id,
                  JSON.stringify(args.p_references),
                ],
              )
            ).rows[0].result,
          };
        },
      });
      const watched = [
        "public.erp_sync_inbox",
        "public.erp_document_series",
        "public.erp_accounting_journal_entries",
        "public.erp_accounting_journal_lines",
        "private.pos_recovered_close_commits",
        "private.pos_recovered_close_assignments",
        "private.pos_recovered_close_evidence",
      ];
      async function state() {
        const result = [];
        for (const table of watched)
          result.push(
            (
              await admin.query(
                `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') data from ${table} t`,
              )
            ).rows[0].data,
          );
        return result;
      }
      const before = await state();
      const result = await producer.produce(input);
      assert.equal(result.closeAuthorization, "NOT_GRANTED");
      assert.equal(result.exactZEligible, false);
      assert.equal(result.packetHash, await hash(result.packetJson));
      assert.equal(
        result.trace.configurationProfile,
        "pos.native-z.configuration.v1",
      );
      assert.equal(
        result.trace.configurationHash,
        frozen.nativeConfiguration.bodySha256,
      );
      assert.equal(
        result.trace.configurationSourceHash,
        request.nativeZ!.configurationSha256,
      );
      assert.notEqual(
        result.trace.configurationHash,
        result.trace.configurationSourceHash,
      );
      const packet = JSON.parse(result.packetJson);
      assert.deepEqual(
        packet.report,
        JSON.parse(JSON.stringify(frozen.nativeReport)),
      );
      assert.equal(packet.summary.total_sales, 150);
      assert.equal(
        packet.journal.lines.reduce((n: number, l: any) => n + l.debit, 0),
        150,
      );
      assert.deepEqual(await state(), before);
      ({ db, prepare } = local.restart());
      const resumed = await prepare.resume(
        request.scopeKey,
        request.preparationId,
      );
      assert.equal(resumed.body, prepared.body);
      const reopened = decodeOriginal(resumed.body) as any;
      const reopenedRequest = decodeOriginal(reopened.requestBody) as any;
      assert.equal(
        (
          await producer.produce({
            ...input,
            preparation: { body: resumed.body, bodySha256: resumed.bodySha256 },
            nativeReport: reopened.nativeReport,
            closeControl: reopened.closeControl,
            configuration: {
              body: reopened.nativeConfiguration.body,
              bodySha256: reopened.nativeConfiguration.bodySha256,
            },
            declaration: await image(reopenedRequest.declaration),
          })
        ).packetJson,
        result.packetJson,
      );
      // A newly serialized full config cannot silently replace the frozen projection.
      await assert.rejects(
        producer.produce({ ...input, configuration: await image(config) }),
        /CONFIGURATION_MISMATCH/,
      );
      await assert.rejects(
        producer.produce({
          ...input,
          configuration: await image({ paymentMethods: [] }),
        }),
        /CONFIGURATION_MISMATCH/,
      );
      assert.deepEqual(await state(), before);
      await assert.rejects(
        producer.produce({
          ...input,
          declaration: await image({ cashCounted: 999 }),
        }),
        /DECLARATION_MISMATCH/,
      );
      await assert.rejects(
        producer.produce({ ...input, receiptBindings: bindings.slice(1) }),
        /SELECTION_MISMATCH|MEMBERS/,
      );
      await admin.query(
        "update public.erp_sync_inbox set status='FAILED' where event_id=$1",
        [eventIds[0]],
      );
      const failed = await state();
      await assert.rejects(producer.produce(input), /EVENT_NOT_APPLIED/);
      assert.deepEqual(await state(), failed);
      assert.deepEqual(await db.getCollection("zReports"), []);
      assert.deepEqual(await db.getCollection("internalSequences"), []);
      assert(calls.length >= 3);
    } finally {
      await reader?.end();
      await admin?.end();
      if (started) await pg.stop();
      await rm(directory, { recursive: true, force: true });
      local.close();
    }
  },
);
