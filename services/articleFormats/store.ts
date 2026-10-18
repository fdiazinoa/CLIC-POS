import {cloneFormatJSON} from './json';
import type { ArticleFormatLine, ArticleFormatMasterPage, ArticleFormatsDTO, ArticleFormatScope } from './contract';
import { ArticleFormatError, baseCost, exactDecimal, inventoryQuantity, snapshot, validateDTO } from './domain';
import { ARTICLE_FORMATS_SCHEMA } from './schema';

export interface FormatStatement { statement: string; values?: (string | number | null)[] }
export interface FormatSQL {
  /** Native develop uses canonical document rows; omitted only by legacy isolated fixtures. */
  readonly storageLayout?: 'DOCUMENTS';
  /** Native writers do not yet share the complete financial read/mutate/commit boundary. */
  readonly financialPostingReadiness?: 'NATIVE_UNPROVEN' | 'ISOLATED_SQLITE' | 'NATIVE_V3_TRANSACTION';
  /** Authoritative planning reads and writes share one tracked native transaction. Internal support, not network readiness. */
  runFinancial?<T>(work: (sql: FormatSQL) => Promise<T>): Promise<T>;
  /** Existing native V3 financial preconditions, executed on the scoped transaction connection. */
  assertFinancialDocuments?(documents: import('../db/DatabaseAdapter').DurableDocumentMutation[]): Promise<void>;
  executeSchema(sql: string): Promise<void>;
  /** Serializes reads/planning and commit with legacy collection writers. */
  runExclusive?<T>(work: (sql: FormatSQL) => Promise<T>): Promise<T>;
  /** Must be one atomic native/SQLite transaction, not interleavable JS BEGIN/RUN/COMMIT. */
  executeAtomic(statements: FormatStatement[]): Promise<void>;
  query<T>(sql: string, values: (string | number | null)[]): Promise<T[]>;
}

