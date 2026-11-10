import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createSupermarketLineInteraction } from '../utils/supermarketLineInteraction';
import { transform } from 'esbuild';
import { resetCompletedSaleDiscount, type CheckoutDiscount } from '../utils/checkoutDiscountLifecycle';

test('click and long-press open one line each without a duplicate synthetic click', () => {
  let timestamp = 1000;
  const opened: string[] = [];
  const interaction = createSupermarketLineInteraction((cartId) => opened.push(cartId), () => timestamp);
  interaction.click('line-a');
  assert.deepEqual(opened, ['line-a']);

  let prevented = 0;
  timestamp += 100;
  interaction.contextMenu('line-a', { preventDefault: () => { prevented += 1; } });
  interaction.click('line-a'); // Android's click following a long touch.
  assert.equal(prevented, 1);
  assert.deepEqual(opened, ['line-a', 'line-a']);

  interaction.click('line-b'); // A different line must remain responsive.
  assert.deepEqual(opened, ['line-a', 'line-a', 'line-b']);
  timestamp += 701;
  interaction.click('line-a');
  assert.deepEqual(opened, ['line-a', 'line-a', 'line-b', 'line-a']);
});

test('keyboard activation ignores events from nested controls', () => {
  const opened: string[] = [];
  const interaction = createSupermarketLineInteraction((cartId) => opened.push(cartId));
  let prevented = 0;
  interaction.keyDown('line-a', { key: 'Enter', isRowTarget: false, preventDefault: () => { prevented += 1; } });
  interaction.keyDown('line-a', { key: 'Enter', isRowTarget: true, preventDefault: () => { prevented += 1; } });
  interaction.keyDown('line-a', { key: ' ', isRowTarget: true, preventDefault: () => { prevented += 1; } });
  assert.deepEqual(opened, ['line-a', 'line-a']);
  assert.equal(prevented, 2);
});

test('supermarket ticket exposes the selected line for keyboard and touch editing', () => {
  const table = readFileSync(new URL('../components/ProductTableSupermarket.tsx', import.meta.url), 'utf8');
  assert.match(table, /tabIndex=\{0\}/);
  assert.match(table, /aria-label=\{`Editar \$\{item\.name\}, cantidad \$\{item\.quantity\}`\}/);
  assert.doesNotMatch(table, /opacity-0 group-hover:opacity-100/);
});

