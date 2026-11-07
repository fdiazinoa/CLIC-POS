/** Local PostgREST-shaped transport to the owned fixture DB. Every operation
 * executes PostgreSQL; no substituted rows, financial effects or success flags. */
export function localPgClient(db: any) {
    const identifier = (value: string) => { if (!/^[a-z_][a-z0-9_]*$/i.test(value))
        throw Error('Unsafe fixture identifier ' + value); return '"' + value + '"'; };
    const column = (value: string) => { const parts = value.split(/(->>|->)/); if (parts.length === 1)
        return identifier(value.trim()); let result = identifier(parts[0]); for (let i = 1; i < parts.length; i += 2) {
        if (!/^[a-z_][a-z0-9_]*$/i.test(parts[i + 1]))
            throw Error('Unsafe fixture JSON path');
        result += parts[i] + "'" + parts[i + 1] + "'";
    } return result; };
    return { async rpc(name: string, args: Record<string, unknown>) { try {
            const entries = Object.entries(args);
            const result = await db.query(`select public.${identifier(name)}(${entries.map(([k], i) => identifier(k) + ' => $' + (i + 1)).join(',')}) result`, entries.map(([, v]) => v));
            return { data: result.rows[0].result, error: null };
        }
        catch (error) {
            return { data: null, error };
        } }, from(table: string) { identifier(table); const values: any[] = [], where: string[] = [], orders: string[] = []; let single = false, columns = '*', maximum: number | null = null, method = 'select', payload: any, offset = 0; const bind = (v: any) => { values.push(v && typeof v === 'object' ? JSON.stringify(v) : v); return '$' + values.length; }; const compare = (key: string, op: string, v: any) => { where.push(column(key) + ' ' + op + ' ' + bind(v)); return q; }; const q: any = { select(c = '*') { columns = c; return q; }, eq: (k: string, v: any) => compare(k, '=', v), neq: (k: string, v: any) => compare(k, '<>', v), gt: (k: string, v: any) => compare(k, '>', v), gte: (k: string, v: any) => compare(k, '>=', v), lt: (k: string, v: any) => compare(k, '<', v), lte: (k: string, v: any) => compare(k, '<=', v), ilike: (k: string, v: any) => compare(k, 'ilike', v), contains: (k: string, v: any) => compare(k, '@>', v), is(k: string, v: any) { if (v !== null)
                throw Error('Only NULL fixture predicate'); where.push(column(k) + ' is null'); return q; }, in(k: string, v: any[]) { where.push(column(k) + ' in (' + v.map(bind).join(',') + ')'); return q; }, order(k: string, o: any = {}) { orders.push(column(k) + (o.ascending === false ? ' desc' : ' asc')); return q; }, limit(v: number) { maximum = v; return q; }, range(a: number, b: number) { offset = a; maximum = b - a + 1; return q; }, maybeSingle() { single = true; return q; }, single() { single = true; return q; }, insert(v: any) { method = 'insert'; payload = v; return q; }, update(v: any) { method = 'update'; payload = v; return q; }, delete() { method = 'delete'; return q; }, async then(done: any) { try {
                const projection = columns === '*' ? '*' : columns.replace('binding:erp_dispatch_bindings(terminal_id,device_id,store_id)','__dispatch_binding').split(',').map((key:string)=>key==='__dispatch_binding'&&table==='erp_dispatch_native_captures'?`(select jsonb_build_object('terminal_id',b.terminal_id,'device_id',b.device_id,'store_id',b.store_id) from erp_dispatch_bindings b where b.id=erp_dispatch_native_captures.binding_id and b.tenant_id=erp_dispatch_native_captures.tenant_id and b.company_id=erp_dispatch_native_captures.company_id) as binding`:column(key)).join(',');
                let sql;
                if (method === 'insert') {
                    const rows = Array.isArray(payload) ? payload : [payload], keys = Object.keys(rows[0]);
                    sql = 'insert into ' + identifier(table) + '(' + keys.map(identifier).join(',') + ') values ' + rows.map(row => '(' + keys.map(k => bind(row[k])).join(',') + ')').join(',');
                }
                else if (method === 'update')
                    sql = 'update ' + identifier(table) + ' set ' + Object.entries(payload).map(([k, v]) => identifier(k) + '=' + bind(v)).join(',');
                else
                    sql = method === 'delete' ? 'delete from ' + identifier(table) : 'select ' + projection + ' from ' + identifier(table);
                if (where.length)
                    sql += ' where ' + where.join(' and ');
                if (method === 'select') {
                    if (orders.length)
                        sql += ' order by ' + orders.join(',');
                    if (maximum !== null)
                        sql += ' limit ' + Number(maximum);
                    sql += ' offset ' + Number(offset);
                }
                else
                    sql += ' returning ' + projection;
                const rows = (await db.query(sql, values)).rows;
                done({ data: single ? rows[0] || null : rows, error: null, count: rows.length });
            }
            catch (error) {
                done({ data: null, error });
            } } }; return q; } };
}
