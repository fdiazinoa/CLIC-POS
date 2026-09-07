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
  let scope = "company:terminal";
  let enabled = true;
  function open() {
    sql = new DatabaseSync(join(dir, "pos.sqlite"));
    sql.exec(
      "CREATE TABLE IF NOT EXISTS documents(collection_name TEXT NOT NULL,doc_id TEXT NOT NULL,data TEXT NOT NULL,sort_order INTEGER,updatedAt TEXT,PRIMARY KEY(collection_name,doc_id))",
    );
    const base = new CapacitorSQLiteAdapter();
    Object.assign(base, {
      isReady: true,
      db: {
        query: async (q: string, p: any[]) => ({
          values: sql.prepare(q).all(...p),
        }),
        executeSet: async (rows: any[]) => {
          sql.exec("BEGIN");
          try {
            for (const row of rows) {
              sql.prepare(row.statement).run(...row.values);
              if (failWrite) throw Error("disk failed");
            }
            sql.exec("COMMIT");
          } catch (e) {
            sql.exec("ROLLBACK");
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
    scope(v: string) {
      scope = v;
    },
    enabled(v: boolean) {
      enabled = v;
    },
  };
}