export function canonicalContent(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalContent).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined)
    .sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,v]) => `${JSON.stringify(key)}:${canonicalContent(v)}`).join(',')}}`;
  if (typeof value === 'number' && !Number.isFinite(value)) throw new ArticleFormatError('ARTICLE_FORMAT_INVALID_DECIMAL');
  if (value === undefined || typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') throw new ArticleFormatError('ARTICLE_FORMAT_NON_JSON_PAYLOAD');
  return JSON.stringify(value);
}

const scopeValues = (scope: ArticleFormatScope): [string,string] => {
  if (typeof scope.tenantId !== 'string' || !scope.tenantId || typeof scope.companyId !== 'string' || !scope.companyId) throw new ArticleFormatError('ARTICLE_FORMAT_SCOPE_REQUIRED');
  return [scope.tenantId,scope.companyId];
};
const insert = (table: string, columns: string, values: (string|number|null)[]): FormatStatement => ({
  statement: `INSERT OR IGNORE INTO ${table} (${columns}) VALUES (${values.map(() => '?').join(',')})`, values
});
const scaledBase = (quantity: number): number => exactDecimal(quantity).mul(10000).toNumber();

/** Internal persisted contract; it must be mapped to a future negotiated ERP protocol. */
export interface FormatLocalEvent {
  scope: ArticleFormatScope;
  eventId: string;
  terminalId: string;
  kind: 'SALE' | 'REFUND' | 'VOID';
  warehouseId: string;
  lines: (ArticleFormatLine & { baseUnitCost: number; originalSaleEventId?: string; originalSaleLineId?: string;
    physicalReturn?: 'RESTOCK' | 'DAMAGED' | 'NO_RETURN' })[];
  fiscalDocument: unknown;
}

export class ArticleFormatStore {
  constructor(private readonly sql: FormatSQL, readonly scope: ArticleFormatScope,
    private readonly authorizedTariffIds: readonly string[], private readonly terminalId: string) {
    scopeValues(scope);
    if (!terminalId) throw new ArticleFormatError('ARTICLE_FORMAT_TERMINAL_REQUIRED');
  }
  migrate(): Promise<void> { return this.sql.executeSchema(ARTICLE_FORMATS_SCHEMA); }
  private assertScope(scope: ArticleFormatScope) {
    if (scope.tenantId !== this.scope.tenantId || scope.companyId !== this.scope.companyId) throw new ArticleFormatError('ARTICLE_FORMAT_SCOPE_MISMATCH');
  }

  async applyMasterPage(page: ArticleFormatMasterPage): Promise<void> {
    this.assertScope(page.scope);
    if (!page.pageId || !Number.isSafeInteger(page.revision) || page.revision < 0 || !Array.isArray(page.items)
      || page.items.length > 1000 || !(page.nextCursor === null || typeof page.nextCursor === 'string')) throw new ArticleFormatError('ARTICLE_FORMAT_INVALID_PAGE');
    const scope = scopeValues(this.scope);
    const items = page.items.map(item => validateDTO(item,this.authorizedTariffIds));
    const itemIds = new Set(items.map(item => item.item_id));
    if (itemIds.size !== items.length) throw new ArticleFormatError('ARTICLE_FORMAT_DUPLICATE_ITEM');
    const statements = [insert('article_format_master_pages','tenant_id,company_id,page_id,revision,content,next_cursor',
      [...scope,page.pageId,page.revision,canonicalContent(page),page.nextCursor])];
    for (const dto of items) {
      statements.push(insert('article_format_revisions','tenant_id,company_id,item_id,revision,content',
        [...scope,dto.item_id,page.revision,canonicalContent(dto)]));
      for (const format of dto.formats) {
        const variantKey = JSON.stringify(format.variantId);
        statements.push(insert('article_formats','tenant_id,company_id,item_id,revision,variant_key,format_id,barcode,content',
          [...scope,dto.item_id,page.revision,variantKey,format.id,format.barcode,canonicalContent(format)]));
        for (const price of format.prices) statements.push(insert('article_format_prices',
          'tenant_id,company_id,item_id,revision,variant_key,format_id,tariff_id,price',
          [...scope,dto.item_id,page.revision,variantKey,format.id,price.tariffId,String(price.price)]));
      }
    }
    await this.sql.executeAtomic(statements);
  }

  async getMaster(itemId: string): Promise<ArticleFormatsDTO | undefined> {
    const rows = await this.sql.query<{content:string}>('SELECT content FROM article_format_revisions WHERE tenant_id=? AND company_id=? AND item_id=? ORDER BY revision DESC LIMIT 1', [...scopeValues(this.scope),itemId]);
    return rows[0] ? JSON.parse(rows[0].content) : undefined;
  }

  async findBarcode(barcode: string) {
    const rows = await this.sql.query<{item_id:string;content:string}>(`SELECT f.item_id,f.content FROM article_formats f
      WHERE f.tenant_id=? AND f.company_id=? AND f.barcode=? AND f.revision=(SELECT MAX(r.revision) FROM article_format_revisions r
       WHERE r.tenant_id=f.tenant_id AND r.company_id=f.company_id AND r.item_id=f.item_id)`,[...scopeValues(this.scope),barcode]);
    const matches = rows.map(row => ({itemId:row.item_id,format:JSON.parse(row.content) as ArticleFormatsDTO['formats'][number]}))
      .filter(row => row.format.active && row.format.allow_sale);
    if (matches.length > 1) throw new ArticleFormatError('ARTICLE_FORMAT_AMBIGUOUS_BARCODE');
    return matches[0] || null;
  }

  async pendingMasterACKs() {
    return this.sql.query<{page_id:string;revision:number;next_cursor:string|null}>('SELECT page_id,revision,next_cursor FROM article_format_master_pages WHERE tenant_id=? AND company_id=? AND acked=0 ORDER BY revision,page_id',scopeValues(this.scope));
  }
  async ackMasterPage(pageId: string): Promise<void> {
    await this.sql.executeAtomic([{statement:'UPDATE article_format_master_pages SET acked=1 WHERE tenant_id=? AND company_id=? AND page_id=?',values:[...scopeValues(this.scope),pageId]}]);
  }

  async commitLocalEvent(event: FormatLocalEvent): Promise<void> {
    // Own the entire payload before awaits; callers cannot mutate durable content mid-commit.
    event = cloneFormatJSON(event);
    this.assertScope(event.scope);
    if (event.terminalId !== this.terminalId || !event.eventId || !event.warehouseId || !event.lines.length
      || !['SALE','REFUND','VOID'].includes(event.kind)) throw new ArticleFormatError('ARTICLE_FORMAT_INVALID_EVENT');
    const ids = new Set<string>();
    const scope = scopeValues(this.scope);
    const statements = [insert('article_format_outbox','tenant_id,company_id,event_id,terminal_id,kind,content',
      [...scope,event.eventId,event.terminalId,event.kind,canonicalContent(event)])];
    for (const line of event.lines) {
      if (!line.cartId || !line.id || ids.has(line.cartId) || !line.articleFormat || line.quantity <= 0
        || (line.variantSku !== undefined && line.variantSku !== (line.articleFormat.variantId || undefined))) throw new ArticleFormatError('ARTICLE_FORMAT_INVALID_LINE');
      ids.add(line.cartId);
      const base = scaledBase(inventoryQuantity(line));
      const frozen = canonicalContent(snapshot(line.articleFormat));
      baseCost(line.baseUnitCost);
      if (exactDecimal(line.price).isNegative()) throw new ArticleFormatError('ARTICLE_FORMAT_INVALID_PRICE');
      if (event.kind === 'SALE') {
        statements.push(insert('article_format_sale_lines','tenant_id,company_id,event_id,line_id,item_id,snapshot,sold_base,content',
          [...scope,event.eventId,line.cartId,line.id,frozen,base,canonicalContent(line)]));
      } else {
        if (!line.originalSaleEventId || !line.originalSaleLineId || !line.physicalReturn
          || !['RESTOCK','DAMAGED','NO_RETURN'].includes(line.physicalReturn)) throw new ArticleFormatError('ARTICLE_FORMAT_RETURN_POLICY_REQUIRED');
        const originals = await this.sql.query<{item_id:string;content:string}>('SELECT item_id,content FROM article_format_sale_lines WHERE tenant_id=? AND company_id=? AND event_id=? AND line_id=?',
          [...scope,line.originalSaleEventId,line.originalSaleLineId]);
        const original = originals[0] && JSON.parse(originals[0].content);
        if (!original || originals[0].item_id !== line.id || original.price !== line.price || original.baseUnitCost !== line.baseUnitCost) throw new ArticleFormatError('ARTICLE_FORMAT_ORIGINAL_LINE_MISSING_OR_CHANGED');
        statements.push(insert('article_format_returns','tenant_id,company_id,event_id,line_id,sale_event_id,sale_line_id,snapshot,returned_base,physical_return',
          [...scope,event.eventId,line.cartId,line.originalSaleEventId,line.originalSaleLineId,frozen,base,line.physicalReturn]));
      }
      const delta = event.kind === 'SALE' ? -base : line.physicalReturn === 'RESTOCK' ? base : 0;
      statements.push(insert('article_format_base_movements','tenant_id,company_id,event_id,line_id,item_id,variant_key,warehouse_id,base_delta,base_unit_cost',
        [...scope,event.eventId,line.cartId,line.id,JSON.stringify(line.articleFormat.variantId),event.warehouseId,delta,baseCost(line.baseUnitCost)]));
    }
    await this.sql.executeAtomic(statements);
  }

  async pendingEvents(): Promise<FormatLocalEvent[]> {
    const rows = await this.sql.query<{content:string}>(`SELECT content FROM article_format_outbox WHERE tenant_id=? AND company_id=? AND state=? AND json_extract(content,'$.schema_version') IS NULL ORDER BY rowid`,[...scopeValues(this.scope),'PENDING']);
    return rows.map(row => JSON.parse(row.content));
  }
  async ackEvent(event: FormatLocalEvent): Promise<void> {
    this.assertScope(event.scope);
    const rows = await this.sql.query<{content:string}>('SELECT content FROM article_format_outbox WHERE tenant_id=? AND company_id=? AND event_id=?',[...scopeValues(this.scope),event.eventId]);
    if (!rows[0] || rows[0].content !== canonicalContent(event)) throw new ArticleFormatError('ARTICLE_FORMAT_ACK_CONFLICT');
    await this.sql.executeAtomic([{statement:'UPDATE article_format_outbox SET state=? WHERE tenant_id=? AND company_id=? AND event_id=? AND content=?',
      values:['ACKED',...scopeValues(this.scope),event.eventId,canonicalContent(event)]}]);
  }
}
