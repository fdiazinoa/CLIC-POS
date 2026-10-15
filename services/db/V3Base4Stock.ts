import {Money,requireFormat} from '../articleFormats/wire';

type Query=<T>(sql:string,values:(string|number|null)[])=>Promise<T[]>;
const maximum='99999999999.9999';
export function base4(value:unknown):InstanceType<typeof Money> {
 requireFormat(typeof value==='number'&&Number.isFinite(value),'POS_FORMAT_PRECISION_INVALID');
 const quantity=new Money(String(value));
 requireFormat(quantity.dp()<=4&&quantity.abs().lte(maximum),'POS_FORMAT_PRECISION_INVALID');
 return quantity;
}

/** Exact BASE4 stock authority. Validate each stored operand before integer scaling; never round a historical aggregate. */
export async function readV3Base4Stock(query:Query,baseline:string,itemId:string,warehouseId:string) {
 const qtyIn="COALESCE(json_extract(data,'$.qtyIn'),0)",qtyOut="COALESCE(json_extract(data,'$.qtyOut'),0)";
 const valid=(field:string,path:string)=>`(COALESCE(json_type(data,'$.${path}'),'null') IN ('integer','real','null')
  AND ${field}=${field} AND ABS(${field})<=99999999999.9999 AND ${field}>=0 AND ${field}=ROUND(${field},4))`;
 const predicate="collection_name='inventoryLedger' AND json_extract(data,'$.v3InventoryBaseline')=? AND json_extract(data,'$.productId')=? AND json_extract(data,'$.warehouseId')=?";
 const baselineRows=await query<any>('SELECT qty_on_hand,qty_reserved,qty_committed FROM master_v3_inventory_balances WHERE item_id=? AND warehouse_id=?',[itemId,warehouseId]);
 requireFormat(baselineRows.length===1,'POS_FORMAT_STOCK_BASELINE_MISSING');
 const stored=baselineRows[0],onHand=base4(stored.qty_on_hand),reserved=base4(stored.qty_reserved),committed=base4(stored.qty_committed);
 const validOperands=`${valid(qtyIn,'qtyIn')} AND ${valid(qtyOut,'qtyOut')}`;
 const rows=await query<any>(`SELECT
  COALESCE(MAX(CASE WHEN ${validOperands} THEN 0 ELSE 1 END),0) AS invalid_operand,
  COALESCE(SUM(CASE WHEN ${validOperands} THEN CAST(ROUND(${qtyIn}*10000) AS INTEGER)-CAST(ROUND(${qtyOut}*10000) AS INTEGER) ELSE 0 END),0) AS delta_scaled
  FROM documents WHERE ${predicate}`,[baseline,itemId,warehouseId]);
 const row=rows[0];
 requireFormat(row&&Number(row.invalid_operand)===0&&Number.isSafeInteger(row.delta_scaled),'POS_FORMAT_PRECISION_INVALID');
 const physical=onHand.plus(new Money(row.delta_scaled).div(10000));
 requireFormat(physical.dp()<=4&&physical.abs().lte(maximum),'POS_FORMAT_PRECISION_INVALID');
 return {physical,reserved,committed,available:physical.minus(reserved).minus(committed)};
}
