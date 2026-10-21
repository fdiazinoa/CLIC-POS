import { FISCAL_WORKFLOW_V2_SCHEMA } from "../../services/db/FiscalWorkflowV2Store";
import { DURABLE_OUTBOX_SCHEMA_SQL } from "../../services/sync/DurableOutboxSchema";
import { FISCAL_RETIREMENT_WRITER_SCHEMA } from "../../services/db/FiscalWorkflowRetirementStore";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapacitorSQLiteAdapter } from "../../services/db/adapters/CapacitorSQLiteAdapter";
import { recoveryDatabase } from "../../services/recovery/RecoveryDatabase";
import { ClosePreparation } from "../../services/recovery/ClosePreparation";
export function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pos-close-preparation-"));
  let sql: DatabaseSync;
  let failWrite = false;
  let failCollection: string | null = null;
  let scope = "company:terminal";
  let enabled = true;
  function open() {
    sql = new DatabaseSync(join(dir, "pos.sqlite"));
    sql.exec(
      "CREATE TABLE IF NOT EXISTS documents(collection_name TEXT NOT NULL,doc_id TEXT NOT NULL,data TEXT NOT NULL,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id))",
    );
    sql.exec(FISCAL_WORKFLOW_V2_SCHEMA + DURABLE_OUTBOX_SCHEMA_SQL + "CREATE TABLE IF NOT EXISTS sync_queue(id TEXT PRIMARY KEY,type TEXT,payload TEXT,status TEXT);" + FISCAL_RETIREMENT_WRITER_SCHEMA);
    const base = new CapacitorSQLiteAdapter();
    Object.assign(base, {
      isReady: true,
      db: {
        query: async (q: string, p: any[]=[]) => ({
          values: sql.prepare(q).all(...p),
        }),
        execute: async (statement: string,transaction=true) => {
          if(transaction)sql.exec("BEGIN");
          try{sql.exec(statement);if(transaction)sql.exec("COMMIT");}
          catch(error){if(transaction)sql.exec("ROLLBACK");throw error;}
        },
        run: async (statement: string,values: any[]=[],transaction=true) => {
          if(transaction)sql.exec("BEGIN");
          try{
            const result=sql.prepare(statement).run(...values);
            if(failWrite||(failCollection&&values[0]===failCollection))throw Error("disk failed");
            if(transaction)sql.exec("COMMIT");
            return {changes:result};
          }catch(error){if(transaction)sql.exec("ROLLBACK");throw error;}
        },
        executeSet: async (rows: any[],transaction=true) => {
          if(transaction)sql.exec("BEGIN");
          try {
            for (const row of rows) {
              sql.prepare(row.statement).run(...row.values);
              if (failWrite || (failCollection && row.values?.[0] === failCollection)) throw Error("disk failed");
            }
            if(transaction)sql.exec("COMMIT");
          } catch (e) {
            if(transaction)sql.exec("ROLLBACK");
            throw e;
          }
        },
      },
    });
    const db = recoveryDatabase(
      base,
      () => enabled,
      () => ({ key: scope, terminalId: "T1" }),
    );
    return { db, prepare: new ClosePreparation(db) };
  }
  return {
    open,
    restart() {
      sql.close();
      return open();
    },
    close() {
      sql.close();
      rmSync(dir, { recursive: true });
    },
    fail(v: boolean) {
      failWrite = v;
    },
    failOnCollection(v: string | null) {
      failCollection = v;
    },
    scope(v: string) {
      scope = v;
    },
    enabled(v: boolean) {
      enabled = v;
    },
  };
}