test('the supermarket row opens the existing permission-aware editor using the canonical cart line', () => {
  const pos = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const table = readFileSync(new URL('../components/ProductTableSupermarket.tsx', import.meta.url), 'utf8');
  assert.match(pos, /cart\.find\(item => item\.cartId === cartId\)/);
  assert.match(pos, /if \(selectedLine\) setEditingItem\(selectedLine\)/);
  assert.match(pos, /<CartItemOptionsModal[\s\S]*?canVoidItem=\{cartItemEditCapabilities\.canVoidItem/);
  assert.match(table, /lineInteraction\.contextMenu\(item\.cartId, event\)/);
  assert.match(table, /isRowTarget: event\.target === event\.currentTarget/);
  assert.match(table, /onRemoveItem: \(cartId: string\) => void/);
  assert.match(pos, /onRemoveItem=\{\(cartId\) => \{ void updateCartItem\(null, cartId\); \}\}/);
});

test('completed checkout clears discount on every cart-closing path but not a partial fraction', () => {
  const pos = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  let currentDiscount: CheckoutDiscount = { type: 'FIXED', value: 65 };
  resetCompletedSaleDiscount((discount) => { currentDiscount = discount; });
  assert.deepEqual(currentDiscount, { type: 'PERCENT', value: 0 });
  for (const reason of ['POS_CLEAR_05', 'POS_CLEAR_06', 'POS_CLEAR_07']) {
    const index = pos.indexOf(`reason: '${reason}'`);
    assert.ok(index > 0, `${reason} success path exists`);
    assert.match(pos.slice(index, index + 240), /onUpdateCart\(\[\]\);\s*resetCompletedSaleDiscount\(setGlobalDiscount\)/);
  }
  const partial = pos.indexOf('if (currentFractionPart && pendingFractionParts.length > 1)');
  const completed = pos.indexOf('if (currentFractionPart && pendingFractionParts.length === 1)');
  assert.ok(partial > 0 && completed > partial);
  assert.doesNotMatch(pos.slice(partial, completed), /setGlobalDiscount/);
});

test('retail desktop restores clear-ticket through the existing permission-aware handler', () => {
  const pos = readFileSync(new URL('../components/POSInterface.tsx', import.meta.url), 'utf8');
  const start = pos.indexOf('data-testid="desktop-ticket-toolbar"');
  const toolbar = pos.slice(start, pos.indexOf('</TicketStatusControls>', start));
  assert.match(toolbar, /aria-label="Eliminar todos los artículos"/);
  assert.match(toolbar, /void handleClearFreshCartItems\(\)/);
  const handler=pos.slice(pos.indexOf('const handleClearFreshCartItems'),pos.indexOf('const syncConsignmentSettlement'));
  assert.match(handler,/clicConfirm/);
  assert.match(handler,/POS_VOID_ITEM/);
  assert.match(handler,/POS_VOID_SUBTOTALIZED_TICKET/);
  assert.match(handler,/cart\.filter\(item => !isKitchenDispatchedCartItem\(item\)\)/);
});

async function actualClearHandler(overrides: Record<string, unknown> = {}) {
  const source=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
  const begin=source.indexOf('const handleClearFreshCartItems =');
  const end=source.indexOf('const syncConsignmentSettlement',begin);
  const result=await transform(source.slice(begin,end)+'return handleClearFreshCartItems;', {loader:'ts'});
  const changes:unknown[]=[];
  const scope={cart:[{cartId:'a'},{cartId:'b'}],blockRecoveredUberOrderMutation:()=>false,
    hasSubtotalizedCart:false,isKitchenDispatchedCartItem:(item:any)=>item.dispatched===true,
    canReverseRestaurantDraftWithoutApproval:()=>false,isRestaurantOrderContext:false,
    clicConfirm:async()=>true,requestApproval:async()=>true,activeTerminalConfig:{},activeTable:null,
    activeDirectV3TicketId:undefined,onUpdateCart:(value:unknown)=>changes.push(value),
    setActiveCartItemId:()=>{},setEditingItem:()=>{},setSuccessToast:()=>{},...overrides};
  const handler=new Function(...Object.keys(scope),result.code)(...Object.values(scope));
  return {handler,changes};
}

test('clear-ticket cancellation or rejected approval preserves the cart',async()=>{
  for(const overrides of [{clicConfirm:async()=>false},{requestApproval:async()=>false}]) {
    const f=await actualClearHandler(overrides);await f.handler();assert.deepEqual(f.changes,[]);
  }
});
test('approved clear removes the whole fresh ticket and retains dispatched lines',async()=>{
  const all=await actualClearHandler();await all.handler();assert.deepEqual(all.changes,[[]]);
  const dispatched={cartId:'kitchen',dispatched:true};
  const mixed=await actualClearHandler({cart:[{cartId:'fresh'},dispatched]});
  await mixed.handler();assert.deepEqual(mixed.changes,[[dispatched]]);
});

test('direct line removal keeps authorization, kitchen protection and the other cart lines',async()=>{
  const source=readFileSync(new URL('../components/POSInterface.tsx',import.meta.url),'utf8');
  const begin=source.indexOf('const updateCartItem =');
  const end=source.indexOf('const handleClearAllCartItems',begin);
  const result=await transform(source.slice(begin,end)+'return updateCartItem;', {loader:'ts'});
  for(const mode of ['approved','denied','dispatched']) {
    const changes:unknown[]=[];const alerts:string[]=[];const approvals:string[]=[];
    const first={cartId:'a',dispatched:mode==='dispatched'},second={cartId:'b'};
    const scope={cart:[first,second],blockRecoveredUberOrderMutation:()=>false,hasSubtotalizedCart:false,
      authorizeSubtotalizedEdit:async()=>true,canReverseRestaurantDraftWithoutApproval:()=>false,
      isRestaurantOrderContext:false,isKitchenDispatchedCartItem:(item:any)=>item?.dispatched===true,
      isKdsReturnedCartItem:()=>false,alert:(message:string)=>alerts.push(message),
      activeTerminalConfig:{},activeTable:null,editingItem:null,
      requestApproval:async({permission}:any)=>{approvals.push(permission);return mode!=='denied';},
      onUpdateCart:(value:unknown)=>changes.push(value)};
    const handler=new Function(...Object.keys(scope),result.code)(...Object.values(scope));
    await handler(null,'a');
    assert.deepEqual(changes,mode==='approved'?[[second]]:[]);
    assert.deepEqual(approvals,mode==='dispatched'?[]:['POS_VOID_ITEM']);
    assert.equal(alerts.length,mode==='dispatched'?1:0);
  }
});
