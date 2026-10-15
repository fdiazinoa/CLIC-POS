import { requireFormat } from './wire';
import type { FormatSQL, FormatStatement } from './store';

/** A unit of work over the existing native document store. Tracks IDs and changed rows only. */
export class FormatLocalDocuments {
 private readonly originals = new Map<string, Map<string, string>>();
 private readonly ids = new WeakMap<object, string>();
 constructor(private readonly sql: FormatSQL) {}
 async read(name: string): Promise<any[]> {
  if (this.sql.storageLayout !== 'DOCUMENTS') {
   const rows = await this.sql.query<{value: string}>('SELECT value FROM collections WHERE key=?', [name]);
   const docs = rows[0] ? JSON.parse(rows[0].value) : [];
   requireFormat(Array.isArray(docs), 'POS_FORMAT_LOCAL_COLLECTION_INVALID');
   return docs;
  }
  const rows = await this.sql.query<{doc_id: string; data: string}>(
   'SELECT doc_id,data FROM documents WHERE collection_name=? ORDER BY sort_order,doc_id', [name]);
  const originals = new Map<string, string>();
  this.originals.set(name, originals);
  return rows.map(row => {
   const doc = JSON.parse(row.data);
   requireFormat(doc && typeof doc === 'object' && !Array.isArray(doc), 'POS_FORMAT_LOCAL_DOCUMENT_INVALID');
   originals.set(row.doc_id, row.data); this.ids.set(doc, row.doc_id); return doc;
  });
 }
 writes(name: string, docs: any[], at: string): FormatStatement[] {
  if (this.sql.storageLayout !== 'DOCUMENTS') return [{statement:
   'INSERT OR REPLACE INTO collections(key,value,updatedAt) VALUES(?,?,?)', values: [name, JSON.stringify(docs), at]}];
  const originals = this.originals.get(name);
  requireFormat(originals, 'POS_FORMAT_LOCAL_COLLECTION_NOT_READ');
  const seen = new Set<string>();
  return docs.flatMap(doc => {
   const id = this.ids.get(doc) || String(doc.id || '');
   requireFormat(id && !seen.has(id), 'POS_FORMAT_IDENTITY_CONFLICT'); seen.add(id);
   const data = JSON.stringify(doc);
   if (originals.get(id) === data) return [];
   return [{statement: `INSERT INTO documents(collection_name,doc_id,data,sort_order,updatedAt)
    VALUES(?,?,?,COALESCE((SELECT sort_order FROM documents WHERE collection_name=? AND doc_id=?),
     (SELECT COALESCE(MAX(sort_order)+1,0) FROM documents WHERE collection_name=?)),?)
    ON CONFLICT(collection_name,doc_id) DO UPDATE SET data=excluded.data,updatedAt=excluded.updatedAt`,
    values: [name,id,data,name,id,name,at]}];
  });
 }
}
